"""Accounting reports, all read from the journal (or, for patient balances, from the billing records the journal mirrors):
overview, profit & loss, trial balance, general ledger, daily cash, income analysis, receivables aging, patient credit, VAT."""
from datetime import date, timedelta
from decimal import Decimal

import psycopg

from app.core import accounting as acc
from app.core import clinic_time
from app.core.accounting import ZERO
from app.core.errors import AppError, field_error

D = Decimal
MAX_DAYS = 800


def _range(date_from: date | None, date_to: date | None) -> tuple[date, date]:
    today = clinic_time.today()
    date_to = date_to or today
    date_from = date_from or date_to.replace(day=1)
    if date_from > date_to:
        raise field_error("date_from", "after_to")
    if (date_to - date_from).days > MAX_DAYS:
        raise field_error("date_from", "range_too_long")
    return date_from, date_to


def _signed(type_: str, debit, credit) -> Decimal:
    return D(debit) - D(credit) if type_ in acc.NORMAL_DEBIT else D(credit) - D(debit)


# ---------- overview ----------

def overview(conn: psycopg.Connection) -> dict:
    today = clinic_time.today()
    month = acc.month_start(today)
    balances = acc.accounts(conn)
    money = [a for a in balances if a["is_money"] and (a["is_active"] or a["balance"])]
    by_key = {a["system_key"]: a for a in balances if a["system_key"]}
    series = []
    m = month
    for _ in range(6):
        series.append(m)
        m = acc.month_start(m - timedelta(days=1))
    series.reverse()
    figures = {r["m"]: r for r in conn.execute(
        """SELECT date_trunc('month', e.entry_date)::date AS m,
                  COALESCE(sum(l.credit - l.debit) FILTER (WHERE a.type = 'income'), 0) AS income,
                  COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.type = 'expense'), 0) AS expenses
           FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id JOIN accounts a ON a.id = l.account_id
           WHERE e.entry_date >= %s GROUP BY 1""",
        (series[0],),
    )}
    months = [{"month": m, "income": D(figures.get(m, {}).get("income", 0)), "expenses": D(figures.get(m, {}).get("expenses", 0))} for m in series]
    for x in months:
        x["net"] = x["income"] - x["expenses"]
    top_expenses = conn.execute(
        """SELECT a.id, a.code, a.name_ar, a.name_en, sum(l.debit - l.credit) AS amount
           FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
           WHERE a.type = 'expense' AND e.entry_date >= %s GROUP BY a.id HAVING sum(l.debit - l.credit) <> 0
           ORDER BY sum(l.debit - l.credit) DESC LIMIT 6""",
        (month,),
    ).fetchall()
    pending = {
        "close_requested": conn.execute("SELECT count(*) AS n FROM periods WHERE status = 'close_requested'").fetchone()["n"],
        "payouts_prepared": conn.execute("SELECT count(*) AS n FROM doctor_payouts WHERE status = 'prepared'").fetchone()["n"],
        "payouts_approved": conn.execute("SELECT count(*) AS n FROM doctor_payouts WHERE status = 'approved'").fetchone()["n"],
        "unsettled": conn.execute(
            """SELECT count(*) AS n FROM receipt_payments p WHERE p.method IN ('card', 'instapay', 'wallet')
               AND NOT EXISTS (SELECT 1 FROM settlement_items s WHERE s.receipt_payment_id = p.id)""").fetchone()["n"],
    }
    last = acc.last_closed(conn)
    return {
        "today": today,
        "money": money,
        "money_total": sum((D(a["balance"]) for a in money), ZERO),
        "owed": {k: by_key[k]["balance"] for k in ("receivables", "patient_credit", "deferred_packages", "doctors_payable", "labs_payable", "vat_payable")
                 if k in by_key},
        "this_month": months[-1],
        "months": months,
        "top_expenses": top_expenses,
        "pending": pending,
        "last_closed": last,
        "checks": reconciliation(conn),
    }


