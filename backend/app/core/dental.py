"""Dentistry: the tooth chart (FDI), treatment plans with a priced quotation, patient acceptance and an
installment schedule, and dental lab cases.

Prices always come from the price list (never typed). Once quoted, a plan's items are frozen by the database;
items marked done become "ready to bill" for the billing module (requirement 5)."""
import calendar
from datetime import date, timedelta
from decimal import ROUND_DOWN, Decimal

import psycopg

from app.core import appointments, audit, clinic_time
from app.core.appointments import price_on
from app.core.clinical_schemas import (
    ChartEntryIn, LabCaseEditIn, LabCaseIn, LabIn, LabMoveIn, PlanEditIn, PlanIn, PlanItemIn,
)
from app.core.errors import AppError, field_error
from app.core.session import Ctx


def _scope(conn: psycopg.Connection, ctx: Ctx, patient_id) -> None:
    doctor = appointments.doctor_scope(ctx)
    if doctor and not appointments.doctor_has_patient(conn, doctor, patient_id):
        raise AppError(403, "not_your_patient")


def _patient(conn: psycopg.Connection, patient_id) -> dict:
    row = conn.execute("SELECT id, mrn, full_name_ar, full_name_en, date_of_birth, gender FROM patients WHERE id = %s",
                       (patient_id,)).fetchone()
    if not row:
        raise AppError(404, "patient_not_found")
    return row


def _clean(value):
    value = (value or "").strip() if isinstance(value, str) else value
    return value or None


def valid_tooth(t: int | None) -> bool:
    if t is None:
        return True
    q, n = divmod(t, 10)
    return (1 <= q <= 4 and 1 <= n <= 8) or (5 <= q <= 8 and 1 <= n <= 5)


# ====================== tooth chart ======================

def chart(conn: psycopg.Connection, ctx: Ctx, patient_id) -> dict:
    _scope(conn, ctx, patient_id)
    patient = _patient(conn, patient_id)
    entries = conn.execute(
        """
        SELECT e.*, u.full_name_ar AS recorded_by_ar, u.full_name_en AS recorded_by_en,
               vu.full_name_ar AS voided_by_ar, vu.full_name_en AS voided_by_en
        FROM dental_chart_entries e JOIN users u ON u.id = e.recorded_by LEFT JOIN users vu ON vu.id = e.voided_by
        WHERE e.patient_id = %s ORDER BY e.recorded_at, e.id
        """,
        (patient_id,),
    ).fetchall()
    planned = conn.execute(
        """
        SELECT i.id, i.plan_id, p.ref AS plan_ref, p.status AS plan_status, i.tooth, i.surfaces, i.condition, i.phase,
               s.name_ar AS service_name_ar, s.name_en AS service_name_en
        FROM treatment_plan_items i JOIN treatment_plans p ON p.id = i.plan_id JOIN services s ON s.id = i.service_id
        WHERE p.patient_id = %s AND i.status = 'planned' AND p.status IN ('draft', 'quoted', 'accepted') AND i.tooth IS NOT NULL
        ORDER BY i.tooth
        """,
        (patient_id,),
    ).fetchall()
    return {"patient": patient, "entries": entries, "planned": planned, "can": {"record": "dental.chart" in ctx.permissions}}


def add_entry(conn: psycopg.Connection, ctx: Ctx, patient_id, body: ChartEntryIn, visit_id=None, plan_item_id=None) -> dict:
    _scope(conn, ctx, patient_id)
    _patient(conn, patient_id)
    if not valid_tooth(body.tooth):
        raise field_error("tooth", "invalid")
    surfaces = sorted(set(body.surfaces), key="MODBLI".index)
    row = conn.execute(
        """
        INSERT INTO dental_chart_entries (patient_id, tooth, surfaces, condition, status, note, visit_id, plan_item_id, recorded_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *
        """,
        (patient_id, body.tooth, surfaces, body.condition, body.status, _clean(body.note), visit_id, plan_item_id, ctx.user_id),
    ).fetchone()
    return row


