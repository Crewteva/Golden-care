"""The accountant's own work: expenses (with a scanned receipt), money moved between accounts, card / InstaPay / wallet
settlements against the bank, monthly doctor payouts (prepared → approved by management → paid) and payments to labs.
Each one posts its journal entry in the same transaction."""
import os
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

from app.config import settings
from app.core import audit, clinic_time
from app.core import accounting as acc
from app.core.accounting import L, ZERO
from app.core.billing import q
from app.core.errors import AppError, field_error
from app.core.files import SIGNATURES
from app.core.session import Ctx

D = Decimal
# Expense categories the system posts by itself: picked automatically, never by hand.
AUTO_EXPENSES = ("doctor_fees", "lab_costs", "cash_short", "consumables_used", "stock_losses", "device_maintenance")
METHOD_CLEARING = {"card": "card_clearing", "instapay": "instapay_clearing", "wallet": "wallet_clearing"}


def _clean(text: str | None) -> str | None:
    return " ".join((text or "").split()) or None


# ---------- expenses ----------

EXPENSE_SELECT = """
    SELECT x.id, x.ref, x.spent_on, x.account_id, x.paid_from_id, x.branch_id, x.amount, x.payee, x.description, x.reference,
           x.file_name, x.file_mime, x.status, x.void_reason, x.voided_at, x.created_at,
           a.code AS account_code, a.name_ar AS account_name_ar, a.name_en AS account_name_en,
           m.name_ar AS paid_from_ar, m.name_en AS paid_from_en,
           u.full_name_ar AS created_by_ar, u.full_name_en AS created_by_en,
           (SELECT e.id FROM journal_entries e WHERE e.source_type = 'expense' AND e.source_id = x.id::text) AS entry_id
    FROM expenses x JOIN accounts a ON a.id = x.account_id JOIN accounts m ON m.id = x.paid_from_id
    LEFT JOIN users u ON u.id = x.created_by
"""


def expenses(conn: psycopg.Connection, *, q_text=None, account_id=None, date_from=None, date_to=None, status=None, page: int = 1) -> dict:
    where, params = [], {}
    if q_text:
        where.append("(x.ref ILIKE %(q)s OR x.description ILIKE %(q)s OR x.payee ILIKE %(q)s OR x.reference ILIKE %(q)s)")
        params["q"] = f"%{q_text.strip()}%"
    if account_id:
        where.append("x.account_id = %(acc)s")
        params["acc"] = account_id
    if date_from:
        where.append("x.spent_on >= %(from)s")
        params["from"] = date_from
    if date_to:
        where.append("x.spent_on <= %(to)s")
        params["to"] = date_to
    if status:
        where.append("x.status = %(status)s")
        params["status"] = status
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    total = conn.execute(
        f"""SELECT count(*) AS n, COALESCE(sum(x.amount) FILTER (WHERE x.status = 'posted'), 0) AS amount FROM expenses x {clause}""", params,
    ).fetchone()
    rows = conn.execute(f"{EXPENSE_SELECT} {clause} ORDER BY x.spent_on DESC, x.created_at DESC LIMIT 50 OFFSET %(offset)s",
                        {**params, "offset": (page - 1) * 50}).fetchall()
    by_category = conn.execute(
        f"""SELECT a.id, a.code, a.name_ar, a.name_en, sum(x.amount) AS amount, count(*) AS n FROM expenses x JOIN accounts a ON a.id = x.account_id
            {clause + ' AND' if clause else 'WHERE'} x.status = 'posted' GROUP BY a.id ORDER BY sum(x.amount) DESC""", params,
    ).fetchall()
    return {"items": rows, "total": total["n"], "amount": total["amount"], "by_category": by_category, "page": page, "page_size": 50}


def _store_attachment(filename: str, data: bytes) -> tuple[str, str, str]:
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise field_error("file", "too_large")
    kind = next(((mime, ext) for magic, mime, ext in SIGNATURES if data.startswith(magic)), None)
    if not kind:
        raise field_error("file", "unsupported_type")
    mime, ext = kind
    key = f"accounting/{uuid.uuid4().hex}.{ext}"
    path = _path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    tmp.write_bytes(data)
    os.replace(tmp, path)
    return key, (filename or f"receipt.{ext}")[:200], mime


