"""Complaints & requests desk: log it, assign it, answer within the deadline its priority sets, follow it until
it's resolved. Every step is kept in the ticket's history (append-only).

complaints.create   log a complaint or request and follow the ones you logged or that are assigned to you
complaints.manage   see every ticket, assign, change priority and status, resolve and close
Patients send theirs from the portal and see its status and the resolution — never the internal comments."""
from datetime import timedelta

import psycopg

from app.core import audit, clinic_time
from app.core.clinical_schemas import PortalTicketIn, TicketIn, TicketUpdateIn
from app.core.errors import AppError, field_error
from app.core.normalize import normalize_phone
from app.core.session import Ctx

SLA_HOURS = {"urgent": 4, "high": 24, "normal": 48, "low": 72}

TICKET_SELECT = """
    SELECT t.*, p.mrn, p.full_name_ar AS patient_name_ar, p.full_name_en AS patient_name_en, p.phone AS patient_phone,
           a.full_name_ar AS assignee_name_ar, a.full_name_en AS assignee_name_en,
           c.full_name_ar AS created_by_ar, c.full_name_en AS created_by_en,
           (t.status IN ('open', 'in_progress') AND t.due_at < now()) AS overdue
    FROM tickets t
    LEFT JOIN patients p ON p.id = t.patient_id
    LEFT JOIN users a ON a.id = t.assigned_to
    LEFT JOIN users c ON c.id = t.created_by
"""


def _manager(ctx: Ctx) -> bool:
    return "complaints.manage" in ctx.permissions


def _get(conn: psycopg.Connection, ctx: Ctx, ticket_id, lock: bool = False) -> dict:
    if lock:
        conn.execute("SELECT 1 FROM tickets WHERE id = %s FOR UPDATE", (ticket_id,))
    row = conn.execute(f"{TICKET_SELECT} WHERE t.id = %s", (ticket_id,)).fetchone()
    if not row:
        raise AppError(404, "ticket_not_found")
    if not (_manager(ctx) or row["created_by"] == ctx.user_id or row["assigned_to"] == ctx.user_id):
        raise AppError(403, "not_your_ticket")
    return row


def _event(conn: psycopg.Connection, ticket_id, actor, action: str, from_value=None, to_value=None, body=None) -> None:
    conn.execute(
        "INSERT INTO ticket_events (ticket_id, actor_id, actor_label, action, from_value, to_value, body) VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (ticket_id, getattr(actor, "user_id", None), getattr(actor, "label", None), action, from_value, to_value, body),
    )


def _staff(conn: psycopg.Connection, user_id) -> None:
    if not conn.execute("SELECT 1 FROM users WHERE id = %s AND kind = 'staff' AND is_active", (user_id,)).fetchone():
        raise field_error("assigned_to", "invalid")


def listing(conn: psycopg.Connection, ctx: Ctx, *, state: str | None, kind: str | None, q: str | None) -> dict:
    where = []
    params: dict = {"me": ctx.user_id, "like": f"%{(q or '').strip()}%", "kind": kind}
    if not _manager(ctx):
        where.append("(t.created_by = %(me)s OR t.assigned_to = %(me)s)")
    if state == "open":
        where.append("t.status IN ('open', 'in_progress')")
    elif state == "mine":
        where.append("t.assigned_to = %(me)s AND t.status IN ('open', 'in_progress')")
    elif state == "overdue":
        where.append("t.status IN ('open', 'in_progress') AND t.due_at < now()")
    elif state == "unassigned":
        where.append("t.assigned_to IS NULL AND t.status IN ('open', 'in_progress')")
    elif state == "done":
        where.append("t.status IN ('resolved', 'closed')")
    if kind:
        where.append("t.kind = %(kind)s")
    if q and q.strip():
        where.append("(t.subject ILIKE %(like)s OR t.details ILIKE %(like)s OR t.ref ILIKE %(like)s OR p.name_search ILIKE %(like)s "
                     "OR t.contact_name ILIKE %(like)s)")
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    rows = conn.execute(
        f"""{TICKET_SELECT} {clause}
        ORDER BY (t.status IN ('open', 'in_progress')) DESC,
                 CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.due_at, t.created_at DESC
        LIMIT 300""",
        params,
    ).fetchall()
    scope = "" if _manager(ctx) else "WHERE created_by = %(me)s OR assigned_to = %(me)s"
    counts = conn.execute(
        f"""
        SELECT count(*) FILTER (WHERE status IN ('open', 'in_progress')) AS open,
               count(*) FILTER (WHERE status IN ('open', 'in_progress') AND due_at < now()) AS overdue,
               count(*) FILTER (WHERE status IN ('open', 'in_progress') AND assigned_to IS NULL) AS unassigned,
               count(*) FILTER (WHERE status IN ('open', 'in_progress') AND assigned_to = %(me)s) AS mine,
               count(*) FILTER (WHERE resolved_at >= now() - interval '7 days') AS resolved_week
        FROM tickets {scope}
        """,
        {"me": ctx.user_id},
    ).fetchone()
    return {"items": rows, "counts": counts}


