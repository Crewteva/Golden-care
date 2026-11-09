"""Moving stock between stores (and branches) and returning a batch to its supplier.

Transfers: requested → dispatched → received (or cancelled before dispatch).
  dispatch   Stock in transit / Inventory        what left the sending store, lot by lot (earliest expiry first)
  receive    Inventory (+ Stock losses for any shortage) / Stock in transit
The lots keep their number, expiry, cost and supplier receipt in the receiving store, so they can still be returned.

Returns to suppliers: one lot per return, requested by the stock keeper and approved by someone else. Approving takes
the quantity out of that exact lot and posts Suppliers payable / Inventory at the lot's cost: what's owed goes down."""
from decimal import Decimal

import psycopg

from app.core import accounting as acc
from app.core import audit, clinic_time
from app.core.accounting import L, ZERO
from app.core.billing import q
from app.core.errors import AppError, field_error
from app.core.inventory import _item, _move, _store, clean, take
from app.core.session import Ctx

D = Decimal

TRANSFER_SELECT = """
    SELECT t.*, f.name_ar AS from_ar, f.name_en AS from_en, f.branch_id AS from_branch_id,
           s.name_ar AS to_ar, s.name_en AS to_en, s.branch_id AS to_branch_id,
           ru.full_name_ar AS requested_by_ar, ru.full_name_en AS requested_by_en,
           du.full_name_ar AS dispatched_by_ar, du.full_name_en AS dispatched_by_en,
           cu.full_name_ar AS received_by_ar, cu.full_name_en AS received_by_en,
           (SELECT count(*) FROM stock_transfer_lines x WHERE x.transfer_id = t.id) AS line_count
    FROM stock_transfers t JOIN stores f ON f.id = t.from_store_id JOIN stores s ON s.id = t.to_store_id
    LEFT JOIN users ru ON ru.id = t.requested_by LEFT JOIN users du ON du.id = t.dispatched_by LEFT JOIN users cu ON cu.id = t.received_by
"""


# ---------- transfers ----------

def transfers(conn: psycopg.Connection, *, status=None, store_id=None) -> list[dict]:
    where, params = [], {}
    if status == "open":
        where.append("t.status IN ('requested', 'dispatched')")
    elif status:
        where.append("t.status = %(status)s")
        params["status"] = status
    if store_id:
        where.append("(t.from_store_id = %(store)s OR t.to_store_id = %(store)s)")
        params["store"] = store_id
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    return conn.execute(f"{TRANSFER_SELECT} {clause} ORDER BY (t.status IN ('requested', 'dispatched')) DESC, t.requested_at DESC LIMIT 200",
                        params).fetchall()


