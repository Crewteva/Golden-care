"""Invoices: built from the price list (never typed prices), from an arrived/finished appointment, a package sale,
a session taken from a package the patient already bought, or a treatment-plan item that's ready to bill.

Life of an invoice:  draft → (pending_approval when the discount is over the limit) → issued → void (with approval)
A draft can be cancelled. Once issued it gets its number (INV-…, no gaps) and the database refuses any change to it
except payment progress and voiding. Doctor shares are worked out and frozen when it's issued.

Approvals (billing.approve, management): discounts over the limit, voids, refunds and package cancellations."""
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

import psycopg
from psycopg.types.json import Jsonb

from app.core import audit, clinic_time
from app.core.appointments import price_on
from app.core.billing_schemas import InvoiceCreateIn, InvoiceUpdateIn, IssueIn, LineIn, PackageCancelIn, VoidIn
from app.core.billing_setup import doctor_share, rules, share_rule_for
from app.core.errors import AppError, field_error
from app.core.normalize import clean_name, normalize_name
from app.core.session import Ctx

D = Decimal
CENT = D("0.01")
BILLABLE_APPT = ("arrived", "in_room", "completed")
OPEN_INVOICE = ("draft", "pending_approval")


def q(value) -> Decimal:
    return D(value or 0).quantize(CENT, rounding=ROUND_HALF_UP)


def can_see_shares(ctx: Ctx) -> bool:
    return "billing.approve" in ctx.permissions or ctx.active_role in ("accountant", "auditor")


INVOICE_SELECT = """
    SELECT i.*, (i.total - i.paid_total) AS balance,
           p.mrn, p.full_name_ar AS patient_name_ar, p.full_name_en AS patient_name_en, p.phone AS patient_phone,
           b.name_ar AS branch_name_ar, b.name_en AS branch_name_en, b.address_ar AS branch_address_ar, b.address_en AS branch_address_en,
           ib.full_name_ar AS issued_by_ar, ib.full_name_en AS issued_by_en,
           cb.full_name_ar AS created_by_ar, cb.full_name_en AS created_by_en,
           vb.full_name_ar AS voided_by_ar, vb.full_name_en AS voided_by_en,
           ab.full_name_ar AS discount_approved_by_ar, ab.full_name_en AS discount_approved_by_en,
           ap.ref AS appointment_ref, ap.starts_at AS appointment_at
    FROM invoices i
    JOIN patients p ON p.id = i.patient_id
    JOIN branches b ON b.id = i.branch_id
    LEFT JOIN users ib ON ib.id = i.issued_by
    LEFT JOIN users cb ON cb.id = i.created_by
    LEFT JOIN users vb ON vb.id = i.voided_by
    LEFT JOIN users ab ON ab.id = i.discount_approved_by
    LEFT JOIN appointments ap ON ap.id = i.appointment_id
"""


def get(conn: psycopg.Connection, invoice_id, lock: bool = False) -> dict:
    if lock:
        conn.execute("SELECT 1 FROM invoices WHERE id = %s FOR UPDATE", (invoice_id,))
    row = conn.execute(f"{INVOICE_SELECT} WHERE i.id = %s", (invoice_id,)).fetchone()
    if not row:
        raise AppError(404, "invoice_not_found")
    return row


def _patient(conn: psycopg.Connection, patient_id) -> dict:
    row = conn.execute("SELECT id, mrn, full_name_ar, full_name_en, phone, date_of_birth, gender FROM patients WHERE id = %s",
                       (patient_id,)).fetchone()
    if not row:
        raise AppError(404, "patient_not_found")
    return row


def credit_balance(conn: psycopg.Connection, patient_id) -> Decimal:
    return q(conn.execute("SELECT COALESCE(sum(amount), 0) AS b FROM patient_credit WHERE patient_id = %s", (patient_id,)).fetchone()["b"])


def _branch(conn: psycopg.Connection, ctx: Ctx, appointment: dict | None = None) -> int:
    if appointment:
        return appointment["branch_id"]
    if ctx.active_branch_id:
        return ctx.active_branch_id
    return conn.execute("SELECT id FROM branches ORDER BY id LIMIT 1").fetchone()["id"]


def _is_doctor(conn: psycopg.Connection, doctor_id) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM users u WHERE u.id = %s AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_code = 'doctor')",
        (doctor_id,),
    ).fetchone())


# ---------- packages the patient bought ----------

PP_SELECT = """
    SELECT pp.*, s.code AS service_code, s.name_ar AS service_name_ar, s.name_en AS service_name_en,
           (SELECT count(*) FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
            WHERE l.patient_package_id = pp.id AND i.status = 'issued') AS used,
           si.ref AS invoice_ref, si.id AS invoice_id
    FROM patient_packages pp
    JOIN services s ON s.id = pp.service_id
    JOIN invoice_lines sl ON sl.id = pp.sale_line_id
    JOIN invoices si ON si.id = sl.invoice_id
"""


def _pp_state(row: dict, today: date) -> dict:
    row["remaining"] = row["sessions_total"] - row["used"]
    if row["status"] == "cancelled":
        state = "cancelled"
    elif row["remaining"] <= 0:
        state = "used_up"
    elif row["expires_on"] and row["expires_on"] < today:
        state = "expired"
    else:
        state = "active"
    row["state"] = state
    return row


def patient_packages(conn: psycopg.Connection, patient_ids: list) -> list[dict]:
    today = clinic_time.today()
    rows = conn.execute(f"{PP_SELECT} WHERE pp.patient_id = ANY(%s) ORDER BY pp.sold_at DESC", (patient_ids,)).fetchall()
    return [_pp_state(r, today) for r in rows]


def _usable_package(conn: psycopg.Connection, patient_id, service_id) -> dict | None:
    for pp in patient_packages(conn, [patient_id]):
        if pp["state"] == "active" and pp["service_id"] == service_id:
            return pp
    return None


# ---------- lines: price them from the price list, then share out the discount and add VAT ----------

