"""Purchasing: purchase orders (every order is approved by someone other than who raised it; above the limit only
management can approve), the supplier's bill matched to what was received, two-person payments to suppliers, the
supplier statement and payables aging.

What the clinic owes a supplier = goods received + maintenance done on credit − approved returns − payments. A bill
doesn't post anything: it groups receipts (and maintenance) under the supplier's invoice number and gives them a due
date from the payment terms. A payment is prepared by one person and approved by another; approving posts Suppliers
payable / Bank or petty cash."""
from datetime import date, timedelta
from decimal import Decimal

import psycopg

from app.core import accounting as acc
from app.core import audit, clinic_time
from app.core.accounting import L, ZERO
from app.core.billing import q
from app.core.errors import AppError, field_error
from app.core.inventory import _item, _store, approval_limit, clean
from app.core.session import Ctx

D = Decimal

PO_SELECT = """
    SELECT o.*, s.name AS supplier, st.name_ar AS store_ar, st.name_en AS store_en,
           cu.full_name_ar AS created_by_ar, cu.full_name_en AS created_by_en,
           du.full_name_ar AS decided_by_ar, du.full_name_en AS decided_by_en,
           (o.approval_limit <= 0 OR o.total > o.approval_limit) AS needs_management,
           (SELECT count(*) FROM purchase_order_lines l WHERE l.po_id = o.id) AS line_count,
           (SELECT COALESCE(sum(l.received_qty * l.unit_cost), 0) FROM purchase_order_lines l WHERE l.po_id = o.id) AS received_value
    FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id JOIN stores st ON st.id = o.store_id
    LEFT JOIN users cu ON cu.id = o.created_by LEFT JOIN users du ON du.id = o.decided_by
"""


# ---------- purchase orders ----------

def orders(conn: psycopg.Connection, *, status=None, supplier_id=None, q_text=None) -> list[dict]:
    where, params = [], {}
    if status == "open":
        where.append("o.status IN ('pending_approval', 'approved', 'partial')")
    elif status:
        where.append("o.status = %(status)s")
        params["status"] = status
    if supplier_id:
        where.append("o.supplier_id = %(supplier)s")
        params["supplier"] = supplier_id
    if q_text:
        where.append("(o.ref ILIKE %(q)s OR s.name ILIKE %(q)s OR o.note ILIKE %(q)s)")
        params["q"] = f"%{q_text.strip()}%"
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    return conn.execute(f"{PO_SELECT} {clause} ORDER BY o.ordered_on DESC, o.created_at DESC LIMIT 200", params).fetchall()


