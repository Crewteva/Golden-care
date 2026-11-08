"""What the clinic offers: specialties, services, prices (with start dates and optional per-doctor prices),
room types and rooms. Shared by every role that sees or manages the clinic setup."""
import re
from contextlib import contextmanager
from datetime import date
from decimal import Decimal

import psycopg
from psycopg import errors as pg_errors

from app.core import audit
from app.core.errors import AppError, field_error
from app.core.normalize import clean_name
from app.core.session import Ctx
from app.core.settings_schemas import PriceIn, RoomIn, RoomTypeIn, ServiceIn, SpecialtyIn


@contextmanager
def friendly_db_errors(unique_field: str | None = None):
    """Turns database refusals into clear API errors (in use → 409 in_use, duplicate → field taken)."""
    try:
        yield
    except pg_errors.ForeignKeyViolation:
        raise AppError(409, "in_use") from None
    except pg_errors.UniqueViolation:
        raise AppError(409, "conflict", fields={unique_field or "name": "taken"}) from None


def _delete(conn: psycopg.Connection, table: str, row_id) -> dict:
    with friendly_db_errors(), conn.transaction():
        row = conn.execute(f"DELETE FROM {table} WHERE id = %s RETURNING *", (row_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    return row


def _changes(before: dict, after: dict) -> dict:
    return {k: [str(before.get(k)) if before.get(k) is not None else None, str(v) if v is not None else None]
            for k, v in after.items() if before.get(k) != v}


# ---------- reading ----------

def catalog(conn: psycopg.Connection) -> dict:
    specialties = conn.execute(
        """
        SELECT s.*, (SELECT count(*) FROM services sv WHERE sv.specialty_id = s.id) AS services
        FROM specialties s ORDER BY s.sort_order, s.name_en
        """
    ).fetchall()
    room_types = conn.execute(
        """
        SELECT rt.*, (SELECT count(*) FROM rooms r WHERE r.room_type_id = rt.id) AS rooms,
               (SELECT count(*) FROM services sv WHERE sv.room_type_id = rt.id) AS services
        FROM room_types rt ORDER BY rt.name_en
        """
    ).fetchall()
    services = conn.execute(
        """
        SELECT sv.*, cur.amount AS current_price, cur.starts_on AS current_from,
               nxt.amount AS next_price, nxt.starts_on AS next_from,
               (SELECT count(DISTINCT p.doctor_id) FROM service_prices p WHERE p.service_id = sv.id AND p.doctor_id IS NOT NULL) AS doctor_prices,
               (SELECT count(*) FROM doctor_services ds WHERE ds.service_id = sv.id) AS doctors
        FROM services sv
        LEFT JOIN LATERAL (SELECT amount, starts_on FROM service_prices p
                           WHERE p.service_id = sv.id AND p.doctor_id IS NULL AND p.starts_on <= current_date
                           ORDER BY p.starts_on DESC LIMIT 1) cur ON true
        LEFT JOIN LATERAL (SELECT amount, starts_on FROM service_prices p
                           WHERE p.service_id = sv.id AND p.doctor_id IS NULL AND p.starts_on > current_date
                           ORDER BY p.starts_on LIMIT 1) nxt ON true
        ORDER BY sv.sort_order, sv.name_en
        """
    ).fetchall()
    return {"specialties": specialties, "room_types": room_types, "services": services}


# ---------- specialties ----------

def save_specialty(conn: psycopg.Connection, ctx: Ctx, body: SpecialtyIn, specialty_id: int | None = None) -> dict:
    values = {"name_ar": clean_name(body.name_ar), "name_en": clean_name(body.name_en), "color": body.color.upper(),
              "sort_order": body.sort_order, "is_active": body.is_active}
    if specialty_id is None:
        row = conn.execute(
            """
            INSERT INTO specialties (name_ar, name_en, color, sort_order, is_active)
            VALUES (%(name_ar)s, %(name_en)s, %(color)s, %(sort_order)s, %(is_active)s) RETURNING *
            """,
            values,
        ).fetchone()
        audit.record(conn, "settings.specialty_created", ctx=ctx, entity="specialty", entity_id=row["id"], details=values)
        return row
    before = conn.execute("SELECT * FROM specialties WHERE id = %s", (specialty_id,)).fetchone()
    if not before:
        raise AppError(404, "not_found")
    row = conn.execute(
        """
        UPDATE specialties SET name_ar = %(name_ar)s, name_en = %(name_en)s, color = %(color)s, sort_order = %(sort_order)s,
               is_active = %(is_active)s, updated_at = now()
        WHERE id = %(id)s RETURNING *
        """,
        {**values, "id": specialty_id},
    ).fetchone()
    audit.record(conn, "settings.specialty_updated", ctx=ctx, entity="specialty", entity_id=specialty_id,
                 details={"changes": _changes(before, values)})
    return row


def delete_specialty(conn: psycopg.Connection, ctx: Ctx, specialty_id: int) -> None:
    row = _delete(conn, "specialties", specialty_id)
    audit.record(conn, "settings.specialty_deleted", ctx=ctx, entity="specialty", entity_id=specialty_id,
                 details={"name": row["name_en"]})


# ---------- room types ----------

def save_room_type(conn: psycopg.Connection, ctx: Ctx, body: RoomTypeIn, type_id: int | None = None) -> dict:
    values = {"name_ar": clean_name(body.name_ar), "name_en": clean_name(body.name_en)}
    if type_id is None:
        row = conn.execute("INSERT INTO room_types (name_ar, name_en) VALUES (%(name_ar)s, %(name_en)s) RETURNING *", values).fetchone()
        audit.record(conn, "settings.room_type_created", ctx=ctx, entity="room_type", entity_id=row["id"], details=values)
        return row
    row = conn.execute("UPDATE room_types SET name_ar = %(name_ar)s, name_en = %(name_en)s WHERE id = %(id)s RETURNING *",
                       {**values, "id": type_id}).fetchone()
    if not row:
        raise AppError(404, "not_found")
    audit.record(conn, "settings.room_type_updated", ctx=ctx, entity="room_type", entity_id=type_id, details=values)
    return row


def delete_room_type(conn: psycopg.Connection, ctx: Ctx, type_id: int) -> None:
    row = _delete(conn, "room_types", type_id)
    audit.record(conn, "settings.room_type_deleted", ctx=ctx, entity="room_type", entity_id=type_id, details={"name": row["name_en"]})


# ---------- services ----------

def _service_values(conn: psycopg.Connection, body: ServiceIn) -> dict:
    code = body.code.strip().upper().replace(" ", "-")
    if not re.fullmatch(r"[A-Z0-9][A-Z0-9-]{1,19}", code):
        raise field_error("code", "invalid")
    if not conn.execute("SELECT 1 FROM specialties WHERE id = %s", (body.specialty_id,)).fetchone():
        raise field_error("specialty_id", "invalid")
    if body.room_type_id and not conn.execute("SELECT 1 FROM room_types WHERE id = %s", (body.room_type_id,)).fetchone():
        raise field_error("room_type_id", "invalid")
    return {"specialty_id": body.specialty_id, "code": code, "name_ar": clean_name(body.name_ar),
            "name_en": clean_name(body.name_en), "duration_min": body.duration_min, "room_type_id": body.room_type_id,
            "is_active": body.is_active, "sort_order": body.sort_order, "clinical_record": body.clinical_record,
            "dental_result": body.dental_result if body.clinical_record == "dental" else None}


def _service_billing(conn: psycopg.Connection, ctx: Ctx, body: ServiceIn, row: dict) -> dict:
    """VAT and direct cost are part of the price list: only someone who manages prices may change them."""
    wanted = {k: getattr(body, k) for k in ("vat_rate", "direct_cost") if getattr(body, k) is not None}
    wanted = {k: v for k, v in wanted.items() if row.get(k) is None or Decimal(row[k]) != v}
    if not wanted:
        return row
    if "settings.prices" not in ctx.permissions:
        raise AppError(403, "forbidden", permission="settings.prices")
    sets = ", ".join(f"{k} = %({k})s" for k in wanted)
    return conn.execute(f"UPDATE services SET {sets}, updated_at = now() WHERE id = %(id)s RETURNING *",
                        {**wanted, "id": row["id"]}).fetchone()


def save_service(conn: psycopg.Connection, ctx: Ctx, body: ServiceIn, service_id: int | None = None) -> dict:
    values = _service_values(conn, body)
    if service_id is None:
        with friendly_db_errors("code"), conn.transaction():
            row = conn.execute(
                """
                INSERT INTO services (specialty_id, code, name_ar, name_en, duration_min, room_type_id, is_active, sort_order,
                                      clinical_record, dental_result)
                VALUES (%(specialty_id)s, %(code)s, %(name_ar)s, %(name_en)s, %(duration_min)s, %(room_type_id)s,
                        %(is_active)s, %(sort_order)s, %(clinical_record)s, %(dental_result)s)
                RETURNING *
                """,
                values,
            ).fetchone()
        row = _service_billing(conn, ctx, body, row)
        if body.price is not None:
            conn.execute(
                "INSERT INTO service_prices (service_id, amount, starts_on, created_by, updated_by) VALUES (%s, %s, %s, %s, %s)",
                (row["id"], body.price.amount, body.price.starts_on or date.today(), ctx.user_id, ctx.user_id),
            )
        audit.record(conn, "settings.service_created", ctx=ctx, entity="service", entity_id=row["id"],
                     details={**values, "price": str(body.price.amount) if body.price else None})
        return row
    before = conn.execute("SELECT * FROM services WHERE id = %s", (service_id,)).fetchone()
    if not before:
        raise AppError(404, "not_found")
    with friendly_db_errors("code"), conn.transaction():
        row = conn.execute(
            """
            UPDATE services SET specialty_id = %(specialty_id)s, code = %(code)s, name_ar = %(name_ar)s, name_en = %(name_en)s,
                   duration_min = %(duration_min)s, room_type_id = %(room_type_id)s, is_active = %(is_active)s,
                   sort_order = %(sort_order)s, clinical_record = %(clinical_record)s, dental_result = %(dental_result)s,
                   updated_at = now()
            WHERE id = %(id)s RETURNING *
            """,
            {**values, "id": service_id},
        ).fetchone()
    row = _service_billing(conn, ctx, body, row)
    after = {**values, "vat_rate": row["vat_rate"], "direct_cost": row["direct_cost"]}
    audit.record(conn, "settings.service_updated", ctx=ctx, entity="service", entity_id=service_id,
                 details={"code": values["code"], "changes": _changes(before, after)})
    return row


def delete_service(conn: psycopg.Connection, ctx: Ctx, service_id: int) -> None:
    row = _delete(conn, "services", service_id)
    audit.record(conn, "settings.service_deleted", ctx=ctx, entity="service", entity_id=service_id,
                 details={"code": row["code"], "name": row["name_en"]})


# ---------- prices ----------

def prices(conn: psycopg.Connection, service_id: int) -> dict:
    service = conn.execute("SELECT * FROM services WHERE id = %s", (service_id,)).fetchone()
    if not service:
        raise AppError(404, "not_found")
    rows = conn.execute(
        """
        SELECT p.*, d.full_name_ar AS doctor_name_ar, d.full_name_en AS doctor_name_en,
               u.full_name_ar AS updated_by_ar, u.full_name_en AS updated_by_en,
               p.starts_on <= current_date AND NOT EXISTS (
                 SELECT 1 FROM service_prices q WHERE q.service_id = p.service_id AND q.doctor_id IS NOT DISTINCT FROM p.doctor_id
                   AND q.starts_on > p.starts_on AND q.starts_on <= current_date) AS in_force
        FROM service_prices p
        LEFT JOIN users d ON d.id = p.doctor_id
        LEFT JOIN users u ON u.id = p.updated_by
        WHERE p.service_id = %s
        ORDER BY p.doctor_id NULLS FIRST, p.starts_on DESC
        """,
        (service_id,),
    ).fetchall()
    return {"service": service, "prices": rows}


def _check_doctor(conn: psycopg.Connection, doctor_id) -> None:
    if doctor_id and not conn.execute(
        "SELECT 1 FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE ur.user_id = %s AND ur.role_code = 'doctor' AND u.is_active",
        (doctor_id,),
    ).fetchone():
        raise field_error("doctor_id", "invalid")


def save_price(conn: psycopg.Connection, ctx: Ctx, service_id: int, body: PriceIn, price_id: int | None = None) -> None:
    if not conn.execute("SELECT 1 FROM services WHERE id = %s", (service_id,)).fetchone():
        raise AppError(404, "not_found")
    _check_doctor(conn, body.doctor_id)
    values = {"service_id": service_id, "doctor_id": body.doctor_id, "amount": body.amount, "starts_on": body.starts_on,
              "note": clean_name(body.note), "uid": ctx.user_id}
    with friendly_db_errors("starts_on"), conn.transaction():
        if price_id is None:
            row = conn.execute(
                """
                INSERT INTO service_prices (service_id, doctor_id, amount, starts_on, note, created_by, updated_by)
                VALUES (%(service_id)s, %(doctor_id)s, %(amount)s, %(starts_on)s, %(note)s, %(uid)s, %(uid)s) RETURNING id
                """,
                values,
            ).fetchone()
            action, price_id = "settings.price_added", row["id"]
        else:
            row = conn.execute(
                """
                UPDATE service_prices SET doctor_id = %(doctor_id)s, amount = %(amount)s, starts_on = %(starts_on)s, note = %(note)s,
                       updated_by = %(uid)s, updated_at = now()
                WHERE id = %(id)s AND service_id = %(service_id)s RETURNING id
                """,
                {**values, "id": price_id},
            ).fetchone()
            if not row:
                raise AppError(404, "not_found")
            action = "settings.price_updated"
    audit.record(conn, action, ctx=ctx, entity="service", entity_id=service_id, details={
        "price_id": price_id, "amount": str(body.amount), "starts_on": str(body.starts_on),
        "doctor_id": str(body.doctor_id) if body.doctor_id else None,
    })


def delete_price(conn: psycopg.Connection, ctx: Ctx, service_id: int, price_id: int) -> None:
    with friendly_db_errors(), conn.transaction():
        row = conn.execute("DELETE FROM service_prices WHERE id = %s AND service_id = %s RETURNING *", (price_id, service_id)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    audit.record(conn, "settings.price_deleted", ctx=ctx, entity="service", entity_id=service_id, details={
        "price_id": price_id, "amount": str(row["amount"]), "starts_on": str(row["starts_on"]),
    })


# ---------- rooms ----------

def rooms(conn: psycopg.Connection) -> list[dict]:
    return conn.execute(
        """
        SELECT r.*, b.name_ar AS branch_name_ar, b.name_en AS branch_name_en,
               t.name_ar AS type_name_ar, t.name_en AS type_name_en,
               (SELECT count(*) FROM doctor_schedules s WHERE s.room_id = r.id AND (s.valid_to IS NULL OR s.valid_to >= current_date)) AS schedules
        FROM rooms r JOIN branches b ON b.id = r.branch_id LEFT JOIN room_types t ON t.id = r.room_type_id
        ORDER BY b.name_en, r.sort_order, r.name_en
        """
    ).fetchall()


def save_room(conn: psycopg.Connection, ctx: Ctx, body: RoomIn, room_id: int | None = None) -> None:
    if not conn.execute("SELECT 1 FROM branches WHERE id = %s", (body.branch_id,)).fetchone():
        raise field_error("branch_id", "invalid")
    if body.room_type_id and not conn.execute("SELECT 1 FROM room_types WHERE id = %s", (body.room_type_id,)).fetchone():
        raise field_error("room_type_id", "invalid")
    values = {"branch_id": body.branch_id, "room_type_id": body.room_type_id, "name_ar": clean_name(body.name_ar),
              "name_en": clean_name(body.name_en), "notes": clean_name(body.notes), "is_active": body.is_active,
              "sort_order": body.sort_order}
    if room_id is None:
        row = conn.execute(
            """
            INSERT INTO rooms (branch_id, room_type_id, name_ar, name_en, notes, is_active, sort_order)
            VALUES (%(branch_id)s, %(room_type_id)s, %(name_ar)s, %(name_en)s, %(notes)s, %(is_active)s, %(sort_order)s) RETURNING id
            """,
            values,
        ).fetchone()
        audit.record(conn, "settings.room_created", ctx=ctx, entity="room", entity_id=row["id"], details=values)
        return
    row = conn.execute(
        """
        UPDATE rooms SET branch_id = %(branch_id)s, room_type_id = %(room_type_id)s, name_ar = %(name_ar)s, name_en = %(name_en)s,
               notes = %(notes)s, is_active = %(is_active)s, sort_order = %(sort_order)s
        WHERE id = %(id)s RETURNING id
        """,
        {**values, "id": room_id},
    ).fetchone()
    if not row:
        raise AppError(404, "not_found")
    audit.record(conn, "settings.room_updated", ctx=ctx, entity="room", entity_id=room_id, details=values)


def delete_room(conn: psycopg.Connection, ctx: Ctx, room_id: int) -> None:
    row = _delete(conn, "rooms", room_id)
    audit.record(conn, "settings.room_deleted", ctx=ctx, entity="room", entity_id=room_id, details={"name": row["name_en"]})
