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
    return {
        "previous_login_at": ctx.user["previous_login_at"],
        "previous_login_ip": ctx.user["previous_login_ip"],
        "cover": cover,
    }