def _resolve_lines(conn: psycopg.Connection, patient_id, lines: list[LineIn], invoice_id=None) -> list[dict]:
    today = clinic_time.today()
    out, used_pp, used_items = [], {}, set()
    for n, line in enumerate(lines):
        def bad(field: str, code: str = "invalid"):
            return field_error(f"lines.{n}.{field}", code)

        appt = None
        if line.appointment_id:
            appt = conn.execute("SELECT id, patient_id, doctor_id, branch_id, status FROM appointments WHERE id = %s",
                                (line.appointment_id,)).fetchone()
            if not appt or appt["patient_id"] != patient_id:
                raise bad("appointment_id")
        doctor_id = line.doctor_id or (appt["doctor_id"] if appt else None)
        if line.doctor_id and not _is_doctor(conn, line.doctor_id):
            raise bad("doctor_id")
        row = {"kind": line.kind, "service_id": None, "package_id": None, "patient_package_id": None, "plan_item_id": None,
               "appointment_id": line.appointment_id, "doctor_id": doctor_id, "qty": line.qty}

        if line.kind == "service":
            service = conn.execute("SELECT * FROM services WHERE id = %s AND is_active", (line.service_id,)).fetchone() if line.service_id else None
            if not service:
                raise bad("service_id")
            booked = None
            if appt:
                booked = conn.execute("SELECT price FROM appointment_services WHERE appointment_id = %s AND service_id = %s",
                                      (appt["id"], service["id"])).fetchone()
            price = booked["price"] if booked and booked["price"] is not None else price_on(conn, service["id"], doctor_id, today)
            if price is None:
                raise bad("service_id", "no_price")
            row.update(service_id=service["id"], name_ar=service["name_ar"], name_en=service["name_en"], unit_price=q(price),
                       vat_rate=D(service["vat_rate"]), unit_cost=D(service["direct_cost"]))

        elif line.kind == "package_sale":
            pkg = conn.execute(
                "SELECT k.*, s.vat_rate FROM packages k JOIN services s ON s.id = k.service_id WHERE k.id = %s AND k.is_active AND s.is_active",
                (line.package_id,),
            ).fetchone() if line.package_id else None
            if not pkg:
                raise bad("package_id")
            row.update(package_id=pkg["id"], service_id=pkg["service_id"], name_ar=pkg["name_ar"], name_en=pkg["name_en"],
                       unit_price=q(pkg["price"]), vat_rate=D(pkg["vat_rate"]), unit_cost=D(0), qty=1, doctor_id=None)

        elif line.kind == "package_use":
            pp = conn.execute(f"{PP_SELECT} WHERE pp.id = %s", (line.patient_package_id,)).fetchone() if line.patient_package_id else None
            if not pp or pp["patient_id"] != patient_id:
                raise bad("patient_package_id")
            pp = _pp_state(pp, today)
            taken = used_pp.get(pp["id"], 0) + 1
            if pp["state"] != "active" or taken > pp["remaining"]:
                raise bad("patient_package_id", f"package_{pp['state']}" if pp["state"] != "active" else "package_used_up")
            used_pp[pp["id"]] = taken
            service = conn.execute("SELECT * FROM services WHERE id = %s", (pp["service_id"],)).fetchone()
            row.update(patient_package_id=pp["id"], service_id=pp["service_id"],
                       name_ar=f"{service['name_ar']} — جلسة من {pp['name_ar']}", name_en=f"{service['name_en']} — session from {pp['name_en']}",
                       unit_price=D("0.00"), vat_rate=D(0), unit_cost=D(service["direct_cost"]), qty=1,
                       session_value=q(D(pp["price_paid"]) / pp["sessions_total"]))

        else:  # plan_item
            item = conn.execute(
                """
                SELECT i.*, tp.patient_id, tp.doctor_id AS plan_doctor_id, tp.ref AS plan_ref, s.name_ar, s.name_en, s.vat_rate, s.direct_cost
                FROM treatment_plan_items i JOIN treatment_plans tp ON tp.id = i.plan_id JOIN services s ON s.id = i.service_id
                WHERE i.id = %s
                """,
                (line.plan_item_id,),
            ).fetchone() if line.plan_item_id else None
            if not item or item["patient_id"] != patient_id:
                raise bad("plan_item_id")
            if item["billing_status"] != "to_bill" or item["id"] in used_items:
                raise bad("plan_item_id", "already_billed")
            if conn.execute(
                """SELECT 1 FROM invoice_lines l JOIN invoices v ON v.id = l.invoice_id
                   WHERE l.plan_item_id = %s AND v.status IN ('draft', 'pending_approval') AND v.id IS DISTINCT FROM %s""",
                (item["id"], invoice_id),
            ).fetchone():
                raise bad("plan_item_id", "on_other_invoice")
            used_items.add(item["id"])
            where = f" #{item['tooth']}" if item["tooth"] else ""
            row.update(plan_item_id=item["id"], service_id=item["service_id"], doctor_id=line.doctor_id or item["plan_doctor_id"],
                       name_ar=f"{item['name_ar']}{where} ({item['plan_ref']})", name_en=f"{item['name_en']}{where} ({item['plan_ref']})",
                       unit_price=q(item["price"]), vat_rate=D(item["vat_rate"]), unit_cost=D(item["direct_cost"]), qty=1)
        out.append(row)
    return out


def _compute(lines: list[dict], discount: Decimal) -> dict:
    """Shares the invoice discount across the lines in proportion to their value, then adds each line's VAT."""
    subtotal = q(sum(r["unit_price"] * r["qty"] for r in lines))
    discount = q(discount)
    if discount > subtotal:
        raise field_error("discount_amount", "too_high")
    left = discount
    priced = [r for r in lines if r["unit_price"] * r["qty"] > 0]
    for r in lines:
        gross = q(r["unit_price"] * r["qty"])
        if r is (priced[-1] if priced else None):
            share = left
        else:
            share = q(discount * gross / subtotal) if subtotal else D(0)
            share = min(share, left)
        left -= share
        r["discount"] = share
        net = gross - share
        r["vat_amount"] = q(net * r["vat_rate"] / 100)
        r["line_total"] = q(net + r["vat_amount"])
        r["cost"] = q(r["unit_cost"] * r["qty"])
    vat_total = q(sum(r["vat_amount"] for r in lines))
    return {"subtotal": subtotal, "discount_amount": discount, "vat_total": vat_total, "total": q(subtotal - discount + vat_total)}


