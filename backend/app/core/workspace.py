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
    if "visits.write" in ctx.permissions or "visits.view_all" in ctx.permissions:
        mine = ctx.user_id if "visits.view_all" not in ctx.permissions else None
        summary["visits"] = conn.execute(
            """
            SELECT count(*) FILTER (WHERE status = 'draft') AS draft,
                   count(*) FILTER (WHERE status = 'signed' AND released_at IS NULL) AS unreleased,
                   count(*) FILTER (WHERE signed_at >= date_trunc('day', now())) AS signed_today
            FROM visits WHERE %(doctor)s::uuid IS NULL OR doctor_id = %(doctor)s::uuid
            """,
            {"doctor": mine},
        ).fetchone()
    if "appointments.book" in ctx.permissions:
        from app.core.visits import follow_ups

        summary["follow_ups"] = len(follow_ups(conn))
    if "dental.lab" in ctx.permissions:
        summary["lab_cases"] = conn.execute(
            """
            SELECT count(*) FILTER (WHERE status IN ('ordered', 'sent', 'remake')) AS at_lab,
                   count(*) FILTER (WHERE status = 'returned') AS ready,
                   count(*) FILTER (WHERE status IN ('ordered', 'sent', 'remake') AND due_on < current_date) AS overdue
            FROM lab_cases WHERE %(doctor)s::uuid IS NULL OR doctor_id = %(doctor)s::uuid
            """,
            {"doctor": doctor},
        ).fetchone()
    if "dental.plans" in ctx.permissions or "dental.plans_view" in ctx.permissions:
        mine = ctx.user_id if "dental.plans_view" not in ctx.permissions else None
        summary["plans"] = conn.execute(
            """
            SELECT count(*) FILTER (WHERE status = 'quoted' AND valid_until >= current_date) AS awaiting,
                   count(*) FILTER (WHERE status = 'accepted') AS in_progress,
                   count(*) FILTER (WHERE status = 'draft') AS draft
            FROM treatment_plans WHERE %(doctor)s::uuid IS NULL OR doctor_id = %(doctor)s::uuid
            """,
            {"doctor": mine},
        ).fetchone()
    if "complaints.create" in ctx.permissions or "complaints.manage" in ctx.permissions:
        manager = "complaints.manage" in ctx.permissions
        summary["tickets"] = conn.execute(
            """
            SELECT count(*) FILTER (WHERE status IN ('open', 'in_progress')) AS open,
                   count(*) FILTER (WHERE status IN ('open', 'in_progress') AND due_at < now()) AS overdue
            FROM tickets WHERE %(all)s OR created_by = %(me)s OR assigned_to = %(me)s
            """,
            {"all": manager, "me": ctx.user_id},
        ).fetchone()
    if "billing.view" in ctx.permissions or "billing.approve" in ctx.permissions:
        summary["billing"] = conn.execute(
            """
            SELECT (SELECT count(*) FROM appointments a WHERE a.starts_at::date = current_date AND a.status IN ('arrived', 'in_room', 'completed')
                      AND NOT EXISTS (SELECT 1 FROM invoices v WHERE v.appointment_id = a.id AND v.status IN ('draft', 'pending_approval', 'issued')))
                     AS unbilled_today,
                   (SELECT COALESCE(sum(total), 0) FROM invoices WHERE status = 'issued' AND issued_at::date = current_date) AS invoiced_today,
                   (SELECT COALESCE(sum(r.total), 0) - COALESCE(sum((SELECT COALESCE(sum(x.amount), 0) FROM receipt_payments x
                                                                     WHERE x.receipt_id = r.id AND x.method = 'credit')), 0)
                    FROM receipts r WHERE r.created_at::date = current_date) AS collected_today,
                   (SELECT COALESCE(sum(total - paid_total), 0) FROM invoices WHERE status = 'issued' AND paid_total < total) AS outstanding,
                   (SELECT count(*) FROM approval_requests WHERE status = 'pending') AS pending_approvals,
                   (SELECT count(*) FROM refunds WHERE status = 'approved') AS refunds_to_pay
            """
        ).fetchone()
        if "billing.collect" in ctx.permissions:
            from app.core.payments import my_shift

            summary["billing"]["shift"] = my_shift(conn, ctx)
    return summary
