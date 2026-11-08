"""Money in and out: receipts (cash, card, InstaPay, wallet or the patient's credit), the patient credit balance,
refunds (always out of the credit balance, after a manager approves) and cashier shifts.

Every receipt belongs to the cashier's open shift. At closing the cashier counts the drawer; the system compares
it with what it expected (opening float + cash taken − cash refunds) and a difference needs a reason.
Receipts, credit movements and closed shifts can never be changed or deleted."""
from datetime import date
from decimal import Decimal

import psycopg
from psycopg.types.json import Jsonb

from app.core import audit, clinic_time
from app.core.billing import D, credit_balance, get as get_invoice, q
from app.core.billing_schemas import PaymentIn, RefundIn, RefundPayIn, ShiftCloseIn, ShiftOpenIn
from app.core.errors import AppError, field_error
from app.core.normalize import clean_name
from app.core.session import Ctx

METHODS = ("cash", "card", "instapay", "wallet", "credit")


# ---------- shifts ----------

SHIFT_SELECT = """
    SELECT s.*, u.full_name_ar AS cashier_name_ar, u.full_name_en AS cashier_name_en,
           b.name_ar AS branch_name_ar, b.name_en AS branch_name_en
    FROM cash_shifts s JOIN users u ON u.id = s.cashier_id JOIN branches b ON b.id = s.branch_id
"""


def _live_totals(conn: psycopg.Connection, shift_id) -> dict:
    by_method = {m: D("0.00") for m in METHODS}
    for row in conn.execute(
        """SELECT x.method, sum(x.amount) AS amount FROM receipt_payments x JOIN receipts r ON r.id = x.receipt_id
           WHERE r.shift_id = %s GROUP BY x.method""",
        (shift_id,),
    ):
        by_method[row["method"]] = q(row["amount"])
    refunds = {m: D("0.00") for m in METHODS if m != "credit"}
    for row in conn.execute("SELECT method, sum(amount) AS amount FROM refunds WHERE shift_id = %s AND status = 'paid' GROUP BY method",
                            (shift_id,)):
        refunds[row["method"]] = q(row["amount"])
    counts = conn.execute("SELECT count(*) AS receipts FROM receipts WHERE shift_id = %s", (shift_id,)).fetchone()
    return {"in": {k: str(v) for k, v in by_method.items()}, "refunds": {k: str(v) for k, v in refunds.items()},
            "receipts": counts["receipts"],
            "collected": str(q(sum(v for k, v in by_method.items() if k != "credit")))}


def _with_totals(conn: psycopg.Connection, shift: dict) -> dict:
    totals = shift["totals"] if shift["status"] == "closed" and shift["totals"] else _live_totals(conn, shift["id"])
    shift["totals"] = totals
    if shift["status"] == "open":
        shift["expected_cash"] = q(D(shift["opening_float"]) + D(totals["in"]["cash"]) - D(totals["refunds"]["cash"]))
    return shift


def my_shift(conn: psycopg.Connection, ctx: Ctx) -> dict | None:
    row = conn.execute(f"{SHIFT_SELECT} WHERE s.cashier_id = %s AND s.status = 'open'", (ctx.user_id,)).fetchone()
    return _with_totals(conn, row) if row else None


def _open_shift(conn: psycopg.Connection, ctx: Ctx) -> dict:
    row = conn.execute("SELECT * FROM cash_shifts WHERE cashier_id = %s AND status = 'open' FOR UPDATE", (ctx.user_id,)).fetchone()
    if not row:
        raise AppError(409, "no_open_shift")
    return row


def open_shift(conn: psycopg.Connection, ctx: Ctx, body: ShiftOpenIn) -> dict:
    if conn.execute("SELECT 1 FROM cash_shifts WHERE cashier_id = %s AND status = 'open'", (ctx.user_id,)).fetchone():
        raise AppError(409, "shift_already_open")
    branch = ctx.active_branch_id or conn.execute("SELECT id FROM branches ORDER BY id LIMIT 1").fetchone()["id"]
    row = conn.execute("INSERT INTO cash_shifts (cashier_id, branch_id, opening_float) VALUES (%s, %s, %s) RETURNING id, ref",
                       (ctx.user_id, branch, body.opening_float)).fetchone()
    audit.record(conn, "billing.shift_opened", ctx=ctx, entity="shift", entity_id=row["id"],
                 details={"ref": row["ref"], "opening_float": str(body.opening_float)})
    return my_shift(conn, ctx)


