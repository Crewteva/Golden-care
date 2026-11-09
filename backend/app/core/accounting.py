"""Accounting: the chart of accounts, the double-entry journal and month closing.

Every money event of the clinic ends up here as a balanced journal entry:
- automatically, from billing (invoices issued and voided, package sessions used, receipts, refunds, cash over / short
  at shift closing) and dental lab work received. `sync()` posts whatever isn't posted yet. It runs at startup (so
  older records are backfilled) and before every accounting page, and is safe to repeat: one entry per record and kind.
- from the accountant's own work: expenses, transfers, card / InstaPay settlements, doctor payouts, lab payments
  (accounting_ops) and manual entries (here).

Nothing is ever edited or deleted. A wrong manual entry is reversed; a wrong expense is voided (which reverses it).
A closed month accepts no entries: automatic postings that would fall in it are dated the first open day instead.

Analysis without extra accounts: every journal line can carry the branch, doctor, service, specialty and patient,
so income is reported by any of them while the chart stays short and generic."""
import logging
from datetime import date, timedelta
from decimal import Decimal

import psycopg

from app.core import audit, clinic_time
from app.core.billing import q
from app.core.errors import AppError, field_error
from app.core.session import Ctx

log = logging.getLogger(__name__)

D = Decimal
ZERO = D(0)
SYNC_LOCK = 727_010
METHOD_ACCOUNT = {"cash": "cash_drawer", "card": "card_clearing", "instapay": "instapay_clearing", "wallet": "wallet_clearing",
                  "credit": "patient_credit"}
CLEARING = ("card_clearing", "instapay_clearing", "wallet_clearing")
# Balances kept equal to the patient records (billing) and the stock / supplier records (inventory); never posted by hand.
CONTROLLED = ("receivables", "patient_credit", "deferred_packages", "inventory", "suppliers_payable")
NORMAL_DEBIT = ("asset", "expense")
SOURCE_GROUPS = {
    "billing": ("invoice", "invoice_void", "package_use", "package_use_void", "package_done", "package_cancel", "receipt",
                "credit_void", "refund", "shift"),
    "expenses": ("expense", "expense_void"),
    "money": ("transfer", "settlement"),
    "doctors": ("payout",),
    "labs": ("lab_case", "lab_payment"),
    "stock": ("stock_receipt", "stock_use", "stock_loss", "stock_count", "supplier_payment", "maintenance"),
    "manual": ("manual", "reversal"),
}


def month_start(day: date) -> date:
    return day.replace(day=1)


def next_month(month: date) -> date:
    return (month.replace(day=28) + timedelta(days=4)).replace(day=1)


def month_end(month: date) -> date:
    return next_month(month) - timedelta(days=1)


# ---------- accounts ----------

def keys(conn: psycopg.Connection) -> dict[str, int]:
    return {r["system_key"]: r["id"] for r in conn.execute("SELECT id, system_key FROM accounts WHERE system_key IS NOT NULL")}


def account(conn: psycopg.Connection, account_id, field: str = "account_id") -> dict:
    row = conn.execute("SELECT * FROM accounts WHERE id = %s", (account_id,)).fetchone()
    if not row:
        raise field_error(field, "invalid")
    return row


def money_account(conn: psycopg.Connection, account_id, field: str, *, allow_drawer: bool = True, allow_clearing: bool = True) -> dict:
    row = account(conn, account_id, field)
    if not row["is_money"] or not row["is_active"]:
        raise field_error(field, "not_money")
    if (not allow_drawer and row["system_key"] == "cash_drawer") or (not allow_clearing and row["system_key"] in CLEARING):
        raise field_error(field, "not_allowed")
    return row


def accounts(conn: psycopg.Connection, as_of: date | None = None) -> list[dict]:
    return conn.execute(
        """
        SELECT a.*, COALESCE(b.debit, 0) AS debit, COALESCE(b.credit, 0) AS credit,
               CASE WHEN a.type IN ('asset', 'expense') THEN COALESCE(b.debit, 0) - COALESCE(b.credit, 0)
                    ELSE COALESCE(b.credit, 0) - COALESCE(b.debit, 0) END AS balance,
               COALESCE(b.lines, 0) AS lines
        FROM accounts a
        LEFT JOIN (SELECT l.account_id, sum(l.debit) AS debit, sum(l.credit) AS credit, count(*) AS lines
                   FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
                   WHERE %(as_of)s::date IS NULL OR e.entry_date <= %(as_of)s::date
                   GROUP BY l.account_id) b ON b.account_id = a.id
        ORDER BY a.code
        """,
        {"as_of": as_of},
    ).fetchall()