def create(conn: psycopg.Connection, ctx: Ctx, body: TicketIn) -> dict:
    if body.patient_id:
        if not conn.execute("SELECT 1 FROM patients WHERE id = %s", (body.patient_id,)).fetchone():
            raise field_error("patient_id", "invalid")
    elif not (body.contact_name or "").strip():
        raise field_error("contact_name", "required")
    phone = None
    if body.contact_phone and body.contact_phone.strip():
        phone = normalize_phone(body.contact_phone)
        if not phone:
            raise field_error("contact_phone", "invalid_phone")
    if body.assigned_to:
        if not _manager(ctx):
            raise AppError(403, "forbidden", permission="complaints.manage")
        _staff(conn, body.assigned_to)
    due = clinic_time.now() + timedelta(hours=SLA_HOURS[body.priority])
    row = conn.execute(
        """
        INSERT INTO tickets (kind, channel, category, priority, patient_id, contact_name, contact_phone, subject, details, assigned_to,
                             due_at, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, ref
        """,
        (body.kind, body.channel, body.category, body.priority, body.patient_id, (body.contact_name or "").strip() or None, phone,
         body.subject.strip(), body.details.strip(), body.assigned_to, due, ctx.user_id),
    ).fetchone()
    _event(conn, row["id"], ctx, "created", None, "open", None)
    if body.assigned_to:
        _event(conn, row["id"], ctx, "assigned", None, str(body.assigned_to))
    audit.record(conn, "ticket.created", ctx=ctx, entity="ticket", entity_id=row["id"],
                 details={"ref": row["ref"], "kind": body.kind, "priority": body.priority,
                          **({"patient_id": body.patient_id} if body.patient_id else {})})
    return row


def detail(conn: psycopg.Connection, ctx: Ctx, ticket_id) -> dict:
    row = _get(conn, ctx, ticket_id)
    events = conn.execute(
        """
        SELECT e.*, u.full_name_ar AS to_name_ar, u.full_name_en AS to_name_en
        FROM ticket_events e LEFT JOIN users u ON e.action = 'assigned' AND u.id::text = e.to_value
        WHERE e.ticket_id = %s ORDER BY e.at, e.id
        """,
        (ticket_id,),
    ).fetchall()
    manager = _manager(ctx)
    return {"ticket": row, "events": events,
            "can": {"manage": manager, "comment": True, "resolve": manager or row["assigned_to"] == ctx.user_id}}