def lock_order(conn: psycopg.Connection, po_id) -> dict:
    row = conn.execute("SELECT * FROM purchase_orders WHERE id = %s FOR UPDATE", (po_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    return row


def order(conn: psycopg.Connection, po_id) -> dict:
    row = conn.execute(f"{PO_SELECT} WHERE o.id = %s", (po_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    lines = conn.execute(
        """SELECT l.*, i.name_ar, i.name_en, i.tracks_expiry, u.name_ar AS unit_ar, u.name_en AS unit_en,
                  l.qty - l.received_qty AS remaining, round(l.qty * l.unit_cost, 2) AS amount
           FROM purchase_order_lines l JOIN items i ON i.id = l.item_id JOIN units u ON u.id = i.unit_id
           WHERE l.po_id = %s ORDER BY l.position, l.id""",
        (po_id,),
    ).fetchall()
    receipts = conn.execute(
        """SELECT g.*, b.ref AS bill_ref, b.bill_no FROM goods_receipts g LEFT JOIN supplier_bills b ON b.id = g.bill_id
           WHERE g.po_id = %s ORDER BY g.received_on, g.created_at""", (po_id,)).fetchall()
    return {"order": row, "lines": lines, "receipts": receipts}


def refresh_status(conn: psycopg.Connection, po_id) -> None:
    left = conn.execute("SELECT COALESCE(sum(qty - received_qty), 0) AS n, COALESCE(sum(received_qty), 0) AS got "
                        "FROM purchase_order_lines WHERE po_id = %s", (po_id,)).fetchone()
    status = "received" if left["n"] <= 0 else ("partial" if left["got"] > 0 else "approved")
    conn.execute("UPDATE purchase_orders SET status = %s, updated_at = now() WHERE id = %s", (status, po_id))


def _check_lines(conn: psycopg.Connection, body) -> Decimal:
    seen = set()
    for i, ln in enumerate(body.lines):
        _item(conn, ln.item_id, f"lines.{i}.item_id")
        if ln.item_id in seen:
            raise field_error(f"lines.{i}.item_id", "duplicate")
        seen.add(ln.item_id)
    return q(sum((ln.qty * ln.unit_cost for ln in body.lines), ZERO))


def _write_lines(conn: psycopg.Connection, po_id, body) -> None:
    conn.execute("DELETE FROM purchase_order_lines WHERE po_id = %s", (po_id,))
    for position, ln in enumerate(body.lines):
        conn.execute("INSERT INTO purchase_order_lines (po_id, position, item_id, qty, unit_cost) VALUES (%s, %s, %s, %s, %s)",
                     (po_id, position, ln.item_id, ln.qty, ln.unit_cost))


def needs_management(total: Decimal, limit: Decimal) -> bool:
    """Above the approval limit (or always, when the limit is 0) only management may approve the order."""
    return limit <= 0 or total > limit


def save_order(conn: psycopg.Connection, ctx: Ctx, body, po_id=None) -> dict:
    """New or edited order. Every order waits for approval by someone else (management above the limit).
    An order can be edited only before anything was received; editing sends it back for approval."""
    supplier = conn.execute("SELECT * FROM suppliers WHERE id = %s", (body.supplier_id,)).fetchone()
    if not supplier or not supplier["is_active"]:
        raise field_error("supplier_id", "invalid")
    _store(conn, body.store_id)
    today = clinic_time.today()
    ordered_on = body.ordered_on or today
    if ordered_on > today:
        raise field_error("ordered_on", "future")
    if body.expected_on and body.expected_on < ordered_on:
        raise field_error("expected_on", "before_order")
    total = _check_lines(conn, body)
    if total <= 0:
        raise field_error("lines", "zero_total")
    limit = approval_limit(conn)
    status = "pending_approval"
    values = (body.supplier_id, body.store_id, status, ordered_on, body.expected_on, clean(body.note), total, limit)
    if po_id is None:
        row = conn.execute(
            """INSERT INTO purchase_orders (supplier_id, store_id, status, ordered_on, expected_on, note, total, approval_limit, created_by)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""", (*values, ctx.user_id)).fetchone()
    else:
        old = lock_order(conn, po_id)
        if old["status"] not in ("pending_approval", "approved") or conn.execute(
                "SELECT 1 FROM goods_receipts WHERE po_id = %s", (po_id,)).fetchone():
            raise AppError(409, "order_locked")
        row = conn.execute(
            """UPDATE purchase_orders SET supplier_id = %s, store_id = %s, status = %s, ordered_on = %s, expected_on = %s, note = %s,
                      total = %s, approval_limit = %s, decided_by = NULL, decided_at = NULL, decision_note = NULL, updated_at = now()
               WHERE id = %s RETURNING *""", (*values, po_id)).fetchone()
    _write_lines(conn, row["id"], body)
    audit.record(conn, "purchasing.order_saved", ctx=ctx, entity="purchase_order", entity_id=row["id"], details={
        "ref": row["ref"], "supplier": supplier["name"], "total": str(total), "status": status, "limit": str(limit), "new": po_id is None,
        "management_approval": needs_management(total, limit)})
    return row


def decide_order(conn: psycopg.Connection, ctx: Ctx, po_id, approve: bool, note: str | None) -> dict:
    row = lock_order(conn, po_id)
    if row["status"] != "pending_approval":
        raise AppError(409, "order_not_pending")
    if row["created_by"] == ctx.user_id:
        raise AppError(403, "same_person")
    if needs_management(D(row["total"]), D(row["approval_limit"])) and "inventory.approve" not in ctx.permissions:
        raise AppError(403, "above_limit", limit=str(row["approval_limit"]))
    note = clean(note)
    if not approve and (not note or len(note) < 5):
        raise field_error("note", "required")
    status = "approved" if approve else "rejected"
    conn.execute("""UPDATE purchase_orders SET status = %s, decided_by = %s, decided_at = now(), decision_note = %s, updated_at = now()
                    WHERE id = %s""", (status, ctx.user_id, note, po_id))
    audit.record(conn, f"purchasing.order_{status}", ctx=ctx, entity="purchase_order", entity_id=po_id,
                 details={"ref": row["ref"], "total": str(row["total"]), "note": note})
    return {"id": po_id, "status": status}


def cancel_order(conn: psycopg.Connection, ctx: Ctx, po_id, reason: str) -> dict:
    """Nothing received yet → cancelled. Partly received → closed: the rest won't come."""
    row = lock_order(conn, po_id)
    if row["status"] not in ("pending_approval", "approved", "partial"):
        raise AppError(409, "order_not_open")
    status = "received" if row["status"] == "partial" else "cancelled"
    conn.execute("UPDATE purchase_orders SET status = %s, cancel_reason = %s, updated_at = now() WHERE id = %s",
                 (status, reason.strip(), po_id))
    audit.record(conn, "purchasing.order_cancelled" if status == "cancelled" else "purchasing.order_closed", ctx=ctx,
                 entity="purchase_order", entity_id=po_id, details={"ref": row["ref"], "reason": reason.strip()})
    return {"id": po_id, "status": status}


# ---------- suppliers: balances, statement, bills, payments ----------

OWED_SQL = """
    (SELECT COALESCE(sum(g.total), 0) FROM goods_receipts g WHERE g.supplier_id = s.id)
  + (SELECT COALESCE(sum(m.cost), 0) FROM device_maintenance m WHERE m.supplier_id = s.id AND m.paid_from_id IS NULL)
  - (SELECT COALESCE(sum(r.amount), 0) FROM supplier_returns r WHERE r.supplier_id = s.id AND r.status = 'approved')
  - (SELECT COALESCE(sum(p.amount), 0) FROM supplier_payments p WHERE p.supplier_id = s.id)
"""


def suppliers(conn: psycopg.Connection) -> list[dict]:
    return conn.execute(
        f"""SELECT s.*, {OWED_SQL} AS balance,
                   (SELECT count(*) FROM purchase_orders o WHERE o.supplier_id = s.id AND o.status IN ('pending_approval', 'approved', 'partial'))
                     AS open_orders,
                   (SELECT max(g.received_on) FROM goods_receipts g WHERE g.supplier_id = s.id) AS last_received
            FROM suppliers s ORDER BY s.is_active DESC, lower(s.name)""").fetchall()


def balance(conn: psycopg.Connection, supplier_id: int) -> Decimal:
    return D(conn.execute(f"SELECT {OWED_SQL} AS b FROM suppliers s WHERE s.id = %s", (supplier_id,)).fetchone()["b"])


def _bills(conn: psycopg.Connection, supplier_id=None) -> list[dict]:
    return conn.execute(
        """SELECT b.*, s.name AS supplier,
                  b.amount - COALESCE((SELECT sum(p.amount) FROM supplier_payments p WHERE p.bill_id = b.id), 0) AS open
           FROM supplier_bills b JOIN suppliers s ON s.id = b.supplier_id
           WHERE %(s)s::int IS NULL OR b.supplier_id = %(s)s::int ORDER BY b.bill_date DESC, b.created_at DESC""",
        {"s": supplier_id},
    ).fetchall()


def _unbilled(conn: psycopg.Connection, supplier_id: int) -> dict:
    receipts = conn.execute(
        """SELECT g.id, g.ref, g.received_on AS day, g.total AS amount, g.delivery_note, o.ref AS po_ref FROM goods_receipts g
           LEFT JOIN purchase_orders o ON o.id = g.po_id
           WHERE g.supplier_id = %s AND g.bill_id IS NULL AND g.total > 0 ORDER BY g.received_on""", (supplier_id,)).fetchall()
    maintenance = conn.execute(
        """SELECT m.id, m.ref, m.done_on AS day, m.cost AS amount, d.name AS device FROM device_maintenance m JOIN devices d ON d.id = m.device_id
           WHERE m.supplier_id = %s AND m.paid_from_id IS NULL AND m.bill_id IS NULL AND m.cost > 0 ORDER BY m.done_on""",
        (supplier_id,)).fetchall()
    return {"receipts": receipts, "maintenance": maintenance}


def statement(conn: psycopg.Connection, supplier_id: int) -> dict:
    supplier = conn.execute("SELECT * FROM suppliers WHERE id = %s", (supplier_id,)).fetchone()
    if not supplier:
        raise AppError(404, "not_found")
    rows = conn.execute(
        """
        SELECT * FROM (
          SELECT 'receipt' AS kind, g.id::text AS id, g.ref, g.received_on AS day, g.created_at, g.total AS owed, 0 AS paid,
                 COALESCE(o.ref, '') AS detail, b.bill_no
          FROM goods_receipts g LEFT JOIN purchase_orders o ON o.id = g.po_id LEFT JOIN supplier_bills b ON b.id = g.bill_id
          WHERE g.supplier_id = %(s)s
          UNION ALL
          SELECT 'maintenance', m.id::text, m.ref, m.done_on, m.created_at, m.cost, 0, d.name, b.bill_no
          FROM device_maintenance m JOIN devices d ON d.id = m.device_id LEFT JOIN supplier_bills b ON b.id = m.bill_id
          WHERE m.supplier_id = %(s)s AND m.paid_from_id IS NULL AND m.cost > 0
          UNION ALL
          SELECT 'return', r.id::text, r.ref, r.returned_on, r.decided_at, 0, r.amount,
                 i.name_en || ' × ' || trim_scale(r.qty)::text || COALESCE(' · ' || l.lot_no, ''), NULL
          FROM supplier_returns r JOIN items i ON i.id = r.item_id JOIN stock_lots l ON l.id = r.lot_id
          WHERE r.supplier_id = %(s)s AND r.status = 'approved'
          UNION ALL
          SELECT 'payment', p.id::text, p.ref, p.paid_on, p.created_at, 0, p.amount, a.name_en || COALESCE(' · ' || p.reference, ''), b.bill_no
          FROM supplier_payments p JOIN accounts a ON a.id = p.paid_from_id LEFT JOIN supplier_bills b ON b.id = p.bill_id
          WHERE p.supplier_id = %(s)s
        ) x ORDER BY day, created_at
        """,
        {"s": supplier_id},
    ).fetchall()
    running = ZERO
    for r in rows:
        running += D(r["owed"]) - D(r["paid"])
        r["balance"] = running
    rows.reverse()
    return {"supplier": supplier, "rows": rows, "balance": running, "bills": _bills(conn, supplier_id), "unbilled": _unbilled(conn, supplier_id),
            "orders": orders(conn, supplier_id=supplier_id)[:20], "aging": aging_for(conn, supplier),
            "requests": payment_requests(conn, supplier_id=supplier_id, status="prepared")}


def add_bill(conn: psycopg.Connection, ctx: Ctx, body) -> dict:
    supplier = conn.execute("SELECT * FROM suppliers WHERE id = %s", (body.supplier_id,)).fetchone()
    if not supplier:
        raise field_error("supplier_id", "invalid")
    if body.bill_date > clinic_time.today():
        raise field_error("bill_date", "future")
    if not body.receipt_ids and not body.maintenance_ids:
        raise field_error("receipt_ids", "required")
    receipts = conn.execute("SELECT * FROM goods_receipts WHERE id = ANY(%s) FOR UPDATE", (body.receipt_ids,)).fetchall()
    jobs = conn.execute("SELECT * FROM device_maintenance WHERE id = ANY(%s) FOR UPDATE", (body.maintenance_ids,)).fetchall()
    if len(receipts) != len(set(body.receipt_ids)) or any(r["supplier_id"] != supplier["id"] or r["bill_id"] for r in receipts):
        raise field_error("receipt_ids", "invalid")
    if len(jobs) != len(set(body.maintenance_ids)) or any(
            j["supplier_id"] != supplier["id"] or j["bill_id"] or j["paid_from_id"] for j in jobs):
        raise field_error("maintenance_ids", "invalid")
    amount = q(sum((D(r["total"]) for r in receipts), ZERO) + sum((D(j["cost"]) for j in jobs), ZERO))
    if amount <= 0:
        raise field_error("receipt_ids", "zero_total")
    try:
        with conn.transaction():
            bill = conn.execute(
                """INSERT INTO supplier_bills (supplier_id, bill_no, bill_date, due_date, amount, note, created_by)
                   VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *""",
                (supplier["id"], body.bill_no.strip(), body.bill_date, body.bill_date + timedelta(days=supplier["payment_terms_days"]),
                 amount, clean(body.note), ctx.user_id),
            ).fetchone()
    except psycopg.errors.UniqueViolation:
        raise field_error("bill_no", "taken", 409) from None
    conn.execute("UPDATE goods_receipts SET bill_id = %s WHERE id = ANY(%s)", (bill["id"], body.receipt_ids))
    conn.execute("UPDATE device_maintenance SET bill_id = %s WHERE id = ANY(%s)", (bill["id"], body.maintenance_ids))
    audit.record(conn, "purchasing.bill_added", ctx=ctx, entity="supplier_bill", entity_id=bill["id"], details={
        "ref": bill["ref"], "supplier": supplier["name"], "bill_no": bill["bill_no"], "amount": str(amount),
        "receipts": [r["ref"] for r in receipts], "maintenance": [j["ref"] for j in jobs]})
    return bill


def _check_payment(conn: psycopg.Connection, body, skip_request=None) -> tuple[dict, dict, dict | None, Decimal]:
    """The supplier, the money account, the bill and the amount, checked against what's owed less the payments already
    waiting for approval (other than `skip_request`)."""
    supplier = conn.execute("SELECT * FROM suppliers WHERE id = %s FOR UPDATE", (body["supplier_id"],)).fetchone()
    if not supplier:
        raise field_error("supplier_id", "invalid")
    acc.check_date(conn, body["paid_on"], "paid_on")
    source = acc.money_account(conn, body["paid_from_id"], "paid_from_id", allow_drawer=False, allow_clearing=False)
    amount = q(body["amount"])
    waiting = conn.execute(
        """SELECT COALESCE(sum(amount), 0) AS total, COALESCE(sum(amount) FILTER (WHERE bill_id = %(b)s), 0) AS on_bill
           FROM supplier_payment_requests WHERE supplier_id = %(s)s AND status = 'prepared' AND id IS DISTINCT FROM %(skip)s""",
        {"s": supplier["id"], "b": body["bill_id"], "skip": skip_request}).fetchone()
    owed = balance(conn, supplier["id"]) - D(waiting["total"])
    if amount > owed:
        raise AppError(422, "validation", fields={"amount": "more_than_owed"}, owed=str(max(owed, ZERO)))
    bill = None
    if body["bill_id"]:
        bill = next((b for b in _bills(conn, supplier["id"]) if b["id"] == body["bill_id"]), None)
        if not bill:
            raise field_error("bill_id", "invalid")
        open_ = D(bill["open"]) - D(waiting["on_bill"])
        if amount > open_:
            raise AppError(422, "validation", fields={"amount": "more_than_bill"}, open=str(max(open_, ZERO)))
    return supplier, source, bill, amount


def prepare_payment(conn: psycopg.Connection, ctx: Ctx, body) -> dict:
    """Step 1 of 2: the payment is prepared; nothing is posted until someone else approves it."""
    data = body.model_dump()
    supplier, source, bill, amount = _check_payment(conn, data)
    row = conn.execute(
        """INSERT INTO supplier_payment_requests (supplier_id, bill_id, paid_on, amount, paid_from_id, reference, note, prepared_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (supplier["id"], data["bill_id"], data["paid_on"], amount, source["id"], clean(data["reference"]), clean(data["note"]), ctx.user_id),
    ).fetchone()
    audit.record(conn, "purchasing.payment_prepared", ctx=ctx, entity="supplier_payment_request", entity_id=row["id"], details={
        "ref": row["ref"], "supplier": supplier["name"], "amount": str(amount), "paid_from": source["name_en"],
        "bill": bill["bill_no"] if bill else None})
    return row


def decide_payment(conn: psycopg.Connection, ctx: Ctx, request_id, approve: bool, note: str | None) -> dict:
    """Step 2 of 2, by a different person: approving writes the payment and posts it; rejecting needs a reason."""
    r = conn.execute("SELECT * FROM supplier_payment_requests WHERE id = %s FOR UPDATE", (request_id,)).fetchone()
    if not r:
        raise AppError(404, "not_found")
    if r["status"] != "prepared":
        raise AppError(409, "payment_not_pending")
    if r["prepared_by"] == ctx.user_id:
        raise AppError(403, "same_person")
    note = clean(note)
    if not approve:
        if not note or len(note) < 5:
            raise field_error("note", "required")
        conn.execute("""UPDATE supplier_payment_requests SET status = 'rejected', decided_by = %s, decided_at = now(), decision_note = %s
                        WHERE id = %s""", (ctx.user_id, note, request_id))
        audit.record(conn, "purchasing.payment_rejected", ctx=ctx, entity="supplier_payment_request", entity_id=r["id"],
                     details={"ref": r["ref"], "amount": str(r["amount"]), "note": note})
        return {"id": r["id"], "status": "rejected"}
    supplier, source, bill, amount = _check_payment(conn, r, skip_request=r["id"])
    row = conn.execute(
        """INSERT INTO supplier_payments (supplier_id, bill_id, paid_on, amount, paid_from_id, reference, note, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (supplier["id"], r["bill_id"], r["paid_on"], amount, source["id"], r["reference"], r["note"], r["prepared_by"]),
    ).fetchone()
    k = acc.keys(conn)
    memo = f"Payment to {supplier['name']}" + (f" (bill {bill['bill_no']})" if bill else "") + f" — {r['ref']}"
    acc.post(conn, day=r["paid_on"], memo=memo, source_type="supplier_payment", source_id=row["id"], source_ref=row["ref"],
             branch_id=ctx.active_branch_id, ctx=ctx, lines=[L(k["suppliers_payable"], amount, memo=supplier["name"]), L(source["id"], -amount)])
    conn.execute("""UPDATE supplier_payment_requests SET status = 'approved', decided_by = %s, decided_at = now(), decision_note = %s,
                           payment_id = %s WHERE id = %s""", (ctx.user_id, note, row["id"], request_id))
    audit.record(conn, "purchasing.supplier_paid", ctx=ctx, entity="supplier_payment", entity_id=row["id"], details={
        "ref": row["ref"], "request": r["ref"], "supplier": supplier["name"], "amount": str(amount), "paid_from": source["name_en"],
        "bill": bill["bill_no"] if bill else None})
    return {"id": r["id"], "status": "approved", "payment": row}


def payment_requests(conn: psycopg.Connection, *, status=None, supplier_id=None) -> list[dict]:
    return conn.execute(
        """SELECT r.*, s.name AS supplier, a.name_ar AS paid_from_ar, a.name_en AS paid_from_en, b.bill_no, p.ref AS payment_ref,
                  pu.full_name_ar AS prepared_by_ar, pu.full_name_en AS prepared_by_en,
                  du.full_name_ar AS decided_by_ar, du.full_name_en AS decided_by_en
           FROM supplier_payment_requests r JOIN suppliers s ON s.id = r.supplier_id JOIN accounts a ON a.id = r.paid_from_id
           LEFT JOIN supplier_bills b ON b.id = r.bill_id LEFT JOIN supplier_payments p ON p.id = r.payment_id
           LEFT JOIN users pu ON pu.id = r.prepared_by LEFT JOIN users du ON du.id = r.decided_by
           WHERE (%(st)s::text IS NULL OR r.status = %(st)s::text) AND (%(sp)s::int IS NULL OR r.supplier_id = %(sp)s::int)
           ORDER BY (r.status = 'prepared') DESC, r.prepared_at DESC LIMIT 100""",
        {"st": status, "sp": supplier_id},
    ).fetchall()


def payments(conn: psycopg.Connection, limit: int = 50) -> list[dict]:
    return conn.execute(
        """SELECT p.*, s.name AS supplier, a.name_ar AS paid_from_ar, a.name_en AS paid_from_en, b.bill_no
           FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id JOIN accounts a ON a.id = p.paid_from_id
           LEFT JOIN supplier_bills b ON b.id = p.bill_id ORDER BY p.paid_on DESC, p.created_at DESC LIMIT %s""", (limit,)).fetchall()


# ---------- aging ----------

BUCKETS = ("current", "d1_30", "d31_60", "d61_90", "d90_plus")


def _bucket(days_late: int) -> str:
    if days_late <= 0:
        return "current"
    if days_late <= 30:
        return "d1_30"
    if days_late <= 60:
        return "d31_60"
    if days_late <= 90:
        return "d61_90"
    return "d90_plus"


def aging_for(conn: psycopg.Connection, supplier: dict, today: date | None = None) -> dict:
    """What's owed by due date. Payments made against a bill settle that bill; other payments and approved returns settle
    the oldest first. Goods not billed yet fall due `payment terms` days after they arrived."""
    today = today or clinic_time.today()
    terms = timedelta(days=supplier["payment_terms_days"])
    debts = [{"due": b["due_date"], "amount": D(b["open"]), "ref": b["bill_no"]} for b in _bills(conn, supplier["id"])]
    unbilled = _unbilled(conn, supplier["id"])
    debts += [{"due": r["day"] + terms, "amount": D(r["amount"]), "ref": r["ref"]} for r in unbilled["receipts"] + unbilled["maintenance"]]
    free = D(conn.execute("SELECT COALESCE(sum(amount), 0) AS n FROM supplier_payments WHERE supplier_id = %s AND bill_id IS NULL",
                          (supplier["id"],)).fetchone()["n"])
    free += D(conn.execute("SELECT COALESCE(sum(amount), 0) AS n FROM supplier_returns WHERE supplier_id = %s AND status = 'approved'",
                           (supplier["id"],)).fetchone()["n"])
    out = dict.fromkeys(BUCKETS, ZERO)
    oldest = None
    for d in sorted(debts, key=lambda x: x["due"]):
        part = min(free, max(d["amount"], ZERO))
        free -= part
        left = d["amount"] - part
        if left > 0:
            out[_bucket((today - d["due"]).days)] += left
            oldest = oldest or d["due"]
    out = {k: q(v) for k, v in out.items()}
    return {**out, "total": q(sum(out.values(), ZERO)), "oldest_due": oldest}


def aging(conn: psycopg.Connection) -> dict:
    rows = []
    for s in conn.execute("SELECT * FROM suppliers ORDER BY lower(name)").fetchall():
        a = aging_for(conn, s)
        if a["total"] > 0:
            rows.append({"id": s["id"], "name": s["name"], "payment_terms_days": s["payment_terms_days"], **a})
    totals = {k: q(sum((r[k] for r in rows), ZERO)) for k in (*BUCKETS, "total")}
    due_soon = conn.execute(
        """SELECT b.*, s.name AS supplier, b.amount - COALESCE((SELECT sum(p.amount) FROM supplier_payments p WHERE p.bill_id = b.id), 0) AS open
           FROM supplier_bills b JOIN suppliers s ON s.id = b.supplier_id
           WHERE b.due_date <= %s ORDER BY b.due_date""", (clinic_time.today() + timedelta(days=14),)).fetchall()
    return {"rows": rows, "totals": totals, "due_soon": [b for b in due_soon if b["open"] > 0], "bills": _bills(conn),
            "payments": payments(conn), "requests": payment_requests(conn), "today": clinic_time.today()}
