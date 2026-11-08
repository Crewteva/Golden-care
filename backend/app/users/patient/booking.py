"""The patient's own appointments in their account: see, book online from free times, and cancel in time.
Covers the patient and the family members they manage (e.g. their children)."""
from datetime import date, timedelta

import psycopg

from app.core import app_settings, appointments, clinic_time, slots
from app.core.appointment_schemas import CancelIn, PortalBookIn, PortalCancelIn, WhenIn
from app.core.errors import AppError, field_error
from app.core.session import Ctx
from app.users.patient.service import my_patient_ids


def _rules(conn: psycopg.Connection) -> dict:
    return app_settings.booking(conn)


def _can_cancel(row: dict, rules: dict) -> bool:
    if row["status"] not in appointments.OPEN:
        return False
    return row["starts_at"] - clinic_time.now() >= timedelta(hours=int(rules["portal_cancel_hours"]))


def _public(row: dict, rules: dict) -> dict:
    keep = ("id", "ref", "patient_id", "patient_name_ar", "patient_name_en", "doctor_id", "doctor_name_ar", "doctor_name_en",
            "branch_name_ar", "branch_name_en", "room_name_ar", "room_name_en", "starts_at", "ends_at", "status", "services",
            "estimated_price", "queue_no", "cancel_reason", "cancelled_by_kind")
    return {**{k: row[k] for k in keep}, "can_cancel": _can_cancel(row, rules)}


def my_appointments(conn: psycopg.Connection, ctx: Ctx) -> dict:
    rules = _rules(conn)
    rows = conn.execute(
        f"{appointments.SELECT} WHERE a.patient_id = ANY(%s) ORDER BY a.starts_at DESC LIMIT 200", (my_patient_ids(conn, ctx),),
    ).fetchall()
    return {"items": [_public(r, rules) for r in rows], "rules": {k: rules[k] for k in
            ("portal_enabled", "portal_needs_confirmation", "portal_cancel_hours", "portal_days_ahead")}, "now": clinic_time.now()}


def options(conn: psycopg.Connection, ctx: Ctx) -> dict:
    """What a patient can book online: services that at least one doctor offers, and for whom."""
    rules = _rules(conn)
    services = conn.execute(
        """
        SELECT s.id, s.name_ar, s.name_en, s.duration_min, s.specialty_id, sp.name_ar AS specialty_name_ar,
               sp.name_en AS specialty_name_en, sp.color,
               (SELECT amount FROM service_prices p WHERE p.service_id = s.id AND p.doctor_id IS NULL AND p.starts_on <= current_date
                ORDER BY p.starts_on DESC LIMIT 1) AS price
        FROM services s JOIN specialties sp ON sp.id = s.specialty_id
        WHERE s.is_active AND sp.is_active AND EXISTS (
          SELECT 1 FROM doctor_services ds JOIN users u ON u.id = ds.doctor_id WHERE ds.service_id = s.id AND u.is_active)
        ORDER BY sp.sort_order, s.sort_order, s.name_en
        """
    ).fetchall()
    people = conn.execute(
        "SELECT id, full_name_ar, full_name_en, date_of_birth FROM patients WHERE id = ANY(%s)", (my_patient_ids(conn, ctx),),
    ).fetchall()
    return {"services": services, "people": people, "rules": rules, "today": clinic_time.today()}


def _check_enabled(rules: dict) -> None:
    if not rules["portal_enabled"]:
        raise AppError(403, "portal_booking_off")


def free_slots(conn: psycopg.Connection, service_id: int, on: date, doctor_id=None) -> list[dict]:
    rules = _rules(conn)
    _check_enabled(rules)
    if on < clinic_time.today() or on > clinic_time.today() + timedelta(days=int(rules["portal_days_ahead"])):
        raise field_error("on", "out_of_range")
    docs = appointments.doctors_for(conn, [service_id])
    if doctor_id:
        docs = [d for d in docs if d["id"] == doctor_id]
    out = []
    for d in docs:
        found = slots.free_slots(conn, d["id"], on, [service_id])
        out.append({**d, "reason": found["reason"], "duration_min": found["duration_min"],
                    "slots": [{"start": s["start"], "end": s["end"]} for s in found["slots"]]})
    return out


def book(conn: psycopg.Connection, ctx: Ctx, body: PortalBookIn) -> dict:
    rules = _rules(conn)
    _check_enabled(rules)
    if body.patient_id not in my_patient_ids(conn, ctx):
        raise AppError(403, "not_your_family")
    start = clinic_time.local(body.starts_at)
    if start.date() > clinic_time.today() + timedelta(days=int(rules["portal_days_ahead"])):
        raise field_error("starts_at", "out_of_range")
    upcoming = conn.execute(
        "SELECT count(*) AS n FROM appointments WHERE patient_id = %s AND status IN ('requested', 'booked', 'confirmed') AND starts_at > now()",
        (body.patient_id,),
    ).fetchone()["n"]
    if upcoming >= int(rules["portal_max_upcoming"]):
        raise AppError(409, "too_many_upcoming", limit=int(rules["portal_max_upcoming"]))
    status = "requested" if rules["portal_needs_confirmation"] else "booked"
    return appointments.create(conn, ctx, patient_id=body.patient_id, doctor_id=body.doctor_id, service_ids=[body.service_id],
                               when=WhenIn(starts_at=start), source="portal", notes=None, status=status)


def cancel(conn: psycopg.Connection, ctx: Ctx, appointment_id, body: PortalCancelIn) -> None:
    rules = _rules(conn)
    row = appointments.get(conn, appointment_id)
    if row["patient_id"] not in my_patient_ids(conn, ctx):
        raise AppError(404, "appointment_not_found")
    if not _can_cancel(row, rules):
        raise AppError(409, "too_late_to_cancel", hours=int(rules["portal_cancel_hours"]))
    reason = (body.reason or "").strip()
    if len(reason) < 3:
        reason = "Cancelled by the patient online"
    appointments.cancel(conn, ctx, appointment_id, CancelIn(reason=reason, by="patient"))
