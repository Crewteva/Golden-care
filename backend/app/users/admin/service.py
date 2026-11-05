"""System admin: staff accounts, roles & permissions, branches, temporary cover, reset requests."""
from datetime import datetime, timedelta, timezone

import psycopg

from app.core import audit
from app.core.errors import AppError, field_error
from app.core.normalize import clean_name, normalize_email, normalize_name, normalize_phone
from app.core.security import hash_password, temp_password
from app.core.session import Ctx, revoke_sessions
from app.users.admin.schemas import BranchIn, DelegationIn, RoleAssignment, StaffCreate, StaffUpdate

# The admin role must always keep these, so nobody can lock the clinic out of its own system.
ADMIN_LOCKED_PERMISSIONS = {"users.view", "users.manage", "roles.manage"}
MAX_COVER_DAYS = 90


# ---------- helpers ----------

def _get_staff(conn: psycopg.Connection, user_id) -> dict:
    user = conn.execute("SELECT * FROM users WHERE id = %s AND kind = 'staff'", (user_id,)).fetchone()
    if not user:
        raise AppError(404, "user_not_found")
    return user


def _label(user: dict) -> str:
    return user["full_name_en"] or user["full_name_ar"]


def _other_active_admins(conn: psycopg.Connection, user_id) -> int:
    return conn.execute(
        """
        SELECT count(DISTINCT u.id) AS n FROM users u JOIN user_roles ur ON ur.user_id = u.id
        WHERE ur.role_code = 'admin' AND u.is_active AND u.id <> %s
        """,
        (user_id,),
    ).fetchone()["n"]


def _clean_contact(email_raw: str, phone_raw: str | None) -> tuple[str, str | None]:
    fields = {}
    email = normalize_email(email_raw)
    if not email:
        fields["email"] = "invalid"
    phone = None
    if phone_raw and phone_raw.strip():
        phone = normalize_phone(phone_raw)
        if not phone:
            fields["phone"] = "invalid_phone"
    if fields:
        raise AppError(422, "validation", fields=fields)
    return email, phone


def _check_unique(conn: psycopg.Connection, email: str | None, phone: str | None, exclude_id=None) -> None:
    fields = {}
    if email and conn.execute(
        "SELECT 1 FROM users WHERE email = %s AND (%s::uuid IS NULL OR id <> %s::uuid)", (email, exclude_id, exclude_id),
    ).fetchone():
        fields["email"] = "taken"
    if phone and conn.execute(
        "SELECT 1 FROM users WHERE phone = %s AND (%s::uuid IS NULL OR id <> %s::uuid)", (phone, exclude_id, exclude_id),
    ).fetchone():
        fields["phone"] = "taken"
    if fields:
        raise AppError(409, "conflict", fields=fields)


def _valid_assignments(conn: psycopg.Connection, items: list[RoleAssignment]) -> list[tuple[str, int | None]]:
    staff_roles = {r["code"] for r in conn.execute("SELECT code FROM roles WHERE kind = 'staff'")}
    branches = {b["id"] for b in conn.execute("SELECT id FROM branches WHERE is_active")}
    result = []
    for item in items:
        if item.role not in staff_roles:
            raise field_error("roles", "unknown_role")
        if item.branch_id is not None and item.branch_id not in branches:
            raise field_error("roles", "unknown_branch")
        pair = (item.role, item.branch_id)
        if pair not in result:
            result.append(pair)
    return result


def _roles_of(conn: psycopg.Connection, user_id) -> list[dict]:
    return conn.execute(
        """
        SELECT ur.role_code AS role, ur.branch_id, ur.granted_at
        FROM user_roles ur JOIN roles r ON r.code = ur.role_code
        WHERE ur.user_id = %s ORDER BY r.sort_order, ur.branch_id NULLS FIRST
        """,
        (user_id,),
    ).fetchall()


# ---------- overview ----------

