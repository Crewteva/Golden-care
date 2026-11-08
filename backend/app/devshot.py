# TEMPORARY screenshot helper — delete before finishing.
from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse

from app.core.security import hash_token, new_session_token
from app.core.session import COOKIE_NAME
from app.storage.db import get_conn

router = APIRouter()
KEY = "shot-7f3a91c2e4"


@router.get("/api/devshot")
def devshot(key: str, email: str, role: str, next: str, lang: str = "ar", conn=Depends(get_conn), request: Request = None):
    if key != KEY or not email.endswith("@demo.goldencare.local") or email.startswith("admin@"):
        return RedirectResponse("/", 302)
    user = conn.execute("SELECT * FROM users WHERE email = %s", (email,)).fetchone()
    r = conn.execute("SELECT branch_id FROM user_roles WHERE user_id = %s AND role_code = %s LIMIT 1", (user["id"], role)).fetchone()
    token = new_session_token()
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at, mfa_passed, active_role, active_branch_id, user_agent) "
        "VALUES (%s, %s, now() + interval '1 hour', true, %s, %s, 'devshot')",
        (hash_token(token), user["id"], role, r["branch_id"] if r else None),
    )
    conn.commit()
    resp = RedirectResponse(next + ("&" if "?" in next else "?") + f"lang={lang}", 302)
    resp.set_cookie(COOKIE_NAME, token, httponly=True, samesite="lax", path="/")
    return resp
