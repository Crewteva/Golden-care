"""Demo data for stock, purchasing & devices (SEED_DEMO only). Kept small:

- 3 items: nitrile gloves (below the minimum), syringes, numbing cream (expires within 60 days); one store per branch;
- 2 suppliers: El-Nour Medical Supplies (30 days) and Delta Pharma Distribution (15 days);
- goods received directly from El-Nour; a Delta order received and billed, not paid yet; an El-Nour order above the
  approval limit waiting for management; a couple of uses by the nurse;
- 3 devices: the 2 lasers (one due for maintenance next week, its warranty ending soon) and an autoclave with a past
  preventive maintenance paid from petty cash.

Made through the real stock code, as the demo inventory keeper, so the journal and the stock always agree. Dates stay
inside the current month (last month is waiting to be closed in the demo)."""
import logging
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace

import psycopg

from app.core import accounting as acc
from app.core import clinic_time, devices, inventory, purchasing
from app.core.errors import AppError
from app.core.inventory_schemas import BillIn, IssueIn, IssueLineIn, PoIn, PoLineIn, ReceiveIn, ReceiveLineIn

log = logging.getLogger(__name__)
D = Decimal

INVENTORY_PERMS = {"inventory.view", "inventory.manage", "inventory.use", "devices.manage", "devices.report"}


def _actor(conn: psycopg.Connection, email: str, role: str, perms: set, branch_id: int):
    user = conn.execute("SELECT id, full_name_en FROM users WHERE email = %s", (f"{email}@demo.goldencare.local",)).fetchone()
    if not user:
        return None
    return SimpleNamespace(user_id=user["id"], label=user["full_name_en"], permissions=perms, active_role=role,
                           active_branch_id=branch_id, ip=None, user_agent=None)


def seed_demo_inventory(conn: psycopg.Connection, branch_id: int) -> None:
    if conn.execute("SELECT 1 FROM stock_lots LIMIT 1").fetchone() or conn.execute("SELECT 1 FROM stores LIMIT 1").fetchone():
        return
    keeper = _actor(conn, "inventory", "inventory", INVENTORY_PERMS, branch_id)
    nurse = _actor(conn, "nurse", "nurse", {"inventory.use", "devices.report"}, branch_id)
    accountant = _actor(conn, "accountant", "accountant", {"inventory.view", "purchasing.pay"}, branch_id)
    if not keeper or not nurse or not accountant:
        return
    try:
        with conn.transaction():
            _build(conn, keeper, nurse, accountant, branch_id)
    except AppError as exc:
        log.warning("Demo inventory skipped: %s %s", exc.code, exc.fields)


def _id(conn, sql, *args):
    return conn.execute(sql, args).fetchone()["id"]