def overview(conn: psycopg.Connection) -> dict:
    stats = conn.execute(
        """
        SELECT
          (SELECT count(*) FROM users WHERE kind = 'staff' AND is_active) AS active_staff,
          (SELECT count(*) FROM users WHERE kind = 'staff' AND NOT is_active) AS inactive_staff,
          (SELECT count(*) FROM patients) AS patients,
          (SELECT count(*) FROM patients WHERE created_at >= date_trunc('day', now())) AS patients_today,
          (SELECT count(DISTINCT actor_id) FROM audit_log WHERE action = 'auth.login' AND at >= date_trunc('day', now())) AS signed_in_today,
          (SELECT count(*) FROM audit_log WHERE action IN ('auth.login_failed', 'auth.locked') AND at >= now() - interval '24 hours') AS failed_24h,
          (SELECT count(*) FROM users WHERE locked_until > now()) AS locked,
          (SELECT count(*) FROM password_reset_requests WHERE status = 'pending') AS pending_resets,
          (SELECT count(*) FROM delegations WHERE revoked_at IS NULL AND now() >= starts_at AND now() < ends_at) AS active_cover,
          (SELECT count(DISTINCT u.id) FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.code = ur.role_code
            WHERE u.is_active AND r.requires_mfa AND NOT u.mfa_enabled) AS mfa_pending
        """
    ).fetchone()
    by_role = conn.execute(
        """
        SELECT r.code AS role, count(DISTINCT u.id) AS users
        FROM roles r
        LEFT JOIN user_roles ur ON ur.role_code = r.code
        LEFT JOIN users u ON u.id = ur.user_id AND u.is_active
        WHERE r.kind = 'staff'
        GROUP BY r.code, r.sort_order ORDER BY r.sort_order
        """
    ).fetchall()
    sign_ins = conn.execute(
        """
        SELECT d::date AS day,
               (SELECT count(*) FROM audit_log a WHERE a.action = 'auth.login' AND a.at >= d AND a.at < d + interval '1 day') AS ok,
               (SELECT count(*) FROM audit_log a WHERE a.action = 'auth.login_failed' AND a.at >= d AND a.at < d + interval '1 day') AS failed
        FROM generate_series(date_trunc('day', now()) - interval '6 days', date_trunc('day', now()), interval '1 day') d
        ORDER BY d
        """
    ).fetchall()
    recent = audit.search(conn, page_size=8)["items"]
    return {"stats": stats, "by_role": by_role, "sign_ins": sign_ins, "recent": recent}


# ---------- staff ----------

SORTS = {
    "name_ar": "u.full_name_ar",
    "name_en": "u.full_name_en",
    "email": "u.email",
    "last_login": "u.last_login_at",
    "created": "u.created_at",
}


def list_staff(conn: psycopg.Connection, *, q=None, role=None, branch_id=None, status=None,
               sort="name_ar", direction="asc", page=1, page_size=25) -> dict:
    where, params = ["u.kind = 'staff'"], []
    if q and q.strip():
        term = q.strip()
        where.append("(u.name_search LIKE %s OR u.email ILIKE %s OR u.phone LIKE %s)")
        phone = normalize_phone(term)
        params += [f"%{normalize_name(term)}%", f"%{term}%", f"%{phone or term}%"]
    if role:
        where.append("EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = u.id AND x.role_code = %s)")
        params.append(role)
    if branch_id:
        where.append("EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = u.id AND (x.branch_id = %s OR x.branch_id IS NULL))")
        params.append(branch_id)
    if status == "active":
        where.append("u.is_active AND (u.locked_until IS NULL OR u.locked_until <= now())")
    elif status == "inactive":
        where.append("NOT u.is_active")
    elif status == "locked":
        where.append("u.locked_until > now()")
    elif status == "mfa_pending":
        where.append("""u.is_active AND NOT u.mfa_enabled AND EXISTS (
            SELECT 1 FROM user_roles x JOIN roles r ON r.code = x.role_code WHERE x.user_id = u.id AND r.requires_mfa)""")
    order = SORTS.get(sort, SORTS["name_ar"])
    direction = "DESC" if direction == "desc" else "ASC"
    page = max(page, 1)
    rows = conn.execute(
        f"""
        SELECT u.id, u.full_name_ar, u.full_name_en, u.email, u.phone, u.is_active, u.locked_until > now() AS locked,
               u.mfa_enabled, u.must_change_password, u.last_login_at, u.created_at,
               COALESCE((SELECT json_agg(json_build_object('role', ur.role_code, 'branch_id', ur.branch_id) ORDER BY r.sort_order)
                         FROM user_roles ur JOIN roles r ON r.code = ur.role_code WHERE ur.user_id = u.id), '[]') AS roles,
               EXISTS (SELECT 1 FROM user_roles x JOIN roles r ON r.code = x.role_code WHERE x.user_id = u.id AND r.requires_mfa) AS mfa_required,
               count(*) OVER () AS total
        FROM users u
        WHERE {' AND '.join(where)}
        ORDER BY {order} {direction} NULLS LAST, u.id
        LIMIT %s OFFSET %s
        """,
        [*params, page_size, (page - 1) * page_size],
    ).fetchall()
    total = rows[0]["total"] if rows else 0
    for row in rows:
        row.pop("total")
        row["locked"] = bool(row["locked"])
    return {"items": rows, "total": total, "page": page, "page_size": page_size}


