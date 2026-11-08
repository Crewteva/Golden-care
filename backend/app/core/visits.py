"""The doctor's visit record: note, diagnoses, prescription, signing (locks it), addenda, and the summary the
patient sees once the doctor releases it. Also vital signs and the follow-ups reception has to book.

Who may do what:
  the treating doctor (visits.write)   writes, signs, releases and adds addenda to their own visits
  visits.view_all (medical director)   reads every visit and may add addenda
  visits.vitals (nurse, doctors)       records and sees vital signs
Other doctors see that a visit exists, never what is in it."""
import re
from datetime import timedelta

import psycopg
from psycopg.types.json import Jsonb

from app.core import appointments, audit, clinic_time
from app.core.errors import AppError, field_error
from app.core.normalize import clean_name
from app.core.session import Ctx
from app.core.visit_schemas import RxIn, VisitNoteIn, VitalsIn

VISIT_SELECT = """
    SELECT v.*, p.mrn, p.full_name_ar AS patient_name_ar, p.full_name_en AS patient_name_en, p.date_of_birth, p.gender,
           p.phone AS patient_phone,
           d.full_name_ar AS doctor_name_ar, d.full_name_en AS doctor_name_en, dp.title_ar AS doctor_title_ar,
           dp.title_en AS doctor_title_en, sp.name_ar AS specialty_name_ar, sp.name_en AS specialty_name_en,
           COALESCE(dp.color, sp.color) AS doctor_color,
           rl.full_name_ar AS released_by_ar, rl.full_name_en AS released_by_en,
           (SELECT count(*) FROM visit_rx_items x WHERE x.visit_id = v.id) AS rx_count,
           (SELECT count(*) FROM visit_addenda ad WHERE ad.visit_id = v.id) AS addenda_count
    FROM visits v
    JOIN patients p ON p.id = v.patient_id
    JOIN users d ON d.id = v.doctor_id
    LEFT JOIN doctor_profiles dp ON dp.user_id = v.doctor_id
    LEFT JOIN specialties sp ON sp.id = dp.specialty_id
    LEFT JOIN users rl ON rl.id = v.released_by
"""

NOTE_FIELDS = ("complaint", "history", "examination", "plan", "follow_up_note", "patient_summary")


# ---------- access ----------

def is_author(ctx: Ctx, visit: dict) -> bool:
    return visit["doctor_id"] == ctx.user_id and "visits.write" in ctx.permissions


def can_read(ctx: Ctx, visit: dict) -> bool:
    return is_author(ctx, visit) or "visits.view_all" in ctx.permissions


def _row(conn: psycopg.Connection, visit_id, lock: bool = False) -> dict:
    if lock:
        conn.execute("SELECT 1 FROM visits WHERE id = %s FOR UPDATE", (visit_id,))
    row = conn.execute(f"{VISIT_SELECT} WHERE v.id = %s", (visit_id,)).fetchone()
    if not row:
        raise AppError(404, "visit_not_found")
    return row


def _readable(conn: psycopg.Connection, ctx: Ctx, visit_id, lock: bool = False) -> dict:
    row = _row(conn, visit_id, lock)
    if not can_read(ctx, row):
        raise AppError(403, "not_your_visit")
    return row


def _writable(conn: psycopg.Connection, ctx: Ctx, visit_id) -> dict:
    row = _row(conn, visit_id, lock=True)
    if not is_author(ctx, row):
        raise AppError(403, "not_your_visit")
    return row


def _draft(conn: psycopg.Connection, ctx: Ctx, visit_id) -> dict:
    row = _writable(conn, ctx, visit_id)
    if row["status"] != "draft":
        raise AppError(409, "visit_locked")
    return row


# ---------- starting a visit ----------

def create_for_appointment(conn: psycopg.Connection, appt: dict) -> None:
    """Called when the doctor calls the patient in: the visit record opens as a draft."""
    conn.execute(
        """
        INSERT INTO visits (appointment_id, patient_id, doctor_id, branch_id) VALUES (%s, %s, %s, %s)
        ON CONFLICT (appointment_id) DO NOTHING
        """,
        (appt["id"], appt["patient_id"], appt["doctor_id"], appt["branch_id"]),
    )


