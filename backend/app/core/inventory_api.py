"""Stock, purchasing & devices endpoints (/api/<role>/inventory/...), mounted by inventory, management, accountant, auditor,
nurse and doctor. What each may do comes from the permissions:

inventory.view     stock, movements, counts, orders, suppliers, payables, devices (read)
inventory.manage   setup lists, receiving goods, write-offs, counting, purchase orders
inventory.use      using stock for a room or a patient's visit
inventory.approve  orders above the approval limit, count differences, the approval limit itself
purchasing.pay     supplier bills and payments
devices.manage     the device register, status, maintenance log, fixing faults
devices.report     reporting a fault"""
from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse

from app.config import settings
from app.core import clinic_time, devices, inventory, purchasing
from app.core import accounting as acc
from app.core.errors import AppError
from app.core.inventory_schemas import (
    BillIn, CountSaveIn, CountStartIn, DecideIn, DeviceIn, DeviceStatusIn, DeviceTypeIn, FaultIn, FixIn, IssueIn, ItemIn, LimitIn,
    NamedIn, PoIn, ReasonIn, ReceiveIn, StoreIn, SupplierIn, SupplierPayIn,
)
from app.core.session import Ctx, require_permission
from app.core.visits_api import require_any
from app.storage.db import get_conn

router = APIRouter(prefix="/inventory", tags=["inventory"])
Conn = psycopg.Connection

can_view = require_permission("inventory.view")
can_manage = require_permission("inventory.manage")
can_use = require_permission("inventory.use")
can_approve = require_permission("inventory.approve")
can_pay = require_permission("purchasing.pay")
can_devices = require_permission("devices.manage")
can_report = require_permission("devices.report")
any_access = require_any("inventory.view", "inventory.use", "devices.report")
see_devices = require_any("inventory.view", "devices.report", "devices.manage")