def _write(conn: psycopg.Connection, invoice_id, lines: list[dict], totals: dict, reason: str | None, notes: str | None) -> None:
    conn.execute("DELETE FROM invoice_lines WHERE invoice_id = %s", (invoice_id,))
    for pos, r in enumerate(lines, start=1):
        conn.execute(
            """
            INSERT INTO invoice_lines (invoice_id, position, kind, service_id, package_id, patient_package_id, plan_item_id, appointment_id,
                                       doctor_id, name_ar, name_en, qty, unit_price, discount, vat_rate, vat_amount, line_total, cost)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (invoice_id, pos, r["kind"], r["service_id"], r["package_id"], r["patient_package_id"], r["plan_item_id"], r["appointment_id"],
             r["doctor_id"], r["name_ar"], r["name_en"], r["qty"], r["unit_price"], r["discount"], r["vat_rate"], r["vat_amount"],
             r["line_total"], r["cost"]),
        )
    conn.execute(
        """
        UPDATE invoices SET subtotal = %s, discount_amount = %s, discount_reason = %s, vat_total = %s, total = %s, notes = %s,
               updated_at = now()
        WHERE id = %s
        """,
        (totals["subtotal"], totals["discount_amount"], reason if totals["discount_amount"] > 0 else None, totals["vat_total"],
         totals["total"], notes, invoice_id),
    )


def _lines_in(rows: list[dict]) -> list[LineIn]:
    return [LineIn(kind=r["kind"], service_id=r["service_id"], package_id=r["package_id"], patient_package_id=r["patient_package_id"],
                   plan_item_id=r["plan_item_id"], appointment_id=r["appointment_id"], doctor_id=r["doctor_id"], qty=r["qty"])
            for r in rows]


# ---------- create / edit / cancel a draft ----------

def create(conn: psycopg.Connection, ctx: Ctx, body: InvoiceCreateIn) -> dict:
    _patient(conn, body.patient_id)
    appt = None
    if body.appointment_id:
        appt = conn.execute("SELECT * FROM appointments WHERE id = %s FOR UPDATE", (body.appointment_id,)).fetchone()
        if not appt or appt["patient_id"] != body.patient_id:
            raise field_error("appointment_id", "invalid")
        if appt["status"] not in BILLABLE_APPT:
            raise AppError(409, "not_arrived")
        existing = conn.execute(
            "SELECT id, status FROM invoices WHERE appointment_id = %s AND status IN ('draft', 'pending_approval', 'issued') ORDER BY created_at LIMIT 1",
            (appt["id"],),
        ).fetchone()
        if existing:
            if existing["status"] == "issued":
                raise AppError(409, "already_invoiced", invoice_id=existing["id"])
            return {"id": existing["id"]}
    row = conn.execute(
        "INSERT INTO invoices (patient_id, branch_id, appointment_id, created_by) VALUES (%s, %s, %s, %s) RETURNING id",
        (body.patient_id, _branch(conn, ctx, appt), body.appointment_id, ctx.user_id),
    ).fetchone()

    # suggest what to bill: the appointment's services (from a package when the patient has sessions left) and plan items ready to bill
    suggested: list[LineIn] = []
    if appt:
        taken: dict = {}
        for s in conn.execute("SELECT service_id FROM appointment_services WHERE appointment_id = %s ORDER BY position", (appt["id"],)):
            pp = _usable_package(conn, body.patient_id, s["service_id"])
            if pp and taken.get(pp["id"], 0) < pp["remaining"]:
                taken[pp["id"]] = taken.get(pp["id"], 0) + 1
                suggested.append(LineIn(kind="package_use", patient_package_id=pp["id"], appointment_id=appt["id"], doctor_id=appt["doctor_id"]))
            else:
                suggested.append(LineIn(kind="service", service_id=s["service_id"], appointment_id=appt["id"], doctor_id=appt["doctor_id"]))
    for item in conn.execute(
        """
        SELECT i.id FROM treatment_plan_items i JOIN treatment_plans tp ON tp.id = i.plan_id
        WHERE tp.patient_id = %s AND i.billing_status = 'to_bill'
          AND NOT EXISTS (SELECT 1 FROM invoice_lines l JOIN invoices v ON v.id = l.invoice_id
                          WHERE l.plan_item_id = i.id AND v.status IN ('draft', 'pending_approval'))
        ORDER BY i.done_at, i.position
        """,
        (body.patient_id,),
    ):
        suggested.append(LineIn(kind="plan_item", plan_item_id=item["id"]))
    if suggested:
        try:
            lines = _resolve_lines(conn, body.patient_id, suggested, row["id"])
        except AppError:
            lines = []          # e.g. a service without a price: start empty, the cashier adds lines by hand
        _write(conn, row["id"], lines, _compute(lines, D(0)), None, None)
    audit.record(conn, "billing.invoice_drafted", ctx=ctx, entity="invoice", entity_id=row["id"],
                 details={"patient_id": str(body.patient_id), **({"appointment_id": str(appt["id"])} if appt else {})})
    return row


def _editable(conn: psycopg.Connection, invoice_id) -> dict:
    inv = get(conn, invoice_id, lock=True)
    if inv["status"] not in OPEN_INVOICE:
        raise AppError(409, "record_locked")
    return inv


def _withdraw(conn: psycopg.Connection, ctx: Ctx, invoice_id) -> None:
    conn.execute(
        """UPDATE approval_requests SET status = 'withdrawn', decided_at = now(), decided_by = %s, decision_note = 'edited'
           WHERE invoice_id = %s AND kind = 'discount' AND status = 'pending'""",
        (ctx.user_id, invoice_id),
    )


def update(conn: psycopg.Connection, ctx: Ctx, invoice_id, body: InvoiceUpdateIn) -> None:
    inv = _editable(conn, invoice_id)
    reason = clean_name(body.discount_reason)
    if body.discount_amount > 0:
        if not ({"billing.discount", "billing.approve"} & ctx.permissions):
            raise AppError(403, "forbidden", permission="billing.discount")
        if not reason or len(reason) < 3:
            raise field_error("discount_reason", "required")
    lines = _resolve_lines(conn, inv["patient_id"], body.lines, invoice_id)
    totals = _compute(lines, body.discount_amount)
    if inv["status"] == "pending_approval":
        _withdraw(conn, ctx, invoice_id)
        conn.execute("UPDATE invoices SET status = 'draft' WHERE id = %s", (invoice_id,))
    _write(conn, invoice_id, lines, totals, reason, clean_name(body.notes))


def cancel(conn: psycopg.Connection, ctx: Ctx, invoice_id) -> None:
    inv = _editable(conn, invoice_id)
    _withdraw(conn, ctx, invoice_id)
    conn.execute("UPDATE invoices SET status = 'cancelled', updated_at = now() WHERE id = %s", (invoice_id,))
    audit.record(conn, "billing.invoice_cancelled", ctx=ctx, entity="invoice", entity_id=invoice_id,
                 details={"patient_id": str(inv["patient_id"]), "total": str(inv["total"])})


# ---------- issue ----------

def _schedule(total: Decimal, body: IssueIn, max_count: int) -> list[tuple[int, date, Decimal]]:
    if body.installments == 0:
        return []
    if body.installments > max_count:
        raise field_error("installments", "too_many")
    down = q(body.down_payment)
    rest = total - down
    if down > total or rest <= 0:
        raise field_error("down_payment", "too_high")
    today = clinic_time.today()
    first = body.first_due_on or (today + timedelta(days=30))
    if first < today:
        raise field_error("first_due_on", "past")
    each = (rest / body.installments).quantize(CENT, rounding="ROUND_DOWN")
    plan = [(0, today, down)] if down > 0 else []
    for k in range(body.installments):
        amount = each if k < body.installments - 1 else rest - each * (body.installments - 1)
        month = first.month - 1 + k
        year, month = first.year + month // 12, month % 12 + 1
        day = min(first.day, 28)
        plan.append((k + 1, date(year, month, day), q(amount)))
    return plan


def issue(conn: psycopg.Connection, ctx: Ctx, invoice_id, body: IssueIn) -> dict:
    inv = _editable(conn, invoice_id)
    if inv["status"] == "pending_approval":
        raise AppError(409, "awaiting_approval")
    lines = conn.execute("SELECT * FROM invoice_lines WHERE invoice_id = %s ORDER BY position", (invoice_id,)).fetchall()
    if not lines:
        raise AppError(422, "invoice_empty")
    # check again: a package session or plan item may have been billed elsewhere since the draft was saved
    resolved = _resolve_lines(conn, inv["patient_id"], _lines_in(lines), invoice_id)
    totals = _compute(resolved, D(inv["discount_amount"]))
    settings = rules(conn)
    _schedule(totals["total"], body, int(settings["max_installments"]))       # validate before anything is saved
    pct = (totals["discount_amount"] / totals["subtotal"] * 100) if totals["subtotal"] else D(0)
    needs_approval = totals["discount_amount"] > 0 and "billing.approve" not in ctx.permissions and (
        "billing.discount" not in ctx.permissions or pct > D(settings["max_discount_pct"]))
    if needs_approval:
        conn.execute("UPDATE invoices SET status = 'pending_approval', updated_at = now() WHERE id = %s", (invoice_id,))
        conn.execute(
            """
            INSERT INTO approval_requests (kind, invoice_id, patient_id, amount, reason, payload, requested_by)
            VALUES ('discount', %s, %s, %s, %s, %s, %s)
            """,
            (invoice_id, inv["patient_id"], totals["discount_amount"], inv["discount_reason"] or "-",
             Jsonb({**body.model_dump(mode="json"), "pct": float(round(pct, 1)), "subtotal": str(totals["subtotal"])}), ctx.user_id),
        )
        audit.record(conn, "billing.discount_requested", ctx=ctx, entity="invoice", entity_id=invoice_id,
                     details={"patient_id": str(inv["patient_id"]), "discount": str(totals["discount_amount"]), "pct": float(round(pct, 1))})
        return {"status": "pending_approval"}
    _finalize(conn, ctx, inv, body, issued_by=ctx.user_id,
              approved_by=ctx.user_id if totals["discount_amount"] > 0 and "billing.approve" in ctx.permissions else None)
    return {"status": "issued"}


def _finalize(conn: psycopg.Connection, ctx: Ctx, inv: dict, body: IssueIn, *, issued_by, approved_by=None) -> None:
    invoice_id = inv["id"]
    today = clinic_time.today()
    rows = conn.execute("SELECT * FROM invoice_lines WHERE invoice_id = %s ORDER BY position", (invoice_id,)).fetchall()
    resolved = _resolve_lines(conn, inv["patient_id"], _lines_in(rows), invoice_id)
    totals = _compute(resolved, D(inv["discount_amount"]))
    _write(conn, invoice_id, resolved, totals, inv["discount_reason"], inv["notes"])
    rows = conn.execute("SELECT * FROM invoice_lines WHERE invoice_id = %s ORDER BY position", (invoice_id,)).fetchall()
    for r, calc in zip(rows, resolved):
        share = D(0)
        if r["doctor_id"] and r["kind"] != "package_sale":
            rule = share_rule_for(conn, r["doctor_id"], r["service_id"], today)
            net = calc["session_value"] if r["kind"] == "package_use" else D(r["unit_price"]) * r["qty"] - D(r["discount"])
            share = doctor_share(rule, net=net, cost=D(r["cost"]), qty=r["qty"])
        conn.execute("UPDATE invoice_lines SET doctor_share = %s WHERE id = %s", (share, r["id"]))
        if r["kind"] == "plan_item":
            conn.execute("UPDATE treatment_plan_items SET billing_status = 'billed' WHERE id = %s", (r["plan_item_id"],))
        if r["kind"] == "package_sale":
            pkg = conn.execute("SELECT * FROM packages WHERE id = %s", (r["package_id"],)).fetchone()
            single = price_on(conn, pkg["service_id"], None, today) or pkg["price"] / pkg["sessions"]
            conn.execute(
                """
                INSERT INTO patient_packages (patient_id, package_id, service_id, name_ar, name_en, sessions_total, price_paid, full_price,
                                              sale_line_id, expires_on)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (inv["patient_id"], pkg["id"], pkg["service_id"], pkg["name_ar"], pkg["name_en"], pkg["sessions"],
                 q(D(r["unit_price"]) - D(r["discount"])), q(single), r["id"],
                 today + timedelta(days=pkg["valid_days"]) if pkg["valid_days"] else None),
            )
    for seq, due_on, amount in _schedule(totals["total"], body, int(rules(conn)["max_installments"])):
        conn.execute("INSERT INTO invoice_installments (invoice_id, seq, due_on, amount) VALUES (%s, %s, %s, %s)",
                     (invoice_id, seq, due_on, amount))
    ref = conn.execute("SELECT 'INV-' || lpad(nextval('invoices_ref_seq')::text, 6, '0') AS ref").fetchone()["ref"]
    conn.execute(
        """
        UPDATE invoices SET status = 'issued', ref = %s, issued_at = now(), issued_by = %s, discount_approved_by = %s, updated_at = now()
        WHERE id = %s
        """,
        (ref, issued_by, approved_by, invoice_id),
    )
    audit.record(conn, "billing.invoice_issued", ctx=ctx, entity="invoice", entity_id=invoice_id, details={
        "ref": ref, "patient_id": str(inv["patient_id"]), "total": str(totals["total"]), "discount": str(totals["discount_amount"]),
        "installments": body.installments})


