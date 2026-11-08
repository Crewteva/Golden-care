"""Demo data for accounting (SEED_DEMO only), on top of the demo billing that's already in the journal: a few of last
month's invoices (so it has income and doctor shares), an opening balance, petty cash, a few expenses, a cash deposit to the bank, a card settlement with the provider's fee, a lab payment,
last month's doctor payouts prepared and last month's closing asked for (management approves it in the demo).

Made through the real accounting code, as the demo accountant. Every amount here is invented."""
import logging
from datetime import time, timedelta
from decimal import Decimal
from types import SimpleNamespace

import psycopg

from app.core import accounting as acc
from app.core import accounting_ops as ops
from app.core import billing, clinic_time, payments
from app.core.accounting import L
from app.core.accounting_schemas import LabPaymentIn, PayoutIn, SettlementIn, TransferIn
from app.core.billing_schemas import InvoiceCreateIn, InvoiceUpdateIn, IssueIn, LineIn, PaymentIn, PaymentLineIn, ShiftCloseIn, ShiftOpenIn
from app.core.errors import AppError
from app.storage.demo_billing import CASHIER_PERMS, _actor as _billing_actor, _move_back

log = logging.getLogger(__name__)
D = Decimal

# (days after the 1st of last month or of this month, category code, paid from, amount, payee, description)
EXPENSES = [
    ("last", 2, "5220", "petty_cash", 2650, "El-Nour Medical Supplies", "Gloves, gauze and disinfectant — opening stock"),
    ("last", 9, "5250", "bank", 6000, "Shorouk Print House", "Opening flyers and roll-up banners"),
    ("last", 20, "5240", "petty_cash", 750, "Cool Air Services", "AC filters cleaned in clinics 2 and 3"),
    ("this", 0, "5200", "bank", 28000, "Eng. Samir Halim (landlord)", "Rent for November — Shorouk branch"),
    ("this", 2, "5210", "bank", 3480, "North Cairo Electricity", "Electricity bill for October"),
    ("this", 3, "5210", "petty_cash", 640, "WE Internet", "Internet — November"),
    ("this", 4, "5220", "petty_cash", 1285, "El-Nour Medical Supplies", "Syringes, cannulas and numbing cream"),
]


def seed_demo_accounting(conn: psycopg.Connection, branch_id: int) -> None:
    if conn.execute("SELECT 1 FROM expenses LIMIT 1").fetchone():
        return
    user = conn.execute("SELECT id, full_name_en FROM users WHERE email = 'accountant@demo.goldencare.local'").fetchone()
    owner = conn.execute("SELECT id, full_name_en FROM users WHERE email = 'owner@demo.goldencare.local'").fetchone()
    if not user or not owner:
        return
    ctx = SimpleNamespace(user_id=user["id"], label=user["full_name_en"], permissions={"accounting.view", "accounting.post"},
                          active_role="accountant", active_branch_id=branch_id, ip=None, user_agent=None)
    k = acc.keys(conn)
    today = clinic_time.today()
    this_month = acc.month_start(today)
    last_month = acc.month_start(this_month - timedelta(days=1))
    try:
        with conn.transaction():
            _build(conn, ctx, k, today, this_month, last_month)
    except AppError as exc:
        log.warning("Demo accounting skipped: %s", exc.code)


