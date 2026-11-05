"""/api/patient: registration is public; everything else needs a signed-in patient."""
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import FileResponse

from app.core import files
from app.core.session import Ctx, require_role, set_session_cookie
from app.core.workspace import workspace_home
from app.storage.db import get_conn
from app.users.patient import service
from app.users.patient.schemas import ProfileUpdate, RegisterIn

router = APIRouter(tags=["patient"])
is_patient = require_role("patient")


@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, response: Response, conn: psycopg.Connection = Depends(get_conn)):
    token, ctx = service.register(conn, body, request)
    set_session_cookie(response, token, "patient")
    return ctx.as_me()


@router.get("/home")
def home(ctx: Ctx = Depends(is_patient), conn: psycopg.Connection = Depends(get_conn)):
    return {**workspace_home(conn, ctx), "profile": service.profile(conn, ctx)}


@router.get("/profile")
def get_profile(ctx: Ctx = Depends(is_patient), conn: psycopg.Connection = Depends(get_conn)):
    return service.profile(conn, ctx)


@router.put("/profile")
def update_profile(body: ProfileUpdate, ctx: Ctx = Depends(is_patient), conn: psycopg.Connection = Depends(get_conn)):
    return service.update_profile(conn, ctx, body)


@router.get("/family")
def family(ctx: Ctx = Depends(is_patient), conn: psycopg.Connection = Depends(get_conn)):
    return service.family(conn, ctx)


@router.get("/files")
def my_files(ctx: Ctx = Depends(is_patient), conn: psycopg.Connection = Depends(get_conn)):
    """Documents the doctor released (and signed consents) for me and the family members I manage."""
    return files.list_for_patient(conn, service.my_patient_ids(conn, ctx))


@router.get("/files/{file_id}/download")
def open_file(file_id: UUID, ctx: Ctx = Depends(is_patient), conn: psycopg.Connection = Depends(get_conn)):
    path, row = files.open_for_patient(conn, ctx, service.my_patient_ids(conn, ctx), file_id)
    conn.commit()
    return FileResponse(path, media_type=row["mime"], filename=row["original_name"], content_disposition_type="inline",
                        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