def update(conn: psycopg.Connection, ctx: Ctx, ticket_id, body: TicketUpdateIn) -> None:
    row = _get(conn, ticket_id, lock=True)
    manager = _manager(ctx)
    assignee = row["assigned_to"] == ctx.user_id
    changes = {}
    if body.priority and body.priority != row["priority"]:
        if not manager:
            raise AppError(403, "forbidden", permission="complaints.manage")
        hours = SLA_HOURS[body.priority]
        changes["priority"] = body.priority
        conn.execute("UPDATE tickets SET priority = %s, due_at = created_at + make_interval(hours => %s) WHERE id = %s",
                     (body.priority, hours, ticket_id))
        _event(conn, ticket_id, ctx, "priority", row["priority"], body.priority)
    if body.unassign or (body.assigned_to and str(body.assigned_to) != str(row["assigned_to"])):
        if not manager:
            raise AppError(403, "forbidden", permission="complaints.manage")
        target = None if body.unassign else body.assigned_to
        if target:
            _staff(conn, target)
        conn.execute("UPDATE tickets SET assigned_to = %s WHERE id = %s", (target, ticket_id))
        _event(conn, ticket_id, ctx, "assigned", str(row["assigned_to"]) if row["assigned_to"] else None, str(target) if target else None)
        changes["assigned_to"] = str(target) if target else None
    if body.status and body.status != row["status"]:
        if not (manager or assignee):
            raise AppError(403, "not_your_ticket")
        if body.status == "closed" and not manager:
            raise AppError(403, "forbidden", permission="complaints.manage")
        resolution = (body.resolution or "").strip() or row["resolution"]
        if body.status in ("resolved", "closed") and (not resolution or len(resolution) < 5):
            raise field_error("resolution", "required")
        sets = {"resolved": ", resolved_at = COALESCE(resolved_at, now())", "closed": ", closed_at = now(), resolved_at = COALESCE(resolved_at, now())",
                "open": ", resolved_at = NULL, closed_at = NULL", "in_progress": ""}[body.status]
        conn.execute(f"UPDATE tickets SET status = %s, resolution = %s {sets} WHERE id = %s", (body.status, resolution, ticket_id))
        _event(conn, ticket_id, ctx, "status", row["status"], body.status,
               resolution if body.status in ("resolved", "closed") and resolution != row["resolution"] else None)
        changes["status"] = body.status
    comment = (body.comment or "").strip()
    if comment:
        _event(conn, ticket_id, ctx, "comment", None, None, comment)
        if row["status"] == "open" and not body.status and (manager or assignee):
            conn.execute("UPDATE tickets SET status = 'in_progress' WHERE id = %s", (ticket_id,))
            _event(conn, ticket_id, ctx, "status", "open", "in_progress")
    conn.execute("UPDATE tickets SET updated_at = now() WHERE id = %s", (ticket_id,))
    if changes:
        audit.record(conn, "ticket.updated", ctx=ctx, entity="ticket", entity_id=ticket_id,
                     details={"ref": row["ref"], **changes, **({"patient_id": str(row["patient_id"])} if row["patient_id"] else {})})


def staff_options(conn: psycopg.Connection) -> list[dict]:
    return conn.execute(
        """
        SELECT u.id, u.full_name_ar, u.full_name_en,
               (SELECT string_agg(DISTINCT r.name_en, ', ') FROM user_roles ur JOIN roles r ON r.code = ur.role_code WHERE ur.user_id = u.id) AS roles_en,
               (SELECT string_agg(DISTINCT r.name_ar, '، ') FROM user_roles ur JOIN roles r ON r.code = ur.role_code WHERE ur.user_id = u.id) AS roles_ar
        FROM users u WHERE u.kind = 'staff' AND u.is_active AND u.email NOT LIKE 'admin@%%'
        ORDER BY u.full_name_ar
        """
    ).fetchall()


# --- patient portal ---

def portal_list(conn: psycopg.Connection, patient_id) -> list[dict]:
    return conn.execute(
        """
        SELECT id, ref, kind, category, subject, details, status, resolution, created_at, resolved_at, channel
        FROM tickets WHERE patient_id = %s ORDER BY created_at DESC LIMIT 100
        """,
        (patient_id,),
    ).fetchall()


def portal_create(conn: psycopg.Connection, ctx: Ctx, patient_id, body: PortalTicketIn) -> dict:
    recent = conn.execute(
        "SELECT count(*) AS n FROM tickets WHERE patient_id = %s AND channel = 'portal' AND created_at > now() - interval '1 day'",
        (patient_id,),
    ).fetchone()["n"]
    if recent >= 5:
        raise AppError(429, "too_many_tickets")
    priority = "high" if body.kind == "complaint" else "normal"
    row = conn.execute(
        """
        INSERT INTO tickets (kind, channel, category, priority, patient_id, subject, details, due_at)
        VALUES (%s, 'portal', %s, %s, %s, %s, %s, %s) RETURNING id, ref
        """,
        (body.kind, body.category, priority, patient_id, body.subject.strip(), body.details.strip(),
         clinic_time.now() + timedelta(hours=SLA_HOURS[priority])),
    ).fetchone()
    _event(conn, row["id"], ctx, "created", None, "open", None)
    audit.record(conn, "ticket.created", ctx=ctx, entity="ticket", entity_id=row["id"],
                 details={"ref": row["ref"], "kind": body.kind, "channel": "portal", "patient_id": str(patient_id)})
    return row
