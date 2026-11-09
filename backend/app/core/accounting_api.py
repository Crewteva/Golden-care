"""Accounting endpoints shared by the accountant, management and the auditor (/api/<role>/accounting/...).

accounting.view     journal, chart, expenses, payouts, months and every report (read)
accounting.post     manual entries and reversals, expenses, transfers, settlements, payout preparation and payment,
                    lab payments, asking for a month to be closed
accounting.approve  approve or reject doctor payouts and month closing; reopen the last closed month
accounting.setup    the chart of accounts

Billing and lab records are posted to the journal before every request, so what's shown is always up to date."""
from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse

from app.config import settings
from app.core import accounting as acc
from app.core import accounting_ops as ops
from app.core import accounting_reports as reports
from app.core.accounting_schemas import (
    AccountIn, CloseRequestIn, DecideIn, EntryIn, LabPaymentIn, PayoutIn, PayoutPayIn, ReasonIn, ReverseIn, SettlementIn, TransferIn,
)
from app.core.session import Ctx, require_permission
from app.storage.db import get_conn

router = APIRouter(prefix="/accounting", tags=["accounting"])

can_view = require_permission("accounting.view")
can_post = require_permission("accounting.post")
can_approve = require_permission("accounting.approve")
can_setup = require_permission("accounting.setup")


def synced(conn: psycopg.Connection = Depends(get_conn)) -> psycopg.Connection:
    acc.sync(conn)
    return conn


Conn = psycopg.Connection


@router.get("/overview")
def overview(_: Ctx = Depends(can_view), conn: Conn = Depends(synced)):
    return reports.overview(conn)


