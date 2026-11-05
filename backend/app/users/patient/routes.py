"""/api/patient: registration is public; everything else needs a signed-in patient."""
import psycopg
from fastapi import APIRouter, Depends, Request, Response

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