def _build(conn: psycopg.Connection, keeper, nurse, accountant, branch_id: int) -> None:
    today = clinic_time.today()
    month = acc.month_start(today)

    def day(n: int):
        return max(month, today - timedelta(days=n))

    # ----- lists -----
    units = {}
    for ar, en in (("قطعة", "Piece"), ("علبة", "Box"), ("عبوة", "Pack"), ("أنبوبة", "Tube"), ("زجاجة", "Bottle")):
        units[en] = _id(conn, "INSERT INTO units (name_ar, name_en) VALUES (%s, %s) RETURNING id", ar, en)
    cats = {}
    for ar, en in (("مستهلكات طبية", "Medical consumables"), ("أدوية وكريمات", "Medications & creams"),
                   ("نظافة وتعقيم", "Cleaning & sterilization")):
        cats[en] = _id(conn, "INSERT INTO item_categories (name_ar, name_en) VALUES (%s, %s) RETURNING id", ar, en)
    items = {
        "gloves": _id(conn, """INSERT INTO items (name_ar, name_en, category_id, unit_id, min_qty, tracks_expiry, notes)
                               VALUES ('جوانتي نيتريل (مقاس M)', 'Nitrile gloves (size M)', %s, %s, 20, false, '100 gloves per box') RETURNING id""",
                      cats["Medical consumables"], units["Box"]),
        "syringes": _id(conn, """INSERT INTO items (name_ar, name_en, category_id, unit_id, min_qty, tracks_expiry, notes)
                                 VALUES ('سرنجات 5 مل', 'Syringes 5 ml', %s, %s, 5, true, '100 syringes per box') RETURNING id""",
                        cats["Medical consumables"], units["Box"]),
        "cream": _id(conn, """INSERT INTO items (name_ar, name_en, category_id, unit_id, min_qty, tracks_expiry)
                              VALUES ('كريم مخدر موضعي 30 جم', 'Numbing cream 30 g', %s, %s, 5, true) RETURNING id""",
                     cats["Medications & creams"], units["Tube"]),
    }
    stores = {}
    for b in conn.execute("SELECT id, name_ar, name_en FROM branches ORDER BY id").fetchall():
        stores[b["id"]] = _id(conn, "INSERT INTO stores (branch_id, name_ar, name_en) VALUES (%s, %s, %s) RETURNING id",
                              b["id"], f"المخزن الرئيسي — {b['name_ar']}", f"Main store — {b['name_en']}")
    store = stores.get(branch_id) or next(iter(stores.values()))
    elnour = _id(conn, """INSERT INTO suppliers (name, contact_name, phone, email, address, payment_terms_days, notes)
                          VALUES ('El-Nour Medical Supplies', 'Mr. Adel Fathy', '01223456781', 'orders@elnour-medical.example',
                                  'Industrial Zone 1, El Shorouk', 30, 'Delivers twice a week') RETURNING id""")
    delta = _id(conn, """INSERT INTO suppliers (name, contact_name, phone, email, address, payment_terms_days)
                         VALUES ('Delta Pharma Distribution', 'Dr. Nermeen Saleh', '01098765432', 'sales@deltapharma.example',
                                 'Nasr City, Cairo', 15) RETURNING id""")

    # ----- stock -----
    inventory.receive(conn, keeper, ReceiveIn(
        supplier_id=elnour, store_id=store, received_on=day(7), delivery_note="DN-4471",
        lines=[ReceiveLineIn(item_id=items["gloves"], qty=12, unit_cost=185),
               ReceiveLineIn(item_id=items["syringes"], qty=10, unit_cost=95, lot_no="SYR-2409", expiry=today + timedelta(days=330))]))
    po = purchasing.save_order(conn, keeper, PoIn(supplier_id=delta, store_id=store, ordered_on=day(6), expected_on=day(5),
                                                  lines=[PoLineIn(item_id=items["cream"], qty=15, unit_cost=260)]))
    manager = _actor(conn, "owner", "management", {"inventory.view", "inventory.approve"}, branch_id)
    if manager:
        purchasing.decide_order(conn, manager, po["id"], True, None)
    else:
        conn.execute("UPDATE purchase_orders SET status = 'approved' WHERE id = %s", (po["id"],))
    line = conn.execute("SELECT id FROM purchase_order_lines WHERE po_id = %s", (po["id"],)).fetchone()
    receipt = inventory.receive(conn, keeper, ReceiveIn(
        po_id=po["id"], received_on=day(5), delivery_note="DPD-20931",
        lines=[ReceiveLineIn(po_line_id=line["id"], item_id=items["cream"], qty=15, unit_cost=260, lot_no="EM-2311",
                             expiry=today + timedelta(days=45))]))
    purchasing.add_bill(conn, accountant, BillIn(supplier_id=delta, bill_no="DP-55871", bill_date=day(5), receipt_ids=[receipt["id"]]))
    purchasing.save_order(conn, keeper, PoIn(
        supplier_id=elnour, store_id=store, ordered_on=day(1), expected_on=today + timedelta(days=3), note="Monthly refill",
        lines=[PoLineIn(item_id=items["gloves"], qty=40, unit_cost=185), PoLineIn(item_id=items["syringes"], qty=20, unit_cost=95)]))

    room = conn.execute("SELECT id FROM rooms WHERE branch_id = %s AND is_active ORDER BY id LIMIT 1", (branch_id,)).fetchone()
    inventory.issue(conn, nurse, IssueIn(store_id=store, issued_on=day(3), room_id=room["id"] if room else None,
                                         note="Laser room morning set-up",
                                         lines=[IssueLineIn(item_id=items["gloves"], qty=2), IssueLineIn(item_id=items["cream"], qty=2)]))
    inventory.issue(conn, nurse, IssueIn(store_id=store, issued_on=day(1),
                                         lines=[IssueLineIn(item_id=items["gloves"], qty=1), IssueLineIn(item_id=items["syringes"], qty=2)]))

    # ----- devices -----
    laser = conn.execute("SELECT id FROM device_types WHERE is_laser ORDER BY id LIMIT 1").fetchone()["id"]
    sterilizer = conn.execute("SELECT id FROM device_types WHERE name_en LIKE 'Sterilizer%%'").fetchone()["id"]
    lasers = conn.execute("SELECT id FROM devices WHERE kind = 'laser' ORDER BY id").fetchall()
    plans = [(84, 40, 2, 650_000), (40, 420, 1, 480_000)]  # days since last maintenance, warranty days left, years owned, price
    for dev, (since, warranty, years, price) in zip(lasers, plans):
        conn.execute(
            """UPDATE devices SET type_id = %s, purchase_date = %s, purchase_price = %s, warranty_end = %s, maintenance_every_days = 90,
                      last_maintenance_on = %s WHERE id = %s""",
            (laser, today - timedelta(days=365 * years), price, today + timedelta(days=warranty), today - timedelta(days=since), dev["id"]))
    autoclave = conn.execute(
        """INSERT INTO devices (kind, type_id, name, model, serial_no, room_id, supplier_id, purchase_date, purchase_price, warranty_end,
                                maintenance_every_days, notes)
           VALUES ('other', %s, 'Autoclave B-Class 23 L', 'Melag Vacuklav 31 B+', 'MLG-31B-77412', %s, %s, %s, 185000, %s, 45,
                   'Spore test every week; preventive service every 45 days') RETURNING id""",
        (sterilizer, room["id"] if room else None, elnour, today - timedelta(days=500), today + timedelta(days=230)),
    ).fetchone()["id"]
    petty = acc.keys(conn)["petty_cash"]
    devices.add_maintenance(conn, keeper, autoclave, kind="preventive", done_on=day(6),
                            description="Preventive service: door seal replaced, chamber cleaned, test cycle passed",
                            technician="Eng. Mahmoud Saad", supplier_id=elnour, cost=D(850), paid_from_id=petty)