def reconciliation(conn: psycopg.Connection) -> list[dict]:
    """The control accounts must equal the patient records they summarise. A difference means something to look at."""
    k = acc.keys(conn)

    def bal(key: str, sign: int) -> Decimal:
        return sign * D(conn.execute("SELECT COALESCE(sum(debit - credit), 0) AS b FROM journal_lines WHERE account_id = %s",
                                     (k[key],)).fetchone()["b"])

    receivables = D(conn.execute("SELECT COALESCE(sum(total - paid_total), 0) AS b FROM invoices WHERE status = 'issued'").fetchone()["b"])
    credit = D(conn.execute("SELECT COALESCE(sum(amount), 0) AS b FROM patient_credit").fetchone()["b"])
    return [
        {"code": "receivables", "ledger": bal("receivables", 1), "records": receivables},
        {"code": "patient_credit", "ledger": bal("patient_credit", -1), "records": credit},
    ]


# ---------- statements ----------

def pnl(conn: psycopg.Connection, date_from: date | None, date_to: date | None) -> dict:
    date_from, date_to = _range(date_from, date_to)
    rows = conn.execute(
        """SELECT a.id, a.code, a.name_ar, a.name_en, a.type, COALESCE(sum(l.debit), 0) AS debit, COALESCE(sum(l.credit), 0) AS credit
           FROM accounts a JOIN journal_lines l ON l.account_id = a.id JOIN journal_entries e ON e.id = l.entry_id
           WHERE a.type IN ('income', 'expense') AND e.entry_date BETWEEN %s AND %s
           GROUP BY a.id ORDER BY a.code""",
        (date_from, date_to),
    ).fetchall()
    income = [{**r, "amount": _signed(r["type"], r["debit"], r["credit"])} for r in rows if r["type"] == "income"]
    expenses = [{**r, "amount": _signed(r["type"], r["debit"], r["credit"])} for r in rows if r["type"] == "expense"]
    total_income = sum((r["amount"] for r in income), ZERO)
    total_expenses = sum((r["amount"] for r in expenses), ZERO)
    return {"date_from": date_from, "date_to": date_to, "income": income, "expenses": expenses,
            "total_income": total_income, "total_expenses": total_expenses, "net": total_income - total_expenses}


def trial_balance(conn: psycopg.Connection, as_of: date | None) -> dict:
    as_of = as_of or clinic_time.today()
    rows = [r for r in acc.accounts(conn, as_of) if r["lines"]]
    for r in rows:
        diff = D(r["debit"]) - D(r["credit"])
        r["debit_balance"] = diff if diff > 0 else ZERO
        r["credit_balance"] = -diff if diff < 0 else ZERO
    return {"as_of": as_of, "items": rows,
            "debit": sum((r["debit_balance"] for r in rows), ZERO), "credit": sum((r["credit_balance"] for r in rows), ZERO)}


def ledger(conn: psycopg.Connection, account_id: int, date_from: date | None, date_to: date | None) -> dict:
    date_from, date_to = _range(date_from, date_to)
    a = acc.account(conn, account_id)
    opening_row = conn.execute(
        """SELECT COALESCE(sum(l.debit), 0) AS d, COALESCE(sum(l.credit), 0) AS c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
           WHERE l.account_id = %s AND e.entry_date < %s""",
        (account_id, date_from),
    ).fetchone()
    opening = _signed(a["type"], opening_row["d"], opening_row["c"])
    rows = conn.execute(
        """SELECT e.id AS entry_id, e.ref, e.entry_date, e.memo, e.source_type, e.source_ref, l.debit, l.credit, l.memo AS line_memo,
                  p.mrn, p.full_name_ar AS patient_name_ar, p.full_name_en AS patient_name_en,
                  d.full_name_ar AS doctor_name_ar, d.full_name_en AS doctor_name_en
           FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
           LEFT JOIN patients p ON p.id = l.patient_id LEFT JOIN users d ON d.id = l.doctor_id
           WHERE l.account_id = %s AND e.entry_date BETWEEN %s AND %s ORDER BY e.entry_date, e.id, l.id LIMIT 5001""",
        (account_id, date_from, date_to),
    ).fetchall()
    if len(rows) > 5000:
        raise AppError(422, "too_many_rows")
    running = opening
    for r in rows:
        running += _signed(a["type"], r["debit"], r["credit"])
        r["balance"] = running
    return {"account": a, "date_from": date_from, "date_to": date_to, "opening": opening, "closing": running, "items": rows,
            "debit": sum((D(r["debit"]) for r in rows), ZERO), "credit": sum((D(r["credit"]) for r in rows), ZERO)}


