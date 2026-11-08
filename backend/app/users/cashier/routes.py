"""/api/cashier: Cashier workspace. Add this role's endpoints here as its features are built."""
import psycopg
from fastapi import Depends

from app.core.session import Ctx, ready_ctx
from app.core.appointments_api import router as appointments_router
from app.core.settings_api import router as settings_router
from app.core.workspace import role_router, workspace_home
from app.storage.db import get_conn

router = role_router("cashier")

# /api/cashier/settings/... (clinic setup; what this role may change is set by its permissions)
router.include_router(settings_router)
# /api/cashier/appointments/... (what this role may do is set by its permissions)
router.include_router(appointments_router)


@router.get("/home")
def home(ctx: Ctx = Depends(ready_ctx), conn: psycopg.Connection = Depends(get_conn)):
    return workspace_home(conn, ctx)