def _lock(conn: psycopg.Connection, transfer_id) -> dict:
    row = conn.execute("SELECT * FROM stock_transfers WHERE id = %s FOR UPDATE", (transfer_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    return row


def transfer(conn: psycopg.Connection, transfer_id) -> dict:
    row = conn.execute(f"{TRANSFER_SELECT} WHERE t.id = %s", (transfer_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    lines = conn.execute(
        """SELECT x.*, i.name_ar, i.name_en, u.name_ar AS unit_ar, u.name_en AS unit_en,
                  COALESCE((SELECT sum(o.qty_sent) FROM stock_transfer_lots o WHERE o.transfer_id = x.transfer_id AND o.item_id = x.item_id), 0) AS sent,
                  (SELECT sum(o.qty_received) FROM stock_transfer_lots o WHERE o.transfer_id = x.transfer_id AND o.item_id = x.item_id) AS received,
                  COALESCE((SELECT sum(l.qty_on_hand) FROM stock_lots l WHERE l.store_id = %(from)s AND l.item_id = x.item_id
                              AND l.qty_on_hand > 0 AND (l.expiry IS NULL OR l.expiry >= %(today)s)), 0) AS available
           FROM stock_transfer_lines x JOIN items i ON i.id = x.item_id JOIN units u ON u.id = i.unit_id
           WHERE x.transfer_id = %(id)s ORDER BY lower(i.name_en)""",
        {"id": transfer_id, "from": row["from_store_id"], "today": clinic_time.today()},
    ).fetchall()
    lots = conn.execute(
        """SELECT o.*, i.name_ar, i.name_en, u.name_ar AS unit_ar, u.name_en AS unit_en, round(o.qty_sent * o.unit_cost, 2) AS value
           FROM stock_transfer_lots o JOIN items i ON i.id = o.item_id JOIN units u ON u.id = i.unit_id
           WHERE o.transfer_id = %s ORDER BY lower(i.name_en), o.expiry NULLS LAST, o.id""", (transfer_id,)).fetchall()
    return {"transfer": row, "lines": lines, "lots": lots}


def request_transfer(conn: psycopg.Connection, ctx: Ctx, body) -> dict:
    src = _store(conn, body.from_store_id, "from_store_id")
    dst = _store(conn, body.to_store_id, "to_store_id")
    if src["id"] == dst["id"]:
        raise field_error("to_store_id", "same_store")
    seen = set()
    for i, ln in enumerate(body.lines):
        _item(conn, ln.item_id, f"lines.{i}.item_id")
        if ln.item_id in seen:
            raise field_error(f"lines.{i}.item_id", "duplicate")
        seen.add(ln.item_id)
    row = conn.execute(
        "INSERT INTO stock_transfers (from_store_id, to_store_id, note, requested_by) VALUES (%s, %s, %s, %s) RETURNING *",
        (src["id"], dst["id"], clean(body.note), ctx.user_id),
    ).fetchone()
    for ln in body.lines:
        conn.execute("INSERT INTO stock_transfer_lines (transfer_id, item_id, qty) VALUES (%s, %s, %s)", (row["id"], ln.item_id, ln.qty))
    audit.record(conn, "inventory.transfer_requested", ctx=ctx, entity="stock_transfer", entity_id=row["id"], details={
        "ref": row["ref"], "from": src["name_en"], "to": dst["name_en"], "lines": len(body.lines)})
    return row


def dispatch_transfer(conn: psycopg.Connection, ctx: Ctx, transfer_id, body) -> dict:
    """The sending store packs it: each line leaves earliest-expiry first (usable lots only). A line may be sent short of
    what was asked, or not at all (0), when there isn't enough."""
    t = _lock(conn, transfer_id)
    if t["status"] != "requested":
        raise AppError(409, "transfer_not_requested", transfer_status=t["status"])
    day = body.dispatched_on or clinic_time.today()
    acc.check_date(conn, day, "dispatched_on")
    src = _store(conn, t["from_store_id"], "from_store_id")
    lines = conn.execute("SELECT * FROM stock_transfer_lines WHERE transfer_id = %s ORDER BY id", (transfer_id,)).fetchall()
    sending = {ln.item_id: ln.qty for ln in body.lines}
    doc = {"id": t["id"], "ref": t["ref"]}
    total, sent_any, names = ZERO, False, []
    for i, ln in enumerate(lines):
        qty = D(sending.get(ln["item_id"], ln["qty"]))
        if qty > D(ln["qty"]):
            raise AppError(422, "validation", fields={f"lines.{i}.qty": "more_than_requested"}, requested=str(ln["qty"]))
        if qty <= 0:
            continue
        item = conn.execute("SELECT * FROM items WHERE id = %s", (ln["item_id"],)).fetchone()
        parts = []
        total += take(conn, ctx, store_id=src["id"], item=item, qty=qty, day=day, kind="transfer_out", doc_type="transfer", doc=doc,
                      field=f"lines.{i}.qty", usable_only=True, parts=parts)
        for lot, part in parts:
            conn.execute(
                """INSERT INTO stock_transfer_lots (transfer_id, item_id, from_lot_id, lot_no, expiry, unit_cost, qty_sent)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                (t["id"], item["id"], lot["id"], lot["lot_no"], lot["expiry"], lot["unit_cost"], part))
        sent_any = True
        names.append(f"{item['name_en']} × {qty.normalize():f}")
    if not sent_any:
        raise AppError(422, "nothing_to_send")
    total = q(total)
    conn.execute("""UPDATE stock_transfers SET status = 'dispatched', dispatched_on = %s, dispatched_by = %s, dispatched_at = now(),
                           sent_value = %s WHERE id = %s""", (day, ctx.user_id, total, transfer_id))
    dst = conn.execute("SELECT * FROM stores WHERE id = %s", (t["to_store_id"],)).fetchone()
    k = acc.keys(conn)
    acc.post(conn, day=day, memo=f"Stock sent {src['name_en']} → {dst['name_en']}: " + ", ".join(names), source_type="stock_transfer",
             source_id=t["id"], source_ref=t["ref"], branch_id=src["branch_id"], ctx=ctx,
             lines=[L(k["stock_in_transit"], total), L(k["inventory"], -total)])
    audit.record(conn, "inventory.transfer_dispatched", ctx=ctx, entity="stock_transfer", entity_id=t["id"],
                 details={"ref": t["ref"], "items": names, "value": str(total)})
    return {"id": t["id"], "status": "dispatched", "sent_value": total}


def receive_transfer(conn: psycopg.Connection, ctx: Ctx, transfer_id, body) -> dict:
    """The receiving store checks what arrived, lot by lot. Anything missing is a shortage: it needs a note and is posted to
    Stock losses at cost."""
    t = _lock(conn, transfer_id)
    if t["status"] != "dispatched":
        raise AppError(409, "transfer_not_dispatched", transfer_status=t["status"])
    day = body.received_on or clinic_time.today()
    acc.check_date(conn, day, "received_on")
    if day < t["dispatched_on"]:
        raise field_error("received_on", "before_dispatch")
    dst = _store(conn, t["to_store_id"], "to_store_id")
    got = {ln.lot_id: ln.qty_received for ln in body.lots}
    doc = {"id": t["id"], "ref": t["ref"]}
    received, short_items = ZERO, []
    for i, sl in enumerate(conn.execute("SELECT * FROM stock_transfer_lots WHERE transfer_id = %s ORDER BY id FOR UPDATE", (transfer_id,)).fetchall()):
        qty = D(got.get(sl["id"], sl["qty_sent"]))
        if qty > D(sl["qty_sent"]):
            raise AppError(422, "validation", fields={f"lots.{i}.qty_received": "more_than_sent"}, sent=str(sl["qty_sent"]))
        to_lot = None
        if qty > 0:
            src_lot = conn.execute("SELECT receipt_id FROM stock_lots WHERE id = %s", (sl["from_lot_id"],)).fetchone()
            to_lot = conn.execute(
                """INSERT INTO stock_lots (store_id, item_id, receipt_id, lot_no, expiry, unit_cost, qty_in, qty_on_hand)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
                (dst["id"], sl["item_id"], src_lot["receipt_id"], sl["lot_no"], sl["expiry"], sl["unit_cost"], qty, qty)).fetchone()
            _move(conn, ctx, day=day, kind="transfer_in", lot=to_lot, qty=qty, doc_type="transfer", doc=doc)
            received += qty * D(sl["unit_cost"])
        missing = D(sl["qty_sent"]) - qty
        if missing > 0:
            item = conn.execute("SELECT name_en FROM items WHERE id = %s", (sl["item_id"],)).fetchone()
            short_items.append(f"{item['name_en']} × {missing.normalize():f}" + (f" (lot {sl['lot_no']})" if sl["lot_no"] else ""))
        conn.execute("UPDATE stock_transfer_lots SET qty_received = %s, to_lot_id = %s WHERE id = %s",
                     (qty, to_lot["id"] if to_lot else None, sl["id"]))
    received = q(received)
    shortage = q(D(t["sent_value"]) - received)
    note = clean(body.shortage_note)
    if shortage > 0 and (not note or len(note) < 5):
        raise field_error("shortage_note", "required")
    conn.execute("""UPDATE stock_transfers SET status = 'received', received_on = %s, received_by = %s, received_at = now(),
                           received_value = %s, shortage_value = %s, shortage_note = %s WHERE id = %s""",
                 (day, ctx.user_id, received, shortage, note if shortage > 0 else None, transfer_id))
    src = conn.execute("SELECT * FROM stores WHERE id = %s", (t["from_store_id"],)).fetchone()
    k = acc.keys(conn)
    memo = f"Stock received {src['name_en']} → {dst['name_en']}" + (f"; short: {', '.join(short_items)} ({note})" if short_items else "")
    acc.post(conn, day=day, memo=memo, source_type="stock_transfer", source_id=t["id"], source_ref=t["ref"], branch_id=dst["branch_id"], ctx=ctx,
             lines=[L(k["inventory"], received), L(k["stock_losses"], shortage, memo="Transfer shortage" if shortage else None),
                    L(k["stock_in_transit"], -D(t["sent_value"]))])
    audit.record(conn, "inventory.transfer_received", ctx=ctx, entity="stock_transfer", entity_id=t["id"], details={
        "ref": t["ref"], "received": str(received), "shortage": str(shortage), "short_items": short_items, "note": note})
    return {"id": t["id"], "status": "received", "received_value": received, "shortage_value": shortage}


def cancel_transfer(conn: psycopg.Connection, ctx: Ctx, transfer_id, reason: str) -> dict:
    t = _lock(conn, transfer_id)
    if t["status"] != "requested":
        raise AppError(409, "transfer_not_requested", transfer_status=t["status"])
    conn.execute("UPDATE stock_transfers SET status = 'cancelled', cancel_reason = %s WHERE id = %s", (clean(reason), transfer_id))
    audit.record(conn, "inventory.transfer_cancelled", ctx=ctx, entity="stock_transfer", entity_id=t["id"],
                 details={"ref": t["ref"], "reason": clean(reason)})
    return {"id": t["id"], "status": "cancelled"}


def in_transit_value(conn: psycopg.Connection) -> Decimal:
    return q(conn.execute("SELECT COALESCE(sum(sent_value), 0) AS v FROM stock_transfers WHERE status = 'dispatched'").fetchone()["v"])


# ---------- returns to suppliers ----------

RETURN_SELECT = """
    SELECT r.*, s.name AS supplier, i.name_ar AS item_ar, i.name_en AS item_en, u.name_ar AS unit_ar, u.name_en AS unit_en,
           st.name_ar AS store_ar, st.name_en AS store_en, l.lot_no, l.expiry, g.ref AS receipt_ref,
           cu.full_name_ar AS created_by_ar, cu.full_name_en AS created_by_en,
           du.full_name_ar AS decided_by_ar, du.full_name_en AS decided_by_en
    FROM supplier_returns r JOIN suppliers s ON s.id = r.supplier_id JOIN items i ON i.id = r.item_id JOIN units u ON u.id = i.unit_id
    JOIN stores st ON st.id = r.store_id JOIN stock_lots l ON l.id = r.lot_id LEFT JOIN goods_receipts g ON g.id = r.receipt_id
    LEFT JOIN users cu ON cu.id = r.created_by LEFT JOIN users du ON du.id = r.decided_by
"""


def returns(conn: psycopg.Connection, *, status=None, supplier_id=None) -> list[dict]:
    return conn.execute(
        f"""{RETURN_SELECT} WHERE (%(st)s::text IS NULL OR r.status = %(st)s::text) AND (%(sp)s::int IS NULL OR r.supplier_id = %(sp)s::int)
            ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT 200""",
        {"st": status, "sp": supplier_id},
    ).fetchall()


def returnable_lots(conn: psycopg.Connection, supplier_id=None) -> list[dict]:
    """Lots that came from a supplier and still have stock, less what's already waiting to be returned."""
    return conn.execute(
        """SELECT l.id, l.lot_no, l.expiry, l.unit_cost, l.store_id, l.item_id, g.supplier_id, s.name AS supplier, g.ref AS receipt_ref,
                  g.received_on, i.name_ar AS item_ar, i.name_en AS item_en, u.name_ar AS unit_ar, u.name_en AS unit_en,
                  st.name_ar AS store_ar, st.name_en AS store_en,
                  l.qty_on_hand - COALESCE((SELECT sum(r.qty) FROM supplier_returns r WHERE r.lot_id = l.id AND r.status = 'pending'), 0) AS available
           FROM stock_lots l JOIN goods_receipts g ON g.id = l.receipt_id JOIN suppliers s ON s.id = g.supplier_id
           JOIN items i ON i.id = l.item_id JOIN units u ON u.id = i.unit_id JOIN stores st ON st.id = l.store_id
           WHERE l.qty_on_hand > 0 AND (%(s)s::int IS NULL OR g.supplier_id = %(s)s::int)
           ORDER BY s.name, lower(i.name_en), l.expiry NULLS LAST, l.id""",
        {"s": supplier_id},
    ).fetchall()


def request_return(conn: psycopg.Connection, ctx: Ctx, body) -> dict:
    lot = conn.execute(
        """SELECT l.*, g.supplier_id, s.name AS supplier, i.name_en AS item FROM stock_lots l
           LEFT JOIN goods_receipts g ON g.id = l.receipt_id LEFT JOIN suppliers s ON s.id = g.supplier_id JOIN items i ON i.id = l.item_id
           WHERE l.id = %s FOR UPDATE OF l""", (body.lot_id,)).fetchone()
    if not lot or not lot["supplier_id"]:
        raise field_error("lot_id", "invalid")
    pending = D(conn.execute("SELECT COALESCE(sum(qty), 0) AS n FROM supplier_returns WHERE lot_id = %s AND status = 'pending'",
                             (lot["id"],)).fetchone()["n"])
    available = D(lot["qty_on_hand"]) - pending
    if body.qty > available:
        raise AppError(422, "validation", fields={"qty": "not_enough_stock"}, available=str(available))
    reason = clean(body.reason)
    if not reason or len(reason) < 5:
        raise field_error("reason", "required")
    amount = q(body.qty * D(lot["unit_cost"]))
    row = conn.execute(
        """INSERT INTO supplier_returns (supplier_id, store_id, item_id, lot_id, receipt_id, qty, unit_cost, amount, reason, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (lot["supplier_id"], lot["store_id"], lot["item_id"], lot["id"], lot["receipt_id"], body.qty, lot["unit_cost"], amount, reason,
         ctx.user_id),
    ).fetchone()
    audit.record(conn, "purchasing.return_requested", ctx=ctx, entity="supplier_return", entity_id=row["id"], details={
        "ref": row["ref"], "supplier": lot["supplier"], "item": lot["item"], "lot": lot["lot_no"], "qty": str(body.qty), "amount": str(amount)})
    return row


def decide_return(conn: psycopg.Connection, ctx: Ctx, return_id, approve: bool, note: str | None) -> dict:
    r = conn.execute("SELECT * FROM supplier_returns WHERE id = %s FOR UPDATE", (return_id,)).fetchone()
    if not r:
        raise AppError(404, "not_found")
    if r["status"] != "pending":
        raise AppError(409, "return_not_pending")
    if r["created_by"] == ctx.user_id:
        raise AppError(403, "same_person")
    note = clean(note)
    if not approve and (not note or len(note) < 5):
        raise field_error("note", "required")
    today = clinic_time.today()
    if approve:
        acc.ensure_open(conn, today)
        lot = conn.execute("SELECT * FROM stock_lots WHERE id = %s FOR UPDATE", (r["lot_id"],)).fetchone()
        if D(lot["qty_on_hand"]) < D(r["qty"]):
            raise AppError(409, "not_enough_stock", available=str(lot["qty_on_hand"]))
        conn.execute("UPDATE stock_lots SET qty_on_hand = qty_on_hand - %s WHERE id = %s", (r["qty"], lot["id"]))
        _move(conn, ctx, day=today, kind="return", lot=lot, qty=-D(r["qty"]), doc_type="return", doc=r)
        supplier = conn.execute("SELECT name FROM suppliers WHERE id = %s", (r["supplier_id"],)).fetchone()
        store = conn.execute("SELECT branch_id FROM stores WHERE id = %s", (r["store_id"],)).fetchone()
        item = conn.execute("SELECT name_en FROM items WHERE id = %s", (r["item_id"],)).fetchone()
        k = acc.keys(conn)
        acc.post(conn, day=today, memo=f"Returned to {supplier['name']}: {item['name_en']} × {D(r['qty']).normalize():f}"
                 + (f" (lot {lot['lot_no']})" if lot["lot_no"] else "") + f" — {r['reason']}",
                 source_type="supplier_return", source_id=r["id"], source_ref=r["ref"], branch_id=store["branch_id"], ctx=ctx,
                 lines=[L(k["suppliers_payable"], D(r["amount"]), memo=supplier["name"]), L(k["inventory"], -D(r["amount"]))])
    status = "approved" if approve else "rejected"
    conn.execute("""UPDATE supplier_returns SET status = %s, decided_by = %s, decided_at = now(), decision_note = %s, returned_on = %s
                    WHERE id = %s""", (status, ctx.user_id, note, today if approve else None, return_id))
    audit.record(conn, f"purchasing.return_{status}", ctx=ctx, entity="supplier_return", entity_id=r["id"],
                 details={"ref": r["ref"], "amount": str(r["amount"]), "note": note})
    return {"id": r["id"], "status": status}