def close_shift(conn: psycopg.Connection, ctx: Ctx, body: ShiftCloseIn) -> dict:
    shift = _with_totals(conn, dict(_open_shift(conn, ctx)))
    expected = shift["expected_cash"]
    counted = q(body.counted_cash)
    difference = q(counted - expected)
    reason = clean_name(body.difference_reason)
    if difference != 0 and (not reason or len(reason) < 5):
        raise field_error("difference_reason", "required")
    conn.execute(
        """
        UPDATE cash_shifts SET status = 'closed', closed_at = now(), expected_cash = %s, counted_cash = %s, difference = %s,
               difference_reason = %s, totals = %s, note = %s
        WHERE id = %s
        """,
        (expected, counted, difference, reason if difference != 0 else None, Jsonb(shift["totals"]), clean_name(body.note), shift["id"]),
    )
    audit.record(conn, "billing.shift_closed", ctx=ctx, entity="shift", entity_id=shift["id"], details={
        "ref": shift["ref"], "expected": str(expected), "counted": str(counted), "difference": str(difference), "reason": reason})
    return shift_report(conn, ctx, shift["id"])


def shifts(conn: psycopg.Connection, ctx: Ctx, *, date_from: date | None, date_to: date | None, cashier_id=None) -> list[dict]:
    where, params = [], {}
    # a cashier sees their own shifts; management, accounting and audit see everyone's
    if ctx.active_role == "cashier":
        where.append("s.cashier_id = %(me)s")
        params["me"] = ctx.user_id
    elif cashier_id:
        where.append("s.cashier_id = %(cashier)s")
        params["cashier"] = cashier_id
    if date_from:
        where.append("s.opened_at::date >= %(from)s")
        params["from"] = date_from
    if date_to:
        where.append("s.opened_at::date <= %(to)s")
        params["to"] = date_to
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    rows = conn.execute(f"{SHIFT_SELECT} {clause} ORDER BY s.opened_at DESC LIMIT 200", params).fetchall()
    return [_with_totals(conn, r) for r in rows]


def shift_report(conn: psycopg.Connection, ctx: Ctx, shift_id) -> dict:
    shift = conn.execute(f"{SHIFT_SELECT} WHERE s.id = %s", (shift_id,)).fetchone()
    if not shift:
        raise AppError(404, "not_found")
    if ctx.active_role == "cashier" and shift["cashier_id"] != ctx.user_id:
        raise AppError(403, "forbidden")
    receipts = conn.execute(
        """
        SELECT r.id, r.ref, r.total, r.applied, r.to_credit, r.created_at, i.ref AS invoice_ref,
               p.mrn, p.full_name_ar AS patient_name_ar, p.full_name_en AS patient_name_en,
               COALESCE((SELECT json_agg(json_build_object('method', x.method, 'amount', x.amount, 'reference', x.reference) ORDER BY x.id)
                         FROM receipt_payments x WHERE x.receipt_id = r.id), '[]') AS payments
        FROM receipts r JOIN patients p ON p.id = r.patient_id LEFT JOIN invoices i ON i.id = r.invoice_id
        WHERE r.shift_id = %s ORDER BY r.created_at
        """,
        (shift_id,),
    ).fetchall()
    refunds = conn.execute(
        """SELECT f.*, p.mrn, p.full_name_ar AS patient_name_ar, p.full_name_en AS patient_name_en
           FROM refunds f JOIN patients p ON p.id = f.patient_id WHERE f.shift_id = %s ORDER BY f.paid_at""",
        (shift_id,),
    ).fetchall()
    return {"shift": _with_totals(conn, shift), "receipts": receipts, "refunds": refunds}


# ---------- receipts ----------