def start(conn: psycopg.Connection, ctx: Ctx, appointment_id) -> dict:
    """Opens (or returns) the visit of one of the doctor's own appointments: with them now, or finished."""
    appt = appointments.get(conn, appointment_id, lock=True)
    if appt["doctor_id"] != ctx.user_id or "visits.write" not in ctx.permissions:
        raise AppError(403, "not_your_appointment")
    if appt["status"] not in ("in_room", "completed"):
        raise AppError(409, "visit_not_started")
    create_for_appointment(conn, appt)
    return conn.execute("SELECT id FROM visits WHERE appointment_id = %s", (appointment_id,)).fetchone()


# ---------- reading ----------

def _alerts(conn: psycopg.Connection, patient_id) -> list[dict]:
    return conn.execute(
        """
        SELECT id, kind, description, severity, created_at FROM patient_alerts
        WHERE patient_id = %s AND removed_at IS NULL
        ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at
        """,
        (patient_id,),
    ).fetchall()


def rx_items(conn: psycopg.Connection, visit_id) -> list[dict]:
    return conn.execute("SELECT * FROM visit_rx_items WHERE visit_id = %s ORDER BY position", (visit_id,)).fetchall()


VITALS_SELECT = """
    SELECT vt.*, u.full_name_ar AS recorded_by_ar, u.full_name_en AS recorded_by_en
    FROM vitals vt JOIN users u ON u.id = vt.recorded_by
"""


def _visit_vitals(conn: psycopg.Connection, visit: dict) -> list[dict]:
    """Vital signs of this visit: taken for its appointment, or the same day."""
    day = clinic_time.local(visit["started_at"]).date()
    return conn.execute(
        f"""{VITALS_SELECT}
        WHERE vt.patient_id = %(p)s AND ((%(a)s::uuid IS NOT NULL AND vt.appointment_id = %(a)s::uuid)
              OR (vt.recorded_at >= %(from)s AND vt.recorded_at < %(to)s))
        ORDER BY vt.recorded_at DESC
        """,
        {"p": visit["patient_id"], "a": visit["appointment_id"],
         "from": clinic_time.at(day, clinic_time.MIDNIGHT), "to": clinic_time.at(day + timedelta(days=1), clinic_time.MIDNIGHT)},
    ).fetchall()


def detail(conn: psycopg.Connection, ctx: Ctx, visit_id) -> dict:
    visit = _readable(conn, ctx, visit_id)
    author = is_author(ctx, visit)
    if not author:
        audit.record(conn, "visit.opened", ctx=ctx, entity="visit", entity_id=visit_id,
                     details={"patient_id": str(visit["patient_id"]), "ref": visit["ref"]})
    appt = None
    if visit["appointment_id"]:
        appt = conn.execute(
            f"{appointments.SELECT} WHERE a.id = %s", (visit["appointment_id"],),
        ).fetchone()
    addenda = conn.execute(
        """
        SELECT ad.*, u.full_name_ar AS author_name_ar, u.full_name_en AS author_name_en
        FROM visit_addenda ad JOIN users u ON u.id = ad.author_id WHERE ad.visit_id = %s ORDER BY ad.created_at
        """,
        (visit_id,),
    ).fetchall()
    branch = conn.execute("SELECT * FROM branches WHERE id = %s", (visit["branch_id"],)).fetchone() if visit["branch_id"] else None
    signed = visit["status"] == "signed"
    return {
        "visit": visit,
        "appointment": appt,
        "alerts": _alerts(conn, visit["patient_id"]),
        "vitals": _visit_vitals(conn, visit),
        "rx": rx_items(conn, visit_id),
        "addenda": addenda,
        "branch": branch,
        "can": {
            "write": author and not signed,
            "sign": author and not signed,
            "release": author and signed and visit["released_at"] is None,
            "addendum": signed and (author or "visits.view_all" in ctx.permissions),
            "restricted": "prescriptions.restricted" in ctx.permissions,
        },
    }