@router.get("/overview")
def overview(ctx: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    stock = inventory.stock(conn)
    return {
        "stock_value": inventory.stock_value(conn),
        "items": len(stock["items"]),
        "counts": stock["counts"],
        "alerts": inventory.alerts(conn),
        "devices": devices.alerts(conn),
        "open_faults": len(devices.faults(conn, status="open")),
        "pending_orders": purchasing.orders(conn, status="pending_approval"),
        "open_orders": len(purchasing.orders(conn, status="open")),
        "pending_counts": [c for c in inventory.counts(conn) if c["status"] == "submitted"],
        "payables": purchasing.aging(conn)["totals"],
        "recent": inventory.moves(conn)["items"][:8],
        "approval_limit": inventory.approval_limit(conn),
        "today": clinic_time.today(),
    }


@router.get("/options")
def options(ctx: Ctx = Depends(any_access), conn: Conn = Depends(get_conn)):
    return {
        "stores": conn.execute("SELECT s.*, b.name_ar AS branch_ar, b.name_en AS branch_en FROM stores s JOIN branches b ON b.id = s.branch_id "
                               "ORDER BY s.is_active DESC, s.name_en").fetchall(),
        "items": inventory.setup_list(conn, "items"),
        "categories": inventory.setup_list(conn, "categories"),
        "units": inventory.setup_list(conn, "units"),
        "suppliers": conn.execute("SELECT id, name, payment_terms_days, is_active FROM suppliers ORDER BY is_active DESC, lower(name)").fetchall(),
        "device_types": inventory.setup_list(conn, "device_types"),
        "rooms": conn.execute("SELECT id, branch_id, name_ar, name_en, is_active FROM rooms ORDER BY branch_id, name_en").fetchall(),
        "branches": conn.execute("SELECT id, code, name_ar, name_en FROM branches ORDER BY id").fetchall(),
        "money_accounts": conn.execute(
            """SELECT id, code, name_ar, name_en, system_key FROM accounts WHERE is_money AND is_active
               AND COALESCE(system_key, '') NOT IN ('cash_drawer', 'card_clearing', 'instapay_clearing', 'wallet_clearing') ORDER BY code""").fetchall(),
        "approval_limit": inventory.approval_limit(conn),
        "first_open_day": acc.first_open_day(conn),
        "max_upload_mb": settings.max_upload_mb,
        "today": clinic_time.today(),
    }


# ---------- setup lists ----------

Kind = Literal["categories", "units", "items", "stores", "suppliers", "device-types"]
BODIES = {"categories": NamedIn, "units": NamedIn, "items": ItemIn, "stores": StoreIn, "suppliers": SupplierIn, "device_types": DeviceTypeIn}


def _body(kind: str, payload: dict):
    from pydantic import ValidationError
    try:
        return BODIES[kind].model_validate(payload)
    except ValidationError as e:
        fields = {".".join(str(p) for p in err["loc"]): "invalid" for err in e.errors()}
        raise AppError(422, "validation", fields=fields) from None


@router.get("/setup/{kind}")
def setup_list(kind: Kind, _: Ctx = Depends(any_access), conn: Conn = Depends(get_conn)):
    return inventory.setup_list(conn, kind.replace("-", "_"))


@router.post("/setup/{kind}", status_code=201)
def setup_add(kind: Kind, payload: dict, ctx: Ctx = Depends(can_manage), conn: Conn = Depends(get_conn)):
    k = kind.replace("-", "_")
    return inventory.save_list_row(conn, ctx, k, _body(k, payload))


@router.put("/setup/{kind}/{row_id}")
def setup_edit(kind: Kind, row_id: int, payload: dict, ctx: Ctx = Depends(can_manage), conn: Conn = Depends(get_conn)):
    k = kind.replace("-", "_")
    return inventory.save_list_row(conn, ctx, k, _body(k, payload), row_id)


@router.delete("/setup/{kind}/{row_id}")
def setup_delete(kind: Kind, row_id: int, ctx: Ctx = Depends(can_manage), conn: Conn = Depends(get_conn)):
    return inventory.delete_list_row(conn, ctx, kind.replace("-", "_"), row_id)


@router.put("/approval-limit")
def set_limit(body: LimitIn, ctx: Ctx = Depends(can_approve), conn: Conn = Depends(get_conn)):
    return inventory.save_approval_limit(conn, ctx, body.approval_limit)


# ---------- stock ----------

@router.get("/stock")
def stock(q: str | None = None, category_id: int | None = None, store_id: int | None = None,
          status: Literal["below_min", "expiring", "expired", "ok"] | None = None, all: bool = False,
          _: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return inventory.stock(conn, q_text=q, category_id=category_id, store_id=store_id, status=status, include_inactive=all)


@router.get("/stock/alerts")
def stock_alerts(_: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return inventory.alerts(conn)


@router.get("/stock/items/{item_id}")
def item_card(item_id: int, _: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return inventory.item_card(conn, item_id)


@router.get("/stock/moves")
def moves(item_id: int | None = None, store_id: int | None = None, kind: Literal["receive", "use", "write_off", "count"] | None = None,
          date_from: date | None = None, date_to: date | None = None, q: str | None = None, page: int = Query(1, ge=1),
          _: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return inventory.moves(conn, item_id=item_id, store_id=store_id, kind=kind, date_from=date_from, date_to=date_to, q_text=q, page=page)


@router.post("/stock/receive", status_code=201)
def receive(body: ReceiveIn, ctx: Ctx = Depends(can_manage), conn: Conn = Depends(get_conn)):
    return inventory.receive(conn, ctx, body)


@router.get("/stock/use-options")
def use_options(ctx: Ctx = Depends(require_any("inventory.use", "inventory.manage")), conn: Conn = Depends(get_conn)):
    return inventory.use_options(conn, ctx)


@router.post("/stock/issue", status_code=201)
def issue(body: IssueIn, ctx: Ctx = Depends(require_any("inventory.use", "inventory.manage")), conn: Conn = Depends(get_conn)):
    if body.kind == "write_off" and "inventory.manage" not in ctx.permissions:
        raise AppError(403, "forbidden", permission="inventory.manage")
    if body.kind == "use" and "inventory.use" not in ctx.permissions:
        raise AppError(403, "forbidden", permission="inventory.use")
    return inventory.issue(conn, ctx, body)


@router.get("/stock/issues")
def issues(mine: bool = False, kind: Literal["use", "write_off"] | None = None, ctx: Ctx = Depends(any_access), conn: Conn = Depends(get_conn)):
    if "inventory.view" not in ctx.permissions:
        mine = True
    return inventory.issues(conn, mine=ctx if mine else None, kind=kind)


# ---------- counts ----------

@router.get("/counts")
def counts(_: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return inventory.counts(conn)


@router.post("/counts", status_code=201)
def start_count(body: CountStartIn, ctx: Ctx = Depends(can_manage), conn: Conn = Depends(get_conn)):
    return inventory.start_count(conn, ctx, body)


@router.get("/counts/{count_id}")
def count(count_id: UUID, ctx: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return inventory.count_detail(conn, count_id, can_see_expected=True)


@router.put("/counts/{count_id}")
def save_count(count_id: UUID, body: CountSaveIn, ctx: Ctx = Depends(can_manage), conn: Conn = Depends(get_conn)):
    return inventory.save_count(conn, ctx, count_id, body)


@router.post("/counts/{count_id}/decide")
def decide_count(count_id: UUID, body: DecideIn, ctx: Ctx = Depends(can_approve), conn: Conn = Depends(get_conn)):
    return inventory.decide_count(conn, ctx, count_id, body.approve, body.note)


# ---------- purchase orders ----------

@router.get("/orders")
def orders(status: Literal["open", "pending_approval", "approved", "rejected", "partial", "received", "cancelled"] | None = None,
           supplier_id: int | None = None, q: str | None = None, _: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return purchasing.orders(conn, status=status, supplier_id=supplier_id, q_text=q)


@router.post("/orders", status_code=201)
def add_order(body: PoIn, ctx: Ctx = Depends(can_manage), conn: Conn = Depends(get_conn)):
    return purchasing.save_order(conn, ctx, body)


@router.get("/orders/{po_id}")
def order(po_id: UUID, _: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return purchasing.order(conn, po_id)


@router.put("/orders/{po_id}")
def edit_order(po_id: UUID, body: PoIn, ctx: Ctx = Depends(can_manage), conn: Conn = Depends(get_conn)):
    return purchasing.save_order(conn, ctx, body, po_id)


@router.post("/orders/{po_id}/decide")
def decide_order(po_id: UUID, body: DecideIn, ctx: Ctx = Depends(can_approve), conn: Conn = Depends(get_conn)):
    return purchasing.decide_order(conn, ctx, po_id, body.approve, body.note)


@router.post("/orders/{po_id}/cancel")
def cancel_order(po_id: UUID, body: ReasonIn, ctx: Ctx = Depends(can_manage), conn: Conn = Depends(get_conn)):
    return purchasing.cancel_order(conn, ctx, po_id, body.reason)


# ---------- suppliers, bills, payments ----------

@router.get("/suppliers")
def suppliers(_: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return purchasing.suppliers(conn)


@router.get("/suppliers/{supplier_id}")
def supplier_statement(supplier_id: int, _: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return purchasing.statement(conn, supplier_id)


@router.get("/payables")
def payables(_: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return purchasing.aging(conn)


@router.post("/bills", status_code=201)
def add_bill(body: BillIn, ctx: Ctx = Depends(can_pay), conn: Conn = Depends(get_conn)):
    return purchasing.add_bill(conn, ctx, body)


@router.post("/payments", status_code=201)
def pay_supplier(body: SupplierPayIn, ctx: Ctx = Depends(can_pay), conn: Conn = Depends(get_conn)):
    return purchasing.pay(conn, ctx, body)


# ---------- devices ----------

@router.get("/devices")
def device_list(all: bool = True, _: Ctx = Depends(see_devices), conn: Conn = Depends(get_conn)):
    return devices.devices(conn, include_inactive=all)


@router.get("/devices/{device_id}")
def device(device_id: int, _: Ctx = Depends(see_devices), conn: Conn = Depends(get_conn)):
    return devices.device(conn, device_id)


@router.post("/devices", status_code=201)
def add_device(body: DeviceIn, ctx: Ctx = Depends(can_devices), conn: Conn = Depends(get_conn)):
    return devices.save_device(conn, ctx, body)


@router.put("/devices/{device_id}")
def edit_device(device_id: int, body: DeviceIn, ctx: Ctx = Depends(can_devices), conn: Conn = Depends(get_conn)):
    return devices.save_device(conn, ctx, body, device_id)


@router.delete("/devices/{device_id}")
def delete_device(device_id: int, ctx: Ctx = Depends(can_devices), conn: Conn = Depends(get_conn)):
    return devices.delete_device(conn, ctx, device_id)


@router.post("/devices/{device_id}/status")
def device_status(device_id: int, body: DeviceStatusIn, ctx: Ctx = Depends(can_devices), conn: Conn = Depends(get_conn)):
    return devices.set_status(conn, ctx, device_id, body.status, body.note)


@router.post("/devices/{device_id}/maintenance", status_code=201)
def add_maintenance(
    device_id: int,
    kind: Literal["preventive", "repair"] = Form(...),
    done_on: date = Form(...),
    description: str = Form(..., min_length=3, max_length=500),
    technician: str | None = Form(None, max_length=80),
    supplier_id: int | None = Form(None),
    cost: Decimal = Form(Decimal(0), ge=0, le=10_000_000, decimal_places=2),
    paid_from_id: int | None = Form(None),
    fault_id: UUID | None = Form(None),
    file: UploadFile | None = File(None),
    ctx: Ctx = Depends(can_devices),
    conn: Conn = Depends(get_conn),
):
    data = file.file.read(settings.max_upload_mb * 1024 * 1024 + 1) if file else b""
    return devices.add_maintenance(conn, ctx, device_id, kind=kind, done_on=done_on, description=description, technician=technician,
                                   supplier_id=supplier_id, cost=cost, paid_from_id=paid_from_id, fault_id=fault_id,
                                   filename=(file.filename if file else "") or "", data=data)


@router.get("/maintenance/{maintenance_id}/file")
def maintenance_file(maintenance_id: UUID, ctx: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    path, row = devices.maintenance_file(conn, ctx, maintenance_id)
    conn.commit()
    return FileResponse(path, media_type=row["file_mime"], filename=row["file_name"], content_disposition_type="inline",
                        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.get("/faults")
def fault_list(status: Literal["open", "fixed"] | None = None, _: Ctx = Depends(see_devices), conn: Conn = Depends(get_conn)):
    return devices.faults(conn, status=status)


@router.post("/faults", status_code=201)
def report_fault(body: FaultIn, ctx: Ctx = Depends(can_report), conn: Conn = Depends(get_conn)):
    return devices.report_fault(conn, ctx, body)


@router.post("/faults/{fault_id}/fix")
def fix_fault(fault_id: UUID, body: FixIn, ctx: Ctx = Depends(can_devices), conn: Conn = Depends(get_conn)):
    return devices.fix_fault(conn, ctx, fault_id, body.resolution, body.back_to_work)
