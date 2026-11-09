"""Medical devices: the register (type, model, serial, room, supplier, purchase, warranty), status (working / under
maintenance / out of service: a device that isn't working can't be picked for a laser session), a maintenance plan
every N days, the maintenance log (cost posted to Device maintenance, paid now or on credit with the supplier) and
fault reports from nurses and doctors."""
from datetime import date, timedelta
from decimal import Decimal

import psycopg

from app.core import accounting as acc
from app.core import accounting_ops as ops
from app.core import audit, clinic_time
from app.core.accounting import L
from app.core.billing import q
from app.core.errors import AppError, field_error
from app.core.inventory import clean
from app.core.session import Ctx

D = Decimal
DUE_SOON_DAYS = 14
WARRANTY_WARNING_DAYS = 60

DEVICE_SELECT = """
    SELECT d.*, t.name_ar AS type_ar, t.name_en AS type_en, t.is_laser,
           r.name_ar AS room_ar, r.name_en AS room_en, r.branch_id, s.name AS supplier,
           CASE WHEN d.maintenance_every_days IS NOT NULL AND COALESCE(d.last_maintenance_on, d.purchase_date) IS NOT NULL
                THEN COALESCE(d.last_maintenance_on, d.purchase_date) + d.maintenance_every_days END AS next_due,
           (SELECT count(*) FROM device_faults f WHERE f.device_id = d.id AND f.status = 'open') AS open_faults
    FROM devices d LEFT JOIN device_types t ON t.id = d.type_id LEFT JOIN rooms r ON r.id = d.room_id
    LEFT JOIN suppliers s ON s.id = d.supplier_id
"""


def _flags(d: dict, today: date) -> dict:
    due = d["next_due"]
    d["days_to_due"] = (due - today).days if due else None
    d["maintenance_alert"] = None if due is None else ("overdue" if due < today else "due" if due <= today + timedelta(days=DUE_SOON_DAYS) else None)
    w = d["warranty_end"]
    d["warranty_alert"] = None if w is None else ("ended" if w < today else "ending" if w <= today + timedelta(days=WARRANTY_WARNING_DAYS) else None)
    return d


def devices(conn: psycopg.Connection, *, include_inactive: bool = True) -> list[dict]:
    today = clinic_time.today()
    rows = conn.execute(f"{DEVICE_SELECT} WHERE %s OR d.is_active ORDER BY d.is_active DESC, d.name", (include_inactive,)).fetchall()
    return [_flags(r, today) for r in rows]


