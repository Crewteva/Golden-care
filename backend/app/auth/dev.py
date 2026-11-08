"""TEMPORARY visual-QA helper. Removed after review. Only mounted when DEV_LOGIN=on."""
import psycopg
from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse

from app.auth.service import find_user, start_session
from app.core.security import hash_token
from app.core.session import set_session_cookie
from app.storage.db import get_conn

router = APIRouter()


@router.get("/dev-login")
def dev_login(email: str, role: str, request: Request, next: str = "/", conn: psycopg.Connection = Depends(get_conn)):
    user = find_user(conn, email)
    if not user or not (email.endswith("@demo.goldencare.local") or user["kind"] == "patient"):
        return RedirectResponse("/login", status_code=303)
    token = start_session(conn, user, request)
    conn.execute("UPDATE sessions SET active_role = %s, mfa_passed = true WHERE token_hash = %s", (role, hash_token(token)))
    conn.commit()
    response = RedirectResponse(next if next.startswith("/") else "/", status_code=303)
    set_session_cookie(response, token, user["kind"])
    return response
