"""/api/nurse: Nursing: patient files, medical alerts, clinical photos and consents."""
import psycopg
from fastapi import Depends

from app.core.patients_api import router as patients_router
from app.core.session import Ctx, ready_ctx
from app.core.settings_api import router as settings_router
from app.core.workspace import role_router, workspace_home
from app.storage.db import get_conn

router = role_router("nurse")

# /api/nurse/patients/... (what this role may do there is set by its permissions)
router.include_router(patients_router)
# /api/nurse/settings/... (clinic setup and schedules)
router.include_router(settings_router)


@router.get("/home")
def home(ctx: Ctx = Depends(ready_ctx), conn: psycopg.Connection = Depends(get_conn)):
    return workspace_home(conn, ctx)