def staff_options(conn: psycopg.Connection) -> list[dict]:
    return conn.execute(
        """
        SELECT u.id, u.full_name_ar, u.full_name_en, u.email,
               COALESCE((SELECT json_agg(json_build_object('role', ur.role_code, 'branch_id', ur.branch_id))
                         FROM user_roles ur WHERE ur.user_id = u.id), '[]') AS roles
        FROM users u WHERE u.kind = 'staff' AND u.is_active ORDER BY u.full_name_ar
        """
    ).fetchall()


def get_staff(conn: psycopg.Connection, user_id) -> dict:
    u = _get_staff(conn, user_id)
    sessions = conn.execute(
        """
        SELECT id, active_role, ip, user_agent, created_at, last_seen_at FROM sessions
        WHERE user_id = %s AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC
        """,
        (user_id,),
    ).fetchall()
    cover = conn.execute(
        """
        SELECT d.id, d.role_code AS role, d.branch_id, d.starts_at, d.ends_at, d.reason, d.revoked_at,
               CASE WHEN d.to_user_id = %(uid)s THEN 'received' ELSE 'given' END AS direction,
               CASE WHEN d.to_user_id = %(uid)s THEN fu.full_name_ar ELSE tu.full_name_ar END AS other_name_ar,
               CASE WHEN d.to_user_id = %(uid)s THEN fu.full_name_en ELSE tu.full_name_en END AS other_name_en
        FROM delegations d JOIN users fu ON fu.id = d.from_user_id JOIN users tu ON tu.id = d.to_user_id
        WHERE d.to_user_id = %(uid)s OR d.from_user_id = %(uid)s
        ORDER BY d.starts_at DESC LIMIT 20
        """,
        {"uid": user_id},
    ).fetchall()
    activity = audit.search(conn, related_user=user_id, page_size=15)["items"]
    created_by = None
    if u["created_by"]:
        creator = conn.execute("SELECT full_name_ar, full_name_en FROM users WHERE id = %s", (u["created_by"],)).fetchone()
        created_by = creator
    return {
        "user": {
            "id": u["id"], "full_name_ar": u["full_name_ar"], "full_name_en": u["full_name_en"], "email": u["email"],
            "phone": u["phone"], "is_active": u["is_active"], "deactivated_at": u["deactivated_at"],
            "deactivated_reason": u["deactivated_reason"], "locked_until": u["locked_until"],
            "locked": bool(conn.execute("SELECT %s::timestamptz > now() AS l", (u["locked_until"],)).fetchone()["l"]),
            "mfa_enabled": u["mfa_enabled"], "must_change_password": u["must_change_password"],
            "password_changed_at": u["password_changed_at"], "last_login_at": u["last_login_at"],
            "last_login_ip": u["last_login_ip"], "created_at": u["created_at"], "created_by": created_by,
        },
        "roles": _roles_of(conn, user_id),
        "sessions": sessions,
        "cover": cover,
        "activity": activity,
    }


