"""Stock: setup lists, receiving goods, using and writing off stock, blind counts, alerts and the stock card.

Stock is kept by lot (lot number, expiry, cost) per store. Stock goes out earliest-expiry first (FEFO) and never below
zero: the lot rows are locked and the database refuses a negative quantity. Each movement is written to stock_moves
(append-only) and posts its journal entry in the same transaction, at the cost of the lots it came from:

  receive           Inventory        / Suppliers payable
  use               Consumables used / Inventory
  write-off         Stock losses     / Inventory
  count difference  Stock losses     / Inventory   (or the other way for a surplus), only once management approves

Transfers between stores and returns to suppliers are in transfers.py.
"""
from datetime import date, timedelta
from decimal import Decimal

import psycopg

from app.core import accounting as acc
from app.core import appointments, audit, clinic_time
from app.core.accounting import L, ZERO
from app.core.billing import q
from app.core.errors import AppError, field_error
from app.core.session import Ctx

D = Decimal
EXPIRY_WARNING_DAYS = 60
PAGE = 50


def clean(text: str | None) -> str | None:
    return " ".join((text or "").split()) or None


# ---------- setup lists ----------

# kind → (table, columns that come from the request, order)
LISTS = {
    "categories": ("item_categories", ("name_ar", "name_en", "is_active"), "name_en"),
    "units": ("units", ("name_ar", "name_en", "is_active"), "name_en"),
    "items": ("items", ("name_ar", "name_en", "category_id", "unit_id", "min_qty", "tracks_expiry", "notes", "is_active"), "name_en"),
    "stores": ("stores", ("branch_id", "name_ar", "name_en", "is_active"), "name_en"),
    "suppliers": ("suppliers", ("name", "contact_name", "phone", "email", "address", "payment_terms_days", "notes", "is_active"), "name"),
    "device_types": ("device_types", ("name_ar", "name_en", "is_laser", "is_active"), "name_en"),
}
UNIQUE_FIELD = {"suppliers": "name"}


def setup_list(conn: psycopg.Connection, kind: str) -> list[dict]:
    table, _, order = LISTS[kind]
    extra = {
        "items": """, c.name_ar AS category_ar, c.name_en AS category_en, u.name_ar AS unit_ar, u.name_en AS unit_en
                    FROM items t LEFT JOIN item_categories c ON c.id = t.category_id JOIN units u ON u.id = t.unit_id""",
        "stores": ", b.name_ar AS branch_ar, b.name_en AS branch_en FROM stores t JOIN branches b ON b.id = t.branch_id",
        "device_types": ", (SELECT count(*) FROM devices d WHERE d.type_id = t.id) AS devices FROM device_types t",
        "categories": ", (SELECT count(*) FROM items i WHERE i.category_id = t.id) AS items FROM item_categories t",
        "units": ", (SELECT count(*) FROM items i WHERE i.unit_id = t.id) AS items FROM units t",
    }.get(kind, f" FROM {table} t")
    return conn.execute(f"SELECT t.* {extra} ORDER BY t.is_active DESC, lower(t.{order})").fetchall()


def save_list_row(conn: psycopg.Connection, ctx: Ctx, kind: str, body, row_id: int | None = None) -> dict:
    table, columns, _ = LISTS[kind]
    values = body.model_dump()
    for key, value in values.items():
        if isinstance(value, str):
            values[key] = clean(value)
    for key in ("name_ar", "name_en", "name"):
        if key in columns and not values.get(key):
            raise field_error(key, "required")
    if kind == "items":
        if not conn.execute("SELECT 1 FROM units WHERE id = %s", (values["unit_id"],)).fetchone():
            raise field_error("unit_id", "invalid")
        if values["category_id"] and not conn.execute("SELECT 1 FROM item_categories WHERE id = %s", (values["category_id"],)).fetchone():
            raise field_error("category_id", "invalid")
    if kind == "stores" and not conn.execute("SELECT 1 FROM branches WHERE id = %s", (values["branch_id"],)).fetchone():
        raise field_error("branch_id", "invalid")
    data = {c: values[c] for c in columns}
    try:
        with conn.transaction():
            if row_id is None:
                row = conn.execute(
                    f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join('%(' + c + ')s' for c in columns)}) RETURNING *", data,
                ).fetchone()
            else:
                updated = ", updated_at = now()" if kind == "items" else ""
                row = conn.execute(
                    f"UPDATE {table} SET {', '.join(c + ' = %(' + c + ')s' for c in columns)}{updated} WHERE id = %(id)s RETURNING *",
                    {**data, "id": row_id},
                ).fetchone()
                if not row:
                    raise AppError(404, "not_found")
    except psycopg.errors.UniqueViolation:
        raise field_error(UNIQUE_FIELD.get(kind, "name_en"), "taken", 409) from None
    audit.record(conn, f"inventory.{kind}_saved", ctx=ctx, entity=table, entity_id=row["id"],
                 details={"name": row.get("name_en") or row.get("name"), "new": row_id is None, "active": row["is_active"]})
    return row