def save_account(conn: psycopg.Connection, ctx: Ctx, body, account_id: int | None = None) -> dict:
    code = body.code.strip()
    name_ar, name_en = " ".join(body.name_ar.split()), " ".join(body.name_en.split())
    if len(name_ar) < 2:
        raise field_error("name_ar", "required")
    if len(name_en) < 2:
        raise field_error("name_en", "required")
    clash = conn.execute("SELECT id FROM accounts WHERE code = %s AND id IS DISTINCT FROM %s", (code, account_id)).fetchone()
    if clash:
        raise field_error("code", "taken")
    is_money = bool(body.is_money) and body.type == "asset"
    description = (body.description or "").strip() or None
    if account_id is None:
        row = conn.execute(
            """INSERT INTO accounts (code, name_ar, name_en, type, is_money, description) VALUES (%s, %s, %s, %s, %s, %s) RETURNING *""",
            (code, name_ar, name_en, body.type, is_money, description),
        ).fetchone()
        audit.record(conn, "accounting.account_added", ctx=ctx, entity="account", entity_id=row["id"],
                     details={"code": code, "name": name_en, "type": body.type})
        return row
    old = account(conn, account_id)
    used = conn.execute("SELECT 1 FROM journal_lines WHERE account_id = %s LIMIT 1", (account_id,)).fetchone() is not None
    if old["system_key"]:
        if body.type != old["type"] or not body.is_active or is_money != old["is_money"]:
            raise AppError(409, "system_account")
    elif used and (body.type != old["type"] or code != old["code"]):
        raise AppError(409, "account_in_use")
    row = conn.execute(
        """UPDATE accounts SET code = %s, name_ar = %s, name_en = %s, type = %s, is_money = %s, is_active = %s, description = %s,
                  updated_at = now() WHERE id = %s RETURNING *""",
        (code, name_ar, name_en, body.type, is_money, body.is_active, description, account_id),
    ).fetchone()
    audit.record(conn, "accounting.account_changed", ctx=ctx, entity="account", entity_id=account_id, details={
        "code": code, "before": {k: old[k] for k in ("code", "name_ar", "name_en", "type", "is_active")},
        "after": {"code": code, "name_ar": name_ar, "name_en": name_en, "type": body.type, "is_active": body.is_active}})
    return row


# ---------- periods ----------

def last_closed(conn: psycopg.Connection) -> date | None:
    return conn.execute("SELECT max(month) AS m FROM periods WHERE status = 'closed'").fetchone()["m"]


def first_open_day(conn: psycopg.Connection) -> date | None:
    closed = last_closed(conn)
    return next_month(closed) if closed else None


def ensure_open(conn: psycopg.Connection, day: date, field: str = "date") -> None:
    if conn.execute("SELECT 1 FROM periods WHERE month = %s AND status = 'closed'", (month_start(day),)).fetchone():
        raise AppError(409, "period_closed", fields={field: "period_closed"})
    closed = last_closed(conn)
    if closed and day < next_month(closed):
        raise AppError(409, "period_closed", fields={field: "period_closed"})


def check_date(conn: psycopg.Connection, day: date, field: str = "date") -> None:
    if day > clinic_time.today():
        raise field_error(field, "future")
    if day < clinic_time.today() - timedelta(days=800):
        raise field_error(field, "too_old")
    ensure_open(conn, day, field)


# ---------- posting ----------

def L(account_id: int, amount, **dims) -> dict:
    """A journal line: a positive amount is a debit, a negative one a credit."""
    return {"account_id": account_id, "amount": q(amount), **dims}


DIMS = ("memo", "branch_id", "doctor_id", "service_id", "specialty_id", "patient_id")