def _path(key: str) -> Path:
    root = Path(settings.files_dir).resolve()
    path = (root / key).resolve()
    if root not in path.parents:
        raise AppError(400, "invalid_path")
    return path


def add_expense(conn: psycopg.Connection, ctx: Ctx, *, spent_on: date, account_id: int, paid_from_id: int, amount: Decimal,
                description: str, payee: str | None = None, reference: str | None = None, filename: str = "", data: bytes = b"") -> dict:
    acc.check_date(conn, spent_on, "spent_on")
    category = acc.account(conn, account_id)
    if category["type"] != "expense" or not category["is_active"] or category["system_key"] in AUTO_EXPENSES:
        raise field_error("account_id", "not_expense")
    source = acc.money_account(conn, paid_from_id, "paid_from_id", allow_drawer=False, allow_clearing=False)
    amount = q(amount)
    if amount <= 0 or amount > 10_000_000:
        raise field_error("amount", "invalid")
    description = _clean(description)
    if not description or len(description) < 3:
        raise field_error("description", "required")
    key = name = mime = None
    if data:
        key, name, mime = _store_attachment(filename, data)
    try:
        row = conn.execute(
            """INSERT INTO expenses (spent_on, account_id, paid_from_id, branch_id, amount, payee, description, reference, file_key, file_name,
                                     file_mime, created_by)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
            (spent_on, account_id, paid_from_id, ctx.active_branch_id, amount, _clean(payee), description[:300], _clean(reference),
             key, name, mime, ctx.user_id),
        ).fetchone()
        acc.post(conn, day=spent_on, memo=f"{category['name_en']}: {description}", source_type="expense", source_id=row["id"],
                 source_ref=row["ref"], branch_id=ctx.active_branch_id, ctx=ctx,
                 lines=[L(category["id"], amount, memo=_clean(payee)), L(source["id"], -amount)])
    except Exception:
        if key:
            _path(key).unlink(missing_ok=True)
        raise
    audit.record(conn, "accounting.expense_added", ctx=ctx, entity="expense", entity_id=row["id"], details={
        "ref": row["ref"], "amount": str(amount), "category": category["name_en"], "paid_from": source["name_en"], "attachment": bool(key)})
    return row


def void_expense(conn: psycopg.Connection, ctx: Ctx, expense_id, reason: str) -> dict:
    row = conn.execute("SELECT * FROM expenses WHERE id = %s FOR UPDATE", (expense_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    if row["status"] == "void":
        raise AppError(409, "already_void")
    entry = acc._entry_for(conn, "expense", row["id"])
    today = clinic_time.today()
    acc.ensure_open(conn, today)
    conn.execute("UPDATE expenses SET status = 'void', void_reason = %s, voided_by = %s, voided_at = now() WHERE id = %s",
                 (reason.strip(), ctx.user_id, expense_id))
    if entry:
        acc.reverse(conn, entry, day=today, memo=f"Expense {row['ref']} voided: {reason.strip()}", source_type="expense_void",
                    source_id=row["id"], ctx=ctx)
    audit.record(conn, "accounting.expense_voided", ctx=ctx, entity="expense", entity_id=expense_id,
                 details={"ref": row["ref"], "amount": str(row["amount"]), "reason": reason.strip()})
    return {"id": expense_id, "status": "void"}


def expense_file(conn: psycopg.Connection, ctx: Ctx, expense_id) -> tuple[Path, dict]:
    row = conn.execute("SELECT * FROM expenses WHERE id = %s", (expense_id,)).fetchone()
    if not row or not row["file_key"]:
        raise AppError(404, "file_not_found")
    path = _path(row["file_key"])
    if not path.exists():
        raise AppError(410, "file_missing")
    audit.record(conn, "accounting.expense_file_opened", ctx=ctx, entity="expense", entity_id=expense_id, details={"ref": row["ref"]})
    return path, row


# ---------- transfers & settlements ----------

def transfers(conn: psycopg.Connection, kind: str | None = None) -> list[dict]:
    return conn.execute(
        """SELECT t.*, f.name_ar AS from_ar, f.name_en AS from_en, d.name_ar AS to_ar, d.name_en AS to_en,
                  u.full_name_ar AS created_by_ar, u.full_name_en AS created_by_en,
                  (SELECT count(*) FROM settlement_items s WHERE s.transfer_id = t.id) AS payments,
                  (SELECT e.id FROM journal_entries e WHERE e.source_type = t.kind AND e.source_id = t.id::text) AS entry_id
           FROM transfers t JOIN accounts f ON f.id = t.from_id JOIN accounts d ON d.id = t.to_id LEFT JOIN users u ON u.id = t.created_by
           WHERE %(kind)s::text IS NULL OR t.kind = %(kind)s ORDER BY t.moved_on DESC, t.created_at DESC LIMIT 200""",
        {"kind": kind},
    ).fetchall()


def _move(conn: psycopg.Connection, ctx: Ctx, *, kind: str, day: date, src: dict, dst: dict, amount: Decimal, fee: Decimal,
          reference, note, memo: str) -> dict:
    if fee >= amount:
        raise field_error("fee", "too_high")
    row = conn.execute(
        """INSERT INTO transfers (kind, moved_on, from_id, to_id, amount, fee, reference, note, branch_id, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (kind, day, src["id"], dst["id"], amount, fee, _clean(reference), _clean(note), ctx.active_branch_id, ctx.user_id),
    ).fetchone()
    k = acc.keys(conn)
    acc.post(conn, day=day, memo=memo, source_type=kind, source_id=row["id"], source_ref=row["ref"], branch_id=ctx.active_branch_id, ctx=ctx,
             lines=[L(dst["id"], amount - fee), L(k["bank_fees"], fee), L(src["id"], -amount)])
    return row


def add_transfer(conn: psycopg.Connection, ctx: Ctx, body) -> dict:
    acc.check_date(conn, body.moved_on, "moved_on")
    src = acc.money_account(conn, body.from_id, "from_id", allow_clearing=False)
    dst = acc.money_account(conn, body.to_id, "to_id", allow_clearing=False)
    if src["id"] == dst["id"]:
        raise field_error("to_id", "same_account")
    amount, fee = q(body.amount), q(body.fee)
    balance = balance_of(conn, src["id"], body.moved_on)
    if amount > balance:
        raise AppError(409, "insufficient_balance", fields={"amount": "insufficient_balance"}, balance=str(balance))
    row = _move(conn, ctx, kind="transfer", day=body.moved_on, src=src, dst=dst, amount=amount, fee=fee, reference=body.reference,
                note=body.note, memo=f"{src['name_en']} → {dst['name_en']}" + (f": {_clean(body.note)}" if body.note else ""))
    audit.record(conn, "accounting.transfer_added", ctx=ctx, entity="transfer", entity_id=row["id"],
                 details={"ref": row["ref"], "from": src["name_en"], "to": dst["name_en"], "amount": str(amount), "fee": str(fee)})
    return row


def balance_of(conn: psycopg.Connection, account_id: int, as_of: date | None = None) -> Decimal:
    return D(conn.execute(
        """SELECT COALESCE(sum(l.debit - l.credit), 0) AS b FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
           WHERE l.account_id = %s AND (%s::date IS NULL OR e.entry_date <= %s::date)""",
        (account_id, as_of, as_of),
    ).fetchone()["b"])


def unsettled(conn: psycopg.Connection) -> dict:
    rows = conn.execute(
        """SELECT p.id, p.method, p.amount, p.reference, r.ref AS receipt_ref, r.created_at, r.branch_id,
                  pt.mrn, pt.full_name_ar, pt.full_name_en
           FROM receipt_payments p JOIN receipts r ON r.id = p.receipt_id JOIN patients pt ON pt.id = r.patient_id
           WHERE p.method IN ('card', 'instapay', 'wallet')
             AND NOT EXISTS (SELECT 1 FROM settlement_items s WHERE s.receipt_payment_id = p.id)
           ORDER BY r.created_at, p.id LIMIT 2000"""
    ).fetchall()
    k = acc.keys(conn)
    totals = {m: {"count": 0, "amount": ZERO, "balance": balance_of(conn, k[a])} for m, a in METHOD_CLEARING.items()}
    for r in rows:
        totals[r["method"]]["count"] += 1
        totals[r["method"]]["amount"] += D(r["amount"])
    return {"items": rows, "totals": totals}


def settle(conn: psycopg.Connection, ctx: Ctx, body) -> dict:
    acc.check_date(conn, body.moved_on, "moved_on")
    k = acc.keys(conn)
    src = acc.account(conn, k[METHOD_CLEARING[body.method]])
    dst = acc.money_account(conn, body.to_id, "to_id", allow_drawer=False, allow_clearing=False)
    ids = sorted(set(body.payment_ids))
    rows = conn.execute(
        """SELECT p.id, p.amount, r.created_at::date AS day FROM receipt_payments p JOIN receipts r ON r.id = p.receipt_id
           WHERE p.id = ANY(%s) AND p.method = %s FOR UPDATE OF p""",
        (ids, body.method),
    ).fetchall()
    if len(rows) != len(ids):
        raise field_error("payment_ids", "invalid")
    if conn.execute("SELECT 1 FROM settlement_items WHERE receipt_payment_id = ANY(%s)", (ids,)).fetchone():
        raise AppError(409, "already_settled")
    if any(r["day"] > body.moved_on for r in rows):
        raise field_error("moved_on", "before_payments")
    amount, fee = q(sum((D(r["amount"]) for r in rows), ZERO)), q(body.fee)
    row = _move(conn, ctx, kind="settlement", day=body.moved_on, src=src, dst=dst, amount=amount, fee=fee, reference=body.reference,
                note=body.note, memo=f"Settlement of {len(rows)} {body.method} payments into {dst['name_en']}")
    with conn.cursor() as cur:
        cur.executemany("INSERT INTO settlement_items (transfer_id, receipt_payment_id) VALUES (%s, %s)", [(row["id"], i) for i in ids])
    audit.record(conn, "accounting.settlement_added", ctx=ctx, entity="transfer", entity_id=row["id"], details={
        "ref": row["ref"], "method": body.method, "payments": len(ids), "amount": str(amount), "fee": str(fee), "to": dst["name_en"]})
    return row


# ---------- doctor payouts ----------

def statement(conn: psycopg.Connection, doctor_id, month: date) -> dict:
    """What a doctor earned in a month: their shares of invoices issued (less those voided) and their part of lab costs."""
    month = acc.month_start(month)
    end = acc.month_end(month)
    doctor = conn.execute("SELECT id, full_name_ar, full_name_en FROM users WHERE id = %s", (doctor_id,)).fetchone()
    if not doctor:
        raise field_error("doctor_id", "invalid")
    lines = conn.execute(
        """SELECT e.id AS entry_id, e.ref AS entry_ref, e.entry_date, e.source_type, e.source_ref, l.credit - l.debit AS share,
                  l.memo, s.name_ar AS service_name_ar, s.name_en AS service_name_en
           FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id LEFT JOIN services s ON s.id = l.service_id
           WHERE l.account_id = (SELECT id FROM accounts WHERE system_key = 'doctors_payable') AND l.doctor_id = %s
             AND e.source_type IN ('invoice', 'invoice_void') AND e.entry_date BETWEEN %s AND %s
           ORDER BY e.entry_date, e.id, l.id""",
        (doctor_id, month, end),
    ).fetchall()
    labs = conn.execute(
        """SELECT c.id, c.ref, c.returned_at::date AS returned_on, c.lab_cost, c.doctor_share_pct, l.name AS lab_name,
                  round(c.lab_cost * c.doctor_share_pct / 100, 2) AS deduction, p.mrn, p.full_name_ar, p.full_name_en
           FROM lab_cases c JOIN dental_labs l ON l.id = c.lab_id JOIN patients p ON p.id = c.patient_id
           WHERE c.doctor_id = %s AND c.status <> 'cancelled' AND c.returned_at IS NOT NULL
             AND c.returned_at::date BETWEEN %s AND %s AND c.doctor_share_pct > 0 AND COALESCE(c.lab_cost, 0) > 0
           ORDER BY c.returned_at""",
        (doctor_id, month, end),
    ).fetchall()
    shares = q(sum((D(r["share"]) for r in lines), ZERO))
    deduction = q(sum((D(r["deduction"]) for r in labs), ZERO))
    existing = conn.execute("SELECT id, ref, status FROM doctor_payouts WHERE doctor_id = %s AND month = %s AND status <> 'rejected'",
                            (doctor_id, month)).fetchone()
    by_service = {}
    for r in lines:
        key = r["service_name_en"] or r["memo"] or "—"
        item = by_service.setdefault(key, {"service_name_ar": r["service_name_ar"] or r["memo"], "service_name_en": key, "count": 0, "share": ZERO})
        item["count"] += 1 if r["source_type"] == "invoice" else -1
        item["share"] += D(r["share"])
    return {"doctor": doctor, "month": month, "lines": lines, "labs": labs, "by_service": list(by_service.values()),
            "shares": shares, "lab_deduction": deduction, "net": shares - deduction, "existing": existing}


def doctors_due(conn: psycopg.Connection, month: date) -> list[dict]:
    """Every doctor with shares or lab deductions in the month, and where their payout stands."""
    month = acc.month_start(month)
    end = acc.month_end(month)
    return conn.execute(
        """
        WITH s AS (
          SELECT l.doctor_id, sum(l.credit - l.debit) AS shares FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
          WHERE l.account_id = (SELECT id FROM accounts WHERE system_key = 'doctors_payable') AND l.doctor_id IS NOT NULL
            AND e.source_type IN ('invoice', 'invoice_void') AND e.entry_date BETWEEN %(m)s AND %(end)s GROUP BY l.doctor_id
        ), d AS (
          SELECT c.doctor_id, sum(round(c.lab_cost * c.doctor_share_pct / 100, 2)) AS deduction FROM lab_cases c
          WHERE c.status <> 'cancelled' AND c.returned_at::date BETWEEN %(m)s AND %(end)s AND COALESCE(c.lab_cost, 0) > 0
            AND c.doctor_share_pct > 0
          GROUP BY c.doctor_id
        )
        SELECT u.id AS doctor_id, u.full_name_ar, u.full_name_en, COALESCE(s.shares, 0) AS shares, COALESCE(d.deduction, 0) AS lab_deduction,
               COALESCE(s.shares, 0) - COALESCE(d.deduction, 0) AS net,
               p.id AS payout_id, p.ref AS payout_ref, p.status AS payout_status
        FROM (SELECT doctor_id FROM s UNION SELECT doctor_id FROM d) x
        JOIN users u ON u.id = x.doctor_id
        LEFT JOIN s ON s.doctor_id = x.doctor_id LEFT JOIN d ON d.doctor_id = x.doctor_id
        LEFT JOIN doctor_payouts p ON p.doctor_id = x.doctor_id AND p.month = %(m)s AND p.status <> 'rejected'
        ORDER BY u.full_name_en NULLS LAST, u.full_name_ar
        """,
        {"m": month, "end": end},
    ).fetchall()


PAYOUT_SELECT = """
    SELECT p.*, u.full_name_ar AS doctor_name_ar, u.full_name_en AS doctor_name_en,
           pr.full_name_ar AS prepared_by_ar, pr.full_name_en AS prepared_by_en,
           dc.full_name_ar AS decided_by_ar, dc.full_name_en AS decided_by_en,
           pd.full_name_ar AS paid_by_ar, pd.full_name_en AS paid_by_en,
           m.name_ar AS paid_from_ar, m.name_en AS paid_from_en,
           (SELECT e.id FROM journal_entries e WHERE e.source_type = 'payout' AND e.source_id = p.id::text) AS entry_id
    FROM doctor_payouts p JOIN users u ON u.id = p.doctor_id
    LEFT JOIN users pr ON pr.id = p.prepared_by LEFT JOIN users dc ON dc.id = p.decided_by LEFT JOIN users pd ON pd.id = p.paid_by
    LEFT JOIN accounts m ON m.id = p.paid_from_id
"""


def payouts(conn: psycopg.Connection, *, month: date | None = None, status: str | None = None) -> list[dict]:
    return conn.execute(
        f"""{PAYOUT_SELECT} WHERE (%(m)s::date IS NULL OR p.month = %(m)s::date) AND (%(s)s::text IS NULL OR p.status = %(s)s)
            ORDER BY p.month DESC, p.prepared_at DESC LIMIT 300""",
        {"m": acc.month_start(month) if month else None, "s": status},
    ).fetchall()


def payout(conn: psycopg.Connection, payout_id) -> dict:
    row = conn.execute(f"{PAYOUT_SELECT} WHERE p.id = %s", (payout_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    return row


def prepare_payout(conn: psycopg.Connection, ctx: Ctx, body) -> dict:
    month = acc.month_start(body.month)
    if month >= acc.month_start(clinic_time.today()):
        raise AppError(409, "month_not_ended", fields={"month": "month_not_ended"})
    st = statement(conn, body.doctor_id, month)
    if st["existing"]:
        raise AppError(409, "payout_exists", ref=st["existing"]["ref"])
    if st["shares"] <= 0:
        raise AppError(409, "nothing_to_pay")
    if st["net"] < 0:
        raise AppError(409, "net_negative", net=str(st["net"]))
    details = {"by_service": [{**x, "share": str(x["share"])} for x in st["by_service"]],
               "labs": [{"ref": x["ref"], "lab": x["lab_name"], "cost": str(x["lab_cost"]), "pct": str(x["doctor_share_pct"]),
                         "deduction": str(x["deduction"])} for x in st["labs"]],
               "invoices": len([x for x in st["lines"] if x["source_type"] == "invoice"]),
               "voided": len([x for x in st["lines"] if x["source_type"] == "invoice_void"])}
    row = conn.execute(
        """INSERT INTO doctor_payouts (doctor_id, month, shares, lab_deduction, net, details, note, prepared_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (body.doctor_id, month, st["shares"], st["lab_deduction"], st["net"], Jsonb(details), _clean(body.note), ctx.user_id),
    ).fetchone()
    audit.record(conn, "accounting.payout_prepared", ctx=ctx, entity="doctor_payout", entity_id=row["id"], details={
        "ref": row["ref"], "doctor": st["doctor"]["full_name_en"] or st["doctor"]["full_name_ar"], "month": str(month),
        "shares": str(st["shares"]), "lab_deduction": str(st["lab_deduction"]), "net": str(st["net"])})
    return row


def decide_payout(conn: psycopg.Connection, ctx: Ctx, payout_id, approve: bool, note: str | None) -> dict:
    row = conn.execute("SELECT * FROM doctor_payouts WHERE id = %s FOR UPDATE", (payout_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    if row["status"] != "prepared":
        raise AppError(409, "payout_not_pending")
    note = _clean(note)
    if not approve and (not note or len(note) < 5):
        raise field_error("note", "required")
    if approve:
        # the figures may have moved since it was prepared (a late void): approve only what still holds
        st = statement(conn, row["doctor_id"], row["month"])
        if st["shares"] != D(row["shares"]) or st["lab_deduction"] != D(row["lab_deduction"]):
            raise AppError(409, "payout_changed", shares=str(st["shares"]), lab_deduction=str(st["lab_deduction"]))
    status = "approved" if approve else "rejected"
    conn.execute("UPDATE doctor_payouts SET status = %s, decided_by = %s, decided_at = now(), decision_note = %s WHERE id = %s",
                 (status, ctx.user_id, note, payout_id))
    audit.record(conn, f"accounting.payout_{status}", ctx=ctx, entity="doctor_payout", entity_id=payout_id,
                 details={"ref": row["ref"], "net": str(row["net"]), "note": note})
    return {"id": payout_id, "status": status}


def pay_payout(conn: psycopg.Connection, ctx: Ctx, payout_id, body) -> dict:
    row = conn.execute("SELECT * FROM doctor_payouts WHERE id = %s FOR UPDATE", (payout_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    if row["status"] != "approved":
        raise AppError(409, "payout_not_approved")
    acc.check_date(conn, body.paid_on, "paid_on")
    if body.paid_on < acc.next_month(row["month"]):
        raise field_error("paid_on", "before_month_end")
    src = acc.money_account(conn, body.paid_from_id, "paid_from_id", allow_drawer=False, allow_clearing=False)
    k = acc.keys(conn)
    net, shares, ded = D(row["net"]), D(row["shares"]), D(row["lab_deduction"])
    if net > balance_of(conn, src["id"], body.paid_on):
        raise AppError(409, "insufficient_balance", fields={"paid_from_id": "insufficient_balance"})
    conn.execute(
        """UPDATE doctor_payouts SET status = 'paid', paid_by = %s, paid_at = now(), paid_on = %s, paid_from_id = %s, reference = %s
           WHERE id = %s""",
        (ctx.user_id, body.paid_on, src["id"], _clean(body.reference), payout_id),
    )
    doctor = row["doctor_id"]
    acc.post(conn, day=body.paid_on, memo=f"Doctor payout {row['ref']} for {row['month']:%Y-%m}", source_type="payout", source_id=row["id"],
             source_ref=row["ref"], ctx=ctx,
             lines=[L(k["doctors_payable"], shares, doctor_id=doctor), L(src["id"], -net), L(k["lab_costs"], -ded, doctor_id=doctor)])
    audit.record(conn, "accounting.payout_paid", ctx=ctx, entity="doctor_payout", entity_id=payout_id,
                 details={"ref": row["ref"], "net": str(net), "paid_from": src["name_en"], "paid_on": str(body.paid_on)})
    return {"id": payout_id, "status": "paid"}


# ---------- labs ----------

def labs(conn: psycopg.Connection) -> list[dict]:
    return conn.execute(
        """SELECT l.id, l.name, l.phone, l.is_active,
                  COALESCE(c.cost, 0) AS received, COALESCE(c.cases, 0) AS cases, COALESCE(p.paid, 0) AS paid,
                  COALESCE(c.cost, 0) - COALESCE(p.paid, 0) AS balance, p.last_paid_on
           FROM dental_labs l
           LEFT JOIN (SELECT lab_id, sum(lab_cost) AS cost, count(*) AS cases FROM lab_cases
                      WHERE returned_at IS NOT NULL AND status <> 'cancelled' AND COALESCE(lab_cost, 0) > 0 GROUP BY lab_id) c ON c.lab_id = l.id
           LEFT JOIN (SELECT lab_id, sum(amount) AS paid, max(paid_on) AS last_paid_on FROM lab_payments GROUP BY lab_id) p ON p.lab_id = l.id
           ORDER BY COALESCE(c.cost, 0) - COALESCE(p.paid, 0) DESC, l.name"""
    ).fetchall()


def lab_payments(conn: psycopg.Connection) -> list[dict]:
    return conn.execute(
        """SELECT p.*, l.name AS lab_name, m.name_ar AS paid_from_ar, m.name_en AS paid_from_en,
                  (SELECT e.id FROM journal_entries e WHERE e.source_type = 'lab_payment' AND e.source_id = p.id::text) AS entry_id
           FROM lab_payments p JOIN dental_labs l ON l.id = p.lab_id JOIN accounts m ON m.id = p.paid_from_id
           ORDER BY p.paid_on DESC, p.created_at DESC LIMIT 200"""
    ).fetchall()


def pay_lab(conn: psycopg.Connection, ctx: Ctx, body) -> dict:
    acc.check_date(conn, body.paid_on, "paid_on")
    lab = next((x for x in labs(conn) if x["id"] == body.lab_id), None)
    if not lab:
        raise field_error("lab_id", "invalid")
    amount = q(body.amount)
    if amount > D(lab["balance"]):
        raise AppError(409, "more_than_owed", fields={"amount": "more_than_owed"}, balance=str(lab["balance"]))
    src = acc.money_account(conn, body.paid_from_id, "paid_from_id", allow_drawer=False, allow_clearing=False)
    row = conn.execute(
        """INSERT INTO lab_payments (lab_id, paid_on, amount, paid_from_id, reference, note, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (body.lab_id, body.paid_on, amount, src["id"], _clean(body.reference), _clean(body.note), ctx.user_id),
    ).fetchone()
    k = acc.keys(conn)
    acc.post(conn, day=body.paid_on, memo=f"Payment to {lab['name']}", source_type="lab_payment", source_id=row["id"], source_ref=row["ref"],
             ctx=ctx, lines=[L(k["labs_payable"], amount), L(src["id"], -amount)])
    audit.record(conn, "accounting.lab_paid", ctx=ctx, entity="lab_payment", entity_id=row["id"],
                 details={"ref": row["ref"], "lab": lab["name"], "amount": str(amount), "paid_from": src["name_en"]})
    return row