# ---------- void (needs approval) ----------

def _sold_packages_used(conn: psycopg.Connection, invoice_id) -> bool:
    return bool(conn.execute(
        """
        SELECT 1 FROM patient_packages pp JOIN invoice_lines sl ON sl.id = pp.sale_line_id
        JOIN invoice_lines ul ON ul.patient_package_id = pp.id JOIN invoices ui ON ui.id = ul.invoice_id AND ui.status = 'issued'
        WHERE sl.invoice_id = %s LIMIT 1
        """,
        (invoice_id,),
    ).fetchone())


def void(conn: psycopg.Connection, ctx: Ctx, invoice_id, body: VoidIn) -> dict:
    inv = get(conn, invoice_id, lock=True)
    if inv["status"] != "issued":
        raise AppError(409, "record_locked")
    if _sold_packages_used(conn, invoice_id):
        raise AppError(409, "package_in_use")
    reason = body.reason.strip()
    if "billing.approve" in ctx.permissions:
        _do_void(conn, ctx, inv, reason, body.refund_method)
        return {"status": "void"}
    if conn.execute("SELECT 1 FROM approval_requests WHERE invoice_id = %s AND kind = 'void' AND status = 'pending'", (invoice_id,)).fetchone():
        raise AppError(409, "already_requested")
    conn.execute(
        "INSERT INTO approval_requests (kind, invoice_id, patient_id, amount, reason, payload, requested_by) VALUES ('void', %s, %s, %s, %s, %s, %s)",
        (invoice_id, inv["patient_id"], inv["total"], reason, Jsonb({"refund_method": body.refund_method, "paid": str(inv["paid_total"])}),
         ctx.user_id),
    )
    audit.record(conn, "billing.void_requested", ctx=ctx, entity="invoice", entity_id=invoice_id,
                 details={"ref": inv["ref"], "patient_id": str(inv["patient_id"]), "reason": reason})
    return {"status": "pending_approval"}