def create_staff(conn: psycopg.Connection, ctx: Ctx, body: StaffCreate) -> dict:
    email, phone = _clean_contact(body.email, body.phone)
    _check_unique(conn, email, phone)
    assignments = _valid_assignments(conn, body.roles)
    name_ar, name_en = clean_name(body.full_name_ar), clean_name(body.full_name_en)
    password = temp_password()
    user_id = conn.execute(
        """
        INSERT INTO users (kind, full_name_ar, full_name_en, name_search, email, phone, password_hash,
                           must_change_password, created_by)
        VALUES ('staff', %s, %s, %s, %s, %s, %s, true, %s) RETURNING id
        """,
        (name_ar, name_en, normalize_name(f"{name_ar} {name_en}"), email, phone, hash_password(password), ctx.user_id),
    ).fetchone()["id"]
    for role, branch_id in assignments:
        conn.execute(
            "INSERT INTO user_roles (user_id, role_code, branch_id, granted_by) VALUES (%s, %s, %s, %s)",
            (user_id, role, branch_id, ctx.user_id),
        )
    audit.record(conn, "user.created", ctx=ctx, entity="user", entity_id=user_id, details={
        "name": name_en, "email": email, "roles": [{"role": r, "branch_id": b} for r, b in assignments],
    })
    return {"id": user_id, "temp_password": password}


def update_staff(conn: psycopg.Connection, ctx: Ctx, user_id, body: StaffUpdate) -> None:
    user = _get_staff(conn, user_id)
    email, phone = _clean_contact(body.email, body.phone)
    _check_unique(conn, email, phone, exclude_id=user_id)
    new = {"full_name_ar": clean_name(body.full_name_ar), "full_name_en": clean_name(body.full_name_en),
           "email": email, "phone": phone}
    changes = {k: [user[k], v] for k, v in new.items() if (user[k] or None) != v}
    if not changes:
        return
    conn.execute(
        """
        UPDATE users SET full_name_ar = %s, full_name_en = %s, name_search = %s, email = %s, phone = %s, updated_at = now()
        WHERE id = %s
        """,
        (new["full_name_ar"], new["full_name_en"], normalize_name(f"{new['full_name_ar']} {new['full_name_en']}"),
         email, phone, user_id),
    )
    audit.record(conn, "user.updated", ctx=ctx, entity="user", entity_id=user_id, details={"changes": changes})


def set_roles(conn: psycopg.Connection, ctx: Ctx, user_id, items: list[RoleAssignment]) -> None:
    _get_staff(conn, user_id)
    before = [(r["role"], r["branch_id"]) for r in _roles_of(conn, user_id)]
    after = _valid_assignments(conn, items)
    had_admin = any(r == "admin" for r, _ in before)
    keeps_admin = any(r == "admin" for r, _ in after)
    if had_admin and not keeps_admin and _other_active_admins(conn, user_id) == 0:
        raise AppError(409, "last_admin")
    for role, branch_id in before:
        if (role, branch_id) not in after:
            conn.execute(
                "DELETE FROM user_roles WHERE user_id = %s AND role_code = %s AND branch_id IS NOT DISTINCT FROM %s",
                (user_id, role, branch_id),
            )
    for role, branch_id in after:
        if (role, branch_id) not in before:
            conn.execute(
                "INSERT INTO user_roles (user_id, role_code, branch_id, granted_by) VALUES (%s, %s, %s, %s)",
                (user_id, role, branch_id, ctx.user_id),
            )
    if set(before) != set(after):
        audit.record(conn, "user.roles_changed", ctx=ctx, entity="user", entity_id=user_id, details={
            "before": [{"role": r, "branch_id": b} for r, b in before],
            "after": [{"role": r, "branch_id": b} for r, b in after],
        })


