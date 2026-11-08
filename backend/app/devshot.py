# TEMP: screenshot helper, delete before finishing.
import os

import psycopg
from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse

from app.core.errors import AppError
from app.core.security import hash_token, new_session_token
from app.storage.db import get_conn

router = APIRouter()
KEY = "shot-7f3a91c2"


@router.get("/api/devshot")
def devshot(key: str, email: str, role: str, request: Request, next: str = "/", conn: psycopg.Connection = Depends(get_conn)):
    if key != KEY or not email.endswith("@demo.goldencare.local") or email.startswith("admin@"):
        raise AppError(404, "not_found")
    user = conn.execute("SELECT * FROM users WHERE email = %s", (email,)).fetchone()
    if not user:
        raise AppError(404, "not_found")
    ur = conn.execute("SELECT branch_id FROM user_roles WHERE user_id = %s AND role_code = %s LIMIT 1", (user["id"], role)).fetchone()
    if not ur:
        raise AppError(404, "not_found")
    token = new_session_token()
    conn.execute(
        """INSERT INTO sessions (token_hash, user_id, ip, user_agent, expires_at, mfa_passed, active_role, active_branch_id)
           VALUES (%s, %s, %s, 'devshot', now() + interval '2 hours', true, %s, %s)""",
        (hash_token(token), user["id"], request.client.host if request.client else None, role, ur["branch_id"]),
    )
    conn.commit()
    resp = RedirectResponse(next if next.startswith("/") else "/", status_code=302)
    resp.set_cookie("gc_session", token, max_age=7200, httponly=True, secure=False, samesite="lax", path="/")
    return resp
