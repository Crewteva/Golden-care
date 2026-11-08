"""/api/nurse: Nursing: patient files, medical alerts, clinical photos and consents."""
import psycopg
from fastapi import Depends

from app.core.patients_api import router as patients_router
from app.core.session import Ctx, ready_ctx
from app.core.appointments_api import router as appointments_router
from app.core.settings_api import router as settings_router
from app.core.visits_api import router as visits_router
from app.core.laser_api import router as laser_router
from app.core.dental_api import router as dental_router
from app.core.complaints_api import router as complaints_router
from app.core.workspace import role_router, workspace_home
from app.storage.db import get_conn

router = role_router("nurse")

# /api/nurse/patients/... (what this role may do there is set by its permissions)
router.include_router(patients_router)
# /api/nurse/settings/... (clinic setup and schedules)
router.include_router(settings_router)
# /api/nurse/appointments/... (what this role may do is set by its permissions)
router.include_router(appointments_router)
# /api/nurse/visits/... (vital signs; the doctor's notes need visits.write or visits.view_all)
router.include_router(visits_router)
# /api/nurse/laser, /dental, /complaints (laser sessions, lab work tracking, logging complaints)
router.include_router(laser_router)
router.include_router(dental_router)
router.include_router(complaints_router)


@router.get("/home")
def home(ctx: Ctx = Depends(ready_ctx), conn: psycopg.Connection = Depends(get_conn)):
    return workspace_home(conn, ctx)
