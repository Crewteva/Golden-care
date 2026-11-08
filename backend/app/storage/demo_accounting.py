"""Demo data for accounting (SEED_DEMO only), on top of the demo billing that's already in the journal: an opening
balance, petty cash, a few expenses, a cash deposit to the bank, a card settlement with the provider's fee, a lab payment,
last month's doctor payouts prepared and last month's closing asked for (management approves it in the demo).

Made through the real accounting code, as the demo accountant. Every amount here is invented."""
import logging
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace

import psycopg

from app.core import accounting as acc
from app.core import accounting_ops as ops
from app.core import clinic_time
from app.core.accounting import L
from app.core.accounting_schemas import LabPaymentIn, PayoutIn, SettlementIn, TransferIn
from app.core.errors import AppError

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


def _build(conn, ctx, k, today, this_month, last_month) -> None:
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
