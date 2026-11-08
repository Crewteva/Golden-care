"""Appointment endpoints shared by the staff roles (/api/<role>/appointments/...).
Seeing needs appointments.view, booking appointments.book, arrival/cancel/move appointments.manage,
calling in and finishing appointments.treat; squeeze-ins also need appointments.overbook.
Doctors only ever see their own appointments."""
from datetime import date, timedelta
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends

from app.core import app_settings, appointments, clinic_time, slots
from app.core.appointment_schemas import BookIn, CancelIn, NotesIn, RescheduleIn
from app.core.errors import field_error
from app.core.patients_api import guard
from app.core.session import Ctx, require_permission
from app.storage.db import get_conn

router = APIRouter(prefix="/appointments", tags=["appointments"])
Conn = psycopg.Connection

can_view = require_permission("appointments.view")
can_book = require_permission("appointments.book")
can_manage = require_permission("appointments.manage")
can_treat = require_permission("appointments.treat")


def _ids(raw: str) -> list[int]:
    try:
        ids = [int(x) for x in raw.split(",") if x.strip()]
    except ValueError:
        raise field_error("service_ids", "invalid") from None
    if not 1 <= len(ids) <= 5:
        raise field_error("service_ids", "invalid")
    return ids


@router.get("/rules")
def rules(_: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return {**app_settings.booking(conn), "today": clinic_time.today(), "now": clinic_time.now()}


@router.get("/day")
def day(on: date | None = None, doctor_id: UUID | None = None, branch_id: int | None = None,
        ctx: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return appointments.day(conn, ctx, on or clinic_time.today(), doctor_id, branch_id)


@router.get("/week")
def week(start: date | None = None, ctx: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    if start is None:
        today = clinic_time.today()
        start = today - timedelta(days=(today.weekday() + 2) % 7)
    return appointments.week(conn, ctx, start)


@router.get("/doctors")
def doctors(service_ids: str, _: Ctx = Depends(can_book), conn: Conn = Depends(get_conn)):
    return appointments.doctors_for(conn, _ids(service_ids))


@router.get("/slots")
def free_slots(service_ids: str, on: date, doctor_id: UUID | None = None, exclude: UUID | None = None,
               _: Ctx = Depends(can_book), conn: Conn = Depends(get_conn)):
    ids = _ids(service_ids)
    docs = appointments.doctors_for(conn, ids)
    if doctor_id:
        docs = [d for d in docs if d["id"] == doctor_id]
    return [{**d, **slots.free_slots(conn, d["id"], on, ids, exclude)} for d in docs]


@router.post("", status_code=201)
def book(body: BookIn, ctx: Ctx = Depends(can_book), conn: Conn = Depends(get_conn)):
    created = appointments.book(conn, ctx, body)
    return appointments.detail(conn, ctx, created["id"])


@router.get("/patient/{patient_id}")
def for_patient(patient_id: UUID, ctx: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    guard(conn, ctx, patient_id)
    return appointments.for_patient(conn, ctx, patient_id)


@router.get("/{appointment_id}")
def detail(appointment_id: UUID, ctx: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return appointments.detail(conn, ctx, appointment_id)


@router.post("/{appointment_id}/confirm")
def confirm(appointment_id: UUID, ctx: Ctx = Depends(can_manage), conn: Conn = Depends(get_conn)):
    appointments.confirm(conn, ctx, appointment_id)
    return appointments.detail(conn, ctx, appointment_id)


@router.post("/{appointment_id}/arrive")
def arrive(appointment_id: UUID, ctx: Ctx = Depends(can_manage), conn: Conn = Depends(get_conn)):
    appointments.arrive(conn, ctx, appointment_id)
    return appointments.detail(conn, ctx, appointment_id)


@router.post("/{appointment_id}/no-show")
def no_show(appointment_id: UUID, ctx: Ctx = Depends(can_manage), conn: Conn = Depends(get_conn)):
    appointments.no_show(conn, ctx, appointment_id)
    return appointments.detail(conn, ctx, appointment_id)


@router.post("/{appointment_id}/cancel")
def cancel(appointment_id: UUID, body: CancelIn, ctx: Ctx = Depends(can_manage), conn: Conn = Depends(get_conn)):
    appointments.cancel(conn, ctx, appointment_id, body, ctx)
    return appointments.detail(conn, ctx, appointment_id)


@router.post("/{appointment_id}/reschedule")
def reschedule(appointment_id: UUID, body: RescheduleIn, ctx: Ctx = Depends(can_manage), conn: Conn = Depends(get_conn)):
    appointments.reschedule(conn, ctx, appointment_id, body)
    return appointments.detail(conn, ctx, appointment_id)


@router.post("/{appointment_id}/notes")
def notes(appointment_id: UUID, body: NotesIn, ctx: Ctx = Depends(can_manage), conn: Conn = Depends(get_conn)):
    appointments.set_notes(conn, ctx, appointment_id, body.notes)
    return appointments.detail(conn, ctx, appointment_id)


@router.post("/{appointment_id}/call")
def call_in(appointment_id: UUID, ctx: Ctx = Depends(can_treat), conn: Conn = Depends(get_conn)):
    appointments.call_in(conn, ctx, appointment_id)
    return appointments.detail(conn, ctx, appointment_id)


@router.post("/{appointment_id}/finish")
def finish(appointment_id: UUID, ctx: Ctx = Depends(can_treat), conn: Conn = Depends(get_conn)):
    appointments.finish(conn, ctx, appointment_id)
    return appointments.detail(conn, ctx, appointment_id)