def collect(conn: psycopg.Connection, ctx: Ctx, body: PaymentIn) -> dict:
    """Takes a payment against an invoice (or as a deposit). Anything over what's owed goes to the patient's credit."""
    shift = _open_shift(conn, ctx)
    if not conn.execute("SELECT 1 FROM patients WHERE id = %s", (body.patient_id,)).fetchone():
        raise AppError(404, "patient_not_found")
    conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"credit:{body.patient_id}",))
    for n, p in enumerate(body.payments):
        if p.method in ("card", "instapay", "wallet") and not (p.reference or "").strip():
            raise field_error(f"payments.{n}.reference", "required")
    total = q(sum(p.amount for p in body.payments))
    from_credit = q(sum(p.amount for p in body.payments if p.method == "credit"))
    inv, due = None, D(0)
    if body.invoice_id:
        inv = get_invoice(conn, body.invoice_id, lock=True)
        if inv["patient_id"] != body.patient_id:
            raise field_error("invoice_id", "invalid")
        if inv["status"] != "issued":
            raise AppError(409, "invoice_not_issued")
        due = q(D(inv["total"]) - D(inv["paid_total"]))
        if due <= 0:
            raise AppError(409, "invoice_paid")
    if from_credit > 0:
        if not inv:
            raise field_error("payments", "credit_needs_invoice")
        if from_credit > credit_balance(conn, body.patient_id):
            raise field_error("payments", "credit_too_low")
        if from_credit > due:
            raise field_error("payments", "credit_over_due")
    applied = min(total, due) if inv else D(0)
    to_credit = q(total - applied)
    row = conn.execute(
        """
        INSERT INTO receipts (patient_id, invoice_id, shift_id, branch_id, total, applied, to_credit, note, received_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, ref
        """,
        (body.patient_id, body.invoice_id, shift["id"], shift["branch_id"], total, applied, to_credit, clean_name(body.note), ctx.user_id),
    ).fetchone()
    for p in body.payments:
        conn.execute("INSERT INTO receipt_payments (receipt_id, method, amount, reference) VALUES (%s, %s, %s, %s)",
                     (row["id"], p.method, q(p.amount), clean_name(p.reference)))
    if from_credit > 0:
        conn.execute(
            "INSERT INTO patient_credit (patient_id, amount, reason, receipt_id, invoice_id, created_by) VALUES (%s, %s, 'used', %s, %s, %s)",
            (body.patient_id, -from_credit, row["id"], body.invoice_id, ctx.user_id),
        )
    if to_credit > 0:
        conn.execute(
            "INSERT INTO patient_credit (patient_id, amount, reason, receipt_id, created_by) VALUES (%s, %s, %s, %s, %s)",
            (body.patient_id, to_credit, "overpayment" if inv else "deposit", row["id"], ctx.user_id),
        )
    if inv and applied > 0:
        conn.execute("UPDATE invoices SET paid_total = paid_total + %s, updated_at = now() WHERE id = %s", (applied, inv["id"]))
    audit.record(conn, "billing.payment_received", ctx=ctx, entity="receipt", entity_id=row["id"], details={
        "ref": row["ref"], "patient_id": str(body.patient_id), "invoice": inv["ref"] if inv else None, "total": str(total),
        "applied": str(applied), "to_credit": str(to_credit), "methods": sorted({p.method for p in body.payments})})
    return row


def receipt(conn: psycopg.Connection, receipt_id, patient_ids: list | None = None) -> dict:
    row = conn.execute(
        """
        SELECT r.*, p.mrn, p.full_name_ar AS patient_name_ar, p.full_name_en AS patient_name_en, p.phone AS patient_phone,
               i.ref AS invoice_ref, i.total AS invoice_total, i.paid_total AS invoice_paid, (i.total - i.paid_total) AS invoice_balance,
               u.full_name_ar AS received_by_ar, u.full_name_en AS received_by_en, s.ref AS shift_ref,
               b.name_ar AS branch_name_ar, b.name_en AS branch_name_en, b.address_ar AS branch_address_ar, b.address_en AS branch_address_en
        FROM receipts r JOIN patients p ON p.id = r.patient_id JOIN branches b ON b.id = r.branch_id
        LEFT JOIN invoices i ON i.id = r.invoice_id LEFT JOIN users u ON u.id = r.received_by LEFT JOIN cash_shifts s ON s.id = r.shift_id
        WHERE r.id = %s
        """,
        (receipt_id,),
    ).fetchone()
    if not row or (patient_ids is not None and row["patient_id"] not in patient_ids):
        raise AppError(404, "not_found")
    row["payments"] = conn.execute("SELECT method, amount, reference FROM receipt_payments WHERE receipt_id = %s ORDER BY id",
                                   (receipt_id,)).fetchall()
    row["credit_balance"] = credit_balance(conn, row["patient_id"])
    return row


# ---------- refunds ----------

def _reserved(conn: psycopg.Connection, patient_id) -> Decimal:
    """Credit already promised to refunds that haven't been paid yet."""
    return q(conn.execute("SELECT COALESCE(sum(amount), 0) AS s FROM refunds WHERE patient_id = %s AND status IN ('requested', 'approved')",
                          (patient_id,)).fetchone()["s"])


def request_refund(conn: psycopg.Connection, ctx: Ctx, body: RefundIn) -> dict:
    conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"credit:{body.patient_id}",))
    available = credit_balance(conn, body.patient_id) - _reserved(conn, body.patient_id)
    if body.amount > available:
        raise field_error("amount", "credit_too_low")
    approved = "billing.approve" in ctx.permissions
    row = conn.execute(
        """
        INSERT INTO refunds (patient_id, amount, method, reason, status, requested_by, decided_by, decided_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, CASE WHEN %s THEN now() END) RETURNING id, ref, status, amount
        """,
        (body.patient_id, q(body.amount), body.method, body.reason.strip(), "approved" if approved else "requested", ctx.user_id,
         ctx.user_id if approved else None, approved),
    ).fetchone()
    if not approved:
        conn.execute(
            "INSERT INTO approval_requests (kind, refund_id, patient_id, amount, reason, requested_by) VALUES ('refund', %s, %s, %s, %s, %s)",
            (row["id"], body.patient_id, q(body.amount), body.reason.strip(), ctx.user_id),
        )
    audit.record(conn, "billing.refund_requested", ctx=ctx, entity="refund", entity_id=row["id"], details={
        "ref": row["ref"], "patient_id": str(body.patient_id), "amount": str(body.amount), "method": body.method})
    return row


