"""Billing, payments & cashier endpoints shared by the roles that use them (/api/<role>/billing/...).

billing.view      invoices, receipts, shifts, refunds (read)
billing.invoice   draft, issue and cancel invoices; ask for a void or a package cancellation
billing.collect   take payments, pay out approved refunds, open and close a cash shift
billing.discount  give a discount up to the clinic's limit (above it a manager approves)
billing.approve   approve discounts, voids, refunds and package cancellations
settings.billing  packages, doctor share rules and billing rules"""
from datetime import date
from typing import Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query

from app.core import billing, billing_setup, clinic_time, payments
from app.core.billing_schemas import (
    BillingRulesIn, DecideIn, InvoiceCreateIn, InvoiceUpdateIn, IssueIn, PackageCancelIn, PackageIn, PaymentIn, RefundIn, RefundPayIn,
    ShareRuleIn, ShiftCloseIn, ShiftOpenIn, VoidIn,
)
from app.core.session import Ctx, require_permission
from app.core.visits_api import require_any
from app.storage.db import get_conn

router = APIRouter(prefix="/billing", tags=["billing"])
Conn = psycopg.Connection

can_view = require_any("billing.view", "billing.approve")
can_invoice = require_permission("billing.invoice")
can_collect = require_permission("billing.collect")
can_approve = require_permission("billing.approve")
can_ask = require_any("billing.invoice", "billing.approve")
can_refund = require_any("billing.collect", "billing.approve")
can_setup = require_permission("settings.billing")
can_see_setup = require_any("settings.billing", "billing.view")