def _approved_refund(conn: psycopg.Connection, ctx: Ctx, patient_id, amount: Decimal, method: str, reason: str, requested_by) -> None:
    conn.execute(
        """
        INSERT INTO refunds (patient_id, amount, method, reason, status, requested_by, decided_by, decided_at)
        VALUES (%s, %s, %s, %s, 'approved', %s, %s, now())
        """,
        (patient_id, amount, method, reason, requested_by, ctx.user_id),
    )


def _do_void(conn: psycopg.Connection, ctx: Ctx, inv: dict, reason: str, refund_method: str | None, requested_by=None) -> None:
    invoice_id = inv["id"]
    conn.execute(
        "UPDATE invoices SET status = 'void', voided_at = now(), voided_by = %s, void_reason = %s, updated_at = now() WHERE id = %s",
        (ctx.user_id, reason, invoice_id),
    )
    conn.execute(
        """UPDATE treatment_plan_items SET billing_status = 'to_bill'
           WHERE id IN (SELECT plan_item_id FROM invoice_lines WHERE invoice_id = %s AND kind = 'plan_item')""",
        (invoice_id,),
    )
    conn.execute(
        """UPDATE patient_packages SET status = 'cancelled', cancelled_at = now(), cancel_reason = %s, refund_amount = 0
           WHERE sale_line_id IN (SELECT id FROM invoice_lines WHERE invoice_id = %s)""",
        (f"invoice {inv['ref']} void", invoice_id),
    )
    paid = q(inv["paid_total"])
    if paid > 0:
        conn.execute(
            "INSERT INTO patient_credit (patient_id, amount, reason, invoice_id, note, created_by) VALUES (%s, %s, 'void', %s, %s, %s)",
            (inv["patient_id"], paid, invoice_id, inv["ref"], ctx.user_id),
        )
        if refund_method:
            _approved_refund(conn, ctx, inv["patient_id"], paid, refund_method, f"{inv['ref']}: {reason}", requested_by or ctx.user_id)
    audit.record(conn, "billing.invoice_voided", ctx=ctx, entity="invoice", entity_id=invoice_id, details={
        "ref": inv["ref"], "patient_id": str(inv["patient_id"]), "reason": reason, "paid_to_credit": str(paid),
        "refund_method": refund_method})


# ---------- cancel a package the patient bought (needs approval) ----------

def package_refund(pp: dict) -> Decimal:
    """What's given back: what was paid, less the sessions used at the single-session price (never below zero)."""
    return max(D(0), q(D(pp["price_paid"]) - D(pp["full_price"]) * pp["used"]))


def cancel_package(conn: psycopg.Connection, ctx: Ctx, pp_id, body: PackageCancelIn) -> dict:
    conn.execute("SELECT 1 FROM patient_packages WHERE id = %s FOR UPDATE", (pp_id,))
    pp = conn.execute(f"{PP_SELECT} WHERE pp.id = %s", (pp_id,)).fetchone()
    if not pp:
        raise AppError(404, "not_found")
    pp = _pp_state(pp, clinic_time.today())
    if pp["status"] != "active":
        raise AppError(409, "record_locked")
    if pp["state"] == "used_up":
        raise AppError(409, "package_used_up")
    amount = package_refund(pp)
    reason = body.reason.strip()
    if "billing.approve" in ctx.permissions:
        _do_cancel_package(conn, ctx, pp, amount, reason, body.refund_method)
        return {"status": "cancelled", "refund": amount}
    if conn.execute("SELECT 1 FROM approval_requests WHERE patient_package_id = %s AND status = 'pending'", (pp_id,)).fetchone():
        raise AppError(409, "already_requested")
    conn.execute(
        """INSERT INTO approval_requests (kind, patient_package_id, patient_id, amount, reason, payload, requested_by)
           VALUES ('package_cancel', %s, %s, %s, %s, %s, %s)""",
        (pp_id, pp["patient_id"], amount, reason, Jsonb({"refund_method": body.refund_method, "used": pp["used"],
                                                         "sessions": pp["sessions_total"]}), ctx.user_id),
    )
    audit.record(conn, "billing.package_cancel_requested", ctx=ctx, entity="patient_package", entity_id=pp_id,
                 details={"ref": pp["ref"], "patient_id": str(pp["patient_id"]), "refund": str(amount)})
    return {"status": "pending_approval", "refund": amount}


def _do_cancel_package(conn: psycopg.Connection, ctx: Ctx, pp: dict, amount: Decimal, reason: str, refund_method, requested_by=None) -> None:
    conn.execute("UPDATE patient_packages SET status = 'cancelled', cancelled_at = now(), cancel_reason = %s, refund_amount = %s WHERE id = %s",
                 (reason, amount, pp["id"]))
    if amount > 0:
        conn.execute(
            "INSERT INTO patient_credit (patient_id, amount, reason, note, created_by) VALUES (%s, %s, 'package_cancel', %s, %s)",
            (pp["patient_id"], amount, pp["ref"], ctx.user_id),
        )
        if refund_method:
            _approved_refund(conn, ctx, pp["patient_id"], amount, refund_method, f"{pp['ref']}: {reason}", requested_by or ctx.user_id)
    audit.record(conn, "billing.package_cancelled", ctx=ctx, entity="patient_package", entity_id=pp["id"],
                 details={"ref": pp["ref"], "patient_id": str(pp["patient_id"]), "refund": str(amount), "used": pp["used"]})


# ---------- approvals ----------

def approvals(conn: psycopg.Connection, state: str = "pending") -> dict:
    where = "a.status = 'pending'" if state == "pending" else "a.status <> 'pending' AND a.decided_at > now() - interval '60 days'"
    rows = conn.execute(
        f"""
        SELECT a.*, p.mrn, p.full_name_ar AS patient_name_ar, p.full_name_en AS patient_name_en,
               i.ref AS invoice_ref, i.subtotal AS invoice_subtotal, i.total AS invoice_total, i.paid_total AS invoice_paid,
               r.ref AS refund_ref, r.method AS refund_method, pp.ref AS package_ref, pp.name_ar AS package_name_ar, pp.name_en AS package_name_en,
               rq.full_name_ar AS requested_by_ar, rq.full_name_en AS requested_by_en,
               dc.full_name_ar AS decided_by_ar, dc.full_name_en AS decided_by_en
        FROM approval_requests a
        JOIN patients p ON p.id = a.patient_id
        LEFT JOIN invoices i ON i.id = a.invoice_id
        LEFT JOIN refunds r ON r.id = a.refund_id
        LEFT JOIN patient_packages pp ON pp.id = a.patient_package_id
        LEFT JOIN users rq ON rq.id = a.requested_by
        LEFT JOIN users dc ON dc.id = a.decided_by
        WHERE {where}
        ORDER BY a.requested_at {'' if state == 'pending' else 'DESC'} LIMIT 200
        """
    ).fetchall()
    pending = conn.execute("SELECT count(*) AS n FROM approval_requests WHERE status = 'pending'").fetchone()["n"]
    return {"items": rows, "pending": pending}