def listing(conn: psycopg.Connection, ctx: Ctx, *, state: str | None, q: str | None, mine: bool, page: int, page_size: int = 25) -> dict:
    """Visits list: the doctor's own (mine) or, for the medical director, everyone's."""
    if mine or "visits.view_all" not in ctx.permissions:
        if "visits.write" not in ctx.permissions:
            raise AppError(403, "forbidden", permission="visits.view_all")
        doctor = ctx.user_id
    else:
        doctor = None
    where = ["(%(doctor)s::uuid IS NULL OR v.doctor_id = %(doctor)s::uuid)"]
    if state == "draft":
        where.append("v.status = 'draft'")
    elif state == "unreleased":
        where.append("v.status = 'signed' AND v.released_at IS NULL")
    elif state == "released":
        where.append("v.released_at IS NOT NULL")
    elif state == "signed":
        where.append("v.status = 'signed'")
    if q and q.strip():
        where.append("(p.name_search ILIKE %(like)s OR p.mrn ILIKE %(like)s OR v.ref ILIKE %(like)s OR v.diagnoses::text ILIKE %(like)s)")
    rows = conn.execute(
        f"""
        SELECT x.*, count(*) OVER () AS total FROM ({VISIT_SELECT} WHERE {' AND '.join(where)}) x
        ORDER BY x.started_at DESC LIMIT %(limit)s OFFSET %(offset)s
        """,
        {"doctor": doctor, "like": f"%{(q or '').strip()}%", "limit": page_size, "offset": (max(page, 1) - 1) * page_size},
    ).fetchall()
    total = rows[0]["total"] if rows else 0
    counts = conn.execute(
        """
        SELECT count(*) FILTER (WHERE status = 'draft') AS draft,
               count(*) FILTER (WHERE status = 'signed' AND released_at IS NULL) AS unreleased
        FROM visits WHERE %(doctor)s::uuid IS NULL OR doctor_id = %(doctor)s::uuid
        """,
        {"doctor": doctor},
    ).fetchone()
    return {"items": [{k: v for k, v in r.items() if k != "total"} for r in rows], "total": total, "page": page,
            "page_size": page_size, "counts": counts}


def for_patient(conn: psycopg.Connection, ctx: Ctx, patient_id) -> list[dict]:
    """Every visit of the patient. The content only for visits this person may read."""
    rows = conn.execute(f"{VISIT_SELECT} WHERE v.patient_id = %s ORDER BY v.started_at DESC LIMIT 200", (patient_id,)).fetchall()
    result = []
    for r in rows:
        if can_read(ctx, r):
            items = rx_items(conn, r["id"])
            result.append({**r, "readable": True, "rx": items})
        else:
            result.append({k: r[k] for k in ("id", "ref", "status", "started_at", "signed_at", "doctor_id", "doctor_name_ar",
                                              "doctor_name_en", "specialty_name_ar", "specialty_name_en", "doctor_color")}
                          | {"readable": False})
    return result


# ---------- writing ----------

def _clean_text(value):
    value = (value or "").strip()
    return value or None


def _diagnoses(conn: psycopg.Connection, items) -> list[dict]:
    result = []
    for item in items:
        text = clean_name(item.text) if item.text else None
        if item.diagnosis_id:
            row = conn.execute("SELECT id, code, name_ar, name_en FROM diagnoses WHERE id = %s", (item.diagnosis_id,)).fetchone()
            if not row:
                raise field_error("diagnoses", "invalid")
            result.append({"diagnosis_id": row["id"], "code": row["code"], "name_ar": row["name_ar"], "name_en": row["name_en"],
                           "text": text})
        elif text:
            result.append({"diagnosis_id": None, "code": None, "name_ar": None, "name_en": None, "text": text})
    return result


def save_note(conn: psycopg.Connection, ctx: Ctx, visit_id, body: VisitNoteIn) -> None:
    _draft(conn, ctx, visit_id)
    values = {k: _clean_text(getattr(body, k)) for k in NOTE_FIELDS}
    conn.execute(
        """
        UPDATE visits SET complaint = %(complaint)s, history = %(history)s, examination = %(examination)s,
               diagnoses = %(diagnoses)s, plan = %(plan)s, follow_up_days = %(follow_up_days)s,
               follow_up_note = %(follow_up_note)s, patient_summary = %(patient_summary)s, updated_at = now()
        WHERE id = %(id)s
        """,
        {**values, "diagnoses": Jsonb(_diagnoses(conn, body.diagnoses)), "follow_up_days": body.follow_up_days, "id": visit_id},
    )


def allergy_hit(alerts: list[dict], drug: dict) -> str | None:
    """The patient's allergy alert that matches this drug (its allergy words or active ingredient), if any."""
    words = {t.strip().lower() for t in drug["allergy_tags"] or [] if t.strip()}
    words |= {w.lower() for w in re.split(r"[^\w]+", drug["generic_name"] or "") if len(w) >= 5}
    for alert in alerts:
        if alert["kind"] != "allergy":
            continue
        text = alert["description"].lower()
        if any(w in text for w in words):
            return alert["description"]
    return None


