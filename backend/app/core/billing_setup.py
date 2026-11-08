"""Billing setup that management controls: packages (add, edit, archive — a package already sold can't be deleted),
doctor share rules (percentage or fixed amount, per service or for all of a doctor's services, with a start date)
and the billing rules (discount limit, installments, the note printed on receipts)."""
from datetime import date
from decimal import Decimal

import psycopg
from psycopg.types.json import Jsonb

from app.core import audit
from app.core.billing_schemas import BillingRulesIn, PackageIn, ShareRuleIn
from app.core.catalog import _changes, _check_doctor, friendly_db_errors
from app.core.errors import AppError, field_error
from app.core.normalize import clean_name
from app.core.session import Ctx

RULE_DEFAULTS = {"max_discount_pct": 10, "max_installments": 12, "receipt_note_ar": "", "receipt_note_en": ""}


def rules(conn: psycopg.Connection) -> dict:
    values = dict(RULE_DEFAULTS)
    for row in conn.execute("SELECT key, value FROM app_settings WHERE key LIKE 'billing.%%'"):
        values[row["key"].removeprefix("billing.")] = row["value"]
    return values


def save_rules(conn: psycopg.Connection, ctx: Ctx, body: BillingRulesIn) -> dict:
    before = rules(conn)
    new = body.model_dump()
    new["receipt_note_ar"] = new["receipt_note_ar"].strip()
    new["receipt_note_en"] = new["receipt_note_en"].strip()
    for key, value in new.items():
        conn.execute(
            """
            INSERT INTO app_settings (key, value, updated_by) VALUES (%s, %s, %s)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
            """,
            (f"billing.{key}", Jsonb(value), ctx.user_id),
        )
    changes = {k: [before.get(k), v] for k, v in new.items() if before.get(k) != v}
    if changes:
        audit.record(conn, "settings.billing_rules_updated", ctx=ctx, entity="settings", entity_id="billing", details={"changes": changes})
    return rules(conn)


# ---------- packages ----------

PACKAGE_SELECT = """
    SELECT k.*, s.code AS service_code, s.name_ar AS service_name_ar, s.name_en AS service_name_en,
           (SELECT count(*) FROM patient_packages pp WHERE pp.package_id = k.id) AS sold,
           (SELECT count(*) FROM patient_packages pp WHERE pp.package_id = k.id AND pp.status = 'active') AS active_sold
    FROM packages k JOIN services s ON s.id = k.service_id
"""


def packages(conn: psycopg.Connection, active_only: bool = False) -> list[dict]:
    rows = conn.execute(f"{PACKAGE_SELECT} {'WHERE k.is_active AND s.is_active' if active_only else ''} ORDER BY k.sort_order, k.name_en").fetchall()
    for row in rows:
        row["single_price"] = conn.execute(
            "SELECT amount FROM service_prices WHERE service_id = %s AND doctor_id IS NULL AND starts_on <= current_date ORDER BY starts_on DESC LIMIT 1",
            (row["service_id"],),
        ).fetchone()
        row["single_price"] = row["single_price"]["amount"] if row["single_price"] else None
    return rows


def save_package(conn: psycopg.Connection, ctx: Ctx, body: PackageIn, package_id: int | None = None) -> dict:
    if not conn.execute("SELECT 1 FROM services WHERE id = %s", (body.service_id,)).fetchone():
        raise field_error("service_id", "invalid")
    values = {"service_id": body.service_id, "name_ar": clean_name(body.name_ar), "name_en": clean_name(body.name_en),
              "sessions": body.sessions, "price": body.price, "valid_days": body.valid_days, "notes": clean_name(body.notes),
              "is_active": body.is_active, "sort_order": body.sort_order}
    if package_id is None:
        row = conn.execute(
            """
            INSERT INTO packages (service_id, name_ar, name_en, sessions, price, valid_days, notes, is_active, sort_order)
            VALUES (%(service_id)s, %(name_ar)s, %(name_en)s, %(sessions)s, %(price)s, %(valid_days)s, %(notes)s, %(is_active)s, %(sort_order)s)
            RETURNING *
            """,
            values,
        ).fetchone()
        audit.record(conn, "settings.package_created", ctx=ctx, entity="package", entity_id=row["id"],
                     details={**values, "price": str(body.price)})
        return row
    before = conn.execute("SELECT * FROM packages WHERE id = %s FOR UPDATE", (package_id,)).fetchone()
    if not before:
        raise AppError(404, "not_found")
    # what patients already bought is a copy, so editing a package only changes future sales
    row = conn.execute(
        """
        UPDATE packages SET service_id = %(service_id)s, name_ar = %(name_ar)s, name_en = %(name_en)s, sessions = %(sessions)s,
               price = %(price)s, valid_days = %(valid_days)s, notes = %(notes)s, is_active = %(is_active)s,
               sort_order = %(sort_order)s, updated_at = now()
        WHERE id = %(id)s RETURNING *
        """,
        {**values, "id": package_id},
    ).fetchone()
    audit.record(conn, "settings.package_updated", ctx=ctx, entity="package", entity_id=package_id,
                 details={"name": values["name_en"], "changes": _changes(before, values)})
    return row