def deactivate(conn: psycopg.Connection, ctx: Ctx, user_id, reason: str) -> None:
    user = _get_staff(conn, user_id)
    if str(user_id) == str(ctx.user_id):
        raise AppError(409, "cannot_deactivate_self")
    if not user["is_active"]:
        return
    is_admin = conn.execute(
        "SELECT 1 FROM user_roles WHERE user_id = %s AND role_code = 'admin'", (user_id,),
    ).fetchone()
    if is_admin and _other_active_admins(conn, user_id) == 0:
        raise AppError(409, "last_admin")
    conn.execute(
        "UPDATE users SET is_active = false, deactivated_at = now(), deactivated_reason = %s, updated_at = now() WHERE id = %s",
        (reason.strip(), user_id),
    )
    signed_out = revoke_sessions(conn, user_id)
    ended_cover = conn.execute(
        """
        UPDATE delegations SET revoked_at = now(), revoked_by = %s
        WHERE revoked_at IS NULL AND ends_at > now() AND (to_user_id = %s OR from_user_id = %s)
        """,
        (ctx.user_id, user_id, user_id),
    ).rowcount
    audit.record(conn, "user.deactivated", ctx=ctx, entity="user", entity_id=user_id,
                 details={"reason": reason.strip(), "sessions_ended": signed_out, "cover_ended": ended_cover})


def activate(conn: psycopg.Connection, ctx: Ctx, user_id) -> None:
    user = _get_staff(conn, user_id)
    if user["is_active"]:
        return
    conn.execute(
        "UPDATE users SET is_active = true, deactivated_at = NULL, deactivated_reason = NULL, updated_at = now() WHERE id = %s",
        (user_id,),
    )
    audit.record(conn, "user.activated", ctx=ctx, entity="user", entity_id=user_id)


def unlock(conn: psycopg.Connection, ctx: Ctx, user_id) -> None:
    _get_staff(conn, user_id)
    conn.execute("UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE id = %s", (user_id,))
    audit.record(conn, "user.unlocked", ctx=ctx, entity="user", entity_id=user_id)


def _reset_password(conn: psycopg.Connection, ctx: Ctx, user: dict, source: str) -> str:
    if str(user["id"]) == str(ctx.user_id):
        raise AppError(409, "use_account_page")
    password = temp_password()
    conn.execute(
        """
        UPDATE users SET password_hash = %s, must_change_password = true, locked_until = NULL, failed_attempts = 0,
                         updated_at = now()
        WHERE id = %s
        """,
        (hash_password(password), user["id"]),
    )
    signed_out = revoke_sessions(conn, user["id"])
    audit.record(conn, "user.password_reset", ctx=ctx, entity="user", entity_id=user["id"],
                 details={"source": source, "sessions_ended": signed_out})
    return password


def reset_password(conn: psycopg.Connection, ctx: Ctx, user_id) -> dict:
    user = _get_staff(conn, user_id)
    return {"temp_password": _reset_password(conn, ctx, user, "admin")}


def reset_mfa(conn: psycopg.Connection, ctx: Ctx, user_id) -> None:
    user = _get_staff(conn, user_id)
    if str(user_id) == str(ctx.user_id):
        raise AppError(409, "use_account_page")
    if not user["mfa_enabled"] and not user["mfa_pending_secret"]:
        return
    conn.execute(
        """
        UPDATE users SET mfa_enabled = false, mfa_secret = NULL, mfa_pending_secret = NULL, mfa_last_step = NULL,
                         updated_at = now()
        WHERE id = %s
        """,
        (user_id,),
    )
    signed_out = revoke_sessions(conn, user_id)
    audit.record(conn, "user.mfa_reset", ctx=ctx, entity="user", entity_id=user_id, details={"sessions_ended": signed_out})


def end_session(conn: psycopg.Connection, ctx: Ctx, user_id, session_id) -> None:
    _get_staff(conn, user_id)
    cur = conn.execute(
        "UPDATE sessions SET revoked_at = now() WHERE id = %s AND user_id = %s AND revoked_at IS NULL",
        (session_id, user_id),
    )
    if cur.rowcount:
        audit.record(conn, "user.session_ended", ctx=ctx, entity="user", entity_id=user_id,
                     details={"session": str(session_id)})


# ---------- roles & permissions ----------

