"""/api/inventory: Inventory workspace. Add this role's endpoints here as its features are built."""
import psycopg
from fastapi import Depends

from app.core.session import Ctx, ready_ctx
from app.core.workspace import role_router, workspace_home
from app.storage.db import get_conn

router = role_router("inventory")


@router.get("/home")
def home(ctx: Ctx = Depends(ready_ctx), conn: psycopg.Connection = Depends(get_conn)):
    return workspace_home(conn, ctx)
