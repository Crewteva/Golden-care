"""The frontend connection: every API the React app calls is mounted here under /api."""
import psycopg
from fastapi import APIRouter, Depends

from app.auth.routes import router as auth_router
from app.storage.db import get_conn
from app.users.accountant.routes import router as accountant_router
from app.users.admin.routes import router as admin_router
from app.users.auditor.routes import router as auditor_router
from app.users.cashier.routes import router as cashier_router
from app.users.doctor.routes import router as doctor_router
from app.users.hr.routes import router as hr_router
from app.users.inventory.routes import router as inventory_router
from app.users.management.routes import router as management_router
from app.users.marketing.routes import router as marketing_router
from app.users.medical_director.routes import router as medical_director_router
from app.users.nurse.routes import router as nurse_router
from app.users.patient.routes import router as patient_router
from app.users.patient_relations.routes import router as patient_relations_router
from app.users.reception.routes import router as reception_router

api_router = APIRouter(prefix="/api")


@api_router.get("/health", tags=["system"])
def health(conn: psycopg.Connection = Depends(get_conn)):
    conn.execute("SELECT 1")
    return {"ok": True}


api_router.include_router(auth_router, prefix="/auth")

import os  # TEMPORARY visual QA
if os.environ.get("DEV_LOGIN") == "on":
    from app.auth.dev import router as dev_router
    api_router.include_router(dev_router, prefix="/auth")

# One API per role: /api/admin, /api/doctor, /api/hr, ...
ROLE_ROUTERS = {
    "admin": admin_router,
    "management": management_router,
    "medical-director": medical_director_router,
    "reception": reception_router,
    "patient-relations": patient_relations_router,
    "doctor": doctor_router,
    "nurse": nurse_router,
    "cashier": cashier_router,
    "accountant": accountant_router,
    "hr": hr_router,
    "inventory": inventory_router,
    "marketing": marketing_router,
    "auditor": auditor_router,
    "patient": patient_router,
}
for slug, router in ROLE_ROUTERS.items():
    api_router.include_router(router, prefix=f"/{slug}")
