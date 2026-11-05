"""Sign-in for everyone: staff and patients use the same login, then go to their own dashboard."""
from datetime import timedelta

import psycopg
from fastapi import Request

from app.config import settings
from app.core import audit
from app.core.errors import AppError, field_error
from app.core.normalize import normalize_email, normalize_phone
from app.core.ratelimit import forgot_limit, login_limit
from app.core.security import (
    burn_time, hash_password, hash_token, match_totp, mfa_qr, mfa_uri, needs_rehash, new_mfa_secret,
    new_session_token, password_problem, verify_password,
)
from app.core.session import Ctx, client_info, load_ctx, revoke_sessions

MAX_FAILED_ATTEMPTS = 5
LOCK_MINUTES = 15
MAX_MFA_FAILURES = 5


def find_user(conn: psycopg.Connection, identifier: str) -> dict | None:
    identifier = identifier.strip()
    if "@" in identifier:
        email = normalize_email(identifier)
        if not email:
            return None
        return conn.execute("SELECT * FROM users WHERE email = %s", (email,)).fetchone()
    phone = normalize_phone(identifier)
    if not phone:
        return None
    return conn.execute("SELECT * FROM users WHERE phone = %s", (phone,)).fetchone()


def _mask(identifier: str) -> str:
    identifier = identifier.strip()
    if "@" in identifier:
        name, _, domain = identifier.partition("@")
        return f"{name[:2]}***@{domain}"
    return f"***{identifier[-3:]}"


def start_session(conn: psycopg.Connection, user: dict, request: Request) -> str:
    ip, user_agent = client_info(request)
    token = new_session_token()
    lifetime = (
        timedelta(days=settings.patient_session_days)
        if user["kind"] == "patient"
        else timedelta(hours=settings.staff_session_hours)
    )
    conn.execute(
        """
        INSERT INTO sessions (token_hash, user_id, ip, user_agent, expires_at)
        VALUES (%s, %s, %s, %s, now() + %s)
        """,
        (hash_token(token), user["id"], ip, user_agent, lifetime),
    )
    conn.execute(
        """
        UPDATE users SET previous_login_at = last_login_at, previous_login_ip = last_login_ip,
                         last_login_at = now(), last_login_ip = %s, failed_attempts = 0, locked_until = NULL
        WHERE id = %s
        """,
        (ip, user["id"]),
    )
    return token


def login(conn: psycopg.Connection, identifier: str, password: str, request: Request) -> tuple[str, Ctx]:
    ip, user_agent = client_info(request)
    login_limit.check(ip)
    user = find_user(conn, identifier)

    def fail(code: str, status: int = 401, **extra):
        conn.commit()
        raise AppError(status, code, **extra)

    if user is None:
        burn_time(password)
        audit.record(conn, "auth.login_failed", details={"identifier": _mask(identifier), "reason": "unknown_account"},
                     ip=ip, user_agent=user_agent)
        fail("invalid_credentials")

    locked = conn.execute("SELECT %s::timestamptz > now() AS locked", (user["locked_until"],)).fetchone()["locked"]
    if user["locked_until"] and locked:
        burn_time(password)
        audit.record(conn, "auth.login_blocked", actor_id=user["id"], actor_label=user["full_name_en"] or user["full_name_ar"],
                     entity="user", entity_id=user["id"], details={"reason": "locked"}, ip=ip, user_agent=user_agent)
        fail("account_locked", status=423)

    if not verify_password(user["password_hash"], password):
        attempts = user["failed_attempts"] + 1
        if attempts >= MAX_FAILED_ATTEMPTS:
            conn.execute(
                "UPDATE users SET failed_attempts = 0, locked_until = now() + %s WHERE id = %s",
                (timedelta(minutes=LOCK_MINUTES), user["id"]),
            )
            audit.record(conn, "auth.locked", actor_id=user["id"], actor_label=user["full_name_en"] or user["full_name_ar"],
                         entity="user", entity_id=user["id"], details={"minutes": LOCK_MINUTES}, ip=ip, user_agent=user_agent)
            fail("account_locked", status=423)
        conn.execute("UPDATE users SET failed_attempts = %s WHERE id = %s", (attempts, user["id"]))
        audit.record(conn, "auth.login_failed", actor_id=user["id"], actor_label=user["full_name_en"] or user["full_name_ar"],
                     entity="user", entity_id=user["id"], details={"reason": "wrong_password", "attempt": attempts},
                     ip=ip, user_agent=user_agent)
        fail("invalid_credentials")

    if not user["is_active"]:
        audit.record(conn, "auth.login_blocked", actor_id=user["id"], actor_label=user["full_name_en"] or user["full_name_ar"],
                     entity="user", entity_id=user["id"], details={"reason": "inactive"}, ip=ip, user_agent=user_agent)
        fail("account_inactive", status=403)

    if needs_rehash(user["password_hash"]):
        conn.execute("UPDATE users SET password_hash = %s WHERE id = %s", (hash_password(password), user["id"]))

    token = start_session(conn, user, request)
    ctx = load_ctx(conn, token, request)
    audit.record(conn, "auth.login", ctx=ctx, entity="user", entity_id=user["id"], details={"next_step": ctx.next_step})
    return token, ctx