def void_entry(conn: psycopg.Connection, ctx: Ctx, patient_id, entry_id: int, reason: str) -> None:
    _scope(conn, ctx, patient_id)
    row = conn.execute("SELECT * FROM dental_chart_entries WHERE id = %s AND patient_id = %s", (entry_id, patient_id)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    if row["voided_at"]:
        return
    conn.execute("UPDATE dental_chart_entries SET voided_at = now(), voided_by = %s, void_reason = %s WHERE id = %s",
                 (ctx.user_id, reason.strip(), entry_id))
    audit.record(conn, "dental.chart_voided", ctx=ctx, entity="patient", entity_id=patient_id,
                 details={"patient_id": str(patient_id), "tooth": row["tooth"], "condition": row["condition"], "reason": reason.strip()})


# ====================== treatment plans ======================

PLAN_SELECT = """
    SELECT tp.*, p.mrn, p.full_name_ar AS patient_name_ar, p.full_name_en AS patient_name_en, p.date_of_birth, p.gender,
           p.phone AS patient_phone,
           d.full_name_ar AS doctor_name_ar, d.full_name_en AS doctor_name_en, dp.title_ar AS doctor_title_ar, dp.title_en AS doctor_title_en,
           COALESCE((SELECT sum(i.price) FROM treatment_plan_items i WHERE i.plan_id = tp.id AND i.status <> 'cancelled'), 0) AS items_total,
           COALESCE((SELECT sum(i.price) FROM treatment_plan_items i WHERE i.plan_id = tp.id AND i.status = 'done'), 0) AS done_total,
           COALESCE((SELECT sum(i.price) FROM treatment_plan_items i WHERE i.plan_id = tp.id AND i.billing_status = 'to_bill'), 0) AS to_bill_total,
           (SELECT count(*) FROM treatment_plan_items i WHERE i.plan_id = tp.id AND i.status <> 'cancelled') AS items_count,
           (SELECT count(*) FROM treatment_plan_items i WHERE i.plan_id = tp.id AND i.status = 'done') AS done_count
    FROM treatment_plans tp
    JOIN patients p ON p.id = tp.patient_id
    JOIN users d ON d.id = tp.doctor_id
    LEFT JOIN doctor_profiles dp ON dp.user_id = tp.doctor_id
"""


def plan_state(plan: dict) -> str:
    """The plan's status as people see it: a quotation past its date is "expired"."""
    if plan["status"] == "quoted" and plan["valid_until"] and plan["valid_until"] < clinic_time.today():
        return "expired"
    return plan["status"]


def _plan(conn: psycopg.Connection, plan_id, lock: bool = False) -> dict:
    if lock:
        conn.execute("SELECT 1 FROM treatment_plans WHERE id = %s FOR UPDATE", (plan_id,))
    row = conn.execute(f"{PLAN_SELECT} WHERE tp.id = %s", (plan_id,)).fetchone()
    if not row:
        raise AppError(404, "plan_not_found")
    row["state"] = plan_state(row)
    return row


def _is_author(ctx: Ctx, plan: dict) -> bool:
    return plan["doctor_id"] == ctx.user_id and "dental.plans" in ctx.permissions


def _readable(conn: psycopg.Connection, ctx: Ctx, plan_id, lock: bool = False) -> dict:
    plan = _plan(conn, plan_id, lock)
    if not (_is_author(ctx, plan) or "dental.plans_view" in ctx.permissions or "visits.view_all" in ctx.permissions):
        raise AppError(403, "not_your_plan")
    return plan


def _authored(conn: psycopg.Connection, ctx: Ctx, plan_id, statuses: tuple | None = None) -> dict:
    plan = _plan(conn, plan_id, lock=True)
    if not _is_author(ctx, plan):
        raise AppError(403, "not_your_plan")
    if statuses and plan["status"] not in statuses:
        raise AppError(409, "plan_wrong_status", plan_status=plan["state"])
    return plan


def plan_items(conn: psycopg.Connection, plan_id) -> list[dict]:
    return conn.execute(
        """
        SELECT i.*, s.code AS service_code, s.name_ar AS service_name_ar, s.name_en AS service_name_en,
               u.full_name_ar AS done_by_ar, u.full_name_en AS done_by_en
        FROM treatment_plan_items i JOIN services s ON s.id = i.service_id LEFT JOIN users u ON u.id = i.done_by
        WHERE i.plan_id = %s ORDER BY i.phase, i.position
        """,
        (plan_id,),
    ).fetchall()


def installments(conn: psycopg.Connection, plan_id) -> list[dict]:
    return conn.execute("SELECT * FROM treatment_plan_installments WHERE plan_id = %s ORDER BY seq", (plan_id,)).fetchall()


def _add_months(day: date, months: int) -> date:
    month = day.month - 1 + months
    year, month = day.year + month // 12, month % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def schedule(total: Decimal, down: Decimal, count: int, start: date) -> list[dict]:
    """Down payment on acceptance, then equal monthly installments (whole pounds; the last one takes the remainder).
    With no installments, what's left is paid as the work is done."""
    rows = []
    if down > 0:
        rows.append({"seq": 0, "due_on": start, "amount": down})
    rest = total - down
    if count > 0 and rest > 0:
        each = (rest / count).quantize(Decimal("1"), rounding=ROUND_DOWN)
        for n in range(1, count + 1):
            amount = each if n < count else rest - each * (count - 1)
            rows.append({"seq": n, "due_on": _add_months(start, n), "amount": amount})
    return rows


def plan_detail(conn: psycopg.Connection, ctx: Ctx, plan_id) -> dict:
    plan = _readable(conn, ctx, plan_id)
    items = plan_items(conn, plan_id)
    author = _is_author(ctx, plan)
    preview = None
    if plan["status"] in ("draft", "quoted"):
        total = Decimal(plan["quote_total"] if plan["status"] == "quoted" else plan["items_total"])
        preview = schedule(total, Decimal(plan["down_payment"]), plan["installments_count"],
                           clinic_time.today()) if total > 0 else []
    labs = conn.execute(
        """
        SELECT c.id, c.ref, c.status, c.work_type, c.teeth, c.due_on, c.plan_item_id, l.name AS lab_name
        FROM lab_cases c JOIN dental_labs l ON l.id = c.lab_id
        WHERE c.plan_item_id IN (SELECT id FROM treatment_plan_items WHERE plan_id = %s) ORDER BY c.created_at
        """,
        (plan_id,),
    ).fetchall()
    branch = conn.execute("SELECT * FROM branches WHERE is_active ORDER BY id LIMIT 1").fetchone()
    return {
        "plan": plan, "items": items, "installments": installments(conn, plan_id), "schedule_preview": preview,
        "lab_cases": labs, "branch": branch,
        "can": {
            "edit": author and plan["status"] == "draft",
            "quote": author and plan["status"] == "draft",
            "revise": author and plan["status"] in ("quoted", "declined"),
            "accept": plan["state"] == "quoted" and (author or "dental.plans_view" in ctx.permissions),
            "decline": plan["state"] in ("quoted", "expired") and (author or "dental.plans_view" in ctx.permissions),
            "work": author and plan["status"] == "accepted",
            "cancel": author and plan["status"] in ("draft", "quoted", "accepted", "declined"),
        },
    }


def plans_for_patient(conn: psycopg.Connection, ctx: Ctx, patient_id) -> list[dict]:
    _scope(conn, ctx, patient_id)
    rows = conn.execute(f"{PLAN_SELECT} WHERE tp.patient_id = %s ORDER BY tp.created_at DESC", (patient_id,)).fetchall()
    for r in rows:
        r["state"] = plan_state(r)
        r["readable"] = _is_author(ctx, r) or "dental.plans_view" in ctx.permissions or "visits.view_all" in ctx.permissions
    return rows


def plan_list(conn: psycopg.Connection, ctx: Ctx, *, state: str | None, q: str | None, mine: bool) -> list[dict]:
    if mine or not ("dental.plans_view" in ctx.permissions or "visits.view_all" in ctx.permissions):
        if "dental.plans" not in ctx.permissions:
            raise AppError(403, "forbidden", permission="dental.plans_view")
        doctor = ctx.user_id
    else:
        doctor = None
    where = ["(%(doctor)s::uuid IS NULL OR tp.doctor_id = %(doctor)s::uuid)"]
    if state == "expired":
        where.append("tp.status = 'quoted' AND tp.valid_until < %(today)s")
    elif state == "quoted":
        where.append("tp.status = 'quoted' AND tp.valid_until >= %(today)s")
    elif state == "to_bill":
        where.append("EXISTS (SELECT 1 FROM treatment_plan_items i WHERE i.plan_id = tp.id AND i.billing_status = 'to_bill')")
    elif state:
        where.append("tp.status = %(state)s")
    if q and q.strip():
        where.append("(p.name_search ILIKE %(like)s OR p.mrn ILIKE %(like)s OR tp.ref ILIKE %(like)s OR tp.title ILIKE %(like)s)")
    rows = conn.execute(
        f"{PLAN_SELECT} WHERE {' AND '.join(where)} ORDER BY tp.updated_at DESC LIMIT 200",
        {"doctor": doctor, "state": state, "today": clinic_time.today(), "like": f"%{(q or '').strip()}%"},
    ).fetchall()
    for r in rows:
        r["state"] = plan_state(r)
    return rows


def create_plan(conn: psycopg.Connection, ctx: Ctx, body: PlanIn) -> dict:
    if "dental.plans" not in ctx.permissions:
        raise AppError(403, "forbidden", permission="dental.plans")
    _scope(conn, ctx, body.patient_id)
    _patient(conn, body.patient_id)
    row = conn.execute(
        "INSERT INTO treatment_plans (patient_id, doctor_id, title) VALUES (%s, %s, %s) RETURNING id, ref",
        (body.patient_id, ctx.user_id, body.title.strip()),
    ).fetchone()
    audit.record(conn, "dental.plan_created", ctx=ctx, entity="treatment_plan", entity_id=row["id"],
                 details={"patient_id": body.patient_id, "ref": row["ref"], "title": body.title.strip()})
    return row


def edit_plan(conn: psycopg.Connection, ctx: Ctx, plan_id, body: PlanEditIn) -> None:
    _authored(conn, ctx, plan_id, ("draft",))
    conn.execute(
        """
        UPDATE treatment_plans SET title = %s, notes = %s, patient_note = %s, down_payment = %s, installments_count = %s,
               updated_at = now() WHERE id = %s
        """,
        (body.title.strip(), _clean(body.notes), _clean(body.patient_note), Decimal(str(body.down_payment)).quantize(Decimal("0.01")),
         body.installments_count, plan_id),
    )


def _service(conn: psycopg.Connection, service_id: int) -> dict:
    row = conn.execute(
        "SELECT s.* FROM services s JOIN specialties sp ON sp.id = s.specialty_id WHERE s.id = %s AND s.is_active AND sp.is_active",
        (service_id,),
    ).fetchone()
    if not row:
        raise field_error("service_id", "unavailable")
    return row


def add_item(conn: psycopg.Connection, ctx: Ctx, plan_id, body: PlanItemIn) -> None:
    plan = _authored(conn, ctx, plan_id, ("draft",))
    service = _service(conn, body.service_id)
    if not valid_tooth(body.tooth):
        raise field_error("tooth", "invalid")
    price = price_on(conn, service["id"], plan["doctor_id"], clinic_time.today())
    if price is None:
        raise AppError(409, "no_price", service=service["name_en"])
    position = conn.execute("SELECT COALESCE(max(position), -1) + 1 AS n FROM treatment_plan_items WHERE plan_id = %s",
                            (plan_id,)).fetchone()["n"]
    conn.execute(
        """
        INSERT INTO treatment_plan_items (plan_id, position, phase, service_id, tooth, surfaces, condition, price, note)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (plan_id, position, body.phase, service["id"], body.tooth, sorted(set(body.surfaces), key="MODBLI".index),
         service["dental_result"] if body.tooth else None, price, _clean(body.note)),
    )
    conn.execute("UPDATE treatment_plans SET updated_at = now() WHERE id = %s", (plan_id,))


def remove_item(conn: psycopg.Connection, ctx: Ctx, plan_id, item_id: int) -> None:
    _authored(conn, ctx, plan_id, ("draft",))
    if conn.execute("SELECT 1 FROM lab_cases WHERE plan_item_id = %s", (item_id,)).fetchone():
        raise AppError(409, "in_use")
    cur = conn.execute("DELETE FROM treatment_plan_items WHERE id = %s AND plan_id = %s", (item_id, plan_id))
    if not cur.rowcount:
        raise AppError(404, "not_found")


def quote(conn: psycopg.Connection, ctx: Ctx, plan_id, valid_days: int) -> None:
    """Issues the quotation: prices refreshed from today's price list, then frozen."""
    plan = _authored(conn, ctx, plan_id, ("draft",))
    items = plan_items(conn, plan_id)
    if not items:
        raise AppError(422, "plan_empty")
    today = clinic_time.today()
    total = Decimal("0")
    for item in items:
        price = price_on(conn, item["service_id"], plan["doctor_id"], today)
        if price is None:
            raise AppError(409, "no_price", service=item["service_name_en"])
        if price != item["price"]:
            conn.execute("UPDATE treatment_plan_items SET price = %s WHERE id = %s", (price, item["id"]))
        total += Decimal(price)
    if Decimal(plan["down_payment"]) > total:
        raise field_error("down_payment", "more_than_total")
    conn.execute(
        """
        UPDATE treatment_plans SET status = 'quoted', quoted_at = now(), valid_until = %s, quote_total = %s,
               declined_at = NULL, decline_reason = NULL, updated_at = now() WHERE id = %s
        """,
        (today + timedelta(days=valid_days), total, plan_id),
    )
    audit.record(conn, "dental.plan_quoted", ctx=ctx, entity="treatment_plan", entity_id=plan_id,
                 details={"patient_id": str(plan["patient_id"]), "ref": plan["ref"], "total": str(total),
                          "valid_until": str(today + timedelta(days=valid_days))})


def revise(conn: psycopg.Connection, ctx: Ctx, plan_id) -> None:
    """Back to draft to change the plan; a new quotation must then be issued."""
    plan = _authored(conn, ctx, plan_id, ("quoted", "declined"))
    conn.execute("UPDATE treatment_plans SET status = 'draft', updated_at = now() WHERE id = %s", (plan_id,))
    audit.record(conn, "dental.plan_revised", ctx=ctx, entity="treatment_plan", entity_id=plan_id,
                 details={"patient_id": str(plan["patient_id"]), "ref": plan["ref"]})


def accept(conn: psycopg.Connection, plan_id, *, ctx: Ctx, via: str, patient_ids: list | None = None, signed_paper: bool = False) -> None:
    plan = _plan(conn, plan_id, lock=True)
    if via == "portal":
        if plan["patient_id"] not in (patient_ids or []):
            raise AppError(404, "plan_not_found")
    else:
        if not (_is_author(ctx, plan) or "dental.plans_view" in ctx.permissions):
            raise AppError(403, "not_your_plan")
        if not signed_paper:
            raise field_error("signed_paper", "required")
    if plan["state"] == "expired":
        raise AppError(409, "quote_expired")
    if plan["status"] != "quoted":
        raise AppError(409, "plan_wrong_status", plan_status=plan["state"])
    today = clinic_time.today()
    conn.execute(
        """
        UPDATE treatment_plans SET status = 'accepted', accepted_at = now(), accepted_via = %s, accepted_by = %s, updated_at = now()
        WHERE id = %s
        """,
        (via, ctx.user_id, plan_id),
    )
    for row in schedule(Decimal(plan["quote_total"]), Decimal(plan["down_payment"]), plan["installments_count"], today):
        conn.execute("INSERT INTO treatment_plan_installments (plan_id, seq, due_on, amount) VALUES (%s, %s, %s, %s)",
                     (plan_id, row["seq"], row["due_on"], row["amount"]))
    audit.record(conn, "dental.plan_accepted", ctx=ctx, entity="treatment_plan", entity_id=plan_id,
                 details={"patient_id": str(plan["patient_id"]), "ref": plan["ref"], "via": via, "total": str(plan["quote_total"])})


def decline(conn: psycopg.Connection, plan_id, reason: str, *, ctx: Ctx, via: str, patient_ids: list | None = None) -> None:
    plan = _plan(conn, plan_id, lock=True)
    if via == "portal":
        if plan["patient_id"] not in (patient_ids or []):
            raise AppError(404, "plan_not_found")
    elif not (_is_author(ctx, plan) or "dental.plans_view" in ctx.permissions):
        raise AppError(403, "not_your_plan")
    if plan["status"] != "quoted":
        raise AppError(409, "plan_wrong_status", plan_status=plan["state"])
    conn.execute("UPDATE treatment_plans SET status = 'declined', declined_at = now(), decline_reason = %s, updated_at = now() WHERE id = %s",
                 (reason.strip(), plan_id))
    audit.record(conn, "dental.plan_declined", ctx=ctx, entity="treatment_plan", entity_id=plan_id,
                 details={"patient_id": str(plan["patient_id"]), "ref": plan["ref"], "via": via, "reason": reason.strip()})


def cancel_plan(conn: psycopg.Connection, ctx: Ctx, plan_id, reason: str) -> None:
    plan = _authored(conn, ctx, plan_id, ("draft", "quoted", "accepted", "declined"))
    conn.execute("UPDATE treatment_plans SET status = 'cancelled', cancelled_at = now(), cancel_reason = %s, updated_at = now() WHERE id = %s",
                 (reason.strip(), plan_id))
    conn.execute("UPDATE treatment_plan_installments SET status = 'cancelled' WHERE plan_id = %s AND status = 'scheduled'", (plan_id,))
    audit.record(conn, "dental.plan_cancelled", ctx=ctx, entity="treatment_plan", entity_id=plan_id,
                 details={"patient_id": str(plan["patient_id"]), "ref": plan["ref"], "reason": reason.strip()})


def _maybe_complete(conn: psycopg.Connection, plan_id) -> None:
    left = conn.execute("SELECT count(*) AS n FROM treatment_plan_items WHERE plan_id = %s AND status = 'planned'", (plan_id,)).fetchone()["n"]
    if left == 0:
        conn.execute("UPDATE treatment_plans SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = %s AND status = 'accepted'",
                     (plan_id,))


def item_done(conn: psycopg.Connection, ctx: Ctx, plan_id, item_id: int, visit_id=None, note: str | None = None) -> None:
    """The work is done: it becomes "ready to bill" and goes on the tooth chart."""
    plan = _authored(conn, ctx, plan_id, ("accepted",))
    item = conn.execute("SELECT * FROM treatment_plan_items WHERE id = %s AND plan_id = %s FOR UPDATE", (item_id, plan_id)).fetchone()
    if not item:
        raise AppError(404, "not_found")
    if item["status"] != "planned":
        raise AppError(409, "item_not_planned")
    if visit_id and not conn.execute("SELECT 1 FROM visits WHERE id = %s AND patient_id = %s", (visit_id, plan["patient_id"])).fetchone():
        raise field_error("visit_id", "invalid")
    conn.execute(
        """
        UPDATE treatment_plan_items SET status = 'done', done_at = now(), done_by = %s, done_visit_id = %s, billing_status = 'to_bill',
               note = COALESCE(%s, note) WHERE id = %s
        """,
        (ctx.user_id, visit_id, _clean(note), item_id),
    )
    if item["tooth"] and item["condition"]:
        conn.execute(
            """
            INSERT INTO dental_chart_entries (patient_id, tooth, surfaces, condition, status, note, visit_id, plan_item_id, recorded_by)
            VALUES (%s, %s, %s, %s, 'done', %s, %s, %s, %s)
            """,
            (plan["patient_id"], item["tooth"], item["surfaces"], item["condition"], plan["ref"], visit_id, item_id, ctx.user_id),
        )
    audit.record(conn, "dental.item_done", ctx=ctx, entity="treatment_plan", entity_id=plan_id,
                 details={"patient_id": str(plan["patient_id"]), "ref": plan["ref"], "item": item_id, "tooth": item["tooth"],
                          "price": str(item["price"])})
    _maybe_complete(conn, plan_id)


def item_cancel(conn: psycopg.Connection, ctx: Ctx, plan_id, item_id: int, reason: str) -> None:
    plan = _authored(conn, ctx, plan_id, ("accepted",))
    cur = conn.execute(
        "UPDATE treatment_plan_items SET status = 'cancelled', note = %s WHERE id = %s AND plan_id = %s AND status = 'planned'",
        (reason.strip(), item_id, plan_id),
    )
    if not cur.rowcount:
        raise AppError(409, "item_not_planned")
    audit.record(conn, "dental.item_cancelled", ctx=ctx, entity="treatment_plan", entity_id=plan_id,
                 details={"patient_id": str(plan["patient_id"]), "ref": plan["ref"], "item": item_id, "reason": reason.strip()})
    _maybe_complete(conn, plan_id)


# --- patient portal ---

def portal_plans(conn: psycopg.Connection, patient_ids: list) -> list[dict]:
    """Plans the patient was offered (quoted) and their plans in progress. Never drafts or internal notes."""
    if not patient_ids:
        return []
    rows = conn.execute(
        f"{PLAN_SELECT} WHERE tp.patient_id = ANY(%s) AND tp.status IN ('quoted', 'accepted', 'completed', 'declined') ORDER BY tp.quoted_at DESC",
        (patient_ids,),
    ).fetchall()
    result = []
    for r in rows:
        r["state"] = plan_state(r)
        r.pop("notes", None)
        r["items"] = [{k: i[k] for k in ("id", "phase", "tooth", "surfaces", "price", "status", "service_name_ar", "service_name_en",
                                         "service_code")} for i in plan_items(conn, r["id"]) if i["status"] != "cancelled"]
        r["installments"] = installments(conn, r["id"])
        r["schedule_preview"] = schedule(Decimal(r["quote_total"]), Decimal(r["down_payment"]), r["installments_count"],
                                         clinic_time.today()) if r["status"] == "quoted" else None
        result.append(r)
    return result


# ====================== dental labs & lab cases ======================

def labs(conn: psycopg.Connection, include_inactive: bool = False) -> list[dict]:
    return conn.execute(
        """
        SELECT l.*, (SELECT count(*) FROM lab_cases c WHERE c.lab_id = l.id AND c.status IN ('ordered', 'sent', 'remake')) AS open_cases,
               COALESCE((SELECT sum(c.lab_cost) FROM lab_cases c WHERE c.lab_id = l.id AND c.status IN ('returned', 'remake', 'delivered')), 0) AS cost_total
        FROM dental_labs l WHERE %s OR l.is_active ORDER BY l.is_active DESC, l.name
        """,
        (include_inactive,),
    ).fetchall()


def save_lab(conn: psycopg.Connection, ctx: Ctx, body: LabIn, lab_id: int | None = None) -> dict:
    values = {"name": body.name.strip(), "contact": _clean(body.contact_name), "phone": _clean(body.phone),
              "address": _clean(body.address), "active": body.is_active}
    try:
        with conn.transaction():
            if lab_id is None:
                row = conn.execute(
                    "INSERT INTO dental_labs (name, contact_name, phone, address, is_active) VALUES (%(name)s, %(contact)s, %(phone)s, %(address)s, %(active)s) RETURNING *",
                    values,
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    UPDATE dental_labs SET name = %(name)s, contact_name = %(contact)s, phone = %(phone)s, address = %(address)s,
                           is_active = %(active)s WHERE id = %(id)s RETURNING *
                    """,
                    {**values, "id": lab_id},
                ).fetchone()
                if not row:
                    raise AppError(404, "not_found")
    except psycopg.errors.UniqueViolation:
        raise AppError(409, "conflict", fields={"name": "taken"}) from None
    audit.record(conn, "clinical.lab_saved", ctx=ctx, entity="dental_lab", entity_id=row["id"], details={"name": row["name"]})
    return row


CASE_SELECT = """
    SELECT c.*, l.name AS lab_name, l.phone AS lab_phone, p.mrn, p.full_name_ar AS patient_name_ar, p.full_name_en AS patient_name_en,
           d.full_name_ar AS doctor_name_ar, d.full_name_en AS doctor_name_en, tp.ref AS plan_ref, tp.id AS plan_id,
           (c.due_on < %(today)s AND c.status IN ('ordered', 'sent', 'remake')) AS overdue,
           round(COALESCE(c.lab_cost, 0) * c.doctor_share_pct / 100, 2) AS doctor_share
    FROM lab_cases c
    JOIN dental_labs l ON l.id = c.lab_id
    JOIN patients p ON p.id = c.patient_id
    JOIN users d ON d.id = c.doctor_id
    LEFT JOIN treatment_plan_items ti ON ti.id = c.plan_item_id
    LEFT JOIN treatment_plans tp ON tp.id = ti.plan_id
"""
OPEN_CASE = ("ordered", "sent", "returned", "remake")
MOVES = {
    "ordered": ("sent", "cancelled"),
    "sent": ("returned", "cancelled"),
    "returned": ("delivered", "remake"),
    "remake": ("sent", "cancelled"),
}


def _case(conn: psycopg.Connection, ctx: Ctx, case_id, lock: bool = False) -> dict:
    if lock:
        conn.execute("SELECT 1 FROM lab_cases WHERE id = %s FOR UPDATE", (case_id,))
    row = conn.execute(f"{CASE_SELECT} WHERE c.id = %(id)s", {"id": case_id, "today": clinic_time.today()}).fetchone()
    if not row:
        raise AppError(404, "lab_case_not_found")
    doctor = appointments.doctor_scope(ctx)
    if doctor and row["doctor_id"] != doctor:
        raise AppError(403, "not_your_case")
    return row


def case_events(conn: psycopg.Connection, case_id) -> list[dict]:
    return conn.execute("SELECT * FROM lab_case_events WHERE case_id = %s ORDER BY at, id", (case_id,)).fetchall()


def case_detail(conn: psycopg.Connection, ctx: Ctx, case_id) -> dict:
    row = _case(conn, ctx, case_id)
    return {"case": row, "events": case_events(conn, case_id), "moves": MOVES.get(row["status"], ())}


def case_list(conn: psycopg.Connection, ctx: Ctx, *, state: str | None, lab_id: int | None, q: str | None, patient_id=None) -> list[dict]:
    doctor = appointments.doctor_scope(ctx)
    where = ["(%(doctor)s::uuid IS NULL OR c.doctor_id = %(doctor)s::uuid)"]
    if state == "open":
        where.append("c.status IN ('ordered', 'sent', 'returned', 'remake')")
    elif state == "overdue":
        where.append("c.due_on < %(today)s AND c.status IN ('ordered', 'sent', 'remake')")
    elif state == "ready":
        where.append("c.status = 'returned'")
    elif state:
        where.append("c.status = %(state)s")
    if lab_id:
        where.append("c.lab_id = %(lab)s")
    if patient_id:
        where.append("c.patient_id = %(patient)s")
    if q and q.strip():
        where.append("(p.name_search ILIKE %(like)s OR p.mrn ILIKE %(like)s OR c.ref ILIKE %(like)s OR c.teeth ILIKE %(like)s)")
    return conn.execute(
        f"""{CASE_SELECT} WHERE {' AND '.join(where)}
        ORDER BY (c.status IN ('ordered', 'sent', 'returned', 'remake')) DESC, c.due_on NULLS LAST, c.created_at DESC LIMIT 300""",
        {"doctor": doctor, "today": clinic_time.today(), "state": state, "lab": lab_id, "patient": patient_id,
         "like": f"%{(q or '').strip()}%"},
    ).fetchall()


def _event(conn: psycopg.Connection, ctx: Ctx, case_id, action: str, from_status=None, to_status=None, note=None) -> None:
    conn.execute(
        "INSERT INTO lab_case_events (case_id, actor_id, actor_label, action, from_status, to_status, note) VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (case_id, ctx.user_id, ctx.label, action, from_status, to_status, note),
    )


def _case_doctor(conn: psycopg.Connection, ctx: Ctx, given) -> str:
    if ctx.active_role == "doctor":
        return ctx.user_id
    if not given or not conn.execute(
        "SELECT 1 FROM user_roles WHERE user_id = %s AND role_code = 'doctor'", (given,),
    ).fetchone():
        raise field_error("doctor_id", "required")
    return given


def create_case(conn: psycopg.Connection, ctx: Ctx, body: LabCaseIn) -> dict:
    _scope(conn, ctx, body.patient_id)
    _patient(conn, body.patient_id)
    doctor_id = _case_doctor(conn, ctx, body.doctor_id)
    if not conn.execute("SELECT 1 FROM dental_labs WHERE id = %s AND is_active", (body.lab_id,)).fetchone():
        raise field_error("lab_id", "invalid")
    if body.plan_item_id and not conn.execute(
        "SELECT 1 FROM treatment_plan_items i JOIN treatment_plans p ON p.id = i.plan_id WHERE i.id = %s AND p.patient_id = %s",
        (body.plan_item_id, body.patient_id),
    ).fetchone():
        raise field_error("plan_item_id", "invalid")
    row = conn.execute(
        """
        INSERT INTO lab_cases (patient_id, doctor_id, lab_id, plan_item_id, work_type, teeth, shade, instructions, due_on, lab_cost,
                               doctor_share_pct, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, ref
        """,
        (body.patient_id, doctor_id, body.lab_id, body.plan_item_id, body.work_type, _clean(body.teeth), _clean(body.shade),
         _clean(body.instructions), body.due_on, body.lab_cost, body.doctor_share_pct, ctx.user_id),
    ).fetchone()
    _event(conn, ctx, row["id"], "ordered", None, "ordered", _clean(body.instructions))
    audit.record(conn, "lab.case_created", ctx=ctx, entity="lab_case", entity_id=row["id"],
                 details={"patient_id": body.patient_id, "ref": row["ref"], "work_type": body.work_type})
    return row


def edit_case(conn: psycopg.Connection, ctx: Ctx, case_id, body: LabCaseEditIn) -> None:
    row = _case(conn, ctx, case_id, lock=True)
    if row["status"] in ("delivered", "cancelled"):
        raise AppError(409, "lab_case_closed")
    if not conn.execute("SELECT 1 FROM dental_labs WHERE id = %s", (body.lab_id,)).fetchone():
        raise field_error("lab_id", "invalid")
    conn.execute(
        """
        UPDATE lab_cases SET lab_id = %s, work_type = %s, teeth = %s, shade = %s, instructions = %s, due_on = %s, lab_cost = %s,
               doctor_share_pct = %s, updated_at = now() WHERE id = %s
        """,
        (body.lab_id, body.work_type, _clean(body.teeth), _clean(body.shade), _clean(body.instructions), body.due_on, body.lab_cost,
         body.doctor_share_pct, case_id),
    )
    changes = [k for k, v in (("lab", body.lab_id != row["lab_id"]), ("due date", body.due_on != row["due_on"]),
                              ("cost", (body.lab_cost or 0) != float(row["lab_cost"] or 0))) if v]
    _event(conn, ctx, case_id, "edited", row["status"], row["status"], ", ".join(changes) or None)


def move_case(conn: psycopg.Connection, ctx: Ctx, case_id, body: LabMoveIn) -> None:
    row = _case(conn, ctx, case_id, lock=True)
    allowed = MOVES.get(row["status"], ())
    if body.to not in allowed:
        raise AppError(409, "lab_wrong_status", case_status=row["status"])
    note = _clean(body.note)
    if body.to in ("remake", "cancelled") and (not note or len(note) < 3):
        raise field_error("note", "required")
    due = body.due_on or row["due_on"]
    if body.to == "sent" and not due:
        raise field_error("due_on", "required")
    sets = {"sent": "sent_at = now()", "returned": "returned_at = now()", "delivered": "delivered_at = now()",
            "remake": "remake_count = remake_count + 1", "cancelled": "updated_at = now()"}[body.to]
    conn.execute(f"UPDATE lab_cases SET status = %s, due_on = %s, {sets}, updated_at = now() WHERE id = %s", (body.to, due, case_id))
    _event(conn, ctx, case_id, body.to, row["status"], body.to, note)
    if body.to in ("delivered", "cancelled", "remake"):
        audit.record(conn, f"lab.case_{body.to}", ctx=ctx, entity="lab_case", entity_id=case_id,
                     details={"patient_id": str(row["patient_id"]), "ref": row["ref"], "note": note})