def _last_month_billing(conn: psycopg.Connection, branch_id: int, last_month) -> None:
    """A few invoices across last month (demo billing only covers the last days), so it has income, doctor shares to
    pay out and a month to close. Made like demo billing: through the billing code, then moved back to their day."""
    cashier_user = conn.execute("SELECT id, full_name_en FROM users WHERE email = 'cashier@demo.goldencare.local'").fetchone()
    if not cashier_user:
        return
    cashier = _billing_actor(cashier_user["id"], cashier_user["full_name_en"], CASHIER_PERMS, "cashier", branch_id)
    pairs = conn.execute(
        """SELECT DISTINCT a.doctor_id, s.service_id FROM appointments a JOIN appointment_services s ON s.appointment_id = a.id
           JOIN services sv ON sv.id = s.service_id WHERE sv.is_active ORDER BY 1, 2"""
    ).fetchall()
    patients = [r["id"] for r in conn.execute(
        "SELECT id FROM patients ORDER BY mrn LIMIT 14")] if pairs else []
    if not pairs or not patients:
        return
    moves, methods = [], ["cash", "card", "cash", "instapay", "card", "cash", "wallet"]
    for n, offset in enumerate((5, 8, 12, 15, 19, 22, 26, 29)):
        day = last_month + timedelta(days=offset)
        shift = payments.open_shift(conn, cashier, ShiftOpenIn(opening_float=D(1000)))
        for j in range(3):
            pair = pairs[(n * 3 + j) % len(pairs)]
            patient = patients[(n * 3 + j) % len(patients)]
            at = clinic_time.at(day, time(11 + j * 2, 30))
            try:
                with conn.transaction():
                    inv = billing.create(conn, cashier, InvoiceCreateIn(patient_id=patient))
                    billing.update(conn, cashier, inv["id"], InvoiceUpdateIn(
                        lines=[LineIn(kind="service", service_id=pair["service_id"], doctor_id=pair["doctor_id"])]))
                    billing.issue(conn, cashier, inv["id"], IssueIn())
                    total = D(billing.get(conn, inv["id"])["total"])
                    if total > 0:
                        method = methods[(n * 3 + j) % len(methods)]
                        payments.collect(conn, cashier, PaymentIn(patient_id=patient, invoice_id=inv["id"], payments=[
                            PaymentLineIn(method=method, amount=total, reference=None if method == "cash" else f"TX{6200000 + n * 10 + j}")]))
                    moves.append(("invoices", inv["id"], at))
            except AppError:
                continue
        expected = D(payments.shift_report(conn, cashier, shift["id"])["shift"]["expected_cash"])
        payments.close_shift(conn, cashier, ShiftCloseIn(counted_cash=expected))
        moves.append(("cash_shifts", shift["id"], clinic_time.at(day, time(10, 0)), clinic_time.at(day, time(21, 30))))
    _move_back(conn, moves)


def _build(conn, ctx, k, today, this_month, last_month) -> None:
    _last_month_billing(conn, ctx.active_branch_id, last_month)
    acc.sync(conn)
    acc.post(conn, day=last_month, memo="Opening balance: capital paid into the bank", source_type="manual", ctx=ctx,
             branch_id=ctx.active_branch_id, lines=[L(k["bank"], 400000), L(k["capital"], -400000)])
    ops.add_transfer(conn, ctx, TransferIn(moved_on=last_month, from_id=k["bank"], to_id=k["petty_cash"], amount=D(6000),
                                           reference="CHQ 100231", note="Petty cash fund"))
    accounts = {r["code"]: r["id"] for r in conn.execute("SELECT id, code FROM accounts")}
    for when, offset, code, source, amount, payee, text in EXPENSES:
        day = (last_month if when == "last" else this_month) + timedelta(days=offset)
        if day > today:
            continue
        ops.add_expense(conn, ctx, spent_on=day, account_id=accounts[code], paid_from_id=k[source], amount=D(amount),
                        description=text, payee=payee, reference=None)

    # most of the drawer's cash taken so far is deposited, the rest stays as change
    deposit_day = max(this_month, today - timedelta(days=3))
    cash = ops.balance_of(conn, k["cash_drawer"], deposit_day)
    deposit = D(int(cash * D("0.8") / 500) * 500)
    if deposit > 0:
        ops.add_transfer(conn, ctx, TransferIn(moved_on=deposit_day, from_id=k["cash_drawer"], to_id=k["bank"], amount=deposit,
                                               reference="Deposit slip 55871", note="Cash takings deposited at Banque Misr"))

    # card payments up to two days ago come in from the provider, less 2.25 %
    cutoff = today - timedelta(days=2)
    cards = [r for r in ops.unsettled(conn)["items"] if r["method"] == "card" and r["created_at"].date() <= cutoff]
    if cards:
        total = sum((D(r["amount"]) for r in cards), D(0))
        ops.settle(conn, ctx, SettlementIn(method="card", moved_on=today - timedelta(days=1), to_id=k["bank"],
                                           payment_ids=[r["id"] for r in cards], fee=(total * D("0.0225")).quantize(D("0.01")),
                                           reference="POS batch 0412", note="Card terminal settlement"))

    lab = next((x for x in ops.labs(conn) if D(x["balance"]) > 0), None)
    if lab:
        ops.pay_lab(conn, ctx, LabPaymentIn(lab_id=lab["id"], paid_on=today - timedelta(days=1), amount=(D(lab["balance"]) / 2).quantize(D("1")),
                                            paid_from_id=k["bank"], reference="Transfer 7781", note="Part payment"))

    for due in ops.doctors_due(conn, last_month):
        if D(due["shares"]) > 0 and D(due["net"]) >= 0 and not due["payout_id"]:
            ops.prepare_payout(conn, ctx, PayoutIn(doctor_id=due["doctor_id"], month=last_month, note="Monthly statement"))

    if not [c for c in acc.close_checks(conn, last_month) if c["level"] == "block"]:
        acc.request_close(conn, ctx, last_month, "All shifts closed, expenses entered and payouts prepared.")