def pay_refund(conn: psycopg.Connection, ctx: Ctx, refund_id, body: RefundPayIn) -> None:
    shift = _open_shift(conn, ctx)
    ref = conn.execute("SELECT * FROM refunds WHERE id = %s FOR UPDATE", (refund_id,)).fetchone()
    if not ref:
        raise AppError(404, "not_found")
    if ref["status"] != "approved":
        raise AppError(409, "refund_not_approved")
    reference = clean_name(body.reference)
    if ref["method"] != "cash" and not reference:
        raise field_error("reference", "required")
    conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"credit:{ref['patient_id']}",))
    if D(ref["amount"]) > credit_balance(conn, ref["patient_id"]):
        raise AppError(409, "credit_too_low")
    if ref["method"] == "cash":
        live = _with_totals(conn, dict(shift))
        if D(ref["amount"]) > live["expected_cash"]:
            raise AppError(409, "not_enough_cash")
    conn.execute("UPDATE refunds SET status = 'paid', paid_by = %s, paid_at = now(), shift_id = %s, reference = %s WHERE id = %s",
                 (ctx.user_id, shift["id"], reference, refund_id))
    conn.execute(
        "INSERT INTO patient_credit (patient_id, amount, reason, refund_id, created_by) VALUES (%s, %s, 'refund', %s, %s)",
        (ref["patient_id"], -D(ref["amount"]), refund_id, ctx.user_id),
    )
    audit.record(conn, "billing.refund_paid", ctx=ctx, entity="refund", entity_id=refund_id, details={
        "ref": ref["ref"], "patient_id": str(ref["patient_id"]), "amount": str(ref["amount"]), "method": ref["method"]})


def refunds(conn: psycopg.Connection, state: str | None) -> list[dict]:
    where = {"open": "f.status IN ('requested', 'approved')", "paid": "f.status = 'paid'", "rejected": "f.status = 'rejected'"}.get(state or "", "true")
    return conn.execute(
        f"""
        SELECT f.*, p.mrn, p.full_name_ar AS patient_name_ar, p.full_name_en AS patient_name_en, p.phone AS patient_phone,
               rq.full_name_ar AS requested_by_ar, rq.full_name_en AS requested_by_en,
               dc.full_name_ar AS decided_by_ar, dc.full_name_en AS decided_by_en,
               pb.full_name_ar AS paid_by_ar, pb.full_name_en AS paid_by_en,
               (SELECT COALESCE(sum(c.amount), 0) FROM patient_credit c WHERE c.patient_id = f.patient_id) AS credit_balance
        FROM refunds f JOIN patients p ON p.id = f.patient_id
        LEFT JOIN users rq ON rq.id = f.requested_by LEFT JOIN users dc ON dc.id = f.decided_by LEFT JOIN users pb ON pb.id = f.paid_by
        WHERE {where}
        ORDER BY CASE f.status WHEN 'approved' THEN 0 WHEN 'requested' THEN 1 ELSE 2 END, f.requested_at DESC LIMIT 200
        """
    ).fetchall()


# ---------- installments ----------

def installments_due(conn: psycopg.Connection, days: int = 7) -> list[dict]:
    """Installments not fully paid that are overdue or due within `days` — for the reminder call list."""
    rows = conn.execute(
        """
        SELECT x.*, p.mrn, p.full_name_ar AS patient_name_ar, p.full_name_en AS patient_name_en, p.phone AS patient_phone
        FROM (
          SELECT ii.invoice_id, ii.seq, ii.due_on, ii.amount, i.ref AS invoice_ref, i.patient_id, i.paid_total, i.total,
                 sum(ii.amount) OVER (PARTITION BY ii.invoice_id ORDER BY ii.seq) AS cum
          FROM invoice_installments ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.status = 'issued'
        ) x JOIN patients p ON p.id = x.patient_id
        WHERE x.cum > x.paid_total AND x.due_on <= current_date + %s
        ORDER BY x.due_on, p.full_name_en
        """,
        (days,),
    ).fetchall()
    for r in rows:
        r["remaining"] = q(min(D(r["amount"]), D(r["cum"]) - D(r["paid_total"])))
        r["overdue"] = r["due_on"] < clinic_time.today()
        r.pop("cum")
    return rows
