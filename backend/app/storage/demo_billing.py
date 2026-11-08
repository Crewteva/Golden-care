"""Demo data for billing (SEED_DEMO only): a few packages, doctor share rules, and the last days' invoices,
receipts and closed cashier shifts — one shift with a cash difference, a package sold in installments to the demo
patient, a discount waiting for a manager and a refund request. Today is left for testers: no shift is open.

The records are made through the real billing code (so totals, shares and packages are exactly what the app would
produce), then moved back to the day they belong to. Every person here is invented."""
import logging
from datetime import datetime, time, timedelta
from decimal import Decimal
from types import SimpleNamespace

import psycopg

from app.core import billing, billing_setup, clinic_time, payments
from app.core.billing_schemas import (
    InvoiceCreateIn, InvoiceUpdateIn, IssueIn, LineIn, PackageIn, PaymentIn, PaymentLineIn, RefundIn, ShareRuleIn, ShiftCloseIn, ShiftOpenIn,
)
from app.core.errors import AppError
from app.core.normalize import normalize_phone

log = logging.getLogger(__name__)

# "anything for demo": management adds, edits and removes packages in Billing setup
PACKAGES = [
    ("DRM-FU", "باقة متابعة ٤ زيارات", "Follow-up bundle — 4 visits", 4, 850, 120),
    ("DRM-PEEL", "كورس تقشير ٦ جلسات", "Peeling course — 6 sessions", 6, 7500, 365),
    ("LSR-UARM", "باقة ليزر الإبط ٦ جلسات", "Underarm laser — 6 sessions", 6, 3000, 365),
    ("DNT-SCAL", "تنظيف جير مرتين في السنة", "Scaling — twice a year", 2, 1400, 365),
    ("OBG-PREG", "متابعة حمل ٥ زيارات", "Pregnancy follow-up — 5 visits", 5, 3000, 300),
]
SHARES = {"dr.derm": 40, "dr.dental": 35, "dr.obgyn": 45}
COSTS = {"DRM-BTX": 1200, "DRM-FILL": 2500, "DNT-ZRC": 1800, "DRM-PRP": 300}
VAT = {"DNT-WHT": 14}           # a cosmetic service with VAT, to show it on invoices
CASHIER_PERMS = {"billing.view", "billing.invoice", "billing.collect", "billing.discount"}
LOCKS = [("invoices", "invoices_lock"), ("receipts", "receipts_append_only"), ("patient_credit", "patient_credit_append_only"),
         ("cash_shifts", "cash_shifts_lock")]


def _actor(user_id, label: str, permissions: set, role: str, branch_id) -> SimpleNamespace:
    return SimpleNamespace(user_id=user_id, label=label, permissions=permissions, active_role=role, active_branch_id=branch_id,
                           ip=None, user_agent=None)


