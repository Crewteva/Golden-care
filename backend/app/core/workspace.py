"""Pieces every role's API uses: a router locked to that role, and the dashboard home summary."""
import psycopg
from fastapi import APIRouter, Depends

from app.core.session import Ctx, require_role


def role_router(role: str) -> APIRouter:
    """Every endpoint on this router refuses anyone who isn't working in `role`."""
    return APIRouter(dependencies=[Depends(require_role(role))], tags=[role])


def workspace_home(conn: psycopg.Connection, ctx: Ctx) -> dict:
    """Shown on every dashboard home: last sign-in and temporary cover to / from this person."""
    cover = conn.execute(
        """
        SELECT d.id, d.role_code AS role, d.branch_id, d.starts_at, d.ends_at, d.reason,
               CASE WHEN d.to_user_id = %(uid)s THEN 'received' ELSE 'given' END AS direction,
               CASE WHEN d.to_user_id = %(uid)s THEN fu.full_name_ar ELSE tu.full_name_ar END AS other_name_ar,
               CASE WHEN d.to_user_id = %(uid)s THEN fu.full_name_en ELSE tu.full_name_en END AS other_name_en
        FROM delegations d
        JOIN users fu ON fu.id = d.from_user_id
        JOIN users tu ON tu.id = d.to_user_id
        WHERE (d.to_user_id = %(uid)s OR d.from_user_id = %(uid)s)
          AND d.revoked_at IS NULL AND d.ends_at > now()
        ORDER BY d.starts_at
        """,
        {"uid": ctx.user_id},
    ).fetchall()
    summary = {
        "previous_login_at": ctx.user["previous_login_at"],
        "previous_login_ip": ctx.user["previous_login_ip"],
        "cover": cover,
    }
    doctor = ctx.user_id if ctx.active_role == "doctor" else None
    if "patients.view" in ctx.permissions:
        summary["patients"] = conn.execute(
            """
            SELECT count(*) AS total,
                   count(*) FILTER (WHERE created_at >= date_trunc('day', now())) AS today,
                   count(*) FILTER (WHERE created_at >= date_trunc('day', now()) - interval '6 days') AS week
            FROM patients p
            WHERE %(doctor)s::uuid IS NULL OR EXISTS (SELECT 1 FROM appointments ap WHERE ap.patient_id = p.id AND ap.doctor_id = %(doctor)s::uuid)
            """,
            {"doctor": doctor},
        ).fetchone()
    if "patient_files.review" in ctx.permissions:
        from app.core.files import review_queue

        summary["pending_reviews"] = len(review_queue(conn, doctor))
    if "appointments.view" in ctx.permissions:
        summary["appointments"] = conn.execute(
            """
            SELECT count(*) FILTER (WHERE status NOT IN ('cancelled', 'no_show')) AS today,
                   count(*) FILTER (WHERE status IN ('requested', 'booked', 'confirmed')) AS waiting_arrival,
                   count(*) FILTER (WHERE status = 'arrived') AS arrived,
                   count(*) FILTER (WHERE status = 'in_room') AS in_room,
                   count(*) FILTER (WHERE status = 'completed') AS completed,
                   count(*) FILTER (WHERE status = 'requested') AS requested
            FROM appointments
            WHERE starts_at::date = current_date AND (%(doctor)s::uuid IS NULL OR doctor_id = %(doctor)s::uuid)
            """,
            {"doctor": doctor},
        ).fetchone()
    return summary
