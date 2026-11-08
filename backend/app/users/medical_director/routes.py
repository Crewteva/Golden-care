"""/api/medical-director: Medical director: patient files and the review queue for all doctors."""
import psycopg
from fastapi import Depends

from app.core.patients_api import router as patients_router
from app.core.session import Ctx, ready_ctx
from app.core.appointments_api import router as appointments_router
from app.core.settings_api import router as settings_router
from app.core.visits_api import router as visits_router
from app.core.laser_api import router as laser_router
from app.core.dental_api import router as dental_router
from app.core.workspace import role_router, workspace_home
from app.storage.db import get_conn

router = role_router("medical_director")

# /api/medical-director/patients/... (what this role may do there is set by its permissions)
router.include_router(patients_router)
# /api/medical-director/settings/... (clinic setup and schedules)
router.include_router(settings_router)
# /api/medical-director/appointments/... (what this role may do is set by its permissions)
router.include_router(appointments_router)
# /api/medical-director/visits/... (reads every visit; keeps the drug and diagnosis lists)
router.include_router(visits_router)
# /api/medical-director/laser, /dental (reads every record; keeps the device and lab lists)
router.include_router(laser_router)
router.include_router(dental_router)


@router.get("/home")
def home(ctx: Ctx = Depends(ready_ctx), conn: psycopg.Connection = Depends(get_conn)):
    return workspace_home(conn, ctx)
