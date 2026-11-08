"""/api/auditor: read-only review of the activity log."""
from datetime import date

import psycopg
from fastapi import Depends, Query

from app.core import audit
from app.core.billing_api import router as billing_router
from app.core.session import Ctx, ready_ctx, require_permission
from app.core.workspace import role_router, workspace_home
from app.storage.db import get_conn

router = role_router("auditor")

# /api/auditor/billing/... (read: invoices, receipts, shifts, refunds)
router.include_router(billing_router)


@router.get("/home")
def home(ctx: Ctx = Depends(ready_ctx), conn: psycopg.Connection = Depends(get_conn)):
    return workspace_home(conn, ctx)


@router.get("/activity")
def activity(
    q: str | None = None,
    category: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(1, ge=1),
    _: Ctx = Depends(require_permission("audit.view")),
    conn: psycopg.Connection = Depends(get_conn),
):
    return audit.search(conn, q=q, category=category, date_from=date_from, date_to=date_to, page=page)
