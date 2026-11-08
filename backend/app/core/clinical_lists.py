"""The drug list and the diagnosis list doctors pick from. The medical director keeps them up to date."""
import psycopg
from psycopg import errors as pg_errors

from app.core import audit
from app.core.errors import AppError
from app.core.session import Ctx
from app.core.visit_schemas import DiagnosisListIn, DrugIn
from app.core.visits import _alerts, allergy_hit


def search_drugs(conn: psycopg.Connection, q: str | None, patient_id=None, include_inactive: bool = False, limit: int = 30) -> list[dict]:
    like = f"%{(q or '').strip()}%"
    rows = conn.execute(
        """
        SELECT * FROM drugs
        WHERE (%(all)s OR is_active) AND (%(like)s = '%%%%' OR name ILIKE %(like)s OR generic_name ILIKE %(like)s)
        ORDER BY is_active DESC, CASE WHEN name ILIKE %(start)s THEN 0 ELSE 1 END, name
        LIMIT %(limit)s
        """,
        {"all": include_inactive, "like": like, "start": f"{(q or '').strip()}%", "limit": limit},
    ).fetchall()
    if patient_id:
        alerts = _alerts(conn, patient_id)
        for r in rows:
            r["allergy_alert"] = allergy_hit(alerts, r)
    return rows


def search_diagnoses(conn: psycopg.Connection, q: str | None, specialty_id: int | None = None,
                     include_inactive: bool = False, limit: int = 40) -> list[dict]:
    like = f"%{(q or '').strip()}%"
    return conn.execute(
        """
        SELECT dg.*, sp.name_ar AS specialty_name_ar, sp.name_en AS specialty_name_en
        FROM diagnoses dg LEFT JOIN specialties sp ON sp.id = dg.specialty_id
        WHERE (%(all)s OR dg.is_active)
          AND (%(like)s = '%%%%' OR dg.name_ar ILIKE %(like)s OR dg.name_en ILIKE %(like)s OR dg.code ILIKE %(like)s)
        ORDER BY CASE WHEN %(spec)s::int IS NOT NULL AND dg.specialty_id = %(spec)s::int THEN 0
                      WHEN dg.specialty_id IS NULL THEN 1 ELSE 2 END,
                 sp.sort_order NULLS FIRST, dg.sort_order, dg.name_en
        LIMIT %(limit)s
        """,
        {"all": include_inactive, "like": like, "spec": specialty_id, "limit": limit},
    ).fetchall()


def _tags(values: list[str]) -> list[str]:
    return sorted({v.strip().lower() for v in values if v and v.strip()})


def save_drug(conn: psycopg.Connection, ctx: Ctx, body: DrugIn, drug_id: int | None = None) -> dict:
    values = body.model_dump()
    values["allergy_tags"] = _tags(body.allergy_tags)
    for key in ("strength", "default_dose", "default_frequency", "default_duration"):
        values[key] = (values[key] or "").strip() or None
    values["name"], values["generic_name"] = body.name.strip(), body.generic_name.strip()
    try:
        with conn.transaction():
            if drug_id is None:
                row = conn.execute(
                    """
                    INSERT INTO drugs (name, generic_name, form, strength, default_dose, default_frequency, default_duration,
                                       restricted, allergy_tags, is_active)
                    VALUES (%(name)s, %(generic_name)s, %(form)s, %(strength)s, %(default_dose)s, %(default_frequency)s,
                            %(default_duration)s, %(restricted)s, %(allergy_tags)s, %(is_active)s)
                    RETURNING *
                    """,
                    values,
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    UPDATE drugs SET name = %(name)s, generic_name = %(generic_name)s, form = %(form)s, strength = %(strength)s,
                           default_dose = %(default_dose)s, default_frequency = %(default_frequency)s,
                           default_duration = %(default_duration)s, restricted = %(restricted)s,
                           allergy_tags = %(allergy_tags)s, is_active = %(is_active)s
                    WHERE id = %(id)s RETURNING *
                    """,
                    {**values, "id": drug_id},
                ).fetchone()
                if not row:
                    raise AppError(404, "not_found")
    except pg_errors.UniqueViolation:
        raise AppError(409, "conflict", fields={"name": "taken"}) from None
    audit.record(conn, "clinical.drug_saved", ctx=ctx, entity="drug", entity_id=row["id"],
                 details={"name": row["name"], "restricted": row["restricted"], "new": drug_id is None})
    return row


def delete_drug(conn: psycopg.Connection, ctx: Ctx, drug_id: int) -> None:
    row = conn.execute("SELECT name FROM drugs WHERE id = %s", (drug_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    if conn.execute("SELECT 1 FROM visit_rx_items WHERE drug_id = %s LIMIT 1", (drug_id,)).fetchone():
        raise AppError(409, "in_use")
    conn.execute("DELETE FROM drugs WHERE id = %s", (drug_id,))
    audit.record(conn, "clinical.drug_deleted", ctx=ctx, entity="drug", entity_id=drug_id, details={"name": row["name"]})


def save_diagnosis(conn: psycopg.Connection, ctx: Ctx, body: DiagnosisListIn, diagnosis_id: int | None = None) -> dict:
    values = {**body.model_dump(), "code": (body.code or "").strip().upper() or None,
              "name_ar": body.name_ar.strip(), "name_en": body.name_en.strip()}
    if values["specialty_id"] and not conn.execute("SELECT 1 FROM specialties WHERE id = %s", (values["specialty_id"],)).fetchone():
        raise AppError(422, "validation", fields={"specialty_id": "invalid"})
    try:
        with conn.transaction():
            if diagnosis_id is None:
                row = conn.execute(
                    """
                    INSERT INTO diagnoses (specialty_id, code, name_ar, name_en, is_active, sort_order)
                    VALUES (%(specialty_id)s, %(code)s, %(name_ar)s, %(name_en)s, %(is_active)s, %(sort_order)s) RETURNING *
                    """,
                    values,
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    UPDATE diagnoses SET specialty_id = %(specialty_id)s, code = %(code)s, name_ar = %(name_ar)s,
                           name_en = %(name_en)s, is_active = %(is_active)s, sort_order = %(sort_order)s
                    WHERE id = %(id)s RETURNING *
                    """,
                    {**values, "id": diagnosis_id},
                ).fetchone()
                if not row:
                    raise AppError(404, "not_found")
    except pg_errors.UniqueViolation:
        raise AppError(409, "conflict", fields={"name_en": "taken"}) from None
    audit.record(conn, "clinical.diagnosis_saved", ctx=ctx, entity="diagnosis", entity_id=row["id"],
                 details={"name": row["name_en"], "new": diagnosis_id is None})
    return row


def delete_diagnosis(conn: psycopg.Connection, ctx: Ctx, diagnosis_id: int) -> None:
    row = conn.execute("SELECT name_en FROM diagnoses WHERE id = %s", (diagnosis_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    if conn.execute(
        "SELECT 1 FROM visits WHERE diagnoses @> %s::jsonb LIMIT 1", (f'[{{"diagnosis_id": {int(diagnosis_id)}}}]',),
    ).fetchone():
        raise AppError(409, "in_use")
    conn.execute("DELETE FROM diagnoses WHERE id = %s", (diagnosis_id,))
    audit.record(conn, "clinical.diagnosis_deleted", ctx=ctx, entity="diagnosis", entity_id=diagnosis_id,
                 details={"name": row["name_en"]})