def delete_list_row(conn: psycopg.Connection, ctx: Ctx, kind: str, row_id: int) -> dict:
    """Deletes what was never used; anything already used is switched off instead, so its history stays readable."""
    table, _, _ = LISTS[kind]
    row = conn.execute(f"SELECT * FROM {table} WHERE id = %s FOR UPDATE", (row_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    name = row.get("name_en") or row.get("name")
    try:
        with conn.transaction():
            conn.execute(f"DELETE FROM {table} WHERE id = %s", (row_id,))
    except psycopg.errors.ForeignKeyViolation:
        conn.execute(f"UPDATE {table} SET is_active = false WHERE id = %s", (row_id,))
        audit.record(conn, f"inventory.{kind}_switched_off", ctx=ctx, entity=table, entity_id=row_id, details={"name": name})
        return {"id": row_id, "switched_off": True}
    audit.record(conn, f"inventory.{kind}_deleted", ctx=ctx, entity=table, entity_id=row_id, details={"name": name})
    return {"id": row_id, "deleted": True}


def approval_limit(conn: psycopg.Connection) -> Decimal:
    row = conn.execute("SELECT value FROM app_settings WHERE key = 'purchasing.approval_limit'").fetchone()
    return q(D(str(row["value"]))) if row else D("5000.00")


def save_approval_limit(conn: psycopg.Connection, ctx: Ctx, limit: Decimal) -> dict:
    from psycopg.types.json import Jsonb
    before = approval_limit(conn)
    conn.execute(
        """INSERT INTO app_settings (key, value, updated_by) VALUES ('purchasing.approval_limit', %s, %s)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()""",
        (Jsonb(float(q(limit))), ctx.user_id),
    )
    audit.record(conn, "settings.approval_limit_updated", ctx=ctx, entity="settings", entity_id="purchasing",
                 details={"before": str(before), "after": str(q(limit))})
    return {"approval_limit": approval_limit(conn)}


def _store(conn: psycopg.Connection, store_id, field: str = "store_id") -> dict:
    row = conn.execute("SELECT * FROM stores WHERE id = %s", (store_id,)).fetchone()
    if not row or not row["is_active"]:
        raise field_error(field, "invalid")
    return row


def _item(conn: psycopg.Connection, item_id, field: str) -> dict:
    row = conn.execute("SELECT * FROM items WHERE id = %s", (item_id,)).fetchone()
    if not row or not row["is_active"]:
        raise field_error(field, "invalid")
    return row


# ---------- reading stock ----------

def _status(row: dict, today: date) -> str:
    if row["expired_qty"] and row["expired_qty"] > 0:
        return "expired"
    if row["min_qty"] and row["on_hand"] < row["min_qty"]:
        return "below_min"
    if row["next_expiry"] and row["next_expiry"] <= today + timedelta(days=EXPIRY_WARNING_DAYS):
        return "expiring"
    return "ok"


def stock(conn: psycopg.Connection, *, q_text=None, category_id=None, store_id=None, status=None, include_inactive=False) -> dict:
    today = clinic_time.today()
    rows = conn.execute(
        """
        SELECT i.id, i.name_ar, i.name_en, i.min_qty, i.tracks_expiry, i.is_active, i.category_id,
               c.name_ar AS category_ar, c.name_en AS category_en, u.name_ar AS unit_ar, u.name_en AS unit_en,
               COALESCE(sum(l.qty_on_hand), 0) AS on_hand,
               COALESCE(sum(l.qty_on_hand * l.unit_cost), 0) AS value,
               COALESCE(sum(l.qty_on_hand) FILTER (WHERE l.expiry < %(today)s), 0) AS expired_qty,
               min(l.expiry) FILTER (WHERE l.expiry >= %(today)s) AS next_expiry,
               count(l.id) AS lots
        FROM items i
        JOIN units u ON u.id = i.unit_id
        LEFT JOIN item_categories c ON c.id = i.category_id
        LEFT JOIN stock_lots l ON l.item_id = i.id AND l.qty_on_hand > 0 AND (%(store)s::int IS NULL OR l.store_id = %(store)s::int)
        WHERE (%(all)s OR i.is_active)
          AND (%(cat)s::int IS NULL OR i.category_id = %(cat)s::int)
          AND (%(q)s::text IS NULL OR i.name_en ILIKE %(q)s OR i.name_ar ILIKE %(q)s)
        GROUP BY i.id, c.id, u.id
        ORDER BY lower(i.name_en)
        """,
        {"today": today, "store": store_id, "all": include_inactive, "cat": category_id, "q": f"%{q_text.strip()}%" if q_text else None},
    ).fetchall()
    for r in rows:
        r["status"] = _status(r, today)
    counts = {s: sum(1 for r in rows if r["status"] == s) for s in ("below_min", "expiring", "expired")}
    if status:
        rows = [r for r in rows if r["status"] == status]
    return {"items": rows, "value": q(sum((D(r["value"]) for r in rows), ZERO)), "counts": counts, "today": today}


def stock_value(conn: psycopg.Connection) -> Decimal:
    return q(conn.execute("SELECT COALESCE(sum(qty_on_hand * unit_cost), 0) AS v FROM stock_lots").fetchone()["v"])


def alerts(conn: psycopg.Connection) -> dict:
    today = clinic_time.today()
    below = conn.execute(
        """SELECT i.id, i.name_ar, i.name_en, i.min_qty, u.name_ar AS unit_ar, u.name_en AS unit_en,
                  COALESCE((SELECT sum(l.qty_on_hand) FROM stock_lots l WHERE l.item_id = i.id AND (l.expiry IS NULL OR l.expiry >= %s)), 0) AS on_hand
           FROM items i JOIN units u ON u.id = i.unit_id WHERE i.is_active AND i.min_qty > 0""",
        (today,),
    ).fetchall()
    lots = conn.execute(
        """SELECT l.id, l.item_id, l.lot_no, l.expiry, l.qty_on_hand, l.unit_cost, i.name_ar, i.name_en,
                  s.name_ar AS store_ar, s.name_en AS store_en, u.name_ar AS unit_ar, u.name_en AS unit_en
           FROM stock_lots l JOIN items i ON i.id = l.item_id JOIN stores s ON s.id = l.store_id JOIN units u ON u.id = i.unit_id
           WHERE l.qty_on_hand > 0 AND l.expiry IS NOT NULL AND l.expiry <= %s ORDER BY l.expiry""",
        (today + timedelta(days=EXPIRY_WARNING_DAYS),),
    ).fetchall()
    for lot in lots:
        lot["days_left"] = (lot["expiry"] - today).days
    return {
        "below_min": [r for r in below if r["on_hand"] < r["min_qty"]],
        "expiring": [r for r in lots if r["expiry"] >= today],
        "expired": [r for r in lots if r["expiry"] < today],
    }


MOVE_SELECT = """
    SELECT m.*, i.name_ar AS item_ar, i.name_en AS item_en, s.name_ar AS store_ar, s.name_en AS store_en, l.lot_no, l.expiry,
           u.full_name_ar AS by_ar, u.full_name_en AS by_en
    FROM stock_moves m JOIN items i ON i.id = m.item_id JOIN stores s ON s.id = m.store_id JOIN stock_lots l ON l.id = m.lot_id
    LEFT JOIN users u ON u.id = m.created_by
"""


def moves(conn: psycopg.Connection, *, item_id=None, store_id=None, kind=None, date_from=None, date_to=None, q_text=None, page: int = 1) -> dict:
    where, params = [], {}
    for col, key, value in (("m.item_id", "item", item_id), ("m.store_id", "store", store_id), ("m.kind", "kind", kind)):
        if value:
            where.append(f"{col} = %({key})s")
            params[key] = value
    if date_from:
        where.append("m.moved_on >= %(from)s")
        params["from"] = date_from
    if date_to:
        where.append("m.moved_on <= %(to)s")
        params["to"] = date_to
    if q_text:
        where.append("(m.doc_ref ILIKE %(q)s OR i.name_en ILIKE %(q)s OR i.name_ar ILIKE %(q)s OR l.lot_no ILIKE %(q)s)")
        params["q"] = f"%{q_text.strip()}%"
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    total = conn.execute(
        f"""SELECT count(*) AS n FROM stock_moves m JOIN items i ON i.id = m.item_id JOIN stock_lots l ON l.id = m.lot_id {clause}""", params,
    ).fetchone()["n"]
    rows = conn.execute(f"{MOVE_SELECT} {clause} ORDER BY m.moved_on DESC, m.id DESC LIMIT {PAGE} OFFSET %(offset)s",
                        {**params, "offset": (page - 1) * PAGE}).fetchall()
    return {"items": rows, "total": total, "page": page, "page_size": PAGE}


def item_card(conn: psycopg.Connection, item_id: int) -> dict:
    """The stock card: the item, its lots and every movement with the running balance."""
    item = conn.execute(
        """SELECT i.*, c.name_ar AS category_ar, c.name_en AS category_en, u.name_ar AS unit_ar, u.name_en AS unit_en
           FROM items i JOIN units u ON u.id = i.unit_id LEFT JOIN item_categories c ON c.id = i.category_id WHERE i.id = %s""",
        (item_id,),
    ).fetchone()
    if not item:
        raise AppError(404, "not_found")
    lots = conn.execute(
        """SELECT l.*, s.name_ar AS store_ar, s.name_en AS store_en, g.ref AS receipt_ref, sp.name AS supplier
           FROM stock_lots l JOIN stores s ON s.id = l.store_id
           LEFT JOIN goods_receipts g ON g.id = l.receipt_id LEFT JOIN suppliers sp ON sp.id = g.supplier_id
           WHERE l.item_id = %s ORDER BY (l.qty_on_hand > 0) DESC, l.expiry NULLS LAST, l.id""",
        (item_id,),
    ).fetchall()
    history = conn.execute(f"{MOVE_SELECT} WHERE m.item_id = %s ORDER BY m.moved_on, m.id", (item_id,)).fetchall()
    balance = ZERO
    for m in history:
        balance += D(m["qty"])
        m["balance"] = balance
    history.reverse()
    today = clinic_time.today()
    on_hand = sum((D(lt["qty_on_hand"]) for lt in lots), ZERO)
    usable = sum((D(lt["qty_on_hand"]) for lt in lots if not lt["expiry"] or lt["expiry"] >= today), ZERO)
    value = q(sum((D(lt["qty_on_hand"]) * D(lt["unit_cost"]) for lt in lots), ZERO))
    last_cost = conn.execute("SELECT unit_cost FROM stock_lots WHERE item_id = %s ORDER BY id DESC LIMIT 1", (item_id,)).fetchone()
    used_90 = conn.execute(
        "SELECT COALESCE(-sum(qty), 0) AS n FROM stock_moves WHERE item_id = %s AND kind = 'use' AND moved_on > %s",
        (item_id, today - timedelta(days=90)),
    ).fetchone()["n"]
    return {"item": item, "lots": lots, "moves": history[:300], "on_hand": on_hand, "usable": usable, "value": value,
            "last_cost": last_cost["unit_cost"] if last_cost else None, "used_90": used_90, "today": today}


# ---------- moving stock ----------

def _move(conn: psycopg.Connection, ctx: Ctx, *, day: date, kind: str, lot: dict, qty: Decimal, doc_type: str, doc: dict) -> None:
    conn.execute(
        """INSERT INTO stock_moves (moved_on, kind, store_id, item_id, lot_id, qty, unit_cost, doc_type, doc_id, doc_ref, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (day, kind, lot["store_id"], lot["item_id"], lot["id"], qty, lot["unit_cost"], doc_type, doc["id"], doc["ref"], ctx.user_id),
    )


def take(conn: psycopg.Connection, ctx: Ctx, *, store_id: int, item: dict, qty: Decimal, day: date, kind: str, doc_type: str, doc: dict,
         field: str, usable_only: bool, parts: list | None = None) -> Decimal:
    """Takes `qty` out of the store, earliest expiry first. Returns the cost taken. Expired lots are skipped when using stock
    (they can only be written off). `parts`, when given, collects (lot, qty) for each lot touched."""
    lots = conn.execute(
        """SELECT * FROM stock_lots WHERE store_id = %s AND item_id = %s AND qty_on_hand > 0
             AND (NOT %s OR expiry IS NULL OR expiry >= %s)
           ORDER BY expiry NULLS LAST, id FOR UPDATE""",
        (store_id, item["id"], usable_only, clinic_time.today()),
    ).fetchall()
    available = sum((D(lt["qty_on_hand"]) for lt in lots), ZERO)
    if available < qty:
        raise AppError(409, "not_enough_stock", fields={field: "not_enough_stock"}, item=item["name_en"], available=str(available))
    left, cost = qty, ZERO
    for lot in lots:
        if left <= 0:
            break
        part = min(left, D(lot["qty_on_hand"]))
        conn.execute("UPDATE stock_lots SET qty_on_hand = qty_on_hand - %s WHERE id = %s", (part, lot["id"]))
        _move(conn, ctx, day=day, kind=kind, lot=lot, qty=-part, doc_type=doc_type, doc=doc)
        if parts is not None:
            parts.append((lot, part))
        cost += part * D(lot["unit_cost"])
        left -= part
    return q(cost)


def receive(conn: psycopg.Connection, ctx: Ctx, body) -> dict:
    """Goods arrive, against a purchase order or directly. Each line becomes a lot. Expired goods are refused."""
    from app.core import purchasing  # the order's lines and status live there
    today = clinic_time.today()
    acc.check_date(conn, body.received_on, "received_on")
    po = None
    if body.po_id:
        po = purchasing.lock_order(conn, body.po_id)
        if po["status"] not in ("approved", "partial"):
            raise AppError(409, "order_not_open", order_status=po["status"])
        supplier_id, store_id = po["supplier_id"], po["store_id"]
        po_lines = {ln["id"]: ln for ln in conn.execute("SELECT * FROM purchase_order_lines WHERE po_id = %s FOR UPDATE", (po["id"],))}
    else:
        supplier_id, store_id = body.supplier_id, body.store_id
        if not supplier_id:
            raise field_error("supplier_id", "required")
        if not store_id:
            raise field_error("store_id", "required")
    supplier = conn.execute("SELECT * FROM suppliers WHERE id = %s", (supplier_id,)).fetchone()
    if not supplier or (not supplier["is_active"] and not po):
        raise field_error("supplier_id", "invalid")
    store = _store(conn, store_id)

    checked = []
    for i, ln in enumerate(body.lines):
        item = _item(conn, ln.item_id, f"lines.{i}.item_id")
        if po:
            pl = po_lines.get(ln.po_line_id)
            if not pl or pl["item_id"] != ln.item_id:
                raise field_error(f"lines.{i}.po_line_id", "invalid")
            if D(pl["received_qty"]) + ln.qty > D(pl["qty"]):
                raise AppError(422, "validation", fields={f"lines.{i}.qty": "more_than_ordered"},
                               remaining=str(D(pl["qty"]) - D(pl["received_qty"])))
            pl["received_qty"] = D(pl["received_qty"]) + ln.qty
        elif ln.po_line_id:
            raise field_error(f"lines.{i}.po_line_id", "invalid")
        if item["tracks_expiry"] and not ln.expiry:
            raise field_error(f"lines.{i}.expiry", "required")
        if ln.expiry and ln.expiry <= today:
            raise field_error(f"lines.{i}.expiry", "expired")
        checked.append((ln, item))

    total = q(sum((ln.qty * ln.unit_cost for ln, _ in checked), ZERO))
    receipt = conn.execute(
        """INSERT INTO goods_receipts (supplier_id, store_id, po_id, received_on, delivery_note, note, total, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (supplier_id, store_id, po["id"] if po else None, body.received_on, clean(body.delivery_note), clean(body.note), total, ctx.user_id),
    ).fetchone()
    for ln, item in checked:
        lot = conn.execute(
            """INSERT INTO stock_lots (store_id, item_id, receipt_id, lot_no, expiry, unit_cost, qty_in, qty_on_hand)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
            (store_id, item["id"], receipt["id"], clean(ln.lot_no), ln.expiry, ln.unit_cost, ln.qty, ln.qty),
        ).fetchone()
        conn.execute(
            """INSERT INTO goods_receipt_lines (receipt_id, po_line_id, item_id, qty, unit_cost, lot_no, expiry, lot_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (receipt["id"], ln.po_line_id, item["id"], ln.qty, ln.unit_cost, clean(ln.lot_no), ln.expiry, lot["id"]),
        )
        _move(conn, ctx, day=body.received_on, kind="receive", lot=lot, qty=ln.qty, doc_type="receipt", doc=receipt)
        if po:
            conn.execute("UPDATE purchase_order_lines SET received_qty = received_qty + %s WHERE id = %s", (ln.qty, ln.po_line_id))
    if po:
        purchasing.refresh_status(conn, po["id"])
    k = acc.keys(conn)
    acc.post(conn, day=body.received_on, memo=f"Goods received from {supplier['name']}", source_type="stock_receipt",
             source_id=receipt["id"], source_ref=receipt["ref"], branch_id=store["branch_id"], ctx=ctx,
             lines=[L(k["inventory"], total), L(k["suppliers_payable"], -total, memo=supplier["name"])])
    audit.record(conn, "inventory.received", ctx=ctx, entity="goods_receipt", entity_id=receipt["id"], details={
        "ref": receipt["ref"], "supplier": supplier["name"], "po": po["ref"] if po else None, "total": str(total), "lines": len(checked)})
    return receipt


def use_options(conn: psycopg.Connection, ctx: Ctx) -> dict:
    """What the use-stock form needs: stores, items with usable stock per store, rooms and today's visits."""
    today = clinic_time.today()
    stores = conn.execute(
        """SELECT s.id, s.branch_id, s.name_ar, s.name_en FROM stores s WHERE s.is_active
           ORDER BY (s.branch_id = %s) DESC, s.name_en""", (ctx.active_branch_id,)).fetchall()
    items = conn.execute(
        """SELECT i.id, i.name_ar, i.name_en, u.name_ar AS unit_ar, u.name_en AS unit_en, l.store_id, sum(l.qty_on_hand) AS available
           FROM stock_lots l JOIN items i ON i.id = l.item_id JOIN units u ON u.id = i.unit_id
           WHERE l.qty_on_hand > 0 AND (l.expiry IS NULL OR l.expiry >= %s) AND i.is_active
           GROUP BY i.id, u.id, l.store_id ORDER BY lower(i.name_en)""",
        (today,),
    ).fetchall()
    rooms = conn.execute("SELECT id, branch_id, name_ar, name_en FROM rooms WHERE is_active ORDER BY branch_id, name_en").fetchall()
    doctor = appointments.doctor_scope(ctx)
    visits = conn.execute(
        """SELECT a.id, a.ref, a.starts_at, a.room_id, a.branch_id, a.status, p.id AS patient_id, p.mrn,
                  p.full_name_ar AS patient_ar, p.full_name_en AS patient_en
           FROM appointments a JOIN patients p ON p.id = a.patient_id
           WHERE a.starts_at >= %(from)s AND a.starts_at < %(to)s AND a.status NOT IN ('cancelled', 'no_show', 'requested')
             AND (%(doctor)s::uuid IS NULL OR a.doctor_id = %(doctor)s::uuid)
           ORDER BY a.starts_at""",
        {"from": clinic_time.at(today, clinic_time.MIDNIGHT), "to": clinic_time.at(today + timedelta(days=1), clinic_time.MIDNIGHT),
         "doctor": doctor},
    ).fetchall()
    return {"stores": stores, "items": items, "rooms": rooms, "visits": visits, "today": today}


def issue(conn: psycopg.Connection, ctx: Ctx, body) -> dict:
    """Stock used (room / patient visit / general) or written off with a reason."""
    day = body.issued_on or clinic_time.today()
    acc.check_date(conn, day, "issued_on")
    store = _store(conn, body.store_id)
    reason = clean(body.reason)
    if body.kind == "write_off" and (not reason or len(reason) < 5):
        raise field_error("reason", "required")
    patient_id = None
    if body.appointment_id:
        appt = conn.execute("SELECT * FROM appointments WHERE id = %s", (body.appointment_id,)).fetchone()
        if not appt or appt["status"] in ("cancelled", "no_show"):
            raise field_error("appointment_id", "invalid")
        doctor = appointments.doctor_scope(ctx)
        if doctor and appt["doctor_id"] != doctor:
            raise AppError(403, "not_your_patient")
        patient_id = appt["patient_id"]
    if body.room_id and not conn.execute("SELECT 1 FROM rooms WHERE id = %s", (body.room_id,)).fetchone():
        raise field_error("room_id", "invalid")
    seen = set()
    for i, ln in enumerate(body.lines):
        if ln.item_id in seen:
            raise field_error(f"lines.{i}.item_id", "duplicate")
        seen.add(ln.item_id)
    doc = conn.execute(
        """INSERT INTO stock_issues (kind, store_id, issued_on, room_id, appointment_id, patient_id, reason, note, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (body.kind, store["id"], day, body.room_id, body.appointment_id, patient_id, reason, clean(body.note), ctx.user_id),
    ).fetchone()
    total, names = ZERO, []
    for i, ln in enumerate(body.lines):
        item = _item(conn, ln.item_id, f"lines.{i}.item_id")
        total += take(conn, ctx, store_id=store["id"], item=item, qty=ln.qty, day=day, kind=body.kind, doc_type="issue", doc=doc,
                      field=f"lines.{i}.qty", usable_only=body.kind == "use")
        names.append(f"{item['name_en']} × {ln.qty.normalize():f}")
    total = q(total)
    conn.execute("UPDATE stock_issues SET total_cost = %s WHERE id = %s", (total, doc["id"]))
    k = acc.keys(conn)
    if body.kind == "use":
        debit, source_type, memo = k["consumables_used"], "stock_use", "Stock used: " + ", ".join(names)
    else:
        debit, source_type, memo = k["stock_losses"], "stock_loss", f"Stock written off ({reason}): " + ", ".join(names)
    acc.post(conn, day=day, memo=memo, source_type=source_type, source_id=doc["id"], source_ref=doc["ref"], branch_id=store["branch_id"],
             ctx=ctx, lines=[L(debit, total, patient_id=patient_id), L(k["inventory"], -total)])
    audit.record(conn, f"inventory.{'used' if body.kind == 'use' else 'written_off'}", ctx=ctx, entity="stock_issue", entity_id=doc["id"],
                 details={"ref": doc["ref"], "store": store["name_en"], "items": names, "cost": str(total), "reason": reason,
                          "patient_id": str(patient_id) if patient_id else None})
    return {**doc, "total_cost": total}


def issues(conn: psycopg.Connection, *, mine: Ctx | None = None, kind: str | None = None, limit: int = 30) -> list[dict]:
    rows = conn.execute(
        """SELECT x.*, s.name_ar AS store_ar, s.name_en AS store_en, r.name_ar AS room_ar, r.name_en AS room_en,
                  p.full_name_ar AS patient_ar, p.full_name_en AS patient_en, a.ref AS appointment_ref,
                  u.full_name_ar AS by_ar, u.full_name_en AS by_en,
                  (SELECT string_agg(i.name_en || ' × ' || trim_scale(-m.qty)::text, ', ' ORDER BY m.id)
                   FROM stock_moves m JOIN items i ON i.id = m.item_id WHERE m.doc_type = 'issue' AND m.doc_id = x.id) AS items_en,
                  (SELECT string_agg(i.name_ar || ' × ' || trim_scale(-m.qty)::text, '، ' ORDER BY m.id)
                   FROM stock_moves m JOIN items i ON i.id = m.item_id WHERE m.doc_type = 'issue' AND m.doc_id = x.id) AS items_ar
           FROM stock_issues x JOIN stores s ON s.id = x.store_id LEFT JOIN rooms r ON r.id = x.room_id
           LEFT JOIN patients p ON p.id = x.patient_id LEFT JOIN appointments a ON a.id = x.appointment_id
           LEFT JOIN users u ON u.id = x.created_by
           WHERE (%(me)s::uuid IS NULL OR x.created_by = %(me)s::uuid) AND (%(kind)s::text IS NULL OR x.kind = %(kind)s::text)
           ORDER BY x.created_at DESC LIMIT %(limit)s""",
        {"me": mine.user_id if mine else None, "kind": kind, "limit": limit},
    ).fetchall()
    return rows


# ---------- blind stock counts ----------

def counts(conn: psycopg.Connection) -> list[dict]:
    return conn.execute(
        """SELECT c.*, s.name_ar AS store_ar, s.name_en AS store_en, u.full_name_ar AS started_by_ar, u.full_name_en AS started_by_en,
                  (SELECT count(*) FROM stock_count_lines x WHERE x.count_id = c.id) AS lines,
                  (SELECT count(*) FROM stock_count_lines x WHERE x.count_id = c.id AND x.counted IS NOT NULL) AS counted_lines
           FROM stock_counts c JOIN stores s ON s.id = c.store_id LEFT JOIN users u ON u.id = c.started_by
           ORDER BY c.started_at DESC LIMIT 100""").fetchall()


def _count(conn: psycopg.Connection, count_id, lock: bool = False) -> dict:
    row = conn.execute(f"SELECT * FROM stock_counts WHERE id = %s{' FOR UPDATE' if lock else ''}", (count_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    return row


def start_count(conn: psycopg.Connection, ctx: Ctx, body) -> dict:
    store = _store(conn, body.store_id)
    try:
        with conn.transaction():
            row = conn.execute("INSERT INTO stock_counts (store_id, note, started_by) VALUES (%s, %s, %s) RETURNING *",
                               (store["id"], clean(body.note), ctx.user_id)).fetchone()
    except psycopg.errors.UniqueViolation:
        raise AppError(409, "count_open", fields={"store_id": "count_open"}) from None
    conn.execute(
        """INSERT INTO stock_count_lines (count_id, item_id)
           SELECT %s, i.id FROM items i WHERE i.is_active
              OR EXISTS (SELECT 1 FROM stock_lots l WHERE l.item_id = i.id AND l.store_id = %s AND l.qty_on_hand > 0)""",
        (row["id"], store["id"]),
    )
    audit.record(conn, "inventory.count_started", ctx=ctx, entity="stock_count", entity_id=row["id"],
                 details={"ref": row["ref"], "store": store["name_en"]})
    return row


def count_detail(conn: psycopg.Connection, count_id, can_see_expected: bool) -> dict:
    """While counting nobody sees the expected quantities (blind count); after submitting, the reviewers see the differences."""
    c = conn.execute(
        """SELECT c.*, s.name_ar AS store_ar, s.name_en AS store_en, s.branch_id,
                  a.full_name_ar AS started_by_ar, a.full_name_en AS started_by_en,
                  b.full_name_ar AS submitted_by_ar, b.full_name_en AS submitted_by_en,
                  d.full_name_ar AS decided_by_ar, d.full_name_en AS decided_by_en
           FROM stock_counts c JOIN stores s ON s.id = c.store_id LEFT JOIN users a ON a.id = c.started_by
           LEFT JOIN users b ON b.id = c.submitted_by LEFT JOIN users d ON d.id = c.decided_by WHERE c.id = %s""",
        (count_id,),
    ).fetchone()
    if not c:
        raise AppError(404, "not_found")
    lines = conn.execute(
        """SELECT x.*, i.name_ar, i.name_en, u.name_ar AS unit_ar, u.name_en AS unit_en, cat.name_ar AS category_ar, cat.name_en AS category_en
           FROM stock_count_lines x JOIN items i ON i.id = x.item_id JOIN units u ON u.id = i.unit_id
           LEFT JOIN item_categories cat ON cat.id = i.category_id
           WHERE x.count_id = %s ORDER BY cat.name_en NULLS LAST, lower(i.name_en)""",
        (count_id,),
    ).fetchall()
    blind = c["status"] == "counting" or not can_see_expected
    for ln in lines:
        if blind:
            ln["expected"] = ln["unit_cost"] = None
            ln["difference"] = ln["difference_value"] = None
        else:
            diff = D(ln["counted"] or 0) - D(ln["expected"] or 0)
            ln["difference"] = diff
            ln["difference_value"] = q(diff * D(ln["unit_cost"] or 0))
    return {"count": c, "lines": lines, "blind": blind}


def save_count(conn: psycopg.Connection, ctx: Ctx, count_id, body) -> dict:
    c = _count(conn, count_id, lock=True)
    if c["status"] != "counting":
        raise AppError(409, "count_not_open")
    for ln in body.lines:
        conn.execute("UPDATE stock_count_lines SET counted = %s WHERE count_id = %s AND item_id = %s", (ln.counted, count_id, ln.item_id))
    if not body.submit:
        return {"id": count_id, "status": "counting"}
    missing = conn.execute("SELECT count(*) AS n FROM stock_count_lines WHERE count_id = %s AND counted IS NULL", (count_id,)).fetchone()["n"]
    if missing:
        raise AppError(422, "count_incomplete", missing=missing)
    # freeze what the system expected at this moment, at the lots' average cost
    conn.execute(
        """UPDATE stock_count_lines x SET expected = COALESCE(s.qty, 0),
                  unit_cost = COALESCE(s.avg_cost, (SELECT l.unit_cost FROM stock_lots l WHERE l.item_id = x.item_id ORDER BY l.id DESC LIMIT 1), 0)
           FROM (SELECT i.id AS item_id, sum(l.qty_on_hand) AS qty,
                        round(sum(l.qty_on_hand * l.unit_cost) / NULLIF(sum(l.qty_on_hand), 0), 2) AS avg_cost
                 FROM items i LEFT JOIN stock_lots l ON l.item_id = i.id AND l.store_id = %(store)s AND l.qty_on_hand > 0
                 GROUP BY i.id) s
           WHERE x.count_id = %(id)s AND s.item_id = x.item_id""",
        {"store": c["store_id"], "id": count_id},
    )
    value = conn.execute(
        "SELECT COALESCE(sum((counted - expected) * unit_cost), 0) AS v FROM stock_count_lines WHERE count_id = %s", (count_id,),
    ).fetchone()["v"]
    conn.execute("""UPDATE stock_counts SET status = 'submitted', submitted_by = %s, submitted_at = now(), difference_value = %s
                    WHERE id = %s""", (ctx.user_id, q(value), count_id))
    audit.record(conn, "inventory.count_submitted", ctx=ctx, entity="stock_count", entity_id=count_id,
                 details={"ref": c["ref"], "difference_value": str(q(value))})
    return {"id": count_id, "status": "submitted"}


def decide_count(conn: psycopg.Connection, ctx: Ctx, count_id, approve: bool, note: str | None) -> dict:
    """Management approves: each difference is applied (a shortage leaves earliest-expiry first, a surplus is added to the
    newest lot) and posted to Stock losses. Rejected: nothing changes."""
    c = _count(conn, count_id, lock=True)
    if c["status"] != "submitted":
        raise AppError(409, "count_not_submitted")
    note = clean(note)
    if not approve and (not note or len(note) < 5):
        raise field_error("note", "required")
    today = clinic_time.today()
    total = ZERO
    if approve:
        acc.ensure_open(conn, today)
        store = conn.execute("SELECT * FROM stores WHERE id = %s", (c["store_id"],)).fetchone()
        doc = {"id": c["id"], "ref": c["ref"]}
        for ln in conn.execute("SELECT * FROM stock_count_lines WHERE count_id = %s AND counted <> expected", (count_id,)).fetchall():
            diff = D(ln["counted"]) - D(ln["expected"])
            item = conn.execute("SELECT * FROM items WHERE id = %s", (ln["item_id"],)).fetchone()
            if diff < 0:
                total -= take(conn, ctx, store_id=c["store_id"], item=item, qty=-diff, day=today, kind="count", doc_type="count", doc=doc,
                              field="lines", usable_only=False)
                continue
            lot = conn.execute(
                "SELECT * FROM stock_lots WHERE store_id = %s AND item_id = %s ORDER BY id DESC LIMIT 1 FOR UPDATE", (c["store_id"], item["id"]),
            ).fetchone()
            if not lot:
                lot = conn.execute(
                    """INSERT INTO stock_lots (store_id, item_id, lot_no, unit_cost, qty_in, qty_on_hand) VALUES (%s, %s, %s, %s, 0, 0)
                       RETURNING *""", (c["store_id"], item["id"], c["ref"], ln["unit_cost"] or 0)).fetchone()
            conn.execute("UPDATE stock_lots SET qty_on_hand = qty_on_hand + %s WHERE id = %s", (diff, lot["id"]))
            _move(conn, ctx, day=today, kind="count", lot=lot, qty=diff, doc_type="count", doc=doc)
            total += q(diff * D(lot["unit_cost"]))
        total = q(total)
        k = acc.keys(conn)
        acc.post(conn, day=today, memo=f"Stock count {c['ref']} differences ({store['name_en']})", source_type="stock_count",
                 source_id=c["id"], source_ref=c["ref"], branch_id=store["branch_id"], ctx=ctx,
                 lines=[L(k["inventory"], total), L(k["stock_losses"], -total)])
    conn.execute("""UPDATE stock_counts SET status = %s, decided_by = %s, decided_at = now(), decision_note = %s,
                           difference_value = CASE WHEN %s THEN %s ELSE difference_value END WHERE id = %s""",
                 ("approved" if approve else "rejected", ctx.user_id, note, approve, total, count_id))
    audit.record(conn, f"inventory.count_{'approved' if approve else 'rejected'}", ctx=ctx, entity="stock_count", entity_id=count_id,
                 details={"ref": c["ref"], "posted": str(total) if approve else None, "note": note})
    return {"id": count_id, "status": "approved" if approve else "rejected", "posted": total}