def daily_cash(conn: psycopg.Connection, day: date | None) -> dict:
    day = day or clinic_time.today()
    accounts = conn.execute(
        """SELECT a.id, a.code, a.name_ar, a.name_en, a.system_key,
                  COALESCE(sum(l.debit - l.credit) FILTER (WHERE e.entry_date < %(d)s), 0) AS opening,
                  COALESCE(sum(l.debit) FILTER (WHERE e.entry_date = %(d)s), 0) AS money_in,
                  COALESCE(sum(l.credit) FILTER (WHERE e.entry_date = %(d)s), 0) AS money_out
           FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id LEFT JOIN journal_entries e ON e.id = l.entry_id
           WHERE a.is_money GROUP BY a.id ORDER BY a.code""",
        {"d": day},
    ).fetchall()
    for a in accounts:
        a["closing"] = D(a["opening"]) + D(a["money_in"]) - D(a["money_out"])
    entries = conn.execute(
        """SELECT e.id AS entry_id, e.ref, e.memo, e.source_type, e.source_ref, a.code, a.name_ar, a.name_en, l.debit, l.credit
           FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
           WHERE a.is_money AND e.entry_date = %s ORDER BY e.id, l.id""",
        (day,),
    ).fetchall()
    shifts = conn.execute(
        """SELECT s.id, s.ref, s.status, s.opening_float, s.expected_cash, s.counted_cash, s.difference, s.opened_at, s.closed_at,
                  u.full_name_ar AS cashier_ar, u.full_name_en AS cashier_en
           FROM cash_shifts s JOIN users u ON u.id = s.cashier_id
           WHERE s.opened_at::date = %s OR s.closed_at::date = %s ORDER BY s.opened_at""",
        (day, day),
    ).fetchall()
    keep = [a for a in accounts if a["opening"] or a["money_in"] or a["money_out"]]
    return {"day": day, "accounts": keep, "entries": entries, "shifts": shifts,
            "money_in": sum((D(a["money_in"]) for a in keep), ZERO), "money_out": sum((D(a["money_out"]) for a in keep), ZERO),
            "opening": sum((D(a["opening"]) for a in keep), ZERO), "closing": sum((a["closing"] for a in keep), ZERO)}


# ---------- analysis ----------

DIMENSIONS = {
    "service": ("l.service_id", "LEFT JOIN services x ON x.id = g.key_id", "x.name_ar", "x.name_en"),
    "doctor": ("l.doctor_id", "LEFT JOIN users x ON x.id = g.key_id", "x.full_name_ar", "x.full_name_en"),
    "specialty": ("l.specialty_id", "LEFT JOIN specialties x ON x.id = g.key_id", "x.name_ar", "x.name_en"),
    "branch": ("COALESCE(l.branch_id, e.branch_id)", "LEFT JOIN branches x ON x.id = g.key_id", "x.name_ar", "x.name_en"),
}


def income(conn: psycopg.Connection, by: str, date_from: date | None, date_to: date | None) -> dict:
    if by not in DIMENSIONS:
        raise field_error("by", "invalid")
    date_from, date_to = _range(date_from, date_to)
    column, join, name_ar, name_en = DIMENSIONS[by]
    rows = conn.execute(
        f"""
        WITH g AS (
          SELECT {column} AS key_id,
                 COALESCE(sum(l.credit - l.debit) FILTER (WHERE a.system_key = 'service_income'), 0) AS services,
                 COALESCE(sum(l.credit - l.debit) FILTER (WHERE a.system_key = 'package_income'), 0) AS packages,
                 COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.system_key = 'doctor_fees'), 0) AS doctor_fees,
                 count(DISTINCT e.id) FILTER (WHERE e.source_type IN ('invoice', 'package_use')) AS entries
          FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
          WHERE a.system_key IN ('service_income', 'package_income', 'doctor_fees') AND e.entry_date BETWEEN %s AND %s
          GROUP BY 1
        )
        SELECT g.key_id::text AS key, {name_ar} AS name_ar, {name_en} AS name_en, g.services, g.packages, g.services + g.packages AS income,
               g.doctor_fees, g.services + g.packages - g.doctor_fees AS net, g.entries
        FROM g {join} ORDER BY g.services + g.packages DESC
        """,
        (date_from, date_to),
    ).fetchall()
    total = {k: sum((D(r[k]) for r in rows), ZERO) for k in ("services", "packages", "income", "doctor_fees", "net")}
    return {"by": by, "date_from": date_from, "date_to": date_to, "items": rows, "total": total}