@router.get("/options")
def options(ctx: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return billing.options(conn, ctx)


@router.get("/queue")
def queue(on: date | None = None, _: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return billing.queue(conn, on or clinic_time.today())


@router.get("/patients")
def find_patients(q: str = "", _: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return billing.search_patients(conn, q)


@router.get("/patient/{patient_id}")
def patient_account(patient_id: UUID, ctx: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return billing.account(conn, ctx, patient_id)


# --- invoices ---

@router.get("/invoices")
def invoices(status: Literal["draft", "pending_approval", "issued", "void", "cancelled"] | None = None, q: str | None = None,
             date_from: date | None = None, date_to: date | None = None, unpaid: bool = False,
             sort: Literal["date", "ref", "patient", "total", "balance"] = "date", desc: bool = True, page: int = Query(1, ge=1),
             _: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return billing.listing(conn, status=status, q_text=q, date_from=date_from, date_to=date_to, unpaid=unpaid, sort=sort, desc=desc, page=page)


@router.post("/invoices", status_code=201)
def new_invoice(body: InvoiceCreateIn, ctx: Ctx = Depends(can_invoice), conn: Conn = Depends(get_conn)):
    row = billing.create(conn, ctx, body)
    return billing.detail(conn, ctx, row["id"])


@router.get("/invoices/{invoice_id}")
def invoice(invoice_id: UUID, ctx: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return billing.detail(conn, ctx, invoice_id)


@router.put("/invoices/{invoice_id}")
def edit_invoice(invoice_id: UUID, body: InvoiceUpdateIn, ctx: Ctx = Depends(can_invoice), conn: Conn = Depends(get_conn)):
    billing.update(conn, ctx, invoice_id, body)
    return billing.detail(conn, ctx, invoice_id)


@router.post("/invoices/{invoice_id}/issue")
def issue(invoice_id: UUID, body: IssueIn, ctx: Ctx = Depends(can_invoice), conn: Conn = Depends(get_conn)):
    result = billing.issue(conn, ctx, invoice_id, body)
    return {**result, **billing.detail(conn, ctx, invoice_id)}


@router.post("/invoices/{invoice_id}/cancel")
def cancel(invoice_id: UUID, ctx: Ctx = Depends(can_invoice), conn: Conn = Depends(get_conn)):
    billing.cancel(conn, ctx, invoice_id)
    return billing.detail(conn, ctx, invoice_id)


@router.post("/invoices/{invoice_id}/void")
def void(invoice_id: UUID, body: VoidIn, ctx: Ctx = Depends(can_ask), conn: Conn = Depends(get_conn)):
    result = billing.void(conn, ctx, invoice_id, body)
    return {**result, **billing.detail(conn, ctx, invoice_id)}


@router.post("/packages/{pp_id}/cancel")
def cancel_package(pp_id: UUID, body: PackageCancelIn, ctx: Ctx = Depends(can_ask), conn: Conn = Depends(get_conn)):
    return billing.cancel_package(conn, ctx, pp_id, body)


# --- payments & receipts ---

@router.post("/payments", status_code=201)
def pay(body: PaymentIn, ctx: Ctx = Depends(can_collect), conn: Conn = Depends(get_conn)):
    row = payments.collect(conn, ctx, body)
    return payments.receipt(conn, row["id"])


@router.get("/receipts/{receipt_id}")
def receipt(receipt_id: UUID, _: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return payments.receipt(conn, receipt_id)


@router.get("/installments/due")
def installments_due(days: int = Query(7, ge=0, le=60), _: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return payments.installments_due(conn, days)


# --- cash shifts ---

@router.get("/shift")
def my_shift(ctx: Ctx = Depends(can_collect), conn: Conn = Depends(get_conn)):
    return {"shift": payments.my_shift(conn, ctx)}


@router.post("/shift/open", status_code=201)
def open_shift(body: ShiftOpenIn, ctx: Ctx = Depends(can_collect), conn: Conn = Depends(get_conn)):
    return {"shift": payments.open_shift(conn, ctx, body)}


@router.post("/shift/close")
def close_shift(body: ShiftCloseIn, ctx: Ctx = Depends(can_collect), conn: Conn = Depends(get_conn)):
    return payments.close_shift(conn, ctx, body)


@router.get("/shifts")
def shifts(date_from: date | None = None, date_to: date | None = None, cashier_id: UUID | None = None,
           ctx: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return payments.shifts(conn, ctx, date_from=date_from, date_to=date_to, cashier_id=cashier_id)


@router.get("/shifts/{shift_id}")
def shift(shift_id: UUID, ctx: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return payments.shift_report(conn, ctx, shift_id)


# --- refunds & approvals ---

@router.get("/refunds")
def refunds(state: Literal["open", "paid", "rejected"] | None = None, _: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return payments.refunds(conn, state)


@router.post("/refunds", status_code=201)
def request_refund(body: RefundIn, ctx: Ctx = Depends(can_refund), conn: Conn = Depends(get_conn)):
    return payments.request_refund(conn, ctx, body)


@router.post("/refunds/{refund_id}/pay")
def pay_refund(refund_id: UUID, body: RefundPayIn, ctx: Ctx = Depends(can_collect), conn: Conn = Depends(get_conn)):
    payments.pay_refund(conn, ctx, refund_id, body)
    return {"ok": True}


@router.get("/approvals")
def approvals(state: Literal["pending", "decided"] = "pending", _: Ctx = Depends(can_approve), conn: Conn = Depends(get_conn)):
    return billing.approvals(conn, state)


@router.post("/approvals/{approval_id}/decide")
def decide(approval_id: UUID, body: DecideIn, ctx: Ctx = Depends(can_approve), conn: Conn = Depends(get_conn)):
    billing.decide(conn, ctx, approval_id, body.approve, body.note)
    return billing.approvals(conn, "pending")


# --- setup: packages, doctor shares, rules ---

@router.get("/setup/packages")
def packages(_: Ctx = Depends(can_see_setup), conn: Conn = Depends(get_conn)):
    return billing_setup.packages(conn)


@router.post("/setup/packages", status_code=201)
def add_package(body: PackageIn, ctx: Ctx = Depends(can_setup), conn: Conn = Depends(get_conn)):
    return billing_setup.save_package(conn, ctx, body)


@router.put("/setup/packages/{package_id}")
def edit_package(package_id: int, body: PackageIn, ctx: Ctx = Depends(can_setup), conn: Conn = Depends(get_conn)):
    return billing_setup.save_package(conn, ctx, body, package_id)


@router.delete("/setup/packages/{package_id}")
def remove_package(package_id: int, ctx: Ctx = Depends(can_setup), conn: Conn = Depends(get_conn)):
    billing_setup.delete_package(conn, ctx, package_id)
    return {"ok": True}


@router.get("/setup/shares")
def share_rules(_: Ctx = Depends(can_setup), conn: Conn = Depends(get_conn)):
    return billing_setup.share_rules(conn)


@router.post("/setup/shares", status_code=201)
def add_share(body: ShareRuleIn, ctx: Ctx = Depends(can_setup), conn: Conn = Depends(get_conn)):
    billing_setup.save_share_rule(conn, ctx, body)
    return billing_setup.share_rules(conn)


@router.put("/setup/shares/{rule_id}")
def edit_share(rule_id: int, body: ShareRuleIn, ctx: Ctx = Depends(can_setup), conn: Conn = Depends(get_conn)):
    billing_setup.save_share_rule(conn, ctx, body, rule_id)
    return billing_setup.share_rules(conn)


@router.delete("/setup/shares/{rule_id}")
def remove_share(rule_id: int, ctx: Ctx = Depends(can_setup), conn: Conn = Depends(get_conn)):
    billing_setup.delete_share_rule(conn, ctx, rule_id)
    return billing_setup.share_rules(conn)


@router.get("/setup/rules")
def get_rules(_: Ctx = Depends(can_see_setup), conn: Conn = Depends(get_conn)):
    return billing_setup.rules(conn)


@router.put("/setup/rules")
def put_rules(body: BillingRulesIn, ctx: Ctx = Depends(can_setup), conn: Conn = Depends(get_conn)):
    return billing_setup.save_rules(conn, ctx, body)