def decide(conn: psycopg.Connection, ctx: Ctx, approval_id, approve: bool, note: str | None) -> None:
    req = conn.execute("SELECT * FROM approval_requests WHERE id = %s FOR UPDATE", (approval_id,)).fetchone()
    if not req:
        raise AppError(404, "not_found")
    if req["status"] != "pending":
        raise AppError(409, "already_decided")
    note = clean_name(note)
    if not approve and (not note or len(note) < 3):
        raise field_error("note", "required")
    payload = req["payload"] or {}
    if req["kind"] == "discount":
        inv = get(conn, req["invoice_id"], lock=True)
        if inv["status"] != "pending_approval":
            raise AppError(409, "already_decided")
        if approve:
            _finalize(conn, ctx, inv, IssueIn(installments=payload.get("installments", 0), down_payment=D(str(payload.get("down_payment", 0))),
                                             first_due_on=payload.get("first_due_on")),
                      issued_by=req["requested_by"], approved_by=ctx.user_id)
        else:
            conn.execute("UPDATE invoices SET status = 'draft', updated_at = now() WHERE id = %s", (inv["id"],))
    elif req["kind"] == "void" and approve:
        inv = get(conn, req["invoice_id"], lock=True)
        if inv["status"] != "issued":
            raise AppError(409, "record_locked")
        if _sold_packages_used(conn, inv["id"]):
            raise AppError(409, "package_in_use")
        _do_void(conn, ctx, inv, req["reason"], payload.get("refund_method"), req["requested_by"])
    elif req["kind"] == "refund":
        conn.execute("UPDATE refunds SET status = %s, decided_by = %s, decided_at = now() WHERE id = %s AND status = 'requested'",
                     ("approved" if approve else "rejected", ctx.user_id, req["refund_id"]))
    elif req["kind"] == "package_cancel" and approve:
        pp = conn.execute(f"{PP_SELECT} WHERE pp.id = %s", (req["patient_package_id"],)).fetchone()
        pp = _pp_state(pp, clinic_time.today())
        if pp["status"] != "active":
            raise AppError(409, "record_locked")
        _do_cancel_package(conn, ctx, pp, package_refund(pp), req["reason"], payload.get("refund_method"), req["requested_by"])
    conn.execute(
        "UPDATE approval_requests SET status = %s, decided_by = %s, decided_at = now(), decision_note = %s WHERE id = %s",
        ("approved" if approve else "rejected", ctx.user_id, note, approval_id),
    )
    audit.record(conn, f"billing.{req['kind']}_{'approved' if approve else 'rejected'}", ctx=ctx, entity="approval", entity_id=approval_id,
                 details={"patient_id": str(req["patient_id"]), "amount": str(req["amount"]), "note": note})


# ---------- reading ----------

def installments_state(rows: list[dict], paid: Decimal, void: bool) -> list[dict]:
    today = clinic_time.today()
    left = D(paid)
    for r in rows:
        covered = min(D(r["amount"]), max(D(0), left))
        left -= covered
        r["paid"] = q(covered)
        r["remaining"] = q(D(r["amount"]) - covered)
        if void:
            r["state"] = "cancelled"
        elif r["remaining"] == 0:
            r["state"] = "paid"
        elif r["due_on"] < today:
            r["state"] = "overdue"
        elif covered > 0:
            r["state"] = "partly"
        else:
            r["state"] = "due"
    return rows


def detail(conn: psycopg.Connection, ctx: Ctx, invoice_id) -> dict:
    inv = get(conn, invoice_id)
    lines = conn.execute(
        """
        SELECT l.*, s.code AS service_code, d.full_name_ar AS doctor_name_ar, d.full_name_en AS doctor_name_en
        FROM invoice_lines l LEFT JOIN services s ON s.id = l.service_id LEFT JOIN users d ON d.id = l.doctor_id
        WHERE l.invoice_id = %s ORDER BY l.position
        """,
        (invoice_id,),
    ).fetchall()
    if not can_see_shares(ctx):
        for r in lines:
            r.pop("doctor_share", None)
            r.pop("cost", None)
    installments = installments_state(
        conn.execute("SELECT * FROM invoice_installments WHERE invoice_id = %s ORDER BY seq", (invoice_id,)).fetchall(),
        D(inv["paid_total"]), inv["status"] == "void")
    receipts = conn.execute(
        """
        SELECT r.*, u.full_name_ar AS received_by_ar, u.full_name_en AS received_by_en,
               COALESCE((SELECT json_agg(json_build_object('method', x.method, 'amount', x.amount, 'reference', x.reference) ORDER BY x.id)
                         FROM receipt_payments x WHERE x.receipt_id = r.id), '[]') AS payments
        FROM receipts r LEFT JOIN users u ON u.id = r.received_by WHERE r.invoice_id = %s ORDER BY r.created_at
        """,
        (invoice_id,),
    ).fetchall()
    requests = conn.execute(
        """
        SELECT a.*, rq.full_name_ar AS requested_by_ar, rq.full_name_en AS requested_by_en,
               dc.full_name_ar AS decided_by_ar, dc.full_name_en AS decided_by_en
        FROM approval_requests a LEFT JOIN users rq ON rq.id = a.requested_by LEFT JOIN users dc ON dc.id = a.decided_by
        WHERE a.invoice_id = %s ORDER BY a.requested_at
        """,
        (invoice_id,),
    ).fetchall()
    settings = rules(conn)
    perms = ctx.permissions
    status = inv["status"]
    return {
        "invoice": inv, "lines": lines, "installments": installments, "receipts": receipts, "approvals": requests,
        "credit": credit_balance(conn, inv["patient_id"]),
        "rules": settings,
        "can": {
            "edit": status in OPEN_INVOICE and "billing.invoice" in perms,
            "discount": bool({"billing.discount", "billing.approve"} & perms),
            "issue": status == "draft" and "billing.invoice" in perms,
            "cancel": status in OPEN_INVOICE and "billing.invoice" in perms,
            "collect": status == "issued" and D(inv["balance"]) > 0 and "billing.collect" in perms,
            "void": status == "issued" and bool({"billing.invoice", "billing.approve"} & perms)
                    and not any(a["kind"] == "void" and a["status"] == "pending" for a in requests),
            "approve": "billing.approve" in perms,
            "shares": can_see_shares(ctx),
        },
    }


