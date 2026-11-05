"""TEMPORARY visual-QA helper. Removed after review. Only mounted when DEV_LOGIN=on."""
import psycopg
from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse

from app.auth.service import start_session
from app.core.session import COOKIE_NAME
from app.storage.db import get_conn

router = APIRouter()


@router.get("/dev-login")
def dev_login(email: str, request: Request, role: str | None = None, next: str = "/", mfa: bool = True,
              conn: psycopg.Connection = Depends(get_conn)):
    user = conn.execute("SELECT * FROM users WHERE email = %s OR phone = %s", (email, email)).fetchone()
    token = start_session(conn, user, request)
    conn.execute("UPDATE sessions SET mfa_passed = %s, active_role = %s WHERE token_hash = encode(sha256(%s::bytea), 'hex')",
                 (mfa, role, token))
    response = RedirectResponse(next, status_code=302)
    response.set_cookie(COOKIE_NAME, token, httponly=True, samesite="lax", path="/")
    return response