@router.get("/options")
def options(_: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    accounts = conn.execute("SELECT id, code, name_ar, name_en, type, system_key, is_money, is_active FROM accounts ORDER BY code").fetchall()
    return {
        "accounts": accounts,
        "controlled": list(acc.CONTROLLED),
        "auto_expenses": list(ops.AUTO_EXPENSES),
        "clearing": list(acc.CLEARING),
        "doctors": conn.execute(
            """SELECT u.id, u.full_name_ar, u.full_name_en FROM users u
               WHERE EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_code = 'doctor')
               ORDER BY u.full_name_en, u.full_name_ar""").fetchall(),
        "labs": conn.execute("SELECT id, name FROM dental_labs ORDER BY name").fetchall(),
        "first_open_day": acc.first_open_day(conn),
        "max_upload_mb": settings.max_upload_mb,
    }


# --- chart of accounts ---

@router.get("/accounts")
def accounts(as_of: date | None = None, _: Ctx = Depends(can_view), conn: Conn = Depends(synced)):
    return acc.accounts(conn, as_of)


@router.post("/accounts", status_code=201)
def add_account(body: AccountIn, ctx: Ctx = Depends(can_setup), conn: Conn = Depends(get_conn)):
    return acc.save_account(conn, ctx, body)


@router.put("/accounts/{account_id}")
def edit_account(account_id: int, body: AccountIn, ctx: Ctx = Depends(can_setup), conn: Conn = Depends(get_conn)):
    return acc.save_account(conn, ctx, body, account_id)


# --- journal ---

@router.get("/journal")
def journal(q: str | None = None, group: Literal["billing", "expenses", "money", "doctors", "labs", "stock", "manual"] | None = None,
            date_from: date | None = None, date_to: date | None = None, account_id: int | None = None, page: int = Query(1, ge=1),
            _: Ctx = Depends(can_view), conn: Conn = Depends(synced)):
    return acc.journal(conn, q_text=q, group=group, date_from=date_from, date_to=date_to, account_id=account_id, page=page)


@router.get("/journal/{entry_id}")
def journal_entry(entry_id: int, _: Ctx = Depends(can_view), conn: Conn = Depends(synced)):
    return acc.entry(conn, entry_id)


@router.post("/journal", status_code=201)
def manual_entry(body: EntryIn, ctx: Ctx = Depends(can_post), conn: Conn = Depends(synced)):
    return acc.entry(conn, acc.manual_entry(conn, ctx, body)["id"])


@router.post("/journal/{entry_id}/reverse", status_code=201)
def reverse_entry(entry_id: int, body: ReverseIn, ctx: Ctx = Depends(can_post), conn: Conn = Depends(synced)):
    return acc.entry(conn, acc.reverse_manual(conn, ctx, entry_id, body)["id"])


# --- expenses ---

@router.get("/expenses")
def expenses(q: str | None = None, account_id: int | None = None, date_from: date | None = None, date_to: date | None = None,
             status: Literal["posted", "void"] | None = None, page: int = Query(1, ge=1),
             _: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return ops.expenses(conn, q_text=q, account_id=account_id, date_from=date_from, date_to=date_to, status=status, page=page)


@router.post("/expenses", status_code=201)
def add_expense(
    spent_on: date = Form(...),
    account_id: int = Form(...),
    paid_from_id: int = Form(...),
    amount: Decimal = Form(..., gt=0, le=10_000_000, decimal_places=2),
    description: str = Form(..., min_length=3, max_length=300),
    payee: str | None = Form(None, max_length=120),
    reference: str | None = Form(None, max_length=80),
    file: UploadFile | None = File(None),
    ctx: Ctx = Depends(can_post),
    conn: Conn = Depends(synced),
):
    data = file.file.read(settings.max_upload_mb * 1024 * 1024 + 1) if file else b""
    return ops.add_expense(conn, ctx, spent_on=spent_on, account_id=account_id, paid_from_id=paid_from_id, amount=amount,
                           description=description, payee=payee, reference=reference, filename=(file.filename if file else "") or "", data=data)


@router.post("/expenses/{expense_id}/void")
def void_expense(expense_id: UUID, body: ReasonIn, ctx: Ctx = Depends(can_post), conn: Conn = Depends(synced)):
    return ops.void_expense(conn, ctx, expense_id, body.reason)


@router.get("/expenses/{expense_id}/attachment")
def expense_attachment(expense_id: UUID, ctx: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    path, row = ops.expense_file(conn, ctx, expense_id)
    conn.commit()
    return FileResponse(path, media_type=row["file_mime"], filename=row["file_name"], content_disposition_type="inline",
                        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


# --- money: transfers & settlements ---

@router.get("/transfers")
def transfers(kind: Literal["transfer", "settlement"] | None = None, _: Ctx = Depends(can_view), conn: Conn = Depends(get_conn)):
    return ops.transfers(conn, kind)


@router.post("/transfers", status_code=201)
def add_transfer(body: TransferIn, ctx: Ctx = Depends(can_post), conn: Conn = Depends(synced)):
    return ops.add_transfer(conn, ctx, body)


@router.get("/settlements/unsettled")
def unsettled(_: Ctx = Depends(can_view), conn: Conn = Depends(synced)):
    return ops.unsettled(conn)


@router.post("/settlements", status_code=201)
def settle(body: SettlementIn, ctx: Ctx = Depends(can_post), conn: Conn = Depends(synced)):
    return ops.settle(conn, ctx, body)


# --- doctor payouts ---

@router.get("/payouts")
def payouts(month: date | None = None, status: Literal["prepared", "approved", "rejected", "paid"] | None = None,
            _: Ctx = Depends(can_view), conn: Conn = Depends(synced)):
    return {"items": ops.payouts(conn, month=month, status=status), "due": ops.doctors_due(conn, month) if month else []}


@router.get("/payouts/statement")
def payout_statement(doctor_id: UUID, month: date, _: Ctx = Depends(can_view), conn: Conn = Depends(synced)):
    return ops.statement(conn, doctor_id, month)


@router.get("/payouts/{payout_id}")
def payout(payout_id: UUID, _: Ctx = Depends(can_view), conn: Conn = Depends(synced)):
    row = ops.payout(conn, payout_id)
    return {**row, "statement": ops.statement(conn, row["doctor_id"], row["month"])}


@router.post("/payouts", status_code=201)
def prepare_payout(body: PayoutIn, ctx: Ctx = Depends(can_post), conn: Conn = Depends(synced)):
    return ops.prepare_payout(conn, ctx, body)


@router.post("/payouts/{payout_id}/decide")
def decide_payout(payout_id: UUID, body: DecideIn, ctx: Ctx = Depends(can_approve), conn: Conn = Depends(synced)):
    return ops.decide_payout(conn, ctx, payout_id, body.approve, body.note)


@router.post("/payouts/{payout_id}/pay")
def pay_payout(payout_id: UUID, body: PayoutPayIn, ctx: Ctx = Depends(can_post), conn: Conn = Depends(synced)):
    return ops.pay_payout(conn, ctx, payout_id, body)


# --- labs ---

@router.get("/labs")
def labs(_: Ctx = Depends(can_view), conn: Conn = Depends(synced)):
    return {"labs": ops.labs(conn), "payments": ops.lab_payments(conn)}


@router.post("/lab-payments", status_code=201)
def pay_lab(body: LabPaymentIn, ctx: Ctx = Depends(can_post), conn: Conn = Depends(synced)):
    return ops.pay_lab(conn, ctx, body)


# --- months ---

@router.get("/periods")
def periods(_: Ctx = Depends(can_view), conn: Conn = Depends(synced)):
    return acc.periods(conn)


@router.post("/periods/{month}/request")
def request_close(month: date, body: CloseRequestIn, ctx: Ctx = Depends(can_post), conn: Conn = Depends(synced)):
    return acc.request_close(conn, ctx, month, body.note)


@router.post("/periods/{month}/decide")
def decide_close(month: date, body: DecideIn, ctx: Ctx = Depends(can_approve), conn: Conn = Depends(synced)):
    return acc.decide_close(conn, ctx, month, body.approve, body.note)


@router.post("/periods/{month}/reopen")
def reopen(month: date, body: ReasonIn, ctx: Ctx = Depends(can_approve), conn: Conn = Depends(get_conn)):
    return acc.reopen(conn, ctx, month, body.reason)


# --- reports ---

@router.get("/reports/pnl")
def report_pnl(date_from: date | None = None, date_to: date | None = None, _: Ctx = Depends(can_view), conn: Conn = Depends(synced)):
    return reports.pnl(conn, date_from, date_to)


@router.get("/reports/trial-balance")
def report_trial_balance(as_of: date | None = None, _: Ctx = Depends(can_view), conn: Conn = Depends(synced)):
    return reports.trial_balance(conn, as_of)


@router.get("/reports/ledger")
def report_ledger(account_id: int, date_from: date | None = None, date_to: date | None = None,
                  _: Ctx = Depends(can_view), conn: Conn = Depends(synced)):
    return reports.ledger(conn, account_id, date_from, date_to)


@router.get("/reports/daily-cash")
def report_daily_cash(day: date | None = None, _: Ctx = Depends(can_view), conn: Conn = Depends(synced)):
    return reports.daily_cash(conn, day)


@router.get("/reports/income")
def report_income(by: Literal["service", "doctor", "specialty", "branch"] = "service", date_from: date | None = None,
                  date_to: date | None = None, _: Ctx = Depends(can_view), conn: Conn = Depends(synced)):
    return reports.income(conn, by, date_from, date_to)


@router.get("/reports/aging")
def report_aging(as_of: date | None = None, _: Ctx = Depends(can_view), conn: Conn = Depends(synced)):
    return reports.aging(conn, as_of)


@router.get("/reports/credit")
def report_credit(_: Ctx = Depends(can_view), conn: Conn = Depends(synced)):
    return reports.credit(conn)


@router.get("/reports/vat")
def report_vat(date_from: date | None = None, date_to: date | None = None, _: Ctx = Depends(can_view), conn: Conn = Depends(synced)):
    return reports.vat(conn, date_from, date_to)
