"""Who is calling: session cookie → user → roles → active role → permissions.

Dependencies for routes:
  session_ctx            signed in (any step, e.g. still needs two-step verification)
  ready_ctx              signed in and every step done (2FA, password change, role chosen)
  require_role(code)     ready, working in that role's dashboard
  require_permission(c)  ready, and the active role has permission c
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import psycopg
from fastapi import Depends, Request, Response

from app.config import settings
from app.core.errors import AppError
from app.core.security import hash_token
from app.storage.db import get_conn

COOKIE_NAME = "gc_session"


@dataclass
class Ctx:
    session_id: str
    user: dict
    roles: list[dict]
    active_role: str | None
    active_branch_id: int | None
    mfa_passed: bool
    mfa_required: bool
    permissions: set[str] = field(default_factory=set)
    ip: str | None = None
    user_agent: str | None = None

    @property
    def user_id(self):
        return self.user["id"]

    @property
    def label(self) -> str:
        return self.user["full_name_en"] or self.user["full_name_ar"]

    @property
    def next_step(self) -> str:
        if not self.roles:
            return "no_role"
        if self.mfa_required and not self.mfa_passed:
            return "mfa_verify" if self.user["mfa_enabled"] else "mfa_setup"
        if self.user["must_change_password"]:
            return "change_password"
        if not self.active_role:
            return "choose_role"
        return "ready"

    def as_me(self) -> dict:
        u = self.user
        active = next(
            (r for r in self.roles if r["role"] == self.active_role and r["branch_id"] == self.active_branch_id),
            None,
        )
        return {
            "user": {
                "id": u["id"],
                "kind": u["kind"],
                "full_name_ar": u["full_name_ar"],
                "full_name_en": u["full_name_en"],
                "email": u["email"],
                "phone": u["phone"],
                "preferred_lang": u["preferred_lang"],
                "mfa_enabled": u["mfa_enabled"],
                "last_login_at": u["last_login_at"],
                "previous_login_at": u["previous_login_at"],
                "previous_login_ip": u["previous_login_ip"],
                "password_changed_at": u["password_changed_at"],
            },
            "roles": self.roles,
            "active_role": self.active_role,
            "active_branch_id": self.active_branch_id,
            "active": active,
            "permissions": sorted(self.permissions),
            "mfa_required": self.mfa_required,
            "next_step": self.next_step,
        }


def client_info(request: Request) -> tuple[str | None, str | None]:
    ip = request.client.host if request.client else None
    return ip, (request.headers.get("user-agent") or "")[:300] or None


def effective_roles(conn: psycopg.Connection, user_id) -> list[dict]:
    """Roles the user holds now: their own, plus active temporary cover lent to them."""
    rows = conn.execute(
        """
        SELECT x.role, r.name_ar AS role_name_ar, r.name_en AS role_name_en, r.kind, r.requires_mfa,
               x.branch_id, b.name_ar AS branch_name_ar, b.name_en AS branch_name_en,
               x.delegated, x.until, x.from_name_ar, x.from_name_en
        FROM (
          SELECT ur.role_code AS role, ur.branch_id, false AS delegated, NULL::timestamptz AS until,
                 NULL::text AS from_name_ar, NULL::text AS from_name_en
          FROM user_roles ur WHERE ur.user_id = %(uid)s
          UNION ALL
          SELECT d.role_code, d.branch_id, true, d.ends_at, fu.full_name_ar, fu.full_name_en
          FROM delegations d JOIN users fu ON fu.id = d.from_user_id
          WHERE d.to_user_id = %(uid)s AND d.revoked_at IS NULL AND now() >= d.starts_at AND now() < d.ends_at
        ) x
        JOIN roles r ON r.code = x.role
        LEFT JOIN branches b ON b.id = x.branch_id
        ORDER BY r.sort_order, x.delegated, b.name_en NULLS FIRST
        """,
        {"uid": user_id},
    ).fetchall()
    seen, result = set(), []
    for row in rows:
        key = (row["role"], row["branch_id"])
        if key not in seen:
            seen.add(key)
            result.append(row)
    return result


def load_ctx(conn: psycopg.Connection, token: str | None, request: Request) -> Ctx | None:
    if not token:
        return None
    session = conn.execute(
        """
        SELECT id, user_id, active_role, active_branch_id, mfa_passed, last_seen_at
        FROM sessions
        WHERE token_hash = %s AND revoked_at IS NULL AND expires_at > now()
        """,
        (hash_token(token),),
    ).fetchone()
    if not session:
        return None
    user = conn.execute("SELECT * FROM users WHERE id = %s", (session["user_id"],)).fetchone()
    if not user or not user["is_active"]:
        return None

    now = datetime.now(timezone.utc)
    if user["kind"] == "staff" and now - session["last_seen_at"] > timedelta(minutes=settings.staff_idle_minutes):
        conn.execute("UPDATE sessions SET revoked_at = now() WHERE id = %s", (session["id"],))
        conn.commit()
        return None
    if now - session["last_seen_at"] > timedelta(seconds=60):
        conn.execute("UPDATE sessions SET last_seen_at = now() WHERE id = %s", (session["id"],))

    roles = effective_roles(conn, user["id"])
    active_role, active_branch = session["active_role"], session["active_branch_id"]
    if active_role and not any(r["role"] == active_role and r["branch_id"] == active_branch for r in roles):
        active_role, active_branch = None, None
    if not active_role and len(roles) == 1:
        active_role, active_branch = roles[0]["role"], roles[0]["branch_id"]
    if (active_role, active_branch) != (session["active_role"], session["active_branch_id"]):
        conn.execute(
            "UPDATE sessions SET active_role = %s, active_branch_id = %s WHERE id = %s",
            (active_role, active_branch, session["id"]),
        )

    mfa_required = user["mfa_enabled"] or any(r["requires_mfa"] for r in roles)
    permissions: set[str] = set()
    if active_role:
        permissions = {
            row["permission_code"]
            for row in conn.execute("SELECT permission_code FROM role_permissions WHERE role_code = %s", (active_role,))
        }
    ip, user_agent = client_info(request)
    return Ctx(
        session_id=session["id"],
        user=user,
        roles=roles,
        active_role=active_role,
        active_branch_id=active_branch,
        mfa_passed=session["mfa_passed"] or not mfa_required,
        mfa_required=mfa_required,
        permissions=permissions,
        ip=ip,
        user_agent=user_agent,
    )


def set_session_cookie(response: Response, token: str, kind: str) -> None:
    max_age = settings.patient_session_days * 86400 if kind == "patient" else settings.staff_session_hours * 3600
    response.set_cookie(
        COOKIE_NAME, token, max_age=max_age, httponly=True, secure=settings.cookie_secure, samesite="lax", path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, secure=settings.cookie_secure, samesite="lax")


def session_ctx(request: Request, conn: psycopg.Connection = Depends(get_conn)) -> Ctx:
    ctx = load_ctx(conn, request.cookies.get(COOKIE_NAME), request)
    if ctx is None:
        raise AppError(401, "not_authenticated")
    return ctx


def ready_ctx(ctx: Ctx = Depends(session_ctx)) -> Ctx:
    if ctx.next_step != "ready":
        raise AppError(403, "step_required", next_step=ctx.next_step)
    return ctx


def require_role(role: str):
    def dependency(ctx: Ctx = Depends(ready_ctx)) -> Ctx:
        if ctx.active_role != role:
            raise AppError(403, "wrong_role")
        return ctx

    return dependency


def require_permission(code: str):
    def dependency(ctx: Ctx = Depends(ready_ctx)) -> Ctx:
        if code not in ctx.permissions:
            raise AppError(403, "forbidden", permission=code)
        return ctx

    return dependency


def revoke_sessions(conn: psycopg.Connection, user_id, *, keep_session=None) -> int:
    cur = conn.execute(
        "UPDATE sessions SET revoked_at = now() WHERE user_id = %s AND revoked_at IS NULL AND (%s::uuid IS NULL OR id <> %s::uuid)",
        (user_id, keep_session, keep_session),
    )
    return cur.rowcount