def aging(conn: psycopg.Connection, as_of: date | None) -> dict:
    as_of = as_of or clinic_time.today()
    rows = conn.execute(
        """
        SELECT p.id AS patient_id, p.mrn, p.full_name_ar, p.full_name_en, p.phone, count(*) AS invoices,
               sum(i.total - i.paid_total) AS balance,
               sum(i.total - i.paid_total) FILTER (WHERE %(d)s::date - i.issued_at::date <= 30) AS b0,
               sum(i.total - i.paid_total) FILTER (WHERE %(d)s::date - i.issued_at::date BETWEEN 31 AND 60) AS b30,
               sum(i.total - i.paid_total) FILTER (WHERE %(d)s::date - i.issued_at::date BETWEEN 61 AND 90) AS b60,
               sum(i.total - i.paid_total) FILTER (WHERE %(d)s::date - i.issued_at::date > 90) AS b90,
               min(i.issued_at)::date AS oldest
        FROM invoices i JOIN patients p ON p.id = i.patient_id
        WHERE i.status = 'issued' AND i.total > i.paid_total AND i.issued_at::date <= %(d)s
        GROUP BY p.id ORDER BY sum(i.total - i.paid_total) DESC LIMIT 1000
        """,
        {"d": as_of},
    ).fetchall()
    for r in rows:
        for b in ("b0", "b30", "b60", "b90"):
            r[b] = r[b] or ZERO
    totals = {b: sum((D(r[b]) for r in rows), ZERO) for b in ("balance", "b0", "b30", "b60", "b90")}
    return {"as_of": as_of, "items": rows, "total": totals}


def credit(conn: psycopg.Connection) -> dict:
    rows = conn.execute(
        """SELECT p.id AS patient_id, p.mrn, p.full_name_ar, p.full_name_en, p.phone, sum(c.amount) AS balance, max(c.created_at) AS last_movement,
                  (SELECT count(*) FROM refunds f WHERE f.patient_id = p.id AND f.status IN ('requested', 'approved')) AS refunds_pending
           FROM patient_credit c JOIN patients p ON p.id = c.patient_id
           GROUP BY p.id HAVING sum(c.amount) > 0 ORDER BY sum(c.amount) DESC LIMIT 1000"""
    ).fetchall()
    return {"items": rows, "total": sum((D(r["balance"]) for r in rows), ZERO)}


def vat(conn: psycopg.Connection, date_from: date | None, date_to: date | None) -> dict:
    date_from, date_to = _range(date_from or clinic_time.today().replace(month=1, day=1), date_to)
    k = acc.keys(conn)
    base = {r["m"]: r for r in conn.execute(
        """
        SELECT m, sum(base) AS base, sum(n) AS lines FROM (
          SELECT date_trunc('month', i.issued_at)::date AS m, sum(l.line_total - l.vat_amount) AS base, count(*) AS n
          FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
          WHERE i.status IN ('issued', 'void') AND l.vat_amount > 0 AND i.issued_at::date BETWEEN %(f)s AND %(t)s GROUP BY 1
          UNION ALL
          SELECT date_trunc('month', i.voided_at)::date, -sum(l.line_total - l.vat_amount), -count(*)
          FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
          WHERE i.status = 'void' AND l.vat_amount > 0 AND i.voided_at::date BETWEEN %(f)s AND %(t)s GROUP BY 1
        ) x GROUP BY m
        """,
        {"f": date_from, "t": date_to},
    )}
    tax = {r["m"]: r["vat"] for r in conn.execute(
        """SELECT date_trunc('month', e.entry_date)::date AS m, sum(l.credit - l.debit) AS vat
           FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
           WHERE l.account_id = %s AND e.entry_date BETWEEN %s AND %s GROUP BY 1""",
        (k["vat_payable"], date_from, date_to),
    )}
    months = sorted(set(base) | set(tax), reverse=True)
    items = [{"month": m, "base": D(base[m]["base"]) if m in base else ZERO, "lines": base[m]["lines"] if m in base else 0,
              "vat": D(tax.get(m) or 0)} for m in months]
    return {"date_from": date_from, "date_to": date_to, "items": items,
            "base": sum((x["base"] for x in items), ZERO), "vat": sum((x["vat"] for x in items), ZERO)}
