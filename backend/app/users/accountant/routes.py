"""/api/accountant: Accountant workspace: invoices, receipts and cashier shifts (read); the ledger comes with accounting."""
import psycopg
from fastapi import Depends

from app.core.billing_api import router as billing_router
from app.core.session import Ctx, ready_ctx
from app.core.workspace import role_router, workspace_home
from app.storage.db import get_conn

router = role_router("accountant")

# /api/accountant/billing/... (read: invoices, receipts, shifts, refunds)
router.include_router(billing_router)


@router.get("/home")
def home(ctx: Ctx = Depends(ready_ctx), conn: psycopg.Connection = Depends(get_conn)):
    return workspace_home(conn, ctx)
