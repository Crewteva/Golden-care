"""Clinic-setup endpoints shared by the roles that see or manage it (/api/<role>/settings/...).
Reading needs settings.view; each kind of change needs its own permission."""
from datetime import date, timedelta
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query

from app.core import catalog, schedules
from app.core.session import Ctx, require_permission
from app.core.settings_schemas import (
    DoctorProfileIn, DoctorServicesIn, HolidayIn, LeaveIn, PriceIn, RoomIn, RoomTypeIn, ScheduleIn, ServiceIn, SpecialtyIn,
)
from app.storage.db import get_conn

router = APIRouter(prefix="/settings", tags=["settings"])

can_view = require_permission("settings.view")
can_services = require_permission("settings.services")
can_prices = require_permission("settings.prices")
can_rooms = require_permission("settings.rooms")
can_schedules = require_permission("settings.schedules")
Conn = psycopg.Connection


@router.get("/catalog")
def get_catalog(_: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return catalog.catalog(conn)


# --- specialties ---

@router.post("/specialties", status_code=201)
def add_specialty(body: SpecialtyIn, ctx: Ctx = Depends(can_services), conn: Conn = Depends(get_conn)):
    return catalog.save_specialty(conn, ctx, body)


@router.put("/specialties/{specialty_id}")
def edit_specialty(specialty_id: int, body: SpecialtyIn, ctx: Ctx = Depends(can_services), conn: Conn = Depends(get_conn)):
    return catalog.save_specialty(conn, ctx, body, specialty_id)


@router.delete("/specialties/{specialty_id}")
def remove_specialty(specialty_id: int, ctx: Ctx = Depends(can_services), conn: Conn = Depends(get_conn)):
    catalog.delete_specialty(conn, ctx, specialty_id)
    return {"ok": True}


# --- services & prices ---

@router.post("/services", status_code=201)
def add_service(body: ServiceIn, ctx: Ctx = Depends(can_services), conn: Conn = Depends(get_conn)):
    return catalog.save_service(conn, ctx, body)


@router.put("/services/{service_id}")
def edit_service(service_id: int, body: ServiceIn, ctx: Ctx = Depends(can_services), conn: Conn = Depends(get_conn)):
    return catalog.save_service(conn, ctx, body, service_id)


@router.delete("/services/{service_id}")
def remove_service(service_id: int, ctx: Ctx = Depends(can_services), conn: Conn = Depends(get_conn)):
    catalog.delete_service(conn, ctx, service_id)
    return {"ok": True}


@router.get("/services/{service_id}/prices")
def service_prices(service_id: int, _: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return catalog.prices(conn, service_id)


@router.post("/services/{service_id}/prices", status_code=201)
def add_price(service_id: int, body: PriceIn, ctx: Ctx = Depends(can_prices), conn: Conn = Depends(get_conn)):
    catalog.save_price(conn, ctx, service_id, body)
    return catalog.prices(conn, service_id)


@router.put("/services/{service_id}/prices/{price_id}")
def edit_price(service_id: int, price_id: int, body: PriceIn, ctx: Ctx = Depends(can_prices), conn: Conn = Depends(get_conn)):
    catalog.save_price(conn, ctx, service_id, body, price_id)
    return catalog.prices(conn, service_id)


@router.delete("/services/{service_id}/prices/{price_id}")
def remove_price(service_id: int, price_id: int, ctx: Ctx = Depends(can_prices), conn: Conn = Depends(get_conn)):
    catalog.delete_price(conn, ctx, service_id, price_id)
    return catalog.prices(conn, service_id)


# --- room types & rooms ---

@router.post("/room-types", status_code=201)
def add_room_type(body: RoomTypeIn, ctx: Ctx = Depends(can_rooms), conn: Conn = Depends(get_conn)):
    return catalog.save_room_type(conn, ctx, body)


@router.put("/room-types/{type_id}")
def edit_room_type(type_id: int, body: RoomTypeIn, ctx: Ctx = Depends(can_rooms), conn: Conn = Depends(get_conn)):
    return catalog.save_room_type(conn, ctx, body, type_id)


@router.delete("/room-types/{type_id}")
def remove_room_type(type_id: int, ctx: Ctx = Depends(can_rooms), conn: Conn = Depends(get_conn)):
    catalog.delete_room_type(conn, ctx, type_id)
    return {"ok": True}


@router.get("/rooms")
def list_rooms(_: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    branches = conn.execute("SELECT id, code, name_ar, name_en, is_active FROM branches ORDER BY name_en").fetchall()
    return {"rooms": catalog.rooms(conn), "branches": branches}


@router.post("/rooms", status_code=201)
def add_room(body: RoomIn, ctx: Ctx = Depends(can_rooms), conn: Conn = Depends(get_conn)):
    catalog.save_room(conn, ctx, body)
    return {"ok": True}


@router.put("/rooms/{room_id}")
def edit_room(room_id: int, body: RoomIn, ctx: Ctx = Depends(can_rooms), conn: Conn = Depends(get_conn)):
    catalog.save_room(conn, ctx, body, room_id)
    return {"ok": True}


@router.delete("/rooms/{room_id}")
def remove_room(room_id: int, ctx: Ctx = Depends(can_rooms), conn: Conn = Depends(get_conn)):
    catalog.delete_room(conn, ctx, room_id)
    return {"ok": True}


# --- doctors ---

@router.get("/doctors")
def list_doctors(_: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return schedules.doctors(conn)


@router.put("/doctors/{doctor_id}/profile")
def edit_profile(doctor_id: UUID, body: DoctorProfileIn, ctx: Ctx = Depends(can_schedules), conn: Conn = Depends(get_conn)):
    schedules.save_profile(conn, ctx, doctor_id, body)
    return schedules.doctors(conn, doctor_id)[0]


@router.put("/doctors/{doctor_id}/services")
def edit_doctor_services(doctor_id: UUID, body: DoctorServicesIn, ctx: Ctx = Depends(can_schedules), conn: Conn = Depends(get_conn)):
    schedules.set_services(conn, ctx, doctor_id, body.service_ids)
    return schedules.doctors(conn, doctor_id)[0]


@router.post("/doctors/{doctor_id}/schedule", status_code=201)
def add_schedule(doctor_id: UUID, body: ScheduleIn, ctx: Ctx = Depends(can_schedules), conn: Conn = Depends(get_conn)):
    schedules.save_schedule(conn, ctx, doctor_id, body)
    return schedules.doctors(conn, doctor_id)[0]


@router.put("/doctors/{doctor_id}/schedule/{schedule_id}")
def edit_schedule(doctor_id: UUID, schedule_id: int, body: ScheduleIn, ctx: Ctx = Depends(can_schedules),
                  conn: Conn = Depends(get_conn)):
    schedules.save_schedule(conn, ctx, doctor_id, body, schedule_id)
    return schedules.doctors(conn, doctor_id)[0]


@router.delete("/doctors/{doctor_id}/schedule/{schedule_id}")
def remove_schedule(doctor_id: UUID, schedule_id: int, ctx: Ctx = Depends(can_schedules), conn: Conn = Depends(get_conn)):
    schedules.delete_schedule(conn, ctx, doctor_id, schedule_id)
    return schedules.doctors(conn, doctor_id)[0]


# --- leave & holidays ---

@router.get("/leave")
def list_leave(include_past: bool = False, _: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return schedules.leave(conn, include_past)


@router.post("/leave", status_code=201)
def add_leave(body: LeaveIn, ctx: Ctx = Depends(can_schedules), conn: Conn = Depends(get_conn)):
    schedules.save_leave(conn, ctx, body)
    return {"ok": True}


@router.put("/leave/{leave_id}")
def edit_leave(leave_id: int, body: LeaveIn, ctx: Ctx = Depends(can_schedules), conn: Conn = Depends(get_conn)):
    schedules.save_leave(conn, ctx, body, leave_id)
    return {"ok": True}


@router.delete("/leave/{leave_id}")
def remove_leave(leave_id: int, ctx: Ctx = Depends(can_schedules), conn: Conn = Depends(get_conn)):
    schedules.delete_leave(conn, ctx, leave_id)
    return {"ok": True}


@router.get("/holidays")
def list_holidays(_: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return schedules.holidays(conn)


@router.post("/holidays", status_code=201)
def add_holiday(body: HolidayIn, ctx: Ctx = Depends(can_schedules), conn: Conn = Depends(get_conn)):
    schedules.save_holiday(conn, ctx, body)
    return {"ok": True}


@router.put("/holidays/{holiday_id}")
def edit_holiday(holiday_id: int, body: HolidayIn, ctx: Ctx = Depends(can_schedules), conn: Conn = Depends(get_conn)):
    schedules.save_holiday(conn, ctx, body, holiday_id)
    return {"ok": True}


@router.delete("/holidays/{holiday_id}")
def remove_holiday(holiday_id: int, ctx: Ctx = Depends(can_schedules), conn: Conn = Depends(get_conn)):
    schedules.delete_holiday(conn, ctx, holiday_id)
    return {"ok": True}


# --- week view ---

@router.get("/week")
def week(start: date | None = None, doctor_id: UUID | None = None, _: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    if start is None:
        today = date.today()
        start = today - timedelta(days=(today.weekday() + 2) % 7)  # the Saturday that starts this week
    return schedules.week(conn, start, doctor_id)


def _unused(_: int = Query(0)):  # keeps FastAPI from complaining about an empty module in some tools
    return None
