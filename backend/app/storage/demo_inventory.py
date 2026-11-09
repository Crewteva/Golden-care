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
