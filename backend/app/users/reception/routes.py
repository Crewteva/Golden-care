"""/api/reception: Reception: find, register and edit patient files; upload IDs and consents; give portal access."""
import psycopg
from fastapi import Depends

from app.core.patients_api import router as patients_router
from app.core.session import Ctx, ready_ctx
from app.core.appointments_api import router as appointments_router
from app.core.settings_api import router as settings_router
from app.core.visits_api import router as visits_router
from app.core.workspace import role_router, workspace_home
from app.storage.db import get_conn

router = role_router("reception")

# /api/reception/patients/... (what this role may do there is set by its permissions)
router.include_router(patients_router)
# /api/reception/settings/... (clinic setup and schedules)
router.include_router(settings_router)
# /api/reception/appointments/... (what this role may do is set by its permissions)
router.include_router(appointments_router)
# /api/reception/visits/follow-ups (follow-ups doctors asked for; no medical content)
router.include_router(visits_router)


@router.get("/home")
def home(ctx: Ctx = Depends(ready_ctx), conn: psycopg.Connection = Depends(get_conn)):
    return workspace_home(conn, ctx)
