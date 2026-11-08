"""Clinic-wide rules stored in app_settings (booking rules today; more later). Management edits them."""
import psycopg
from psycopg.types.json import Jsonb

from app.core import audit
from app.core.session import Ctx

BOOKING_DEFAULTS = {
    "slot_step_min": 15,
    "late_after_min": 15,
    "portal_enabled": True,
    "portal_needs_confirmation": False,
    "portal_cancel_hours": 12,
    "portal_days_ahead": 30,
    "portal_max_upcoming": 3,
}


def booking(conn: psycopg.Connection) -> dict:
    values = dict(BOOKING_DEFAULTS)
    for row in conn.execute("SELECT key, value FROM app_settings WHERE key LIKE 'booking.%%'"):
        values[row["key"].removeprefix("booking.")] = row["value"]
    return values


def save_booking(conn: psycopg.Connection, ctx: Ctx, new: dict) -> dict:
    before = booking(conn)
    changes = {k: [before.get(k), v] for k, v in new.items() if before.get(k) != v}
    for key, value in new.items():
        conn.execute(
            """
            INSERT INTO app_settings (key, value, updated_by) VALUES (%s, %s, %s)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
            """,
            (f"booking.{key}", Jsonb(value), ctx.user_id),
        )
    if changes:
        audit.record(conn, "settings.booking_rules_updated", ctx=ctx, entity="settings", entity_id="booking",
                     details={"changes": changes})
    return booking(conn)
