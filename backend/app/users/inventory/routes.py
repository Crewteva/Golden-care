"""/api/inventory: Inventory workspace: stock, purchase orders, suppliers and medical devices."""
import psycopg
from fastapi import Depends

from app.core.inventory_api import router as inventory_router
from app.core.session import Ctx, ready_ctx
from app.core.workspace import role_router, workspace_home
from app.storage.db import get_conn

router = role_router("inventory")

# /api/inventory/inventory/... (setup lists, receiving, counts, purchase orders, devices)
router.include_router(inventory_router)


@router.get("/home")
def home(ctx: Ctx = Depends(ready_ctx), conn: psycopg.Connection = Depends(get_conn)):
    return workspace_home(conn, ctx)