def seed_demo_billing(conn: psycopg.Connection, branch_id: int) -> None:
    if conn.execute("SELECT 1 FROM packages LIMIT 1").fetchone():
        return
    users = {r["email"].split("@")[0]: r for r in conn.execute(
        "SELECT id, email, full_name_en FROM users WHERE email LIKE '%%@demo.goldencare.local'")}
    if "cashier" not in users or "owner" not in users:
        return
    services = {r["code"]: r for r in conn.execute("SELECT id, code FROM services")}
    owner = _actor(users["owner"]["id"], users["owner"]["full_name_en"], {"billing.view", "billing.approve", "settings.billing"},
                   "management", None)
    cashier = _actor(users["cashier"]["id"], users["cashier"]["full_name_en"], CASHIER_PERMS, "cashier", branch_id)
    today = clinic_time.today()

    # --- setup ---
    for code, cost in COSTS.items():
        conn.execute("UPDATE services SET direct_cost = %s WHERE code = %s", (cost, code))
    for code, rate in VAT.items():
        conn.execute("UPDATE services SET vat_rate = %s WHERE code = %s", (rate, code))
    for n, (code, name_ar, name_en, sessions, price, days) in enumerate(PACKAGES):
        if code in services:
            billing_setup.save_package(conn, owner, PackageIn(service_id=services[code]["id"], name_ar=name_ar, name_en=name_en,
                                                              sessions=sessions, price=Decimal(price), valid_days=days, sort_order=n))
    for local, pct in SHARES.items():
        if local in users:
            billing_setup.save_share_rule(conn, owner, ShareRuleIn(doctor_id=users[local]["id"], kind="percent", value=Decimal(pct),
                                                                   starts_on=today - timedelta(days=365)))
    if "dr.dental" in users and "DNT-CONS" in services:   # a fixed amount per consultation, to show both kinds
        billing_setup.save_share_rule(conn, owner, ShareRuleIn(doctor_id=users["dr.dental"]["id"], service_id=services["DNT-CONS"]["id"],
                                                               kind="fixed", value=Decimal(100), deduct_cost=False,
                                                               starts_on=today - timedelta(days=365)))

    # --- the last days' work, one closed shift per day ---
    days = [r["d"] for r in conn.execute(
        """SELECT DISTINCT starts_at::date AS d FROM appointments
           WHERE status = 'completed' AND starts_at::date < %s AND starts_at::date >= %s ORDER BY 1""",
        (today, today - timedelta(days=8)),
    )]
    if not days:
        return
    moves = []      # (table, id, timestamp columns) to move back to their day afterwards
    methods = ["cash", "cash", "card", "cash", "instapay", "cash", "wallet", "card"]
    k = 0
    for i, day in enumerate(days):
        last_day = i == len(days) - 1
        shift = payments.open_shift(conn, cashier, ShiftOpenIn(opening_float=Decimal(1000)))
        appts = conn.execute(
            "SELECT id, patient_id, starts_at FROM appointments WHERE status = 'completed' AND starts_at::date = %s ORDER BY starts_at", (day,),
        ).fetchall()
        if last_day:
            appts = appts[:-2]          # leave two of yesterday's visits unbilled for testers
        for n, a in enumerate(appts):
            at = a["starts_at"] + timedelta(minutes=45)
            try:
                with conn.transaction():
                    inv = billing.create(conn, cashier, InvoiceCreateIn(patient_id=a["patient_id"], appointment_id=a["id"]))
                    rows = conn.execute("SELECT * FROM invoice_lines WHERE invoice_id = %s ORDER BY position", (inv["id"],)).fetchall()
                    if not rows:
                        raise AppError(422, "invoice_empty")
                    if last_day and n == 0:
                        # a 20% discount: over the cashier's 10% limit, so it waits for a manager
                        sub = Decimal(billing.get(conn, inv["id"])["subtotal"])
                        billing.update(conn, cashier, inv["id"], InvoiceUpdateIn(
                            lines=billing._lines_in(rows), discount_amount=(sub * Decimal("0.2")).quantize(Decimal("1")),
                            discount_reason="Long-time patient; family of a staff member"))
                        billing.issue(conn, cashier, inv["id"], IssueIn())
                        moves.append(("invoices", inv["id"], at))
                        continue
                    billing.issue(conn, cashier, inv["id"], IssueIn())
                    total = Decimal(billing.get(conn, inv["id"])["total"])
                    if total <= 0:
                        moves.append(("invoices", inv["id"], at))
                        continue
                    method = methods[k % len(methods)]
                    k += 1
                    extra = Decimal(200) if (i == 0 and n == 1) else Decimal(0)     # paid more than due: goes to credit
                    lines_in = [PaymentLineIn(method=method, amount=total + extra,
                                              reference=None if method == "cash" else f"TX{7310000 + k * 37}")]
                    if i == 1 and n == 0 and total > 300:                         # split between cash and card
                        lines_in = [PaymentLineIn(method="cash", amount=Decimal(300)),
                                    PaymentLineIn(method="card", amount=total - 300, reference=f"POS{48200 + k}")]
                    payments.collect(conn, cashier, PaymentIn(patient_id=a["patient_id"], invoice_id=inv["id"], payments=lines_in))
                    moves.append(("invoices", inv["id"], at))
            except AppError:
                continue

        # the demo patient buys a package in installments on the first day
        if i == 0:
            _package_sale(conn, cashier, services, moves, clinic_time.at(day, time(18, 20)))

        report = payments.shift_report(conn, cashier, shift["id"])
        expected = Decimal(report["shift"]["expected_cash"])
        short = Decimal(50) if i == 1 else Decimal(0)
        payments.close_shift(conn, cashier, ShiftCloseIn(
            counted_cash=expected - short, difference_reason="A 50 EGP note short; reviewed with the cashier" if short else None))
        moves.append(("cash_shifts", shift["id"], clinic_time.at(day, time(10, 0)), clinic_time.at(day, time(22, 15))))

    # a refund request out of the credit left by the overpayment
    credit = conn.execute(
        "SELECT patient_id FROM patient_credit WHERE reason = 'overpayment' GROUP BY patient_id HAVING sum(amount) > 0 LIMIT 1"
    ).fetchone()
    if credit:
        payments.request_refund(conn, cashier, RefundIn(patient_id=credit["patient_id"], amount=Decimal(200), method="cash",
                                                        reason="Paid 200 EGP more than the invoice; patient asked for it back"))

    _move_back(conn, moves)
    log.info("Demo billing created: %s days of invoices and shifts", len(days))


