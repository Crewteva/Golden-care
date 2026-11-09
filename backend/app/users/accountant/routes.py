"""/api/accountant: Accountant workspace: the books (journal, expenses, payouts, month closing, reports) and billing (read)."""
import psycopg
from fastapi import Depends

from app.core.accounting_api import router as accounting_router
from app.core.billing_api import router as billing_router
from app.core.inventory_api import router as inventory_router
from app.core.session import Ctx, ready_ctx
from app.core.workspace import role_router, workspace_home
from app.storage.db import get_conn

router = role_router("accountant")

# /api/accountant/billing/... (read: invoices, receipts, shifts, refunds)
router.include_router(billing_router)
# /api/accountant/accounting/... (posts entries, expenses, transfers, payouts; asks for month closing)
router.include_router(accounting_router)
# /api/accountant/inventory/... (stock value and pages to read; supplier bills and payments)
router.include_router(inventory_router)


@router.get("/home")
def home(ctx: Ctx = Depends(ready_ctx), conn: psycopg.Connection = Depends(get_conn)):
    return workspace_home(conn, ctx)