def save_rx(conn: psycopg.Connection, ctx: Ctx, visit_id, body: RxIn) -> None:
    visit = _draft(conn, ctx, visit_id)
    alerts = _alerts(conn, visit["patient_id"])
    rows = []
    for position, item in enumerate(body.items):
        drug = conn.execute("SELECT * FROM drugs WHERE id = %s", (item.drug_id,)).fetchone()
        if not drug or not drug["is_active"]:
            raise AppError(422, "validation", fields={f"items.{position}.drug_id": "unavailable"})
        restricted_reason = _clean_text(item.restricted_reason)
        if drug["restricted"]:
            if "prescriptions.restricted" not in ctx.permissions:
                raise AppError(403, "restricted_drug", drug=drug["name"], position=position)
            if not restricted_reason or len(restricted_reason) < 5:
                raise AppError(409, "restricted_reason_required", drug=drug["name"], position=position)
        hit = allergy_hit(alerts, drug)
        allergy_reason = _clean_text(item.allergy_reason)
        if hit and (not allergy_reason or len(allergy_reason) < 5):
            raise AppError(409, "allergy_conflict", drug=drug["name"], alert=hit, position=position)
        rows.append((visit_id, position, drug["id"], drug["name"], drug["generic_name"], drug["form"], drug["strength"],
                     item.dose.strip(), item.frequency.strip(), item.duration.strip(), _clean_text(item.instructions),
                     drug["restricted"], restricted_reason if drug["restricted"] else None,
                     hit, allergy_reason if hit else None))
    conn.execute("DELETE FROM visit_rx_items WHERE visit_id = %s", (visit_id,))
    for row in rows:
        conn.execute(
            """
            INSERT INTO visit_rx_items (visit_id, position, drug_id, drug_name, generic_name, form, strength, dose, frequency,
                                        duration, instructions, restricted, restricted_reason, allergy_alert, allergy_reason)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            row,
        )
    conn.execute("UPDATE visits SET updated_at = now() WHERE id = %s", (visit_id,))


def sign(conn: psycopg.Connection, ctx: Ctx, visit_id) -> None:
    """Signs and locks the visit, and finishes the appointment if the patient is still in the room."""
    visit = _draft(conn, ctx, visit_id)
    missing = {}
    if not visit["diagnoses"]:
        missing["diagnoses"] = "required"
    if not (visit["complaint"] or visit["examination"]):
        missing["complaint"] = "required"
    if missing:
        raise AppError(422, "visit_incomplete", fields=missing)
    items = rx_items(conn, visit_id)
    conn.execute("UPDATE visits SET status = 'signed', signed_at = now(), updated_at = now() WHERE id = %s", (visit_id,))
    details = {
        "patient_id": str(visit["patient_id"]), "ref": visit["ref"],
        "diagnoses": [d.get("name_en") or d.get("text") for d in visit["diagnoses"]],
        "rx": [i["drug_name"] for i in items],
    }
    restricted = [{"drug": i["drug_name"], "reason": i["restricted_reason"]} for i in items if i["restricted"]]
    overrides = [{"drug": i["drug_name"], "alert": i["allergy_alert"], "reason": i["allergy_reason"]} for i in items if i["allergy_alert"]]
    if restricted:
        details["restricted"] = restricted
    if overrides:
        details["allergy_overrides"] = overrides
    audit.record(conn, "visit.signed", ctx=ctx, entity="visit", entity_id=visit_id, details=details)
    if visit["appointment_id"]:
        appt = appointments.get(conn, visit["appointment_id"])
        if appt["status"] == "in_room":
            appointments.finish(conn, ctx, visit["appointment_id"])


def release(conn: psycopg.Connection, ctx: Ctx, visit_id, summary: str) -> None:
    visit = _writable(conn, ctx, visit_id)
    if visit["status"] != "signed":
        raise AppError(409, "visit_not_signed")
    if visit["released_at"]:
        raise AppError(409, "already_released")
    summary = summary.strip()
    if len(summary) < 10:
        raise field_error("patient_summary", "too_short")
    conn.execute(
        "UPDATE visits SET patient_summary = %s, released_at = now(), released_by = %s, updated_at = now() WHERE id = %s",
        (summary, ctx.user_id, visit_id),
    )
    audit.record(conn, "visit.released", ctx=ctx, entity="visit", entity_id=visit_id,
                 details={"patient_id": str(visit["patient_id"]), "ref": visit["ref"], "patient_summary": summary})


def add_addendum(conn: psycopg.Connection, ctx: Ctx, visit_id, body: str) -> None:
    visit = _readable(conn, ctx, visit_id, lock=True)
    if visit["status"] != "signed":
        raise AppError(409, "visit_not_signed")
    body = body.strip()
    if len(body) < 5:
        raise field_error("body", "too_short")
    conn.execute("INSERT INTO visit_addenda (visit_id, author_id, body) VALUES (%s, %s, %s)", (visit_id, ctx.user_id, body))
    audit.record(conn, "visit.addendum", ctx=ctx, entity="visit", entity_id=visit_id,
                 details={"patient_id": str(visit["patient_id"]), "ref": visit["ref"]})


# ---------- vital signs ----------

VITAL_FIELDS = ("bp_systolic", "bp_diastolic", "pulse", "temperature", "resp_rate", "spo2", "weight_kg", "height_cm")


def record_vitals(conn: psycopg.Connection, ctx: Ctx, body: VitalsIn) -> dict:
    appointment_id = body.appointment_id
    if appointment_id:
        appt = appointments.get(conn, appointment_id, ctx)
        if appt["status"] not in ("arrived", "in_room", "completed"):
            raise AppError(409, "patient_not_arrived")
        patient_id = appt["patient_id"]
    elif body.patient_id:
        patient_id = body.patient_id
        if not conn.execute("SELECT 1 FROM patients WHERE id = %s", (patient_id,)).fetchone():
            raise AppError(404, "patient_not_found")
    else:
        raise field_error("appointment_id", "required")
    values = {k: getattr(body, k) for k in VITAL_FIELDS}
    if all(v is None for v in values.values()):
        raise AppError(422, "vitals_empty")
    if (values["bp_systolic"] is None) != (values["bp_diastolic"] is None):
        raise field_error("bp_diastolic" if values["bp_diastolic"] is None else "bp_systolic", "required")
    if values["bp_systolic"] is not None and values["bp_diastolic"] >= values["bp_systolic"]:
        raise field_error("bp_diastolic", "invalid")
    row = conn.execute(
        """
        INSERT INTO vitals (patient_id, appointment_id, recorded_by, bp_systolic, bp_diastolic, pulse, temperature, resp_rate,
                            spo2, weight_kg, height_cm, note)
        VALUES (%(patient)s, %(appt)s, %(by)s, %(bp_systolic)s, %(bp_diastolic)s, %(pulse)s, %(temperature)s, %(resp_rate)s,
                %(spo2)s, %(weight_kg)s, %(height_cm)s, %(note)s)
        RETURNING id
        """,
        {**values, "patient": patient_id, "appt": appointment_id, "by": ctx.user_id, "note": _clean_text(body.note)},
    ).fetchone()
    audit.record(conn, "vitals.recorded", ctx=ctx, entity="patient", entity_id=patient_id,
                 details={k: (float(v) if isinstance(v, float) else v) for k, v in values.items() if v is not None})
    return conn.execute(f"{VITALS_SELECT} WHERE vt.id = %s", (row["id"],)).fetchone()


def vitals_for_patient(conn: psycopg.Connection, patient_id) -> list[dict]:
    return conn.execute(f"{VITALS_SELECT} WHERE vt.patient_id = %s ORDER BY vt.recorded_at DESC LIMIT 60", (patient_id,)).fetchall()


def vitals_today(conn: psycopg.Connection) -> list[dict]:
    """Today's vitals, keyed by appointment, for the nurse's list."""
    today = clinic_time.today()
    return conn.execute(
        f"{VITALS_SELECT} WHERE vt.recorded_at >= %s AND vt.appointment_id IS NOT NULL ORDER BY vt.recorded_at DESC",
        (clinic_time.at(today, clinic_time.MIDNIGHT),),
    ).fetchall()


# ---------- follow-ups for reception ----------

def follow_ups(conn: psycopg.Connection) -> list[dict]:
    """Signed visits where the doctor asked for a follow-up and nothing has been booked since."""
    today = clinic_time.today()
    return conn.execute(
        """
        SELECT v.id AS visit_id, v.ref, v.patient_id, v.doctor_id, v.follow_up_days, v.follow_up_note, v.signed_at,
               (v.signed_at AT TIME ZONE %(tz)s)::date + v.follow_up_days AS due_on,
               p.mrn, p.full_name_ar AS patient_name_ar, p.full_name_en AS patient_name_en, p.phone AS patient_phone,
               d.full_name_ar AS doctor_name_ar, d.full_name_en AS doctor_name_en, COALESCE(dp.color, sp.color) AS doctor_color
        FROM visits v
        JOIN patients p ON p.id = v.patient_id
        JOIN users d ON d.id = v.doctor_id
        LEFT JOIN doctor_profiles dp ON dp.user_id = v.doctor_id
        LEFT JOIN specialties sp ON sp.id = dp.specialty_id
        WHERE v.status = 'signed' AND v.follow_up_days IS NOT NULL
          AND (v.signed_at AT TIME ZONE %(tz)s)::date + v.follow_up_days BETWEEN %(from)s AND %(to)s
          AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = v.patient_id AND a.doctor_id = v.doctor_id
                          AND a.starts_at > v.started_at AND a.id IS DISTINCT FROM v.appointment_id
                          AND a.status NOT IN ('cancelled', 'no_show'))
        ORDER BY due_on, p.full_name_ar
        """,
        {"tz": str(clinic_time.TZ), "from": today - timedelta(days=60), "to": today + timedelta(days=21)},
    ).fetchall()


# ---------- patient portal ----------

PORTAL_COLUMNS = """
    v.id, v.ref, v.patient_id, v.started_at, v.signed_at, v.released_at, v.patient_summary, v.follow_up_days,
    p.full_name_ar AS patient_name_ar, p.full_name_en AS patient_name_en, p.mrn, p.date_of_birth, p.gender,
    d.full_name_ar AS doctor_name_ar, d.full_name_en AS doctor_name_en, dp.title_ar AS doctor_title_ar, dp.title_en AS doctor_title_en,
    sp.name_ar AS specialty_name_ar, sp.name_en AS specialty_name_en, v.branch_id