def _package_sale(conn: psycopg.Connection, cashier, services: dict, moves: list, at: datetime) -> None:
    patient = conn.execute("SELECT id FROM patients WHERE phone = %s", (normalize_phone("01001110001"),)).fetchone()
    pkg = conn.execute("SELECT id, price FROM packages ORDER BY price DESC LIMIT 1").fetchone()
    if not patient or not pkg:
        return
    try:
        with conn.transaction():
            inv = billing.create(conn, cashier, InvoiceCreateIn(patient_id=patient["id"]))
            billing.update(conn, cashier, inv["id"], InvoiceUpdateIn(lines=[LineIn(kind="package_sale", package_id=pkg["id"])]))
            billing.issue(conn, cashier, inv["id"], IssueIn(installments=2, down_payment=Decimal(2500),
                                                            first_due_on=clinic_time.today() + timedelta(days=3)))
            payments.collect(conn, cashier, PaymentIn(patient_id=patient["id"], invoice_id=inv["id"],
                                                      payments=[PaymentLineIn(method="card", amount=Decimal(2500), reference="POS48177")]))
            moves.append(("invoices", inv["id"], at))
    except AppError:
        pass


def _move_back(conn: psycopg.Connection, moves: list) -> None:
    for table, trigger in LOCKS:
        conn.execute(f"ALTER TABLE {table} DISABLE TRIGGER {trigger}")
    for move in moves:
        if move[0] == "cash_shifts":
            _, shift_id, opened, closed = move
            conn.execute("UPDATE cash_shifts SET opened_at = %s, closed_at = %s WHERE id = %s", (opened, closed, shift_id))
            continue
        _, invoice_id, at = move
        conn.execute("UPDATE invoices SET created_at = %s, issued_at = CASE WHEN issued_at IS NULL THEN NULL ELSE %s END, updated_at = %s WHERE id = %s",
                     (at, at, at, invoice_id))
        conn.execute("UPDATE approval_requests SET requested_at = %s WHERE invoice_id = %s", (at, invoice_id))
        receipts = [r["id"] for r in conn.execute("SELECT id FROM receipts WHERE invoice_id = %s", (invoice_id,))]
        conn.execute("UPDATE receipts SET created_at = %s + interval '2 minutes' WHERE invoice_id = %s", (at, invoice_id))
        conn.execute("UPDATE patient_credit SET created_at = %s + interval '2 minutes' WHERE receipt_id = ANY(%s) OR invoice_id = %s",
                     (at, receipts, invoice_id))
        conn.execute(
            """UPDATE patient_packages SET sold_at = %s, expires_on = CASE WHEN expires_on IS NULL THEN NULL
                      ELSE %s::date + (expires_on - current_date) END
               WHERE sale_line_id IN (SELECT id FROM invoice_lines WHERE invoice_id = %s)""",
            (at, at, invoice_id),
        )
    conn.execute("UPDATE refunds SET requested_at = now() - interval '20 hours' WHERE status = 'requested'")
    for table, trigger in LOCKS:
        conn.execute(f"ALTER TABLE {table} ENABLE TRIGGER {trigger}")
