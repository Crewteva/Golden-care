"""/api/auth: login, logout, who-am-I, two-step verification, passwords, choosing a role."""
import psycopg
from fastapi import APIRouter, Depends, Request, Response

from app.auth import service
from app.auth.schemas import CodeIn, ForgotIn, LoginIn, MfaDisableIn, PasswordChangeIn, PreferencesIn, RoleIn
from app.core.session import Ctx, clear_session_cookie, load_ctx, ready_ctx, session_ctx, set_session_cookie
from app.storage.db import get_conn

router = APIRouter(tags=["auth"])


def _fresh_me(conn: psycopg.Connection, request: Request) -> dict:
    from app.core.session import COOKIE_NAME

    ctx = load_ctx(conn, request.cookies.get(COOKIE_NAME), request)
    return ctx.as_me() if ctx else {}


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, conn: psycopg.Connection = Depends(get_conn)):
    token, ctx = service.login(conn, body.identifier, body.password, request)
    set_session_cookie(response, token, ctx.user["kind"])
    return ctx.as_me()


@router.post("/logout")
def logout(response: Response, ctx: Ctx = Depends(session_ctx), conn: psycopg.Connection = Depends(get_conn)):
    service.logout(conn, ctx)
    clear_session_cookie(response)
    return {"ok": True}


@router.post("/logout-others")
def logout_others(ctx: Ctx = Depends(ready_ctx), conn: psycopg.Connection = Depends(get_conn)):
    return {"signed_out": service.logout_others(conn, ctx)}


@router.get("/me")
def me(ctx: Ctx = Depends(session_ctx)):
    return ctx.as_me()


@router.post("/mfa/setup")
def mfa_setup(ctx: Ctx = Depends(session_ctx), conn: psycopg.Connection = Depends(get_conn)):
    return service.mfa_setup(conn, ctx)


@router.post("/mfa/verify")
def mfa_verify(body: CodeIn, request: Request, ctx: Ctx = Depends(session_ctx), conn: psycopg.Connection = Depends(get_conn)):
    service.mfa_verify(conn, ctx, body.code)
    return _fresh_me(conn, request)


@router.post("/mfa/disable")
def mfa_disable(body: MfaDisableIn, request: Request, ctx: Ctx = Depends(ready_ctx), conn: psycopg.Connection = Depends(get_conn)):
    service.mfa_disable(conn, ctx, body.password, body.code)
    return _fresh_me(conn, request)


@router.post("/password")
def change_password(body: PasswordChangeIn, request: Request, ctx: Ctx = Depends(session_ctx),
                    conn: psycopg.Connection = Depends(get_conn)):
    service.change_password(conn, ctx, body.current_password, body.new_password)
    return _fresh_me(conn, request)


@router.post("/role")
def choose_role(body: RoleIn, request: Request, ctx: Ctx = Depends(session_ctx), conn: psycopg.Connection = Depends(get_conn)):
    service.choose_role(conn, ctx, body.role, body.branch_id)
    return _fresh_me(conn, request)


@router.post("/forgot")
def forgot(body: ForgotIn, request: Request, conn: psycopg.Connection = Depends(get_conn)):
    service.forgot_password(conn, body.identifier, request)
    return {"ok": True}


@router.post("/preferences")
def preferences(body: PreferencesIn, request: Request, ctx: Ctx = Depends(session_ctx),
                conn: psycopg.Connection = Depends(get_conn)):
    service.set_preferences(conn, ctx, body.preferred_lang)
    return _fresh_me(conn, request)