def logout(conn: psycopg.Connection, ctx: Ctx) -> None:
    conn.execute("UPDATE sessions SET revoked_at = now() WHERE id = %s", (ctx.session_id,))
    audit.record(conn, "auth.logout", ctx=ctx, entity="user", entity_id=ctx.user_id)


def logout_others(conn: psycopg.Connection, ctx: Ctx) -> int:
    count = revoke_sessions(conn, ctx.user_id, keep_session=ctx.session_id)
    audit.record(conn, "auth.logout_others", ctx=ctx, entity="user", entity_id=ctx.user_id, details={"sessions": count})
    return count


def mfa_setup(conn: psycopg.Connection, ctx: Ctx) -> dict:
    if ctx.user["mfa_enabled"]:
        raise AppError(409, "mfa_already_enabled")
    if ctx.next_step not in ("mfa_setup", "ready"):
        raise AppError(403, "step_required", next_step=ctx.next_step)
    secret = new_mfa_secret()
    conn.execute("UPDATE users SET mfa_pending_secret = %s WHERE id = %s", (secret, ctx.user_id))
    account = ctx.user["email"] or ctx.user["phone"]
    uri = mfa_uri(secret, account)
    return {"secret": secret, "uri": uri, "qr": mfa_qr(uri), "account": account}


def mfa_verify(conn: psycopg.Connection, ctx: Ctx, code: str) -> None:
    user = ctx.user
    enabling = not user["mfa_enabled"]
    secret = user["mfa_pending_secret"] if enabling else user["mfa_secret"]
    if not secret:
        raise AppError(409, "mfa_not_started")
    step = match_totp(secret, code, user["mfa_last_step"])
    if step is None:
        failures = conn.execute(
            "UPDATE sessions SET mfa_failures = mfa_failures + 1 WHERE id = %s RETURNING mfa_failures",
            (ctx.session_id,),
        ).fetchone()["mfa_failures"]
        audit.record(conn, "auth.mfa_failed", ctx=ctx, entity="user", entity_id=ctx.user_id, details={"attempt": failures})
        if failures >= MAX_MFA_FAILURES:
            conn.execute("UPDATE sessions SET revoked_at = now() WHERE id = %s", (ctx.session_id,))
            conn.commit()
            raise AppError(401, "mfa_too_many_attempts")
        conn.commit()
        raise field_error("code", "wrong_code")

    if enabling:
        conn.execute(
            """
            UPDATE users SET mfa_enabled = true, mfa_secret = mfa_pending_secret, mfa_pending_secret = NULL,
                             mfa_last_step = %s, updated_at = now()
            WHERE id = %s
            """,
            (step, ctx.user_id),
        )
        audit.record(conn, "auth.mfa_enabled", ctx=ctx, entity="user", entity_id=ctx.user_id)
    else:
        conn.execute("UPDATE users SET mfa_last_step = %s WHERE id = %s", (step, ctx.user_id))
        audit.record(conn, "auth.mfa_passed", ctx=ctx, entity="user", entity_id=ctx.user_id)
    conn.execute("UPDATE sessions SET mfa_passed = true, mfa_failures = 0 WHERE id = %s", (ctx.session_id,))


