"""/api/management: Management (owner / general manager): clinic setup, services and prices; reports come in later steps."""
import psycopg
from fastapi import Depends

from app.core.session import Ctx, ready_ctx
from app.core.appointments_api import router as appointments_router
from app.core.settings_api import router as settings_router
from app.core.dental_api import router as dental_router
from app.core.complaints_api import router as complaints_router
from app.core.billing_api import router as billing_router
from app.core.workspace import role_router, workspace_home
from app.storage.db import get_conn

router = role_router("management")

# /api/management/settings/... (clinic setup; what this role may change is set by its permissions)
router.include_router(settings_router)
# /api/management/appointments/... (what this role may do is set by its permissions)
router.include_router(appointments_router)
# /api/management/dental, /complaints (treatment plans overview; the complaints desk)
router.include_router(dental_router)
router.include_router(complaints_router)
# /api/management/billing/... (approvals, invoices, shifts; packages, doctor shares & billing rules)
router.include_router(billing_router)


@router.get("/home")
def home(ctx: Ctx = Depends(ready_ctx), conn: psycopg.Connection = Depends(get_conn)):
    return workspace_home(conn, ctx)