SORTS = {"date": "COALESCE(i.issued_at, i.created_at)", "ref": "i.ref", "patient": "p.full_name_en", "total": "i.total",
         "balance": "(i.total - i.paid_total)"}


def listing(conn: psycopg.Connection, *, status: str | None, q_text: str | None, date_from: date | None, date_to: date | None,
            unpaid: bool, sort: str, desc: bool, page: int, page_size: int = 30) -> dict:
    where, params = [], {}
    if status:
        where.append("i.status = %(status)s")
        params["status"] = status
    else:
        where.append("i.status <> 'cancelled'")
    if unpaid:
        where.append("i.status = 'issued' AND i.paid_total < i.total")
    if q_text and q_text.strip():
        params["like"] = f"%{q_text.strip()}%"
        params["norm"] = f"%{normalize_name(q_text)}%"
        where.append("(i.ref ILIKE %(like)s OR p.mrn ILIKE %(like)s OR p.phone ILIKE %(like)s OR p.name_search ILIKE %(norm)s)")
    if date_from:
        where.append("COALESCE(i.issued_at, i.created_at)::date >= %(from)s")
        params["from"] = date_from
    if date_to:
        where.append("COALESCE(i.issued_at, i.created_at)::date <= %(to)s")
        params["to"] = date_to
    clause = f"WHERE {' AND '.join(where)}"
    order = f"{SORTS.get(sort, SORTS['date'])} {'DESC' if desc else 'ASC'} NULLS LAST, i.created_at DESC"
    rows = conn.execute(
        f"{INVOICE_SELECT} {clause} ORDER BY {order} LIMIT %(limit)s OFFSET %(offset)s",
        {**params, "limit": page_size, "offset": (max(page, 1) - 1) * page_size},
    ).fetchall()
    sums = conn.execute(
        f"""
        SELECT count(*) AS n, COALESCE(sum(i.total) FILTER (WHERE i.status = 'issued'), 0) AS total,
               COALESCE(sum(i.paid_total) FILTER (WHERE i.status = 'issued'), 0) AS paid,
               COALESCE(sum(i.total - i.paid_total) FILTER (WHERE i.status = 'issued'), 0) AS balance
        FROM invoices i JOIN patients p ON p.id = i.patient_id {clause}
        """,
        params,
    ).fetchone()
    return {"items": rows, "total": sums["n"], "sums": sums, "page": max(page, 1), "page_size": page_size}


def queue(conn: psycopg.Connection, on: date) -> dict:
    """Today's patients from arrival on (they may pay before or after seeing the doctor), with where their bill stands."""
    rows = conn.execute(
        """
        SELECT a.id, a.ref, a.status, a.starts_at, a.queue_no, a.patient_id, p.mrn, p.full_name_ar AS patient_name_ar,
               p.full_name_en AS patient_name_en, p.phone AS patient_phone,
               d.full_name_ar AS doctor_name_ar, d.full_name_en AS doctor_name_en,
               COALESCE((SELECT json_agg(json_build_object('name_ar', s.name_ar, 'name_en', s.name_en, 'price', x.price) ORDER BY x.position)
                         FROM appointment_services x JOIN services s ON s.id = x.service_id WHERE x.appointment_id = a.id), '[]') AS services,
               (SELECT COALESCE(sum(x.price), 0) FROM appointment_services x WHERE x.appointment_id = a.id) AS booked_total,
               inv.id AS invoice_id, inv.ref AS invoice_ref, inv.status AS invoice_status, inv.total AS invoice_total,
               inv.paid_total AS invoice_paid
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        JOIN users d ON d.id = a.doctor_id
        LEFT JOIN LATERAL (SELECT * FROM invoices v WHERE v.appointment_id = a.id AND v.status IN ('draft', 'pending_approval', 'issued')
                           ORDER BY v.created_at DESC LIMIT 1) inv ON true
        WHERE a.starts_at::date = %s AND a.status IN ('arrived', 'in_room', 'completed')
        ORDER BY (inv.id IS NOT NULL AND inv.status = 'issued' AND inv.paid_total >= inv.total), a.status = 'completed' DESC, a.starts_at
        """,
        (on,),
    ).fetchall()
    for r in rows:
        if not r["invoice_id"]:
            r["bill"] = "unbilled"
        elif r["invoice_status"] != "issued":
            r["bill"] = r["invoice_status"]
        elif D(r["invoice_paid"]) >= D(r["invoice_total"]):
            r["bill"] = "paid"
        else:
            r["bill"] = "partly" if D(r["invoice_paid"]) > 0 else "unpaid"
    counts = {k: sum(1 for r in rows if r["bill"] == k) for k in ("unbilled", "draft", "pending_approval", "unpaid", "partly", "paid")}
    return {"items": rows, "counts": counts}


def search_patients(conn: psycopg.Connection, text: str) -> list[dict]:
    text = (text or "").strip()
    if len(text) < 2:
        return []
    return conn.execute(
        """
        SELECT p.id, p.mrn, p.full_name_ar, p.full_name_en, p.phone,
               (SELECT COALESCE(sum(i.total - i.paid_total), 0) FROM invoices i WHERE i.patient_id = p.id AND i.status = 'issued') AS owed,
               (SELECT COALESCE(sum(c.amount), 0) FROM patient_credit c WHERE c.patient_id = p.id) AS credit
        FROM patients p
        WHERE p.mrn ILIKE %(like)s OR p.phone LIKE %(digits)s OR p.name_search ILIKE %(norm)s
        ORDER BY p.full_name_en LIMIT 15
        """,
        {"like": f"%{text}%", "digits": f"%{''.join(c for c in text if c.isdigit()) or text}%", "norm": f"%{normalize_name(text)}%"},
    ).fetchall()