def mfa_disable(conn: psycopg.Connection, ctx: Ctx, password: str, code: str) -> None:
    if not ctx.user["mfa_enabled"]:
        raise AppError(409, "mfa_not_enabled")
    if any(r["requires_mfa"] for r in ctx.roles):
        raise AppError(403, "mfa_required_by_role")
    if not verify_password(ctx.user["password_hash"], password):
        raise field_error("password", "wrong_password")
    step = match_totp(ctx.user["mfa_secret"], code, ctx.user["mfa_last_step"])
    if step is None:
        raise field_error("code", "wrong_code")
    conn.execute(
        "UPDATE users SET mfa_enabled = false, mfa_secret = NULL, mfa_last_step = NULL, updated_at = now() WHERE id = %s",
        (ctx.user_id,),
    )
    audit.record(conn, "auth.mfa_disabled", ctx=ctx, entity="user", entity_id=ctx.user_id)


def change_password(conn: psycopg.Connection, ctx: Ctx, current: str, new: str) -> None:
    if ctx.next_step not in ("change_password", "choose_role", "ready"):
        raise AppError(403, "step_required", next_step=ctx.next_step)
    user = ctx.user
    if not verify_password(user["password_hash"], current):
        raise field_error("current_password", "wrong_password")
    if current == new:
        raise field_error("new_password", "same_as_current")
    problem = password_problem(
        new, kind=user["kind"],
        identifiers=((user["email"] or "").split("@")[0], (user["phone"] or "")[-8:] or None),
    )
    if problem:
        raise field_error("new_password", problem)
    conn.execute(
        """
        UPDATE users SET password_hash = %s, must_change_password = false, password_changed_at = now(), updated_at = now()
        WHERE id = %s
        """,
        (hash_password(new), ctx.user_id),
    )
    signed_out = revoke_sessions(conn, ctx.user_id, keep_session=ctx.session_id)
    audit.record(conn, "auth.password_changed", ctx=ctx, entity="user", entity_id=ctx.user_id,
                 details={"forced": bool(user["must_change_password"]), "other_sessions_signed_out": signed_out})


def choose_role(conn: psycopg.Connection, ctx: Ctx, role: str, branch_id: int | None) -> None:
    if ctx.next_step not in ("choose_role", "ready"):
        raise AppError(403, "step_required", next_step=ctx.next_step)
    if not any(r["role"] == role and r["branch_id"] == branch_id for r in ctx.roles):
        raise AppError(403, "role_not_held")
    conn.execute(
        "UPDATE sessions SET active_role = %s, active_branch_id = %s WHERE id = %s",
        (role, branch_id, ctx.session_id),
    )
    audit.record(conn, "auth.role_switched", ctx=ctx, entity="user", entity_id=ctx.user_id,
                 branch_id=branch_id, details={"from": ctx.active_role, "to": role, "branch_id": branch_id})


def forgot_password(conn: psycopg.Connection, identifier: str, request: Request) -> None:
    """Records the request for an admin. The answer is the same whether or not the account exists."""
    ip, user_agent = client_info(request)
    forgot_limit.check(ip)
    user = find_user(conn, identifier)
    pending = None
    if user:
        pending = conn.execute(
            "SELECT id FROM password_reset_requests WHERE user_id = %s AND status = 'pending'", (user["id"],),
        ).fetchone()
    if pending:
        return
    request_id = conn.execute(
        "INSERT INTO password_reset_requests (identifier, user_id, ip) VALUES (%s, %s, %s) RETURNING id",
        (identifier.strip()[:200], user["id"] if user else None, ip),
    ).fetchone()["id"]
    audit.record(conn, "auth.reset_requested", entity="password_reset", entity_id=request_id,
                 details={"identifier": _mask(identifier), "matched": user is not None}, ip=ip, user_agent=user_agent)


def set_preferences(conn: psycopg.Connection, ctx: Ctx, preferred_lang: str) -> None:
    conn.execute("UPDATE users SET preferred_lang = %s, updated_at = now() WHERE id = %s", (preferred_lang, ctx.user_id))