def list_roles(conn: psycopg.Connection) -> dict:
    roles = conn.execute(
        """
        SELECT r.code, r.kind, r.name_ar, r.name_en, r.requires_mfa, r.sort_order,
               (SELECT count(DISTINCT ur.user_id) FROM user_roles ur JOIN users u ON u.id = ur.user_id
                 WHERE ur.role_code = r.code AND u.is_active) AS users,
               COALESCE((SELECT array_agg(rp.permission_code ORDER BY rp.permission_code)
                         FROM role_permissions rp WHERE rp.role_code = r.code), '{}') AS permissions
        FROM roles r ORDER BY r.sort_order
        """
    ).fetchall()
    permissions = conn.execute("SELECT code, module, name_ar, name_en FROM permissions ORDER BY module, code").fetchall()
    return {"roles": roles, "permissions": permissions, "locked": {"admin": sorted(ADMIN_LOCKED_PERMISSIONS)}}


def _get_role(conn: psycopg.Connection, code: str) -> dict:
    role = conn.execute("SELECT * FROM roles WHERE code = %s", (code,)).fetchone()
    if not role:
        raise AppError(404, "role_not_found")
    return role


def update_role(conn: psycopg.Connection, ctx: Ctx, code: str, requires_mfa: bool) -> None:
    role = _get_role(conn, code)
    if role["kind"] != "staff":
        raise AppError(409, "role_not_editable")
    if code == "admin" and not requires_mfa:
        raise AppError(409, "admin_requires_mfa")
    if role["requires_mfa"] == requires_mfa:
        return
    conn.execute("UPDATE roles SET requires_mfa = %s WHERE code = %s", (requires_mfa, code))
    audit.record(conn, "role.updated", ctx=ctx, entity="role", entity_id=code,
                 details={"requires_mfa": [role["requires_mfa"], requires_mfa]})


def set_permissions(conn: psycopg.Connection, ctx: Ctx, code: str, permissions: list[str]) -> None:
    role = _get_role(conn, code)
    if role["kind"] != "staff":
        raise AppError(409, "role_not_editable")
    known = {p["code"] for p in conn.execute("SELECT code FROM permissions")}
    wanted = set(permissions)
    if wanted - known:
        raise field_error("permissions", "unknown_permission")
    if code == "admin" and not ADMIN_LOCKED_PERMISSIONS <= wanted:
        raise AppError(409, "admin_permissions_locked")
    current = {r["permission_code"] for r in conn.execute(
        "SELECT permission_code FROM role_permissions WHERE role_code = %s", (code,))}
    added, removed = sorted(wanted - current), sorted(current - wanted)
    if not added and not removed:
        return
    for perm in removed:
        conn.execute("DELETE FROM role_permissions WHERE role_code = %s AND permission_code = %s", (code, perm))
    for perm in added:
        conn.execute("INSERT INTO role_permissions (role_code, permission_code) VALUES (%s, %s)", (code, perm))
    audit.record(conn, "role.permissions_changed", ctx=ctx, entity="role", entity_id=code,
                 details={"added": added, "removed": removed})


# ---------- branches ----------

def list_branches(conn: psycopg.Connection) -> list[dict]:
    return conn.execute(
        """
        SELECT b.*, (SELECT count(DISTINCT ur.user_id) FROM user_roles ur JOIN users u ON u.id = ur.user_id
                      WHERE ur.branch_id = b.id AND u.is_active) AS staff
        FROM branches b ORDER BY b.is_active DESC, b.name_en
        """
    ).fetchall()


def _branch_values(body: BranchIn) -> dict:
    code = body.code.strip().upper()
    if not code.isalpha() or not code.isascii():
        raise field_error("code", "invalid")
    phone = None
    if body.phone and body.phone.strip():
        phone = body.phone.strip()
    return {"code": code, "name_ar": clean_name(body.name_ar), "name_en": clean_name(body.name_en),
            "address_ar": clean_name(body.address_ar), "address_en": clean_name(body.address_en),
            "phone": phone, "is_active": body.is_active}