def account(conn: psycopg.Connection, ctx: Ctx, patient_id) -> dict:
    """Everything the cashier needs about one patient: what they owe, credit, packages, what's waiting to be billed."""
    patient = _patient(conn, patient_id)
    invoices = conn.execute(
        f"{INVOICE_SELECT} WHERE i.patient_id = %s AND i.status <> 'cancelled' ORDER BY COALESCE(i.issued_at, i.created_at) DESC LIMIT 50",
        (patient_id,),
    ).fetchall()
    unbilled = conn.execute(
        """
        SELECT a.id, a.ref, a.status, a.starts_at, d.full_name_ar AS doctor_name_ar, d.full_name_en AS doctor_name_en,
               (SELECT COALESCE(sum(x.price), 0) FROM appointment_services x WHERE x.appointment_id = a.id) AS booked_total,
               COALESCE((SELECT json_agg(json_build_object('name_ar', s.name_ar, 'name_en', s.name_en) ORDER BY x.position)
                         FROM appointment_services x JOIN services s ON s.id = x.service_id WHERE x.appointment_id = a.id), '[]') AS services
        FROM appointments a JOIN users d ON d.id = a.doctor_id
        WHERE a.patient_id = %s AND a.status IN ('arrived', 'in_room', 'completed') AND a.starts_at > now() - interval '60 days'
          AND NOT EXISTS (SELECT 1 FROM invoices v WHERE v.appointment_id = a.id AND v.status IN ('draft', 'pending_approval', 'issued'))
          AND NOT EXISTS (SELECT 1 FROM invoice_lines l JOIN invoices v ON v.id = l.invoice_id
                          WHERE l.appointment_id = a.id AND v.status IN ('draft', 'pending_approval', 'issued'))
        ORDER BY a.starts_at DESC
        """,
        (patient_id,),
    ).fetchall()
    to_bill = conn.execute(
        """
        SELECT i.id, i.price, i.tooth, i.done_at, s.name_ar, s.name_en, tp.ref AS plan_ref, tp.title AS plan_title
        FROM treatment_plan_items i JOIN treatment_plans tp ON tp.id = i.plan_id JOIN services s ON s.id = i.service_id
        WHERE tp.patient_id = %s AND i.billing_status = 'to_bill' ORDER BY i.done_at
        """,
        (patient_id,),
    ).fetchall()
    credit = conn.execute(
        """
        SELECT c.*, u.full_name_ar AS by_ar, u.full_name_en AS by_en FROM patient_credit c LEFT JOIN users u ON u.id = c.created_by
        WHERE c.patient_id = %s ORDER BY c.created_at DESC LIMIT 30
        """,
        (patient_id,),
    ).fetchall()
    refunds = conn.execute("SELECT * FROM refunds WHERE patient_id = %s ORDER BY requested_at DESC LIMIT 20", (patient_id,)).fetchall()
    receipts = conn.execute(
        """
        SELECT r.id, r.ref, r.total, r.applied, r.to_credit, r.created_at, i.ref AS invoice_ref,
               (SELECT string_agg(DISTINCT x.method, ',') FROM receipt_payments x WHERE x.receipt_id = r.id) AS methods
        FROM receipts r LEFT JOIN invoices i ON i.id = r.invoice_id WHERE r.patient_id = %s ORDER BY r.created_at DESC LIMIT 30
        """,
        (patient_id,),
    ).fetchall()
    owed = sum((D(i["balance"]) for i in invoices if i["status"] == "issued"), D(0))
    return {
        "patient": patient, "invoices": invoices, "unbilled": unbilled, "to_bill": to_bill,
        "packages": patient_packages(conn, [patient_id]), "credit_balance": credit_balance(conn, patient_id),
        "credit": credit, "refunds": refunds, "receipts": receipts, "owed": q(owed),
        "can": {"invoice": "billing.invoice" in ctx.permissions, "collect": "billing.collect" in ctx.permissions,
                "approve": "billing.approve" in ctx.permissions},
    }


def options(conn: psycopg.Connection, ctx: Ctx) -> dict:
    from app.core.billing_setup import packages

    services = conn.execute(
        """
        SELECT s.id, s.code, s.name_ar, s.name_en, s.vat_rate, sp.name_ar AS specialty_ar, sp.name_en AS specialty_en,
               (SELECT amount FROM service_prices p WHERE p.service_id = s.id AND p.doctor_id IS NULL AND p.starts_on <= current_date
                ORDER BY p.starts_on DESC LIMIT 1) AS price
        FROM services s JOIN specialties sp ON sp.id = s.specialty_id
        WHERE s.is_active AND sp.is_active ORDER BY sp.sort_order, s.sort_order, s.name_en
        """
    ).fetchall()
    doctors = conn.execute(
        """
        SELECT u.id, u.full_name_ar, u.full_name_en FROM users u
        WHERE u.is_active AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_code = 'doctor')
        ORDER BY u.full_name_en
        """
    ).fetchall()
    return {"services": services, "doctors": doctors, "packages": packages(conn, active_only=True), "rules": rules(conn),
            "can": {p: p in ctx.permissions for p in ("billing.invoice", "billing.collect", "billing.discount", "billing.approve")}}


# ---------- patient portal ----------

def portal(conn: psycopg.Connection, patient_ids: list) -> dict:
    invoices = conn.execute(
        f"{INVOICE_SELECT} WHERE i.patient_id = ANY(%s) AND i.status IN ('issued', 'void') ORDER BY i.issued_at DESC LIMIT 100",
        (patient_ids,),
    ).fetchall()
    ids = [i["id"] for i in invoices]
    lines = conn.execute(
        "SELECT invoice_id, position, kind, name_ar, name_en, qty, unit_price, discount, vat_amount, line_total FROM invoice_lines "
        "WHERE invoice_id = ANY(%s) ORDER BY position", (ids,),
    ).fetchall() if ids else []
    inst = conn.execute("SELECT * FROM invoice_installments WHERE invoice_id = ANY(%s) ORDER BY seq", (ids,)).fetchall() if ids else []
    for inv in invoices:
        for key in ("created_by", "issued_by", "voided_by", "discount_approved_by", "created_by_ar", "created_by_en",
                    "discount_approved_by_ar", "discount_approved_by_en", "voided_by_ar", "voided_by_en", "notes"):
            inv.pop(key, None)
        inv["lines"] = [r for r in lines if r["invoice_id"] == inv["id"]]
        inv["installments"] = installments_state([dict(r) for r in inst if r["invoice_id"] == inv["id"]], D(inv["paid_total"]),
                                                 inv["status"] == "void")
    receipts = conn.execute(
        """
        SELECT r.id, r.ref, r.patient_id, r.total, r.applied, r.to_credit, r.created_at, i.ref AS invoice_ref,
               COALESCE((SELECT json_agg(json_build_object('method', x.method, 'amount', x.amount) ORDER BY x.id)
                         FROM receipt_payments x WHERE x.receipt_id = r.id), '[]') AS payments
        FROM receipts r LEFT JOIN invoices i ON i.id = r.invoice_id WHERE r.patient_id = ANY(%s) ORDER BY r.created_at DESC LIMIT 100
        """,
        (patient_ids,),
    ).fetchall()
    names = {r["id"]: r for r in conn.execute("SELECT id, full_name_ar, full_name_en FROM patients WHERE id = ANY(%s)", (patient_ids,))}
    credit = [{"patient_id": pid, "name_ar": names[pid]["full_name_ar"], "name_en": names[pid]["full_name_en"],
               "balance": credit_balance(conn, pid)} for pid in patient_ids if pid in names]
    packages = patient_packages(conn, patient_ids)
    for p in packages:
        for key in ("price_paid", "full_price", "sale_line_id", "refund_amount"):
            p.pop(key, None)
    owed = sum((D(i["balance"]) for i in invoices if i["status"] == "issued"), D(0))
    return {"invoices": invoices, "receipts": receipts, "credit": credit, "packages": packages, "owed": q(owed)}
