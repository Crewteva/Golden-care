"""/api/management: Management (owner / general manager): clinic setup, services and prices; reports come in later steps."""
import psycopg
from fastapi import Depends

from app.core.session import Ctx, ready_ctx
from app.core.settings_api import router as settings_router
from app.core.workspace import role_router, workspace_home
from app.storage.db import get_conn

router = role_router("management")

# /api/management/settings/... (clinic setup; what this role may change is set by its permissions)
router.include_router(settings_router)


@router.get("/home")
def home(ctx: Ctx = Depends(ready_ctx), conn: psycopg.Connection = Depends(get_conn)):
    return workspace_home(conn, ctx)