"""
PORTAL_FROM = """
    FROM visits v JOIN patients p ON p.id = v.patient_id JOIN users d ON d.id = v.doctor_id
    LEFT JOIN doctor_profiles dp ON dp.user_id = v.doctor_id LEFT JOIN specialties sp ON sp.id = dp.specialty_id
"""
PORTAL_RX = "drug_name, generic_name, form, strength, dose, frequency, duration, instructions"


def released_for(conn: psycopg.Connection, patient_ids: list) -> list[dict]:
    """What the patient sees: released visits only, with the summary and the prescription. Never the medical note."""
    if not patient_ids:
        return []
    rows = conn.execute(
        f"SELECT {PORTAL_COLUMNS} {PORTAL_FROM} WHERE v.patient_id = ANY(%s) AND v.released_at IS NOT NULL ORDER BY v.started_at DESC",
        (patient_ids,),
    ).fetchall()
    for r in rows:
        r["rx"] = conn.execute(f"SELECT {PORTAL_RX} FROM visit_rx_items WHERE visit_id = %s ORDER BY position", (r["id"],)).fetchall()
    return rows


def released_one(conn: psycopg.Connection, ctx: Ctx, patient_ids: list, visit_id) -> dict:
    row = conn.execute(
        f"SELECT {PORTAL_COLUMNS} {PORTAL_FROM} WHERE v.id = %s AND v.patient_id = ANY(%s) AND v.released_at IS NOT NULL",
        (visit_id, patient_ids),
    ).fetchone()
    if not row:
        raise AppError(404, "visit_not_found")
    row["rx"] = conn.execute(f"SELECT {PORTAL_RX} FROM visit_rx_items WHERE visit_id = %s ORDER BY position", (visit_id,)).fetchall()
    row["allergies"] = [a["description"] for a in _alerts(conn, row["patient_id"]) if a["kind"] == "allergy"]
    row["branch"] = conn.execute("SELECT * FROM branches WHERE id = %s", (row["branch_id"],)).fetchone() if row["branch_id"] else None
    audit.record(conn, "visit.opened_by_patient", ctx=ctx, entity="visit", entity_id=visit_id,
                 details={"patient_id": str(row["patient_id"]), "ref": row["ref"]})
    return row