def delete_package(conn: psycopg.Connection, ctx: Ctx, package_id: int) -> None:
    if conn.execute("SELECT 1 FROM invoice_lines WHERE package_id = %s LIMIT 1", (package_id,)).fetchone():
        raise AppError(409, "in_use")
    with friendly_db_errors(), conn.transaction():
        row = conn.execute("DELETE FROM packages WHERE id = %s RETURNING *", (package_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    audit.record(conn, "settings.package_deleted", ctx=ctx, entity="package", entity_id=package_id, details={"name": row["name_en"]})


# ---------- doctor share rules ----------

def share_rules(conn: psycopg.Connection) -> dict:
    rows = conn.execute(
        """
        SELECT r.*, d.full_name_ar AS doctor_name_ar, d.full_name_en AS doctor_name_en,
               s.code AS service_code, s.name_ar AS service_name_ar, s.name_en AS service_name_en,
               r.starts_on <= current_date AND NOT EXISTS (
                 SELECT 1 FROM doctor_share_rules q WHERE q.doctor_id = r.doctor_id AND q.service_id IS NOT DISTINCT FROM r.service_id
                   AND q.starts_on > r.starts_on AND q.starts_on <= current_date) AS in_force
        FROM doctor_share_rules r JOIN users d ON d.id = r.doctor_id LEFT JOIN services s ON s.id = r.service_id
        ORDER BY d.full_name_en, r.service_id NULLS FIRST, r.starts_on DESC
        """
    ).fetchall()
    doctors = conn.execute(
        """
        SELECT u.id, u.full_name_ar, u.full_name_en FROM users u
        WHERE u.is_active AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_code = 'doctor')
        ORDER BY u.full_name_en
        """
    ).fetchall()
    return {"rules": rows, "doctors": doctors}


def save_share_rule(conn: psycopg.Connection, ctx: Ctx, body: ShareRuleIn, rule_id: int | None = None) -> None:
    _check_doctor(conn, body.doctor_id)
    if body.service_id and not conn.execute("SELECT 1 FROM services WHERE id = %s", (body.service_id,)).fetchone():
        raise field_error("service_id", "invalid")
    if body.kind == "percent" and body.value > 100:
        raise field_error("value", "invalid")
    values = {"doctor_id": body.doctor_id, "service_id": body.service_id, "kind": body.kind, "value": body.value,
              "deduct_cost": body.deduct_cost, "starts_on": body.starts_on, "uid": ctx.user_id}
    with friendly_db_errors("starts_on"), conn.transaction():
        if rule_id is None:
            row = conn.execute(
                """
                INSERT INTO doctor_share_rules (doctor_id, service_id, kind, value, deduct_cost, starts_on, created_by)
                VALUES (%(doctor_id)s, %(service_id)s, %(kind)s, %(value)s, %(deduct_cost)s, %(starts_on)s, %(uid)s) RETURNING id
                """,
                values,
            ).fetchone()
            action, rule_id = "settings.share_rule_added", row["id"]
        else:
            row = conn.execute(
                """
                UPDATE doctor_share_rules SET doctor_id = %(doctor_id)s, service_id = %(service_id)s, kind = %(kind)s, value = %(value)s,
                       deduct_cost = %(deduct_cost)s, starts_on = %(starts_on)s
                WHERE id = %(id)s RETURNING id
                """,
                {**values, "id": rule_id},
            ).fetchone()
            if not row:
                raise AppError(404, "not_found")
            action = "settings.share_rule_updated"
    audit.record(conn, action, ctx=ctx, entity="share_rule", entity_id=rule_id, details={
        "doctor_id": str(body.doctor_id), "service_id": body.service_id, "kind": body.kind, "value": str(body.value),
        "deduct_cost": body.deduct_cost, "starts_on": str(body.starts_on)})


def delete_share_rule(conn: psycopg.Connection, ctx: Ctx, rule_id: int) -> None:
    row = conn.execute("DELETE FROM doctor_share_rules WHERE id = %s RETURNING *", (rule_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    audit.record(conn, "settings.share_rule_deleted", ctx=ctx, entity="share_rule", entity_id=rule_id,
                 details={"doctor_id": str(row["doctor_id"]), "service_id": row["service_id"], "starts_on": str(row["starts_on"])})


def share_rule_for(conn: psycopg.Connection, doctor_id, service_id, day: date) -> dict | None:
    """The rule in force that day: one for this exact service wins over the doctor's all-services rule."""
    return conn.execute(
        """
        SELECT * FROM doctor_share_rules
        WHERE doctor_id = %(d)s AND (service_id = %(s)s OR service_id IS NULL) AND starts_on <= %(day)s
        ORDER BY service_id NULLS LAST, starts_on DESC LIMIT 1
        """,
        {"d": doctor_id, "s": service_id, "day": day},
    ).fetchone()


def doctor_share(rule: dict | None, *, net: Decimal, cost: Decimal, qty: int) -> Decimal:
    """Percentage: of what the clinic earned for the line (before VAT), less the direct cost if the rule says so.
    Fixed: the amount per unit."""
    if not rule:
        return Decimal("0.00")
    if rule["kind"] == "fixed":
        return (Decimal(rule["value"]) * qty).quantize(Decimal("0.01"))
    base = net - (cost if rule["deduct_cost"] else Decimal(0))
    return max(Decimal(0), base * Decimal(rule["value"]) / 100).quantize(Decimal("0.01"))