# ---------- transfers, returns, two-person payments, calibration, pulse wear, bookings ----------

def seed_demo_inventory_completion(conn: psycopg.Connection, branch_id: int) -> None:
    """Runs once, after the base demo above (also on a demo database that already had it):

    - a second store (the laser room cabinet) and three transfers: one received with a box short, one on the way, one
      waiting to be dispatched;
    - returns: one approved (owed to El-Nour goes down), one waiting for management;
    - a Delta payment prepared by the accountant, waiting for a second person to approve it;
    - calibration plans (the GentleMax calibration is overdue) and laser pulse limits (the GentleMax is past 90 %);
    - device bookings tomorrow."""
    if conn.execute("SELECT 1 FROM stock_transfers LIMIT 1").fetchone() or conn.execute("SELECT 1 FROM supplier_returns LIMIT 1").fetchone():
        return
    if not conn.execute("SELECT 1 FROM stock_lots LIMIT 1").fetchone():
        return
    keeper = _actor(conn, "inventory", "inventory", INVENTORY_PERMS, branch_id)
    manager = _actor(conn, "owner", "management", {"inventory.view", "inventory.approve"}, branch_id)
    accountant = _actor(conn, "accountant", "accountant", {"inventory.view", "purchasing.pay"}, branch_id)
    nurse = _actor(conn, "nurse", "nurse", {"inventory.use", "devices.report"}, branch_id)
    if not keeper or not manager or not accountant or not nurse:
        return
    try:
        with conn.transaction():
            _build_completion(conn, keeper, manager, accountant, nurse, branch_id)
    except AppError as exc:
        log.warning("Demo inventory (transfers, returns, devices) skipped: %s %s", exc.code, exc.fields)