def device(conn: psycopg.Connection, device_id: int) -> dict:
    row = conn.execute(f"{DEVICE_SELECT} WHERE d.id = %s", (device_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    return {
        "device": _flags(row, clinic_time.today()),
        "maintenance": conn.execute(
            """SELECT m.*, s.name AS supplier, a.name_ar AS paid_from_ar, a.name_en AS paid_from_en, b.bill_no, f.ref AS fault_ref,
                      u.full_name_ar AS by_ar, u.full_name_en AS by_en
               FROM device_maintenance m LEFT JOIN suppliers s ON s.id = m.supplier_id LEFT JOIN accounts a ON a.id = m.paid_from_id
               LEFT JOIN supplier_bills b ON b.id = m.bill_id LEFT JOIN device_faults f ON f.id = m.fault_id
               LEFT JOIN users u ON u.id = m.created_by
               WHERE m.device_id = %s ORDER BY m.done_on DESC, m.created_at DESC""", (device_id,)).fetchall(),
        "faults": faults(conn, device_id=device_id),
    }


def alerts(conn: psycopg.Connection) -> dict:
    rows = devices(conn, include_inactive=False)
    return {
        "maintenance": sorted([r for r in rows if r["maintenance_alert"]], key=lambda r: r["next_due"]),
        "warranty": [r for r in rows if r["warranty_alert"] == "ending"],
        "not_working": [r for r in rows if r["status"] != "working"],
    }


# ---------- register ----------

def save_device(conn: psycopg.Connection, ctx: Ctx, body, device_id: int | None = None) -> dict:
    dtype = conn.execute("SELECT * FROM device_types WHERE id = %s", (body.type_id,)).fetchone()
    if not dtype:
        raise field_error("type_id", "invalid")
    if body.room_id and not conn.execute("SELECT 1 FROM rooms WHERE id = %s", (body.room_id,)).fetchone():
        raise field_error("room_id", "invalid")
    if body.supplier_id and not conn.execute("SELECT 1 FROM suppliers WHERE id = %s", (body.supplier_id,)).fetchone():
        raise field_error("supplier_id", "invalid")
    today = clinic_time.today()
    if body.purchase_date and body.purchase_date > today:
        raise field_error("purchase_date", "future")
    if body.last_maintenance_on and body.last_maintenance_on > today:
        raise field_error("last_maintenance_on", "future")
    if body.warranty_end and body.purchase_date and body.warranty_end < body.purchase_date:
        raise field_error("warranty_end", "before_purchase")
    values = {"name": clean(body.name), "type": dtype["id"], "kind": "laser" if dtype["is_laser"] else "other", "model": clean(body.model),
              "serial": clean(body.serial_no), "room": body.room_id, "supplier": body.supplier_id, "pdate": body.purchase_date,
              "price": body.purchase_price, "warranty": body.warranty_end, "every": body.maintenance_every_days,
              "last": body.last_maintenance_on, "notes": clean(body.notes), "active": body.is_active}
    try:
        with conn.transaction():
            if device_id is None:
                row = conn.execute(
                    """INSERT INTO devices (kind, type_id, name, model, serial_no, room_id, supplier_id, purchase_date, purchase_price,
                                            warranty_end, maintenance_every_days, last_maintenance_on, notes, is_active)
                       VALUES (%(kind)s, %(type)s, %(name)s, %(model)s, %(serial)s, %(room)s, %(supplier)s, %(pdate)s, %(price)s,
                               %(warranty)s, %(every)s, %(last)s, %(notes)s, %(active)s) RETURNING *""", values).fetchone()
            else:
                row = conn.execute(
                    """UPDATE devices SET kind = %(kind)s, type_id = %(type)s, name = %(name)s, model = %(model)s, serial_no = %(serial)s,
                              room_id = %(room)s, supplier_id = %(supplier)s, purchase_date = %(pdate)s, purchase_price = %(price)s,
                              warranty_end = %(warranty)s, maintenance_every_days = %(every)s, last_maintenance_on = %(last)s,
                              notes = %(notes)s, is_active = %(active)s, updated_at = now()
                       WHERE id = %(id)s RETURNING *""", {**values, "id": device_id}).fetchone()
                if not row:
                    raise AppError(404, "not_found")
    except psycopg.errors.UniqueViolation:
        raise field_error("name", "taken", 409) from None
    audit.record(conn, "devices.saved", ctx=ctx, entity="device", entity_id=row["id"],
                 details={"name": row["name"], "type": dtype["name_en"], "new": device_id is None, "active": row["is_active"]})
    return row


def delete_device(conn: psycopg.Connection, ctx: Ctx, device_id: int) -> dict:
    row = conn.execute("SELECT * FROM devices WHERE id = %s FOR UPDATE", (device_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    try:
        with conn.transaction():
            conn.execute("DELETE FROM devices WHERE id = %s", (device_id,))
    except psycopg.errors.ForeignKeyViolation:
        conn.execute("UPDATE devices SET is_active = false, updated_at = now() WHERE id = %s", (device_id,))
        audit.record(conn, "devices.switched_off", ctx=ctx, entity="device", entity_id=device_id, details={"name": row["name"]})
        return {"id": device_id, "switched_off": True}
    audit.record(conn, "devices.deleted", ctx=ctx, entity="device", entity_id=device_id, details={"name": row["name"]})
    return {"id": device_id, "deleted": True}


def set_status(conn: psycopg.Connection, ctx: Ctx, device_id: int, status: str, note: str | None) -> dict:
    row = conn.execute("SELECT * FROM devices WHERE id = %s FOR UPDATE", (device_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    note = clean(note)
    if status != "working" and not note:
        raise field_error("note", "required")
    conn.execute("UPDATE devices SET status = %s, status_note = %s, updated_at = now() WHERE id = %s", (status, note, device_id))
    audit.record(conn, "devices.status_changed", ctx=ctx, entity="device", entity_id=device_id,
                 details={"name": row["name"], "from": row["status"], "to": status, "note": note})
    return {"id": device_id, "status": status}


# ---------- faults ----------

def faults(conn: psycopg.Connection, *, device_id=None, status=None) -> list[dict]:
    return conn.execute(
        """SELECT f.*, d.name AS device, d.status AS device_status, r.name_ar AS room_ar, r.name_en AS room_en,
                  u.full_name_ar AS reported_by_ar, u.full_name_en AS reported_by_en,
                  x.full_name_ar AS fixed_by_ar, x.full_name_en AS fixed_by_en
           FROM device_faults f JOIN devices d ON d.id = f.device_id LEFT JOIN rooms r ON r.id = d.room_id
           LEFT JOIN users u ON u.id = f.reported_by LEFT JOIN users x ON x.id = f.fixed_by
           WHERE (%(d)s::int IS NULL OR f.device_id = %(d)s::int) AND (%(s)s::text IS NULL OR f.status = %(s)s::text)
           ORDER BY (f.status = 'open') DESC, f.reported_at DESC LIMIT 200""",
        {"d": device_id, "s": status},
    ).fetchall()


def report_fault(conn: psycopg.Connection, ctx: Ctx, body) -> dict:
    device = conn.execute("SELECT * FROM devices WHERE id = %s AND is_active FOR UPDATE", (body.device_id,)).fetchone()
    if not device:
        raise field_error("device_id", "invalid")
    row = conn.execute(
        """INSERT INTO device_faults (device_id, description, stops_use, reported_by, reported_role) VALUES (%s, %s, %s, %s, %s) RETURNING *""",
        (device["id"], clean(body.description), body.stops_use, ctx.user_id, ctx.active_role),
    ).fetchone()
    if body.stops_use and device["status"] == "working":
        conn.execute("UPDATE devices SET status = 'out_of_service', status_note = %s, updated_at = now() WHERE id = %s",
                     (f"{row['ref']}: {clean(body.description)}"[:300], device["id"]))
    audit.record(conn, "devices.fault_reported", ctx=ctx, entity="device_fault", entity_id=row["id"],
                 details={"ref": row["ref"], "device": device["name"], "stops_use": body.stops_use})
    return row


def fix_fault(conn: psycopg.Connection, ctx: Ctx, fault_id, resolution: str, back_to_work: bool) -> dict:
    f = conn.execute("SELECT * FROM device_faults WHERE id = %s FOR UPDATE", (fault_id,)).fetchone()
    if not f:
        raise AppError(404, "not_found")
    if f["status"] != "open":
        raise AppError(409, "fault_closed")
    conn.execute("UPDATE device_faults SET status = 'fixed', fixed_by = %s, fixed_at = now(), resolution = %s WHERE id = %s",
                 (ctx.user_id, clean(resolution), fault_id))
    still = conn.execute("SELECT 1 FROM device_faults WHERE device_id = %s AND status = 'open' AND stops_use", (f["device_id"],)).fetchone()
    if back_to_work and not still:
        conn.execute("UPDATE devices SET status = 'working', status_note = NULL, updated_at = now() WHERE id = %s", (f["device_id"],))
    audit.record(conn, "devices.fault_fixed", ctx=ctx, entity="device_fault", entity_id=fault_id,
                 details={"ref": f["ref"], "resolution": clean(resolution), "back_to_work": back_to_work and not still})
    return {"id": fault_id, "status": "fixed"}


# ---------- maintenance ----------

def add_maintenance(conn: psycopg.Connection, ctx: Ctx, device_id: int, *, kind: str, done_on: date, description: str,
                    technician: str | None, supplier_id: int | None, cost: Decimal, paid_from_id: int | None, fault_id=None,
                    filename: str = "", data: bytes = b"") -> dict:
    """Logs maintenance. Preventive maintenance restarts the plan. The cost posts Device maintenance / Bank or petty cash, or
    Suppliers payable when it's on credit (then it appears on the supplier's statement)."""
    device = conn.execute("SELECT * FROM devices WHERE id = %s FOR UPDATE", (device_id,)).fetchone()
    if not device:
        raise AppError(404, "not_found")
    acc.check_date(conn, done_on, "done_on")
    description = clean(description)
    if not description or len(description) < 3:
        raise field_error("description", "required")
    cost = q(cost or 0)
    supplier = None
    if supplier_id:
        supplier = conn.execute("SELECT * FROM suppliers WHERE id = %s", (supplier_id,)).fetchone()
        if not supplier:
            raise field_error("supplier_id", "invalid")
    source = None
    if cost > 0:
        if paid_from_id:
            source = acc.money_account(conn, paid_from_id, "paid_from_id", allow_drawer=False, allow_clearing=False)
        elif not supplier:
            raise field_error("paid_from_id", "required")
    fault = None
    if fault_id:
        fault = conn.execute("SELECT * FROM device_faults WHERE id = %s AND device_id = %s FOR UPDATE", (fault_id, device_id)).fetchone()
        if not fault:
            raise field_error("fault_id", "invalid")
    key = name = mime = None
    if data:
        key, name, mime = ops._store_attachment(filename, data)
    try:
        row = conn.execute(
            """INSERT INTO device_maintenance (device_id, kind, done_on, description, technician, supplier_id, cost, paid_from_id, fault_id,
                                               file_key, file_name, file_mime, created_by)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
            (device_id, kind, done_on, description, clean(technician), supplier_id, cost, source["id"] if source else None, fault_id,
             key, name, mime, ctx.user_id),
        ).fetchone()
        if cost > 0:
            k = acc.keys(conn)
            branch = conn.execute("SELECT branch_id FROM rooms WHERE id = %s", (device["room_id"],)).fetchone() if device["room_id"] else None
            credit = source["id"] if source else k["suppliers_payable"]
            acc.post(conn, day=done_on, memo=f"Maintenance ({kind}) of {device['name']}: {description}", source_type="maintenance",
                     source_id=row["id"], source_ref=row["ref"], branch_id=branch["branch_id"] if branch else ctx.active_branch_id, ctx=ctx,
                     lines=[L(k["device_maintenance"], cost, memo=supplier["name"] if supplier else None), L(credit, -cost)])
    except Exception:
        if key:
            ops._path(key).unlink(missing_ok=True)
        raise
    if kind == "preventive" and (not device["last_maintenance_on"] or done_on > device["last_maintenance_on"]):
        conn.execute("UPDATE devices SET last_maintenance_on = %s, updated_at = now() WHERE id = %s", (done_on, device_id))
    if fault and fault["status"] == "open":
        fix_fault(conn, ctx, fault_id, f"{row['ref']}: {description}", back_to_work=True)
    audit.record(conn, "devices.maintenance_added", ctx=ctx, entity="device_maintenance", entity_id=row["id"], details={
        "ref": row["ref"], "device": device["name"], "kind": kind, "cost": str(cost),
        "paid": source["name_en"] if source else ("on credit: " + supplier["name"] if supplier and cost > 0 else None), "attachment": bool(key)})
    return row


def maintenance_file(conn: psycopg.Connection, ctx: Ctx, maintenance_id):
    row = conn.execute("SELECT * FROM device_maintenance WHERE id = %s", (maintenance_id,)).fetchone()
    if not row or not row["file_key"]:
        raise AppError(404, "file_not_found")
    path = ops._path(row["file_key"])
    if not path.exists():
        raise AppError(410, "file_missing")
    audit.record(conn, "devices.maintenance_file_opened", ctx=ctx, entity="device_maintenance", entity_id=maintenance_id,
                 details={"ref": row["ref"]})
    return path, row