def create_branch(conn: psycopg.Connection, ctx: Ctx, body: BranchIn) -> dict:
    values = _branch_values(body)
    if conn.execute("SELECT 1 FROM branches WHERE code = %s", (values["code"],)).fetchone():
        raise AppError(409, "conflict", fields={"code": "taken"})
    branch_id = conn.execute(
        """
        INSERT INTO branches (code, name_ar, name_en, address_ar, address_en, phone, is_active)
        VALUES (%(code)s, %(name_ar)s, %(name_en)s, %(address_ar)s, %(address_en)s, %(phone)s, %(is_active)s)
        RETURNING id
        """,
        values,
    ).fetchone()["id"]
    audit.record(conn, "branch.created", ctx=ctx, entity="branch", entity_id=branch_id, details=values)
    return {"id": branch_id}


def update_branch(conn: psycopg.Connection, ctx: Ctx, branch_id: int, body: BranchIn) -> None:
    branch = conn.execute("SELECT * FROM branches WHERE id = %s", (branch_id,)).fetchone()
    if not branch:
        raise AppError(404, "branch_not_found")
    values = _branch_values(body)
    if conn.execute("SELECT 1 FROM branches WHERE code = %s AND id <> %s", (values["code"], branch_id)).fetchone():
        raise AppError(409, "conflict", fields={"code": "taken"})
    if branch["is_active"] and not values["is_active"]:
        others = conn.execute("SELECT count(*) AS n FROM branches WHERE is_active AND id <> %s", (branch_id,)).fetchone()["n"]
        if others == 0:
            raise AppError(409, "last_branch")
    changes = {k: [branch[k], v] for k, v in values.items() if branch[k] != v}
    if not changes:
        return
    conn.execute(
        """
        UPDATE branches SET code = %(code)s, name_ar = %(name_ar)s, name_en = %(name_en)s, address_ar = %(address_ar)s,
               address_en = %(address_en)s, phone = %(phone)s, is_active = %(is_active)s
        WHERE id = %(id)s
        """,
        {**values, "id": branch_id},
    )
    audit.record(conn, "branch.updated", ctx=ctx, entity="branch", entity_id=branch_id, details={"changes": changes})


# ---------- temporary cover (delegations) ----------

def list_delegations(conn: psycopg.Connection, status: str | None = None) -> list[dict]:
    rows = conn.execute(
        """
        SELECT * FROM (
          SELECT d.id, d.role_code AS role, d.branch_id, d.starts_at, d.ends_at, d.reason, d.created_at, d.revoked_at,
                 d.from_user_id, fu.full_name_ar AS from_name_ar, fu.full_name_en AS from_name_en,
                 d.to_user_id, tu.full_name_ar AS to_name_ar, tu.full_name_en AS to_name_en,
                 cu.full_name_en AS created_by_name,
                 CASE WHEN d.revoked_at IS NOT NULL THEN 'revoked'
                      WHEN now() < d.starts_at THEN 'scheduled'
                      WHEN now() >= d.ends_at THEN 'ended'
                      ELSE 'active' END AS status
          FROM delegations d
          JOIN users fu ON fu.id = d.from_user_id
          JOIN users tu ON tu.id = d.to_user_id
          JOIN users cu ON cu.id = d.created_by
        ) x
        WHERE %(status)s::text IS NULL OR x.status = %(status)s
        ORDER BY CASE x.status WHEN 'active' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, x.starts_at DESC
        LIMIT 200
        """,
        {"status": status or None},
    ).fetchall()
    return rows