def post(conn: psycopg.Connection, *, day: date, memo: str, source_type: str, lines: list[dict], source_id=None, source_ref=None,
         branch_id=None, ctx: Ctx | None = None, reverses_id=None, auto: bool = False) -> dict | None:
    """Writes one balanced entry. `auto` postings move to the first open day when their date is in a closed month."""
    lines = [ln for ln in lines if ln["amount"] != 0]
    if not lines:
        return None
    debit = sum((ln["amount"] for ln in lines if ln["amount"] > 0), ZERO)
    credit = -sum((ln["amount"] for ln in lines if ln["amount"] < 0), ZERO)
    if debit != credit:
        raise AppError(422, "unbalanced", debit=str(debit), credit=str(credit))
    if auto:
        opens = first_open_day(conn)
        if opens and day < opens:
            day = opens
    else:
        ensure_open(conn, day)
    entry = conn.execute(
        """INSERT INTO journal_entries (entry_date, memo, source_type, source_id, source_ref, branch_id, amount, reverses_id, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (day, memo[:300], source_type, str(source_id) if source_id is not None else None, source_ref, branch_id, debit, reverses_id,
         ctx.user_id if ctx else None),
    ).fetchone()
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO journal_lines (entry_id, account_id, debit, credit, memo, branch_id, doctor_id, service_id, specialty_id, patient_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            [(entry["id"], ln["account_id"], max(ln["amount"], ZERO), max(-ln["amount"], ZERO),
              *(ln.get(k) if k != "branch_id" else ln.get(k, branch_id) for k in DIMS)) for ln in lines],
        )
    return entry


def reverse(conn: psycopg.Connection, entry: dict, *, day: date, memo: str, source_type: str, source_id=None, ctx: Ctx | None = None,
            auto: bool = False) -> dict | None:
    lines = conn.execute("SELECT * FROM journal_lines WHERE entry_id = %s ORDER BY id", (entry["id"],)).fetchall()
    return post(conn, day=day, memo=memo, source_type=source_type, source_id=source_id, source_ref=entry["source_ref"],
                branch_id=entry["branch_id"], ctx=ctx, reverses_id=entry["id"], auto=auto,
                lines=[L(ln["account_id"], D(ln["credit"]) - D(ln["debit"]), **{k: ln[k] for k in DIMS}) for ln in lines])


def _entry_for(conn: psycopg.Connection, source_type: str, source_id) -> dict | None:
    return conn.execute("SELECT * FROM journal_entries WHERE source_type = %s AND source_id = %s",
                        (source_type, str(source_id))).fetchone()


# ---------- automatic postings ----------

def _pending(source_type: str, column: str) -> str:
    return f"NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = '{source_type}' AND je.source_id = {column}::text)"


def session_value(pp: dict) -> Decimal:
    return q(D(pp["price_paid"]) / pp["sessions_total"])


def sync(conn: psycopg.Connection) -> int:
    """Posts every billing and lab record that has no entry yet. Returns how many entries were written."""
    conn.execute("SELECT pg_advisory_xact_lock(%s)", (SYNC_LOCK,))
    k = keys(conn)
    if not k:
        return 0
    steps = (_invoices, _invoice_voids, _package_uses, _package_use_voids, _package_done, _package_cancels, _receipts,
             _credit_voids, _refunds, _shifts, _lab_cases)
    count = sum(step(conn, k) for step in steps)
    if count:
        log.info("Accounting: %s entries posted from billing and labs", count)
    return count


def _invoices(conn: psycopg.Connection, k: dict) -> int:
    invoices = conn.execute(
        f"""SELECT i.id, i.ref, i.issued_at::date AS day, i.branch_id, i.patient_id FROM invoices i
            WHERE i.status IN ('issued', 'void') AND {_pending('invoice', 'i.id')} ORDER BY i.issued_at LIMIT 5000"""
    ).fetchall()
    if not invoices:
        return 0
    lines = {}
    for ln in conn.execute(
        """SELECT l.*, COALESCE(l.service_id, pk.service_id) AS svc, s.specialty_id
           FROM invoice_lines l LEFT JOIN packages pk ON pk.id = l.package_id
           LEFT JOIN services s ON s.id = COALESCE(l.service_id, pk.service_id)
           WHERE l.invoice_id = ANY(%s) ORDER BY l.position""",
        ([i["id"] for i in invoices],),
    ):
        lines.setdefault(ln["invoice_id"], []).append(ln)
    count = 0
    for inv in invoices:
        out, owed = [], ZERO
        for ln in lines.get(inv["id"], []):
            dims = {"service_id": ln["svc"], "specialty_id": ln["specialty_id"], "doctor_id": ln["doctor_id"], "patient_id": inv["patient_id"]}
            net = q(D(ln["line_total"]) - D(ln["vat_amount"]))
            vat = q(ln["vat_amount"])
            owed += net + vat
            income = k["deferred_packages"] if ln["kind"] == "package_sale" else k["service_income"]
            out.append(L(income, -net, memo=ln["name_en"], **dims))
            out.append(L(k["vat_payable"], -vat, memo=ln["name_en"], patient_id=inv["patient_id"]))
            share = q(ln["doctor_share"])
            if share and ln["doctor_id"]:
                out.append(L(k["doctor_fees"], share, memo=ln["name_en"], **dims))
                out.append(L(k["doctors_payable"], -share, memo=ln["name_en"], doctor_id=ln["doctor_id"], service_id=ln["svc"]))
        out.insert(0, L(k["receivables"], owed, patient_id=inv["patient_id"]))
        if post(conn, day=inv["day"], memo=f"Invoice {inv['ref']} issued", source_type="invoice", source_id=inv["id"],
                source_ref=inv["ref"], branch_id=inv["branch_id"], lines=out, auto=True):
            count += 1
    return count


def _invoice_voids(conn: psycopg.Connection, k: dict) -> int:
    rows = conn.execute(
        f"""SELECT i.id, i.ref, i.voided_at::date AS day, e.id AS entry_id FROM invoices i
            JOIN journal_entries e ON e.source_type = 'invoice' AND e.source_id = i.id::text
            WHERE i.status = 'void' AND {_pending('invoice_void', 'i.id')} ORDER BY i.voided_at"""
    ).fetchall()
    for r in rows:
        entry = conn.execute("SELECT * FROM journal_entries WHERE id = %s", (r["entry_id"],)).fetchone()
        reverse(conn, entry, day=r["day"], memo=f"Invoice {r['ref']} voided", source_type="invoice_void", source_id=r["id"], auto=True)
    return len(rows)


PP_USE_SELECT = """
    SELECT l.id, l.doctor_id, l.patient_package_id, i.ref, i.issued_at::date AS day, i.voided_at::date AS void_day, i.branch_id,
           i.patient_id, i.status, pp.price_paid, pp.sessions_total, pp.service_id, s.specialty_id, pp.ref AS pp_ref
    FROM invoice_lines l
    JOIN invoices i ON i.id = l.invoice_id
    JOIN patient_packages pp ON pp.id = l.patient_package_id
    JOIN services s ON s.id = pp.service_id
"""


def _package_uses(conn: psycopg.Connection, k: dict) -> int:
    rows = conn.execute(
        f"""{PP_USE_SELECT} WHERE l.kind = 'package_use' AND i.status IN ('issued', 'void') AND {_pending('package_use', 'l.id')}
            ORDER BY i.issued_at, l.id"""
    ).fetchall()
    for r in rows:
        dims = {"doctor_id": r["doctor_id"], "service_id": r["service_id"], "specialty_id": r["specialty_id"], "patient_id": r["patient_id"]}
        value = session_value(r)
        post(conn, day=r["day"], memo=f"Package {r['pp_ref']}: session used ({r['ref']})", source_type="package_use", source_id=r["id"],
             source_ref=r["ref"], branch_id=r["branch_id"], auto=True,
             lines=[L(k["deferred_packages"], value, patient_id=r["patient_id"]), L(k["package_income"], -value, **dims)])
    return len(rows)


def _package_use_voids(conn: psycopg.Connection, k: dict) -> int:
    rows = conn.execute(
        f"""SELECT l.id, i.ref, i.voided_at::date AS day, e.id AS entry_id FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
            JOIN journal_entries e ON e.source_type = 'package_use' AND e.source_id = l.id::text
            WHERE l.kind = 'package_use' AND i.status = 'void' AND {_pending('package_use_void', 'l.id')}"""
    ).fetchall()
    for r in rows:
        entry = conn.execute("SELECT * FROM journal_entries WHERE id = %s", (r["entry_id"],)).fetchone()
        reverse(conn, entry, day=r["day"], memo=f"Session given back: invoice {r['ref']} voided", source_type="package_use_void",
                source_id=r["id"], auto=True)
    return len(rows)


def _active_uses(conn: psycopg.Connection, pp_id) -> int:
    return conn.execute(
        """SELECT count(*) AS n FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
           WHERE l.patient_package_id = %s AND l.kind = 'package_use' AND i.status = 'issued'""", (pp_id,),
    ).fetchone()["n"]


def _package_done(conn: psycopg.Connection, k: dict) -> int:
    """When every session is used, the cents left by rounding the session value are recognised too."""
    rows = conn.execute(
        f"""SELECT pp.*, s.specialty_id, (SELECT max(i.issued_at)::date FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
                                        WHERE l.patient_package_id = pp.id AND l.kind = 'package_use' AND i.status = 'issued') AS day
            FROM patient_packages pp JOIN services s ON s.id = pp.service_id
            WHERE pp.status = 'active' AND {_pending('package_done', 'pp.id')}
              AND (SELECT count(*) FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
                   WHERE l.patient_package_id = pp.id AND l.kind = 'package_use' AND i.status = 'issued') >= pp.sessions_total"""
    ).fetchall()
    count = 0
    for pp in rows:
        rest = q(D(pp["price_paid"]) - session_value(pp) * pp["sessions_total"])
        if rest and post(conn, day=pp["day"], memo=f"Package {pp['ref']} fully used", source_type="package_done", source_id=pp["id"],
                         source_ref=pp["ref"], auto=True,
                         lines=[L(k["deferred_packages"], rest, patient_id=pp["patient_id"]),
                                L(k["package_income"], -rest, service_id=pp["service_id"], specialty_id=pp["specialty_id"],
                                  patient_id=pp["patient_id"])]):
            count += 1
    return count


def _package_cancels(conn: psycopg.Connection, k: dict) -> int:
    """A cancelled package: what's still unearned leaves 'unused sessions'; the refund goes to the patient's credit and the
    rest (the sessions charged at the single price) becomes income. Packages cancelled by voiding their sale are reversed
    with the invoice instead."""
    rows = conn.execute(
        f"""SELECT pp.*, s.specialty_id, pp.cancelled_at::date AS day, i.branch_id FROM patient_packages pp
            JOIN services s ON s.id = pp.service_id
            JOIN invoice_lines sl ON sl.id = pp.sale_line_id JOIN invoices i ON i.id = sl.invoice_id
            WHERE pp.status = 'cancelled' AND pp.refund_amount IS NOT NULL AND i.status = 'issued' AND {_pending('package_cancel', 'pp.id')}"""
    ).fetchall()
    count = 0
    for pp in rows:
        remaining = q(D(pp["price_paid"]) - session_value(pp) * _active_uses(conn, pp["id"]))
        refund = q(pp["refund_amount"])
        dims = {"service_id": pp["service_id"], "specialty_id": pp["specialty_id"], "patient_id": pp["patient_id"]}
        if post(conn, day=pp["day"], memo=f"Package {pp['ref']} cancelled", source_type="package_cancel", source_id=pp["id"],
                source_ref=pp["ref"], branch_id=pp["branch_id"], auto=True,
                lines=[L(k["deferred_packages"], remaining, patient_id=pp["patient_id"]),
                       L(k["patient_credit"], -refund, patient_id=pp["patient_id"]),
                       L(k["package_income"], -(remaining - refund), **dims)]):
            count += 1
    return count


def _receipts(conn: psycopg.Connection, k: dict) -> int:
    rows = conn.execute(
        f"""SELECT r.id, r.ref, r.created_at::date AS day, r.branch_id, r.patient_id, r.applied, r.to_credit, i.ref AS invoice_ref,
                   COALESCE((SELECT json_agg(json_build_object('method', p.method, 'amount', p.amount) ORDER BY p.id)
                             FROM receipt_payments p WHERE p.receipt_id = r.id), '[]') AS payments
            FROM receipts r LEFT JOIN invoices i ON i.id = r.invoice_id
            WHERE {_pending('receipt', 'r.id')} ORDER BY r.created_at LIMIT 5000"""
    ).fetchall()
    for r in rows:
        p = r["patient_id"]
        out = [L(k[METHOD_ACCOUNT[x["method"]]], D(str(x["amount"])), patient_id=p if x["method"] == "credit" else None) for x in r["payments"]]
        out += [L(k["receivables"], -D(r["applied"]), patient_id=p), L(k["patient_credit"], -D(r["to_credit"]), patient_id=p)]
        memo = f"Receipt {r['ref']}" + (f" for {r['invoice_ref']}" if r["invoice_ref"] else " (deposit to credit)")
        post(conn, day=r["day"], memo=memo, source_type="receipt", source_id=r["id"], source_ref=r["ref"], branch_id=r["branch_id"],
             lines=out, auto=True)
    return len(rows)


def _credit_voids(conn: psycopg.Connection, k: dict) -> int:
    """Money paid on an invoice that was later voided now belongs to the patient's credit."""
    rows = conn.execute(
        f"""SELECT c.id, c.amount, c.patient_id, c.created_at::date AS day, i.ref, i.branch_id FROM patient_credit c
            JOIN invoices i ON i.id = c.invoice_id
            WHERE c.reason = 'void' AND {_pending('credit_void', 'c.id')}"""
    ).fetchall()
    for r in rows:
        post(conn, day=r["day"], memo=f"Paid on voided {r['ref']} kept as credit", source_type="credit_void", source_id=r["id"],
             source_ref=r["ref"], branch_id=r["branch_id"], auto=True,
             lines=[L(k["receivables"], D(r["amount"]), patient_id=r["patient_id"]), L(k["patient_credit"], -D(r["amount"]), patient_id=r["patient_id"])])
    return len(rows)


def _refunds(conn: psycopg.Connection, k: dict) -> int:
    rows = conn.execute(
        f"""SELECT f.*, f.paid_at::date AS day, sh.branch_id FROM refunds f LEFT JOIN cash_shifts sh ON sh.id = f.shift_id
            WHERE f.status = 'paid' AND {_pending('refund', 'f.id')}"""
    ).fetchall()
    for r in rows:
        post(conn, day=r["day"], memo=f"Refund {r['ref']} paid ({r['method']})", source_type="refund", source_id=r["id"], source_ref=r["ref"],
             branch_id=r["branch_id"], auto=True,
             lines=[L(k["patient_credit"], D(r["amount"]), patient_id=r["patient_id"]), L(k[METHOD_ACCOUNT[r["method"]]], -D(r["amount"]))])
    return len(rows)


def _shifts(conn: psycopg.Connection, k: dict) -> int:
    rows = conn.execute(
        f"""SELECT s.id, s.ref, s.branch_id, s.difference, s.difference_reason, s.closed_at::date AS day FROM cash_shifts s
            WHERE s.status = 'closed' AND s.difference IS NOT NULL AND s.difference <> 0 AND {_pending('shift', 's.id')}"""
    ).fetchall()
    for r in rows:
        diff = D(r["difference"])
        lines = ([L(k["cash_drawer"], diff), L(k["cash_over"], -diff)] if diff > 0
                 else [L(k["cash_short"], -diff), L(k["cash_drawer"], diff)])
        post(conn, day=r["day"], memo=f"Shift {r['ref']}: cash {'over' if diff > 0 else 'short'} — {r['difference_reason'] or ''}"[:300],
             source_type="shift", source_id=r["id"], source_ref=r["ref"], branch_id=r["branch_id"], lines=lines, auto=True)
    return len(rows)


def _lab_cases(conn: psycopg.Connection, k: dict) -> int:
    rows = conn.execute(
        f"""SELECT c.id, c.ref, c.lab_cost, c.doctor_id, c.patient_id, c.returned_at::date AS day, l.name FROM lab_cases c
            JOIN dental_labs l ON l.id = c.lab_id
            WHERE c.returned_at IS NOT NULL AND c.status <> 'cancelled' AND COALESCE(c.lab_cost, 0) > 0 AND {_pending('lab_case', 'c.id')}"""
    ).fetchall()
    for r in rows:
        post(conn, day=r["day"], memo=f"Lab work {r['ref']} received from {r['name']}", source_type="lab_case", source_id=r["id"],
             source_ref=r["ref"], auto=True,
             lines=[L(k["lab_costs"], D(r["lab_cost"]), doctor_id=r["doctor_id"], patient_id=r["patient_id"]), L(k["labs_payable"], -D(r["lab_cost"]))])
    return len(rows)


# ---------- the journal ----------

ENTRY_SELECT = """
    SELECT e.*, u.full_name_ar AS created_by_ar, u.full_name_en AS created_by_en, b.name_ar AS branch_name_ar, b.name_en AS branch_name_en,
           rv.ref AS reverses_ref, rb.id AS reversed_by_id, rb.ref AS reversed_by_ref
    FROM journal_entries e
    LEFT JOIN users u ON u.id = e.created_by
    LEFT JOIN branches b ON b.id = e.branch_id
    LEFT JOIN journal_entries rv ON rv.id = e.reverses_id
    LEFT JOIN journal_entries rb ON rb.reverses_id = e.id
"""
PAGE = 50


def journal(conn: psycopg.Connection, *, q_text=None, group=None, date_from=None, date_to=None, account_id=None, page: int = 1) -> dict:
    where, params = [], {}
    if q_text:
        where.append("(e.ref ILIKE %(q)s OR e.source_ref ILIKE %(q)s OR e.memo ILIKE %(q)s)")
        params["q"] = f"%{q_text.strip()}%"
    if group in SOURCE_GROUPS:
        where.append("e.source_type = ANY(%(types)s)")
        params["types"] = list(SOURCE_GROUPS[group])
    if date_from:
        where.append("e.entry_date >= %(from)s")
        params["from"] = date_from
    if date_to:
        where.append("e.entry_date <= %(to)s")
        params["to"] = date_to
    if account_id:
        where.append("EXISTS (SELECT 1 FROM journal_lines x WHERE x.entry_id = e.id AND x.account_id = %(acc)s)")
        params["acc"] = account_id
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    total = conn.execute(f"SELECT count(*) AS n, COALESCE(sum(e.amount), 0) AS amount FROM journal_entries e {clause}", params).fetchone()
    rows = conn.execute(
        f"""{ENTRY_SELECT} {clause} ORDER BY e.entry_date DESC, e.id DESC LIMIT {PAGE} OFFSET %(offset)s""",
        {**params, "offset": (page - 1) * PAGE},
    ).fetchall()
    if rows:
        accs = {}
        for r in conn.execute(
            """SELECT l.entry_id, a.code, a.name_ar, a.name_en, sum(l.debit) AS debit, sum(l.credit) AS credit
               FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ANY(%s)
               GROUP BY l.entry_id, a.code, a.name_ar, a.name_en ORDER BY l.entry_id, sum(l.credit), a.code""",
            ([r["id"] for r in rows],),
        ):
            accs.setdefault(r["entry_id"], []).append(r)
        for r in rows:
            r["accounts"] = accs.get(r["id"], [])
    return {"items": rows, "total": total["n"], "amount": total["amount"], "page": page, "page_size": PAGE}


def entry(conn: psycopg.Connection, entry_id: int) -> dict:
    row = conn.execute(f"{ENTRY_SELECT} WHERE e.id = %s", (entry_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    row["lines"] = conn.execute(
        """SELECT l.*, a.code, a.name_ar, a.name_en, a.type, d.full_name_ar AS doctor_name_ar, d.full_name_en AS doctor_name_en,
                  s.name_ar AS service_name_ar, s.name_en AS service_name_en, sp.name_ar AS specialty_name_ar, sp.name_en AS specialty_name_en,
                  p.mrn, p.full_name_ar AS patient_name_ar, p.full_name_en AS patient_name_en
           FROM journal_lines l JOIN accounts a ON a.id = l.account_id
           LEFT JOIN users d ON d.id = l.doctor_id LEFT JOIN services s ON s.id = l.service_id
           LEFT JOIN specialties sp ON sp.id = l.specialty_id LEFT JOIN patients p ON p.id = l.patient_id
           WHERE l.entry_id = %s ORDER BY l.id""",
        (entry_id,),
    ).fetchall()
    row["link"] = _source_link(conn, row)
    return row


def _source_link(conn: psycopg.Connection, e: dict) -> dict | None:
    """Where the record behind an entry can be opened in the app."""
    t, sid = e["source_type"], e["source_id"]
    if not sid:
        return None
    if t in ("invoice", "invoice_void"):
        return {"kind": "invoice", "id": sid}
    if t == "receipt":
        return {"kind": "receipt", "id": sid}
    if t == "shift":
        return {"kind": "shift", "id": sid}
    if t in ("package_use", "package_use_void"):
        row = conn.execute("SELECT invoice_id FROM invoice_lines WHERE id = %s", (int(sid),)).fetchone()
        return {"kind": "invoice", "id": str(row["invoice_id"])} if row else None
    if t == "credit_void":
        row = conn.execute("SELECT invoice_id FROM patient_credit WHERE id = %s", (int(sid),)).fetchone()
        return {"kind": "invoice", "id": str(row["invoice_id"])} if row else None
    if t in ("package_cancel", "package_done", "refund"):
        table = "patient_packages" if t != "refund" else "refunds"
        row = conn.execute(f"SELECT patient_id FROM {table} WHERE id = %s", (sid,)).fetchone()
        return {"kind": "patient", "id": str(row["patient_id"])} if row else None
    if t in ("expense", "expense_void"):
        return {"kind": "expense", "id": sid}
    if t == "payout":
        return {"kind": "payout", "id": sid}
    if t == "stock_receipt":
        row = conn.execute("SELECT po_id, supplier_id FROM goods_receipts WHERE id = %s", (sid,)).fetchone()
        if row:
            return {"kind": "order", "id": str(row["po_id"])} if row["po_id"] else {"kind": "supplier", "id": str(row["supplier_id"])}
    if t == "supplier_payment":
        row = conn.execute("SELECT supplier_id FROM supplier_payments WHERE id = %s", (sid,)).fetchone()
        return {"kind": "supplier", "id": str(row["supplier_id"])} if row else None
    if t == "stock_count":
        return {"kind": "count", "id": sid}
    if t in ("stock_use", "stock_loss"):
        return {"kind": "stock_moves", "id": sid}
    if t == "maintenance":
        row = conn.execute("SELECT device_id FROM device_maintenance WHERE id = %s", (sid,)).fetchone()
        return {"kind": "device", "id": str(row["device_id"])} if row else None
    return None


def manual_entry(conn: psycopg.Connection, ctx: Ctx, body) -> dict:
    check_date(conn, body.entry_date, "entry_date")
    memo = " ".join(body.memo.split())
    if len(memo) < 5:
        raise field_error("memo", "too_short")
    lines = []
    for n, ln in enumerate(body.lines):
        debit, credit = q(ln.debit), q(ln.credit)
        if (debit > 0) == (credit > 0):
            raise field_error(f"lines.{n}", "one_side")
        acc = account(conn, ln.account_id, f"lines.{n}")
        if not acc["is_active"]:
            raise field_error(f"lines.{n}", "inactive")
        if acc["system_key"] in CONTROLLED:
            raise field_error(f"lines.{n}", "controlled")
        lines.append(L(acc["id"], debit - credit, memo=(ln.memo or "").strip() or None, branch_id=ctx.active_branch_id))
    debit = sum((x["amount"] for x in lines if x["amount"] > 0), ZERO)
    if debit != -sum((x["amount"] for x in lines if x["amount"] < 0), ZERO):
        raise AppError(422, "unbalanced")
    row = post(conn, day=body.entry_date, memo=memo, source_type="manual", lines=lines, ctx=ctx, branch_id=ctx.active_branch_id)
    audit.record(conn, "accounting.entry_posted", ctx=ctx, entity="journal_entry", entity_id=row["id"],
                 details={"ref": row["ref"], "date": str(body.entry_date), "amount": str(row["amount"]), "memo": memo})
    return row


def reverse_manual(conn: psycopg.Connection, ctx: Ctx, entry_id: int, body) -> dict:
    row = conn.execute("SELECT * FROM journal_entries WHERE id = %s FOR UPDATE", (entry_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    if row["source_type"] != "manual":
        raise AppError(409, "not_manual")
    if conn.execute("SELECT 1 FROM journal_entries WHERE reverses_id = %s", (entry_id,)).fetchone():
        raise AppError(409, "already_reversed")
    day = body.entry_date or clinic_time.today()
    check_date(conn, day, "entry_date")
    if day < row["entry_date"]:
        raise field_error("entry_date", "before_original")
    reason = body.reason.strip()
    new = reverse(conn, row, day=day, memo=f"Reversal of {row['ref']}: {reason}", source_type="reversal", source_id=row["id"], ctx=ctx)
    audit.record(conn, "accounting.entry_reversed", ctx=ctx, entity="journal_entry", entity_id=entry_id,
                 details={"ref": row["ref"], "reversal": new["ref"], "reason": reason})
    return new


# ---------- month closing ----------

def periods(conn: psycopg.Connection) -> dict:
    today = clinic_time.today()
    first = conn.execute("SELECT min(entry_date) AS d FROM journal_entries").fetchone()["d"] or today
    stored = {r["month"]: r for r in conn.execute(
        """SELECT p.*, rq.full_name_ar AS requested_by_ar, rq.full_name_en AS requested_by_en,
                  dc.full_name_ar AS decided_by_ar, dc.full_name_en AS decided_by_en
           FROM periods p LEFT JOIN users rq ON rq.id = p.requested_by LEFT JOIN users dc ON dc.id = p.decided_by""")}
    figures = {r["m"]: r for r in conn.execute(
        """SELECT date_trunc('month', e.entry_date)::date AS m, count(DISTINCT e.id) AS entries,
                  COALESCE(sum(l.credit - l.debit) FILTER (WHERE a.type = 'income'), 0) AS income,
                  COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.type = 'expense'), 0) AS expenses
           FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id JOIN accounts a ON a.id = l.account_id
           GROUP BY 1""")}
    months, m = [], month_start(min(first, today))
    while m <= month_start(today):
        p = stored.get(m) or {"month": m, "status": "open"}
        f = figures.get(m) or {"entries": 0, "income": 0, "expenses": 0}
        months.append({**p, "entries": f["entries"], "income": f["income"], "expenses": f["expenses"],
                       "net": D(f["income"]) - D(f["expenses"]), "ended": m < month_start(today),
                       "checks": close_checks(conn, m) if p["status"] != "closed" and m < month_start(today) else []})
        m = next_month(m)
    months.reverse()
    return {"months": months, "last_closed": last_closed(conn), "year_start_month": _year_start(conn)}


def _year_start(conn: psycopg.Connection) -> int:
    row = conn.execute("SELECT value FROM app_settings WHERE key = 'accounting.year_start_month'").fetchone()
    try:
        return int(row["value"]) if row else 1
    except (TypeError, ValueError):
        return 1


def close_checks(conn: psycopg.Connection, month: date) -> list[dict]:
    """What to look at before a month is closed. 'block' stops the close; 'warn' is shown to the accountant and management."""
    end = month_end(month)
    out = []
    shifts = conn.execute("SELECT count(*) AS n FROM cash_shifts WHERE status = 'open' AND opened_at::date <= %s", (end,)).fetchone()["n"]
    if shifts:
        out.append({"code": "open_shifts", "level": "block", "count": shifts})
    earlier = conn.execute(
        """SELECT min(date_trunc('month', e.entry_date)::date) AS m FROM journal_entries e
           WHERE e.entry_date < %s AND NOT EXISTS (SELECT 1 FROM periods p WHERE p.month = date_trunc('month', e.entry_date)::date AND p.status = 'closed')""",
        (month,),
    ).fetchone()["m"]
    if earlier:
        out.append({"code": "earlier_open", "level": "block", "month": earlier})
    drafts = conn.execute(
        "SELECT count(*) AS n FROM invoices WHERE status IN ('draft', 'pending_approval') AND created_at::date <= %s", (end,),
    ).fetchone()["n"]
    if drafts:
        out.append({"code": "draft_invoices", "level": "warn", "count": drafts})
    unsettled = conn.execute(
        """SELECT count(*) AS n, COALESCE(sum(p.amount), 0) AS amount FROM receipt_payments p JOIN receipts r ON r.id = p.receipt_id
           WHERE p.method IN ('card', 'instapay', 'wallet') AND r.created_at::date <= %s
             AND NOT EXISTS (SELECT 1 FROM settlement_items si WHERE si.receipt_payment_id = p.id)""",
        (end,),
    ).fetchone()
    if unsettled["n"]:
        out.append({"code": "unsettled", "level": "warn", "count": unsettled["n"], "amount": unsettled["amount"]})
    payouts = conn.execute(
        """SELECT count(*) AS n FROM (
             SELECT l.doctor_id FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
             WHERE l.account_id = (SELECT id FROM accounts WHERE system_key = 'doctors_payable') AND l.doctor_id IS NOT NULL
               AND e.source_type IN ('invoice', 'invoice_void') AND e.entry_date BETWEEN %(m)s AND %(end)s
             GROUP BY l.doctor_id HAVING sum(l.credit - l.debit) > 0) d
           WHERE NOT EXISTS (SELECT 1 FROM doctor_payouts dp WHERE dp.doctor_id = d.doctor_id AND dp.month = %(m)s AND dp.status <> 'rejected')""",
        {"m": month, "end": end},
    ).fetchone()["n"]
    if payouts:
        out.append({"code": "payouts_missing", "level": "warn", "count": payouts})
    return out


def _period_row(conn: psycopg.Connection, month: date) -> dict:
    conn.execute("INSERT INTO periods (month) VALUES (%s) ON CONFLICT DO NOTHING", (month,))
    return conn.execute("SELECT * FROM periods WHERE month = %s FOR UPDATE", (month,)).fetchone()


def request_close(conn: psycopg.Connection, ctx: Ctx, month: date, note: str | None) -> dict:
    month = month_start(month)
    if month >= month_start(clinic_time.today()):
        raise AppError(409, "month_not_ended")
    row = _period_row(conn, month)
    if row["status"] != "open":
        raise AppError(409, "period_not_open")
    blocks = [c for c in close_checks(conn, month) if c["level"] == "block"]
    if blocks:
        raise AppError(409, "close_blocked", checks=blocks)
    note = (note or "").strip() or None
    conn.execute(
        """UPDATE periods SET status = 'close_requested', requested_by = %s, requested_at = now(), request_note = %s,
                  decided_by = NULL, decided_at = NULL, decision_note = NULL, updated_at = now() WHERE month = %s""",
        (ctx.user_id, note, month),
    )
    audit.record(conn, "accounting.close_requested", ctx=ctx, entity="period", entity_id=str(month), details={"month": str(month), "note": note})
    return {"month": month, "status": "close_requested"}


def decide_close(conn: psycopg.Connection, ctx: Ctx, month: date, approve: bool, note: str | None) -> dict:
    month = month_start(month)
    row = _period_row(conn, month)
    if row["status"] != "close_requested":
        raise AppError(409, "period_not_requested")
    note = (note or "").strip() or None
    if approve:
        blocks = [c for c in close_checks(conn, month) if c["level"] == "block"]
        if blocks:
            raise AppError(409, "close_blocked", checks=blocks)
    elif not note or len(note) < 5:
        raise field_error("note", "required")
    status = "closed" if approve else "open"
    conn.execute("UPDATE periods SET status = %s, decided_by = %s, decided_at = now(), decision_note = %s, updated_at = now() WHERE month = %s",
                 (status, ctx.user_id, note, month))
    audit.record(conn, "accounting.month_closed" if approve else "accounting.close_rejected", ctx=ctx, entity="period",
                 entity_id=str(month), details={"month": str(month), "note": note})
    return {"month": month, "status": status}


def reopen(conn: psycopg.Connection, ctx: Ctx, month: date, reason: str) -> dict:
    month = month_start(month)
    if month != last_closed(conn):
        raise AppError(409, "reopen_latest_only")
    conn.execute("UPDATE periods SET status = 'open', decided_by = %s, decided_at = now(), decision_note = %s, updated_at = now() WHERE month = %s",
                 (ctx.user_id, reason.strip(), month))
    audit.record(conn, "accounting.month_reopened", ctx=ctx, entity="period", entity_id=str(month),
                 details={"month": str(month), "reason": reason.strip()})
    return {"month": month, "status": "open"}
