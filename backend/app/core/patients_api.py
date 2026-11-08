"""Patient-file endpoints shared by the staff roles that work with patients.

Each role mounts this router inside its own API (/api/reception/patients, /api/doctor/patients, ...),
so the role check comes from the role's router and every endpoint here also checks a permission.
What each role may do is therefore set in Roles & permissions (defaults in storage/seed.py).
Doctors only reach the files of patients who have an appointment with them."""
from typing import Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse

from app.config import settings
from app.core import appointments, files, patients
from app.core.errors import AppError
from app.core.national_id import parse_national_id
from app.core.patient_schemas import (
    AlertIn, DuplicateCheckIn, FamilyLinkIn, PatientCreate, PatientUpdate, ReasonIn, ReviewIn,
)
from app.core.session import Ctx, ready_ctx, require_permission
from app.storage.db import get_conn

router = APIRouter(tags=["patients"])

can_view = require_permission("patients.view")
can_create = require_permission("patients.create")
can_edit = require_permission("patients.edit")
can_alerts = require_permission("patients.alerts")
can_portal = require_permission("patients.portal_access")
can_review = require_permission("patient_files.review")


def guard(conn: psycopg.Connection, ctx: Ctx, patient_id) -> None:
    """A doctor may open a file only when the patient has (or had) an appointment with them."""
    doctor = appointments.doctor_scope(ctx)
    if doctor and not appointments.doctor_has_patient(conn, doctor, patient_id):
        raise AppError(403, "not_your_patient")


def _file_response(path, row) -> FileResponse:
    return FileResponse(
        path, media_type=row["mime"], filename=row["original_name"], content_disposition_type="inline",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/patients")
def search(
    q: str | None = None,
    gender: Literal["female", "male"] | None = None,
    age_min: int | None = Query(None, ge=0, le=120),
    age_max: int | None = Query(None, ge=0, le=120),
    source: Literal["self", "reception"] | None = None,
    has_alerts: bool | None = None,
    sort: str = "created",
    direction: Literal["asc", "desc"] = "desc",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=5, le=100),
    ctx: Ctx = Depends(can_view),
    conn: psycopg.Connection = Depends(get_conn),
):
    return patients.search(conn, q=q, gender=gender, age_min=age_min, age_max=age_max, source=source,
                           has_alerts=has_alerts, sort=sort, direction=direction, page=page, page_size=page_size,
                           doctor_id=appointments.doctor_scope(ctx))


@router.get("/patients/national-id/{value}")
def check_national_id(value: str, _: Ctx = Depends(can_view)):
    parsed = parse_national_id(value)
    if not parsed:
        raise AppError(422, "validation", fields={"national_id": "invalid_national_id"})
    return parsed


@router.post("/patients/check-duplicates")
def check_duplicates(body: DuplicateCheckIn, _: Ctx = Depends(can_view), conn: psycopg.Connection = Depends(get_conn)):
    return patients.find_duplicates(conn, name_ar=body.full_name_ar, name_en=body.full_name_en, dob=body.date_of_birth,
                                    phone=body.phone, national_id=body.national_id, exclude_id=body.exclude_id)


@router.post("/patients", status_code=201)
def create(body: PatientCreate, ctx: Ctx = Depends(can_create), conn: psycopg.Connection = Depends(get_conn)):
    return patients.create(conn, ctx, body)


@router.get("/patients/review-queue")
def review_queue(ctx: Ctx = Depends(can_review), conn: psycopg.Connection = Depends(get_conn)):
    return files.review_queue(conn, doctor_id=appointments.doctor_scope(ctx))


@router.get("/patients/{patient_id}")
def detail(patient_id: UUID, ctx: Ctx = Depends(can_view), conn: psycopg.Connection = Depends(get_conn)):
    guard(conn, ctx, patient_id)
    return patients.detail(conn, patient_id)


@router.put("/patients/{patient_id}")
def update(patient_id: UUID, body: PatientUpdate, ctx: Ctx = Depends(can_edit), conn: psycopg.Connection = Depends(get_conn)):
    guard(conn, ctx, patient_id)
    patients.update(conn, ctx, patient_id, body)
    return patients.detail(conn, patient_id)