def create_delegation(conn: psycopg.Connection, ctx: Ctx, body: DelegationIn) -> dict:
    role = conn.execute("SELECT * FROM roles WHERE code = %s", (body.role,)).fetchone()
    if not role or role["kind"] != "staff":
        raise field_error("role", "unknown_role")
    giver = _get_staff(conn, body.from_user_id)
    taker = _get_staff(conn, body.to_user_id)
    if not giver["is_active"]:
        raise field_error("from_user_id", "inactive")
    if not taker["is_active"]:
        raise field_error("to_user_id", "inactive")
    if giver["id"] == taker["id"]:
        raise field_error("to_user_id", "same_person")
    holds = conn.execute(
        """
        SELECT 1 FROM user_roles WHERE user_id = %s AND role_code = %s AND (branch_id IS NULL OR branch_id IS NOT DISTINCT FROM %s)
        """,
        (giver["id"], body.role, body.branch_id),
    ).fetchone()
    if not holds:
        raise field_error("role", "not_held_by_giver")
    if conn.execute(
        "SELECT 1 FROM user_roles WHERE user_id = %s AND role_code = %s AND (branch_id IS NULL OR branch_id IS NOT DISTINCT FROM %s)",
        (taker["id"], body.role, body.branch_id),
    ).fetchone():
        raise field_error("to_user_id", "already_has_role")
    starts, ends = body.starts_at, body.ends_at
    if starts.tzinfo is None or ends.tzinfo is None:
        raise field_error("starts_at", "invalid")
    if ends <= starts:
        raise field_error("ends_at", "before_start")
    if ends <= datetime.now(timezone.utc):
        raise field_error("ends_at", "in_past")
    if ends - starts > timedelta(days=MAX_COVER_DAYS):
        raise field_error("ends_at", "too_long")
    delegation_id = conn.execute(
        """
        INSERT INTO delegations (from_user_id, to_user_id, role_code, branch_id, starts_at, ends_at, reason, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
        """,
        (giver["id"], taker["id"], body.role, body.branch_id, starts, ends, body.reason.strip(), ctx.user_id),
    ).fetchone()["id"]
    audit.record(conn, "delegation.created", ctx=ctx, entity="delegation", entity_id=delegation_id, details={
        "from": _label(giver), "to": _label(taker), "role": body.role, "branch_id": body.branch_id,
        "starts_at": starts.isoformat(), "ends_at": ends.isoformat(), "reason": body.reason.strip(),
    })
    return {"id": delegation_id}


def revoke_delegation(conn: psycopg.Connection, ctx: Ctx, delegation_id: int) -> None:
    row = conn.execute("SELECT * FROM delegations WHERE id = %s", (delegation_id,)).fetchone()
    if not row:
        raise AppError(404, "delegation_not_found")
    if row["revoked_at"]:
        return
    conn.execute("UPDATE delegations SET revoked_at = now(), revoked_by = %s WHERE id = %s", (ctx.user_id, delegation_id))
    audit.record(conn, "delegation.revoked", ctx=ctx, entity="delegation", entity_id=delegation_id,
                 details={"role": row["role_code"]})


# ---------- password reset requests ----------

def list_reset_requests(conn: psycopg.Connection) -> list[dict]:
    return conn.execute(
        """
        SELECT p.id, p.identifier, p.status, p.created_at, p.handled_at, p.ip,
               u.id AS user_id, u.kind AS user_kind, u.full_name_ar, u.full_name_en, u.email, u.phone, u.is_active,
               h.full_name_en AS handled_by_name
        FROM password_reset_requests p
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN users h ON h.id = p.handled_by
        WHERE p.status = 'pending' OR p.handled_at > now() - interval '30 days'
        ORDER BY (p.status = 'pending') DESC, p.created_at DESC
        LIMIT 200
        """
    ).fetchall()


def resolve_reset_request(conn: psycopg.Connection, ctx: Ctx, request_id: int, action: str) -> dict:
    row = conn.execute("SELECT * FROM password_reset_requests WHERE id = %s FOR UPDATE", (request_id,)).fetchone()
    if not row:
        raise AppError(404, "request_not_found")
    if row["status"] != "pending":
        raise AppError(409, "request_already_handled")
    result: dict = {}
    if action == "reset":
        if not row["user_id"]:
            raise AppError(409, "request_has_no_account")
        user = conn.execute("SELECT * FROM users WHERE id = %s", (row["user_id"],)).fetchone()
        result["temp_password"] = _reset_password(conn, ctx, user, "reset_request")
        status = "resolved"
    else:
        status = "dismissed"
    conn.execute(
        "UPDATE password_reset_requests SET status = %s, handled_by = %s, handled_at = now() WHERE id = %s",
        (status, ctx.user_id, request_id),
    )
    audit.record(conn, f"password_reset.{status}", ctx=ctx, entity="password_reset", entity_id=request_id,
                 details={"user_id": str(row["user_id"]) if row["user_id"] else None})
    return result
