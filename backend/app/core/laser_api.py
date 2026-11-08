"""Laser session endpoints (/api/<role>/laser/...): laser.record writes; visits.view_all (medical director) reads."""
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends

from app.core import laser
from app.core.clinical_schemas import DeviceIn, LaserSessionIn
from app.core.session import Ctx, require_permission
from app.core.visits_api import require_any
from app.storage.db import get_conn

router = APIRouter(prefix="/laser", tags=["laser"])
Conn = psycopg.Connection

can_read = require_any("laser.record", "visits.view_all")
can_record = require_permission("laser.record")
can_devices = require_permission("clinical_lists.manage")


@router.get("/today")
def today(ctx: Ctx = Depends(can_read), conn: Conn = Depends(get_conn)):
    return laser.today(conn, ctx)


@router.get("/devices")
def devices(all: bool = False, ctx: Ctx = Depends(require_any("laser.record", "visits.view_all", "clinical_lists.manage")),
            conn: Conn = Depends(get_conn)):
    return laser.devices(conn, include_inactive=all)


@router.post("/devices", status_code=201)
def add_device(body: DeviceIn, ctx: Ctx = Depends(can_devices), conn: Conn = Depends(get_conn)):
    return laser.save_device(conn, ctx, body)


@router.put("/devices/{device_id}")
def edit_device(device_id: int, body: DeviceIn, ctx: Ctx = Depends(can_devices), conn: Conn = Depends(get_conn)):
    return laser.save_device(conn, ctx, body, device_id)


@router.get("/patient/{patient_id}")
def for_patient(patient_id: UUID, ctx: Ctx = Depends(can_read), conn: Conn = Depends(get_conn)):
    return laser.for_patient(conn, ctx, patient_id)


@router.post("/start/{appointment_id}")
def start(appointment_id: UUID, ctx: Ctx = Depends(can_record), conn: Conn = Depends(get_conn)):
    return laser.start(conn, ctx, appointment_id)


@router.get("/{session_id}")
def detail(session_id: UUID, ctx: Ctx = Depends(can_read), conn: Conn = Depends(get_conn)):
    return laser.detail(conn, ctx, session_id)


@router.put("/{session_id}")
def save(session_id: UUID, body: LaserSessionIn, ctx: Ctx = Depends(can_record), conn: Conn = Depends(get_conn)):
    laser.save(conn, ctx, session_id, body)
    return {"ok": True}


@router.post("/{session_id}/sign")
def sign(session_id: UUID, ctx: Ctx = Depends(can_record), conn: Conn = Depends(get_conn)):
    laser.sign(conn, ctx, session_id)
    return laser.detail(conn, ctx, session_id)