def _build_completion(conn: psycopg.Connection, keeper, manager, accountant, nurse, branch_id: int) -> None:
    from datetime import time
    from app.core import transfers
    from app.core.inventory_schemas import (
        ArrivalIn, ArrivedLotIn, BookingIn, DispatchIn, ReturnIn, SupplierPayIn, TransferIn, TransferLineIn,
    )
    today = clinic_time.today()
    month = acc.month_start(today)

    def day(n: int):
        return max(month, today - timedelta(days=n))

    main = conn.execute("SELECT id FROM stores WHERE branch_id = %s ORDER BY id LIMIT 1", (branch_id,)).fetchone()["id"]
    cabinet = conn.execute(
        """INSERT INTO stores (branch_id, name_ar, name_en) VALUES (%s, 'خزانة غرفة الليزر', 'Laser room cabinet')
           ON CONFLICT DO NOTHING RETURNING id""", (branch_id,)).fetchone()
    cabinet = cabinet["id"] if cabinet else conn.execute("SELECT id FROM stores WHERE name_en = 'Laser room cabinet'").fetchone()["id"]
    item = {r["key"]: r["id"] for r in conn.execute(
        """SELECT id, CASE WHEN name_en LIKE 'Nitrile%%' THEN 'gloves' WHEN name_en LIKE 'Syringes%%' THEN 'syringes'
                           WHEN name_en LIKE 'Numbing%%' THEN 'cream' END AS key FROM items""").fetchall() if r["key"]}

    # ----- transfers: received with a shortage, on the way, waiting -----
    t1 = transfers.request_transfer(conn, keeper, TransferIn(
        from_store_id=main, to_store_id=cabinet, note="Weekly top-up of the laser room",
        lines=[TransferLineIn(item_id=item["gloves"], qty=2), TransferLineIn(item_id=item["cream"], qty=4)]))
    transfers.dispatch_transfer(conn, keeper, t1["id"], DispatchIn(dispatched_on=day(2)))
    lots = conn.execute("SELECT o.id, o.qty_sent, i.name_en FROM stock_transfer_lots o JOIN items i ON i.id = o.item_id WHERE transfer_id = %s",
                        (t1["id"],)).fetchall()
    transfers.receive_transfer(conn, keeper, t1["id"], ArrivalIn(
        received_on=day(2), shortage_note="One tube of numbing cream arrived crushed and leaking; discarded",
        lots=[ArrivedLotIn(lot_id=lt["id"], qty_received=D(lt["qty_sent"]) - (1 if lt["name_en"].startswith("Numbing") else 0)) for lt in lots]))
    t2 = transfers.request_transfer(conn, keeper, TransferIn(
        from_store_id=main, to_store_id=cabinet, note="Syringes for the procedure tray",
        lines=[TransferLineIn(item_id=item["syringes"], qty=1)]))
    transfers.dispatch_transfer(conn, keeper, t2["id"], DispatchIn(dispatched_on=day(0)))
    transfers.request_transfer(conn, keeper, TransferIn(
        from_store_id=cabinet, to_store_id=main, note="Return unused gloves before the count",
        lines=[TransferLineIn(item_id=item["gloves"], qty=1)]))

    # ----- returns to suppliers -----
    syringes = conn.execute(
        """SELECT l.id FROM stock_lots l JOIN goods_receipts g ON g.id = l.receipt_id
           WHERE l.store_id = %s AND l.item_id = %s AND l.qty_on_hand > 0 ORDER BY l.id LIMIT 1""", (main, item["syringes"])).fetchone()
    if syringes:
        r = transfers.request_return(conn, keeper, ReturnIn(lot_id=syringes["id"], qty=1,
                                                            reason="Wrong gauge delivered (21G instead of 23G); supplier will credit"))
        transfers.decide_return(conn, manager, r["id"], True, None)
    cream = conn.execute(
        """SELECT l.id FROM stock_lots l JOIN goods_receipts g ON g.id = l.receipt_id
           WHERE l.store_id = %s AND l.item_id = %s AND l.qty_on_hand >= 2 ORDER BY l.id LIMIT 1""", (main, item["cream"])).fetchone()
    if cream:
        transfers.request_return(conn, keeper, ReturnIn(lot_id=cream["id"], qty=2, reason="Seal broken on two tubes of batch EM-2311"))

    # ----- a payment waiting for its second person -----
    bill = conn.execute("SELECT id, supplier_id FROM supplier_bills WHERE bill_no = 'DP-55871'").fetchone()
    bank = conn.execute("SELECT id FROM accounts WHERE is_money AND is_active AND system_key = 'bank' LIMIT 1").fetchone() \
        or conn.execute("SELECT id FROM accounts WHERE is_money AND is_active AND system_key = 'petty_cash' LIMIT 1").fetchone()
    if bill and bank:
        purchasing.prepare_payment(conn, accountant, SupplierPayIn(
            supplier_id=bill["supplier_id"], bill_id=bill["id"], paid_on=today, amount=D(2000), paid_from_id=bank["id"],
            reference="Bank transfer — CIB", note="First instalment on DP-55871"))

    # ----- calibration and pulse wear -----
    lasers = conn.execute("SELECT id, pulse_counter FROM devices WHERE kind = 'laser' ORDER BY id").fetchall()
    plans = [(1_000_000, 930_000, 196), (500_000, 118_000, 40)]  # pulse limit, pulses since service, days since calibration
    for dev, (limit, since, cal) in zip(lasers, plans):
        conn.execute("""UPDATE devices SET calibration_every_days = 180, last_calibration_on = %s, pulse_limit = %s,
                               pulses_at_service = GREATEST(pulse_counter - %s, 0) WHERE id = %s""",
                     (today - timedelta(days=cal), limit, since, dev["id"]))
    conn.execute("UPDATE devices SET calibration_every_days = 365, last_calibration_on = %s WHERE name = 'Autoclave B-Class 23 L'",
                 (today - timedelta(days=100),))
    if len(lasers) > 1:
        devices.add_maintenance(conn, keeper, lasers[1]["id"], kind="calibration", done_on=day(3),
                                description="Energy output calibrated with the power meter; within ±5 % on all spot sizes",
                                technician="Eng. Walid Hamdy", supplier_id=None, cost=D(0), paid_from_id=None)

    # ----- bookings (tomorrow, so they're never in the past) -----
    tomorrow = today + timedelta(days=1)
    room = conn.execute("SELECT id FROM rooms WHERE branch_id = %s AND name_en ILIKE 'Laser%%' LIMIT 1", (branch_id,)).fetchone()
    for dev, (start, end, purpose) in zip(lasers, [(time(10), time(12), "Laser hair removal block — Dr. Rania Samir"),
                                                   (time(13), time(14, 30), "Fractional resurfacing — two follow-up patients")]):
        devices.book(conn, nurse, BookingIn(device_id=dev["id"], day=tomorrow, starts=start, ends=end, purpose=purpose,
                                            room_id=room["id"] if room else None))
