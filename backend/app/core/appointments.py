"""Appointments: booking, moving, the visit's journey (booked → confirmed → arrived → with doctor → completed),
cancellations, no-shows, queue numbers and the full history of every appointment."""
from datetime import date, datetime, timedelta

import psycopg
from psycopg import errors as pg_errors
from psycopg.types.json import Jsonb

from app.core import audit, clinic_time
from app.core.errors import AppError, field_error
from app.core.normalize import clean_name
from app.core.appointment_schemas import BookIn, CancelIn, RescheduleIn, WhenIn
from app.core.session import Ctx
from app.core.slots import DayPlanner, doctor_blocks, room_type_for

OPEN = ("requested", "booked", "confirmed")          # can still be moved or cancelled
ACTIVE = ("requested", "booked", "confirmed", "arrived", "in_room")

SELECT = """
    SELECT a.*, p.mrn, p.full_name_ar AS patient_name_ar, p.full_name_en AS patient_name_en, p.phone AS patient_phone,
           p.date_of_birth, p.gender,
           d.full_name_ar AS doctor_name_ar, d.full_name_en AS doctor_name_en,
           COALESCE(dp.color, sp.color) AS doctor_color,
           r.name_ar AS room_name_ar, r.name_en AS room_name_en, b.name_ar AS branch_name_ar, b.name_en AS branch_name_en,
           COALESCE((SELECT json_agg(json_build_object('service_id', s.id, 'code', s.code, 'name_ar', s.name_ar, 'name_en', s.name_en,
                                                       'duration_min', x.duration_min, 'price', x.price) ORDER BY x.position)
                     FROM appointment_services x JOIN services s ON s.id = x.service_id WHERE x.appointment_id = a.id), '[]') AS services,
           EXISTS (SELECT 1 FROM patient_alerts al WHERE al.patient_id = a.patient_id AND al.removed_at IS NULL
                   AND al.severity = 'critical') AS critical_alert
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN users d ON d.id = a.doctor_id
    LEFT JOIN doctor_profiles dp ON dp.user_id = a.doctor_id
    LEFT JOIN specialties sp ON sp.id = dp.specialty_id
    LEFT JOIN rooms r ON r.id = a.room_id
    JOIN branches b ON b.id = a.branch_id
"""


def doctor_scope(ctx: Ctx):
    """Doctors only ever see their own appointments."""
    return ctx.user_id if ctx.active_role == "doctor" else None