@router.get("/patients/{patient_id}/history")
def history(patient_id: UUID, page: int = Query(1, ge=1), ctx: Ctx = Depends(can_view),
            conn: psycopg.Connection = Depends(get_conn)):
    guard(conn, ctx, patient_id)
    return patients.history(conn, patient_id, page)


@router.post("/patients/{patient_id}/alerts", status_code=201)
def add_alert(patient_id: UUID, body: AlertIn, ctx: Ctx = Depends(can_alerts), conn: psycopg.Connection = Depends(get_conn)):
    guard(conn, ctx, patient_id)
    patients.add_alert(conn, ctx, patient_id, body.kind, body.description, body.severity)
    return patients.alerts_of(conn, patient_id)


@router.post("/patients/{patient_id}/alerts/{alert_id}/remove")
def remove_alert(patient_id: UUID, alert_id: int, body: ReasonIn, ctx: Ctx = Depends(can_alerts),
                 conn: psycopg.Connection = Depends(get_conn)):
    guard(conn, ctx, patient_id)
    patients.remove_alert(conn, ctx, patient_id, alert_id, body.reason)
    return patients.alerts_of(conn, patient_id)


@router.post("/patients/{patient_id}/family", status_code=201)
def link_family(patient_id: UUID, body: FamilyLinkIn, ctx: Ctx = Depends(can_edit), conn: psycopg.Connection = Depends(get_conn)):
    patients.link_family(conn, ctx, patient_id, body)
    return patients.family_of(conn, patient_id)


@router.post("/patients/{patient_id}/family/{link_id}/remove")
def unlink_family(patient_id: UUID, link_id: int, body: ReasonIn, ctx: Ctx = Depends(can_edit),
                  conn: psycopg.Connection = Depends(get_conn)):
    patients.unlink_family(conn, ctx, patient_id, link_id, body.reason)
    return patients.family_of(conn, patient_id)


@router.post("/patients/{patient_id}/portal-access")
def portal_access(patient_id: UUID, ctx: Ctx = Depends(can_portal), conn: psycopg.Connection = Depends(get_conn)):
    return patients.give_portal_access(conn, ctx, patient_id)


# --- documents ---

@router.get("/patients/{patient_id}/files")
def list_files(patient_id: UUID, ctx: Ctx = Depends(can_view), conn: psycopg.Connection = Depends(get_conn)):
    patients.get_patient(conn, patient_id)
    guard(conn, ctx, patient_id)
    return files.list_for_staff(conn, ctx, patient_id)


@router.post("/patients/{patient_id}/files", status_code=201)
def upload_file(
    patient_id: UUID,
    category: str = Form(...),
    title: str = Form(...),
    file: UploadFile = File(...),
    ctx: Ctx = Depends(ready_ctx),
    conn: psycopg.Connection = Depends(get_conn),
):
    guard(conn, ctx, patient_id)
    data = file.file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    return files.store(conn, ctx, patient_id, category, title, file.filename or "", data)


@router.get("/patients/{patient_id}/files/{file_id}/download")
def download_file(patient_id: UUID, file_id: UUID, ctx: Ctx = Depends(can_view), conn: psycopg.Connection = Depends(get_conn)):
    guard(conn, ctx, patient_id)
    path, row = files.open_for_staff(conn, ctx, patient_id, file_id)
    conn.commit()
    return _file_response(path, row)


@router.post("/patients/{patient_id}/files/{file_id}/review")
def review_file(patient_id: UUID, file_id: UUID, body: ReviewIn, ctx: Ctx = Depends(can_review),
                conn: psycopg.Connection = Depends(get_conn)):
    guard(conn, ctx, patient_id)
    files.review(conn, ctx, patient_id, file_id, body)
    return files.list_for_staff(conn, ctx, patient_id)


@router.post("/patients/{patient_id}/files/{file_id}/void")
def void_file(patient_id: UUID, file_id: UUID, body: ReasonIn, ctx: Ctx = Depends(ready_ctx),
              conn: psycopg.Connection = Depends(get_conn)):
    guard(conn, ctx, patient_id)
    files.void(conn, ctx, patient_id, file_id, body.reason)
    return files.list_for_staff(conn, ctx, patient_id)
