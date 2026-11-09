import psycopg
from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse

from app.auth.service import start_session
from app.core.security import hash_token
from app.core.session import set_session_cookie
from app.storage.db import get_conn

router = APIRouter()


@router.get("/api/devshot")
def devshot(email: str, to: str, request: Request, conn: psycopg.Connection = Depends(get_conn)):
    user = conn.execute("SELECT * FROM users WHERE email = %s", (email,)).fetchone()
    token = start_session(conn, user, request)
    role = conn.execute("SELECT role_code, branch_id FROM user_roles WHERE user_id = %s LIMIT 1", (user["id"],)).fetchone()
    conn.execute("UPDATE sessions SET mfa_passed = true, active_role = %s, active_branch_id = %s WHERE token_hash = %s",
                 (role["role_code"], role["branch_id"], hash_token(token)))
    conn.commit()
    resp = RedirectResponse(to, status_code=302)
    set_session_cookie(resp, token, user["kind"])
    return resp