def _event(conn: psycopg.Connection, appointment_id, actor, action: str, from_status=None, to_status=None, details=None):
    actor_id = getattr(actor, "user_id", None)
    label = getattr(actor, "label", None)
    conn.execute(
        """
        INSERT INTO appointment_events (appointment_id, actor_id, actor_label, action, from_status, to_status, details)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (appointment_id, actor_id, label, action, from_status, to_status, Jsonb(details or {})),
    )


def get(conn: psycopg.Connection, appointment_id, ctx: Ctx | None = None, lock: bool = False) -> dict:
    if lock:
        conn.execute("SELECT 1 FROM appointments WHERE id = %s FOR UPDATE", (appointment_id,))
    row = conn.execute(f"{SELECT} WHERE a.id = %s", (appointment_id,)).fetchone()
    if not row:
        raise AppError(404, "appointment_not_found")
    if ctx is not None and doctor_scope(ctx) and row["doctor_id"] != ctx.user_id:
        raise AppError(403, "not_your_appointment")
    return row


def detail(conn: psycopg.Connection, ctx: Ctx, appointment_id) -> dict:
    row = get(conn, appointment_id, ctx)
    events = conn.execute(
        "SELECT * FROM appointment_events WHERE appointment_id = %s ORDER BY at, id", (appointment_id,),
    ).fetchall()
    return {**row, "events": events}


# ---------- prices & services ----------

def _services(conn: psycopg.Connection, service_ids: list[int]) -> list[dict]:
    rows = conn.execute(
        """
        SELECT s.* FROM services s JOIN specialties sp ON sp.id = s.specialty_id
        WHERE s.id = ANY(%s) AND s.is_active AND sp.is_active
        """,
        (service_ids,),
    ).fetchall()
    by_id = {r["id"]: r for r in rows}
    if len(by_id) != len(set(service_ids)):
        raise field_error("service_ids", "unavailable")
    return [by_id[s] for s in service_ids]


def price_on(conn: psycopg.Connection, service_id: int, doctor_id, day: date):
    row = conn.execute(
        """
        SELECT COALESCE(
          (SELECT amount FROM service_prices WHERE service_id = %(s)s AND doctor_id = %(d)s AND starts_on <= %(day)s ORDER BY starts_on DESC LIMIT 1),
          (SELECT amount FROM service_prices WHERE service_id = %(s)s AND doctor_id IS NULL AND starts_on <= %(day)s ORDER BY starts_on DESC LIMIT 1)
        ) AS amount
        """,
        {"s": service_id, "d": doctor_id, "day": day},
    ).fetchone()
    return row["amount"]


def _check_doctor_services(conn: psycopg.Connection, doctor_id, service_ids: list[int]) -> None:
    if not conn.execute(
        "SELECT 1 FROM users u WHERE u.id = %s AND u.is_active AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_code = 'doctor')",
        (doctor_id,),
    ).fetchone():
        raise field_error("doctor_id", "invalid")
    n = conn.execute(
        "SELECT count(*) AS n FROM doctor_services WHERE doctor_id = %s AND service_id = ANY(%s)", (doctor_id, service_ids),
    ).fetchone()["n"]
    if n != len(set(service_ids)):
        raise AppError(409, "doctor_does_not_offer")


def doctors_for(conn: psycopg.Connection, service_ids: list[int]) -> list[dict]:
    return conn.execute(
        """
        SELECT u.id, u.full_name_ar, u.full_name_en, dp.title_ar, dp.title_en, COALESCE(dp.color, sp.color) AS color
        FROM users u
        LEFT JOIN doctor_profiles dp ON dp.user_id = u.id
        LEFT JOIN specialties sp ON sp.id = dp.specialty_id
        WHERE u.is_active AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_code = 'doctor')
          AND (SELECT count(*) FROM doctor_services ds WHERE ds.doctor_id = u.id AND ds.service_id = ANY(%s)) = %s
        ORDER BY u.full_name_ar
        """,
        (service_ids, len(set(service_ids))),
    ).fetchall()


# ---------- placing an appointment in time ----------

def _resolve_when(conn: psycopg.Connection, ctx: Ctx | None, doctor_id, service_ids: list[int], duration: int, when: WhenIn,
                  exclude=None) -> dict:
    """Where and when the appointment goes. Normal bookings must fit a free slot; squeeze-ins need a reason + permission."""
    reason = (when.overbook_reason or "").strip()
    if when.starts_at is not None:
        start = when.starts_at if when.starts_at.tzinfo else when.starts_at.replace(tzinfo=clinic_time.TZ)
    elif when.local_date and when.local_time:
        start = clinic_time.at(when.local_date, when.local_time)
    else:
        raise field_error("starts_at", "required")
    start = clinic_time.local(start).replace(second=0, microsecond=0)
    end = start + timedelta(minutes=duration)
    if end <= clinic_time.now() - timedelta(minutes=5) and not reason:
        raise field_error("starts_at", "in_past")
    planner = DayPlanner(conn, doctor_id, start.date(), room_type_for(conn, service_ids), exclude)
    if not reason:
        block, room = planner.check(start, end)
        return {"start": start, "end": end, "branch_id": block["branch_id"], "room_id": room["id"] if room else None,
                "overbooked": False, "reason": None}
    # squeeze-in
    if ctx is None or "appointments.overbook" not in ctx.permissions:
        raise AppError(403, "forbidden", permission="appointments.overbook")
    if len(reason) < 5:
        raise field_error("overbook_reason", "too_short")
    if planner.reason in ("leave", "holiday"):
        raise AppError(409, "doctor_on_leave" if planner.reason == "leave" else "clinic_holiday")
    block = next((b for b in planner.blocks if b["start"] <= start < b["end"]), None) or (planner.blocks[0] if planner.blocks else None)
    branch_id = block["branch_id"] if block else (ctx.active_branch_id or conn.execute("SELECT id FROM branches WHERE is_active ORDER BY id LIMIT 1").fetchone()["id"])
    room = planner.room_for(block, start, end) if block else None
    return {"start": start, "end": end, "branch_id": branch_id, "room_id": room["id"] if room else None,
            "overbooked": True, "reason": reason}


def _exclusion(exc: pg_errors.ExclusionViolation) -> AppError:
    name = getattr(exc.diag, "constraint_name", "") or ""
    return AppError(409, "room_taken" if "room" in name else "slot_taken")


def create(conn: psycopg.Connection, actor, *, patient_id, doctor_id, service_ids: list[int], when: WhenIn, source: str,
           notes: str | None, status: str = "booked", ctx_for_overbook: Ctx | None = None) -> dict:
    if not conn.execute("SELECT 1 FROM patients WHERE id = %s", (patient_id,)).fetchone():
        raise AppError(404, "patient_not_found")
    services = _services(conn, service_ids)
    _check_doctor_services(conn, doctor_id, service_ids)
    duration = sum(s["duration_min"] for s in services)
    place = _resolve_when(conn, ctx_for_overbook, doctor_id, service_ids, duration, when)
    day = place["start"].date()
    prices = [price_on(conn, s["id"], doctor_id, day) for s in services]
    total = sum(p for p in prices if p is not None) if any(p is not None for p in prices) else None
    try:
        with conn.transaction():
            row = conn.execute(
                """
                INSERT INTO appointments (patient_id, doctor_id, branch_id, room_id, starts_at, ends_at, status, source, notes,
                                          overbooked, overbook_reason, estimated_price, booked_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, ref
                """,
                (patient_id, doctor_id, place["branch_id"], place["room_id"], place["start"], place["end"], status, source,
                 clean_name(notes), place["overbooked"], place["reason"], total, getattr(actor, "user_id", None)),
            ).fetchone()
    except pg_errors.ExclusionViolation as exc:
        raise _exclusion(exc) from None
    for position, (service, price) in enumerate(zip(services, prices)):
        conn.execute(
            "INSERT INTO appointment_services (appointment_id, position, service_id, duration_min, price) VALUES (%s, %s, %s, %s, %s)",
            (row["id"], position, service["id"], service["duration_min"], price),
        )
    details = {"patient_id": str(patient_id), "doctor_id": str(doctor_id), "starts_at": place["start"].isoformat(),
               "services": [s["code"] for s in services], "source": source, "overbook_reason": place["reason"]}
    _event(conn, row["id"], actor, "booked", None, status, details)
    audit.record(conn, "appointment.booked", ctx=actor if isinstance(actor, Ctx) else None, entity="appointment",
                 entity_id=row["id"], details={**details, "ref": row["ref"]})
    return {"id": row["id"], "ref": row["ref"]}


def book(conn: psycopg.Connection, ctx: Ctx, body: BookIn) -> dict:
    return create(conn, ctx, patient_id=body.patient_id, doctor_id=body.doctor_id, service_ids=body.service_ids, when=body,
                  source=body.source, notes=body.notes, ctx_for_overbook=ctx)


def reschedule(conn: psycopg.Connection, ctx: Ctx, appointment_id, body: RescheduleIn) -> None:
    appt = get(conn, appointment_id, ctx, lock=True)
    if appt["status"] not in OPEN:
        raise AppError(409, "cannot_change_status")
    doctor_id = body.doctor_id or appt["doctor_id"]
    service_ids = [s["service_id"] for s in appt["services"]]
    if doctor_id != appt["doctor_id"]:
        _check_doctor_services(conn, doctor_id, service_ids)
    duration = sum(s["duration_min"] for s in appt["services"])
    place = _resolve_when(conn, ctx, doctor_id, service_ids, duration, body, exclude=appointment_id)
    new_status = "booked" if appt["status"] == "confirmed" else appt["status"]
    try:
        with conn.transaction():
            conn.execute(
                """
                UPDATE appointments SET doctor_id = %s, branch_id = %s, room_id = %s, starts_at = %s, ends_at = %s, status = %s,
                       overbooked = %s, overbook_reason = %s, updated_at = now()
                WHERE id = %s
                """,
                (doctor_id, place["branch_id"], place["room_id"], place["start"], place["end"], new_status,
                 place["overbooked"], place["reason"], appointment_id),
            )
    except pg_errors.ExclusionViolation as exc:
        raise _exclusion(exc) from None
    details = {"patient_id": str(appt["patient_id"]), "from": appt["starts_at"].isoformat(), "to": place["start"].isoformat(),
               "from_doctor": str(appt["doctor_id"]), "to_doctor": str(doctor_id), "overbook_reason": place["reason"]}
    _event(conn, appointment_id, ctx, "rescheduled", appt["status"], new_status, details)
    audit.record(conn, "appointment.rescheduled", ctx=ctx, entity="appointment", entity_id=appointment_id,
                 details={**details, "ref": appt["ref"]})


# ---------- the visit's journey ----------

def _set_status(conn: psycopg.Connection, actor, appt: dict, to: str, extra_sql: str = "", extra: tuple = (), details=None) -> None:
    conn.execute(f"UPDATE appointments SET status = %s, updated_at = now(){extra_sql} WHERE id = %s", (to, *extra, appt["id"]))
    _event(conn, appt["id"], actor, to, appt["status"], to, details)


def confirm(conn: psycopg.Connection, ctx: Ctx, appointment_id) -> None:
    appt = get(conn, appointment_id, ctx, lock=True)
    if appt["status"] not in ("requested", "booked"):
        raise AppError(409, "cannot_change_status")
    _set_status(conn, ctx, appt, "confirmed")


def arrive(conn: psycopg.Connection, ctx: Ctx, appointment_id) -> None:
    appt = get(conn, appointment_id, ctx, lock=True)
    if appt["status"] not in OPEN:
        raise AppError(409, "cannot_change_status")
    day = clinic_time.local(appt["starts_at"]).date()
    if day != clinic_time.today():
        raise AppError(409, "not_today")
    conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"queue:{appt['doctor_id']}:{day}",))
    queue_no = conn.execute(
        "SELECT COALESCE(max(queue_no), 0) + 1 AS n FROM appointments WHERE doctor_id = %s AND starts_at::date = %s",
        (appt["doctor_id"], day),
    ).fetchone()["n"]
    late = max(0, int((clinic_time.now() - appt["starts_at"]).total_seconds() // 60))
    _set_status(conn, ctx, appt, "arrived", ", arrived_at = now(), queue_no = %s", (queue_no,),
                {"queue_no": queue_no, "minutes_late": late})


def _treat_guard(ctx: Ctx, appt: dict) -> None:
    if appt["doctor_id"] != ctx.user_id and "appointments.manage" not in ctx.permissions:
        raise AppError(403, "not_your_appointment")


def call_in(conn: psycopg.Connection, ctx: Ctx, appointment_id) -> None:
    appt = get(conn, appointment_id, ctx, lock=True)
    _treat_guard(ctx, appt)
    if appt["status"] != "arrived":
        raise AppError(409, "cannot_change_status")
    if conn.execute(
        "SELECT 1 FROM appointments WHERE doctor_id = %s AND status = 'in_room' AND id <> %s", (appt["doctor_id"], appointment_id),
    ).fetchone():
        raise AppError(409, "already_with_patient")
    _set_status(conn, ctx, appt, "in_room", ", in_room_at = now()")


def finish(conn: psycopg.Connection, ctx: Ctx, appointment_id) -> None:
    appt = get(conn, appointment_id, ctx, lock=True)
    _treat_guard(ctx, appt)
    if appt["status"] != "in_room":
        raise AppError(409, "cannot_change_status")
    _set_status(conn, ctx, appt, "completed", ", completed_at = now()")
    audit.record(conn, "appointment.completed", ctx=ctx, entity="appointment", entity_id=appointment_id,
                 details={"patient_id": str(appt["patient_id"]), "ref": appt["ref"]})


def cancel(conn: psycopg.Connection, actor, appointment_id, body: CancelIn, ctx: Ctx | None = None) -> None:
    appt = get(conn, appointment_id, ctx, lock=True)
    if appt["status"] not in OPEN + ("arrived",):
        raise AppError(409, "cannot_change_status")
    _set_status(conn, actor, appt, "cancelled", ", cancelled_at = now(), cancel_reason = %s, cancelled_by_kind = %s",
                (body.reason.strip(), body.by), {"reason": body.reason.strip(), "by": body.by})
    audit.record(conn, "appointment.cancelled", ctx=actor if isinstance(actor, Ctx) else None, entity="appointment",
                 entity_id=appointment_id, details={"patient_id": str(appt["patient_id"]), "ref": appt["ref"],
                                                    "reason": body.reason.strip(), "by": body.by})


def no_show(conn: psycopg.Connection, ctx: Ctx, appointment_id) -> None:
    appt = get(conn, appointment_id, ctx, lock=True)
    if appt["status"] not in OPEN:
        raise AppError(409, "cannot_change_status")
    if clinic_time.now() < appt["starts_at"]:
        raise AppError(409, "not_started_yet")
    _set_status(conn, ctx, appt, "no_show")
    audit.record(conn, "appointment.no_show", ctx=ctx, entity="appointment", entity_id=appointment_id,
                 details={"patient_id": str(appt["patient_id"]), "ref": appt["ref"]})


def set_notes(conn: psycopg.Connection, ctx: Ctx, appointment_id, notes: str | None) -> None:
    appt = get(conn, appointment_id, ctx, lock=True)
    conn.execute("UPDATE appointments SET notes = %s, updated_at = now() WHERE id = %s", (clean_name(notes), appointment_id))
    _event(conn, appointment_id, ctx, "notes", appt["status"], appt["status"], {"notes": clean_name(notes)})


# ---------- lists ----------

def day(conn: psycopg.Connection, ctx: Ctx, on: date, doctor_id=None, branch_id=None) -> dict:
    """Everything reception and doctors need for one day: who works, their hours, and every appointment."""
    scope = doctor_scope(ctx)
    doctor_id = scope or doctor_id
    rows = conn.execute(
        f"""{SELECT}
        WHERE a.starts_at::date = %(day)s
          AND (%(doctor)s::uuid IS NULL OR a.doctor_id = %(doctor)s::uuid)
          AND (%(branch)s::int IS NULL OR a.branch_id = %(branch)s::int)
        ORDER BY a.starts_at, d.full_name_ar
        """,
        {"day": on, "doctor": doctor_id, "branch": branch_id},
    ).fetchall()
    doctors = conn.execute(
        """
        SELECT u.id, u.full_name_ar, u.full_name_en, dp.title_ar, dp.title_en, COALESCE(dp.color, sp.color) AS color,
               sp.name_ar AS specialty_name_ar, sp.name_en AS specialty_name_en
        FROM users u LEFT JOIN doctor_profiles dp ON dp.user_id = u.id LEFT JOIN specialties sp ON sp.id = dp.specialty_id
        WHERE u.is_active AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_code = 'doctor')
          AND (%s::uuid IS NULL OR u.id = %s::uuid)
        ORDER BY u.full_name_ar
        """,
        (doctor_id, doctor_id),
    ).fetchall()
    working = []
    for doc in doctors:
        blocks, reason = doctor_blocks(conn, doc["id"], on)
        has_appts = any(r["doctor_id"] == doc["id"] for r in rows)
        if blocks or has_appts or doctor_id:
            working.append({**doc, "off_reason": reason, "blocks": [
                {"start": b["start"], "end": b["end"], "room_name_ar": b["room_name_ar"], "room_name_en": b["room_name_en"],
                 "branch_id": b["branch_id"]} for b in blocks]})
    stats = {s: sum(1 for r in rows if r["status"] == s) for s in
             ("requested", "booked", "confirmed", "arrived", "in_room", "completed", "cancelled", "no_show")}
    return {"date": on, "doctors": working, "appointments": rows, "stats": stats, "now": clinic_time.now()}


def week(conn: psycopg.Connection, ctx: Ctx, start: date) -> dict:
    scope = doctor_scope(ctx)
    end = start + timedelta(days=7)
    rows = conn.execute(
        """
        SELECT a.doctor_id, a.starts_at::date AS day, count(*) FILTER (WHERE a.status NOT IN ('cancelled', 'no_show')) AS active,
               count(*) FILTER (WHERE a.status = 'completed') AS completed,
               count(*) FILTER (WHERE a.status IN ('cancelled', 'no_show')) AS lost
        FROM appointments a
        WHERE a.starts_at >= %s AND a.starts_at < %s AND (%s::uuid IS NULL OR a.doctor_id = %s::uuid)
        GROUP BY a.doctor_id, a.starts_at::date
        """,
        (clinic_time.at(start, datetime.min.time()), clinic_time.at(end, datetime.min.time()), scope, scope),
    ).fetchall()
    return {"start": start, "counts": rows}


def for_patient(conn: psycopg.Connection, ctx: Ctx, patient_id) -> list[dict]:
    scope = doctor_scope(ctx)
    return conn.execute(
        f"{SELECT} WHERE a.patient_id = %s AND (%s::uuid IS NULL OR a.doctor_id = %s::uuid) ORDER BY a.starts_at DESC LIMIT 200",
        (patient_id, scope, scope),
    ).fetchall()


def doctor_has_patient(conn: psycopg.Connection, doctor_id, patient_id) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM appointments WHERE doctor_id = %s AND patient_id = %s LIMIT 1", (doctor_id, patient_id),
    ).fetchone())
