"""Activity log: every sign-in and every account change is written here and never edited."""
from datetime import date

import psycopg
from psycopg.types.json import Jsonb


def record(
    conn: psycopg.Connection,
    action: str,
    *,
    ctx=None,
    actor_id=None,
    actor_label: str | None = None,
    entity: str | None = None,
    entity_id=None,
    branch_id: int | None = None,
    details: dict | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> None:
    actor_role = None
    if ctx is not None:
        actor_id = actor_id or ctx.user_id
        actor_label = actor_label or ctx.label
        actor_role = ctx.active_role
        ip = ip or ctx.ip
        user_agent = user_agent or ctx.user_agent
        if branch_id is None:
            branch_id = ctx.active_branch_id
    conn.execute(
        """
        INSERT INTO audit_log (actor_id, actor_label, actor_role, action, entity, entity_id, branch_id, ip, user_agent, details)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            actor_id, actor_label, actor_role, action, entity,
            str(entity_id) if entity_id is not None else None,
            branch_id, ip, (user_agent or "")[:300] or None, Jsonb(details or {}),
        ),
    )


def search(
    conn: psycopg.Connection,
    *,
    q: str | None = None,
    category: str | None = None,
    actor_id=None,
    related_user=None,
    patient_id=None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = 1,
    page_size: int = 50,
) -> dict:
    where, params = [], []
    if q:
        like = f"%{q.strip()}%"
        where.append("(a.actor_label ILIKE %s OR a.action ILIKE %s OR a.entity_id ILIKE %s OR a.ip ILIKE %s OR a.details::text ILIKE %s)")
        params += [like] * 5
    if category:
        where.append("a.action LIKE %s")
        params.append(f"{category}.%")
    if actor_id:
        where.append("a.actor_id = %s")
        params.append(actor_id)
    if related_user:
        where.append("(a.actor_id = %s OR (a.entity = 'user' AND a.entity_id = %s::text))")
        params += [related_user, str(related_user)]
    if patient_id:
        where.append("((a.entity = 'patient' AND a.entity_id = %s) OR a.details->>'patient_id' = %s)")
        params += [str(patient_id), str(patient_id)]
    if date_from:
        where.append("a.at >= %s::date")
        params.append(date_from)
    if date_to:
        where.append("a.at < %s::date + 1")
        params.append(date_to)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    page = max(page, 1)
    rows = conn.execute(
        f"""
        SELECT a.id, a.at, a.actor_id, a.actor_label, a.actor_role, a.action, a.entity, a.entity_id,
               a.branch_id, a.ip, a.user_agent, a.details, count(*) OVER () AS total
        FROM audit_log a
        {clause}
        ORDER BY a.at DESC, a.id DESC
        LIMIT %s OFFSET %s
        """,
        [*params, page_size, (page - 1) * page_size],
    ).fetchall()
    total = rows[0]["total"] if rows else 0
    for row in rows:
        row.pop("total", None)
    return {"items": rows, "total": total, "page": page, "page_size": page_size}
