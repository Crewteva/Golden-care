"""Laser session records: safety checklist, settings per body area, and the device's pulse counter before and
after — so every pulse fired is accounted for. Signing locks the record and moves the device counter forward.

The operator (doctor or trained nurse with laser.record) writes and signs their own session."""
from datetime import timedelta

import psycopg
from psycopg.types.json import Jsonb

from app.core import appointments, audit, clinic_time
from app.core.clinical_schemas import DeviceIn, LaserSessionIn
from app.core.errors import AppError
from app.core.session import Ctx

# Safety questions asked before every session. A "yes" on a stop question needs a written reason to go ahead;
# the patient's signed consent is always required.
CHECKLIST = ["pregnant", "isotretinoin", "photosensitive_meds", "recent_tan", "active_infection", "herpes_history",
             "tattoo_in_area", "epilepsy_light", "keloid", "consent_signed", "patch_test"]
STOP = {"pregnant", "isotretinoin", "recent_tan", "active_infection", "epilepsy_light"}
MUST_BE_YES = {"consent_signed"}

SESSION_SELECT = """
    SELECT s.*, p.mrn, p.full_name_ar AS patient_name_ar, p.full_name_en AS patient_name_en, p.date_of_birth, p.gender,
           u.full_name_ar AS operator_name_ar, u.full_name_en AS operator_name_en,
           dv.name AS device_name, dv.model AS device_model, dv.pulse_counter AS device_counter,
           (SELECT COALESCE(sum(a.pulses), 0) FROM laser_session_areas a WHERE a.session_id = s.id) AS recorded_pulses,
           (SELECT string_agg(a.area, ' · ' ORDER BY a.position) FROM laser_session_areas a WHERE a.session_id = s.id) AS areas_text
    FROM laser_sessions s
    JOIN patients p ON p.id = s.patient_id
    JOIN users u ON u.id = s.operator_id
    LEFT JOIN devices dv ON dv.id = s.device_id
"""


def _get(conn: psycopg.Connection, session_id, lock: bool = False) -> dict:
    if lock:
        conn.execute("SELECT 1 FROM laser_sessions WHERE id = %s FOR UPDATE", (session_id,))
    row = conn.execute(f"{SESSION_SELECT} WHERE s.id = %s", (session_id,)).fetchone()
    if not row:
        raise AppError(404, "laser_session_not_found")
    return row


def _scope(conn: psycopg.Connection, ctx: Ctx, patient_id) -> None:
    """Doctors only reach their own patients (same rule as the patient file)."""
    doctor = appointments.doctor_scope(ctx)
    if doctor and not appointments.doctor_has_patient(conn, doctor, patient_id):
        raise AppError(403, "not_your_patient")


def _draft_of_operator(conn: psycopg.Connection, ctx: Ctx, session_id) -> dict:
    s = _get(conn, session_id, lock=True)
    if s["operator_id"] != ctx.user_id:
        raise AppError(403, "not_your_session")
    if s["status"] != "draft":
        raise AppError(409, "visit_locked")
    return s


def areas(conn: psycopg.Connection, session_id) -> list[dict]:
    return conn.execute("SELECT * FROM laser_session_areas WHERE session_id = %s ORDER BY position", (session_id,)).fetchall()


def devices(conn: psycopg.Connection, include_inactive: bool = False) -> list[dict]:
    return conn.execute(
        """
        SELECT d.*, r.name_ar AS room_name_ar, r.name_en AS room_name_en,
               (SELECT max(signed_at) FROM laser_sessions s WHERE s.device_id = d.id) AS last_used_at
        FROM devices d LEFT JOIN rooms r ON r.id = d.room_id
        WHERE d.kind = 'laser' AND (%s OR d.is_active) ORDER BY d.is_active DESC, d.name
        """,
        (include_inactive,),
    ).fetchall()


# ---------- starting ----------

def start(conn: psycopg.Connection, ctx: Ctx, appointment_id) -> dict:
    appt = appointments.get(conn, appointment_id, ctx, lock=True)
    if appt["status"] not in ("arrived", "in_room", "completed"):
        raise AppError(409, "patient_not_arrived")
    mine = conn.execute(
        "SELECT id FROM laser_sessions WHERE appointment_id = %s AND operator_id = %s AND status = 'draft'",
        (appointment_id, ctx.user_id),
    ).fetchone()
    if mine:
        return mine
    previous = conn.execute(
        "SELECT * FROM laser_sessions WHERE patient_id = %s AND status = 'signed' ORDER BY signed_at DESC LIMIT 1",
        (appt["patient_id"],),
    ).fetchone()
    count = conn.execute("SELECT count(*) AS n FROM laser_sessions WHERE patient_id = %s AND status = 'signed'",
                         (appt["patient_id"],)).fetchone()["n"]
    device = conn.execute(
        """
        SELECT * FROM devices WHERE kind = 'laser' AND is_active AND status = 'working'
        ORDER BY (room_id IS NOT DISTINCT FROM %s) DESC, (id IS NOT DISTINCT FROM %s) DESC, name LIMIT 1
        """,
        (appt["room_id"], previous["device_id"] if previous else None),
    ).fetchone()
    row = conn.execute(
        """
        INSERT INTO laser_sessions (appointment_id, patient_id, operator_id, device_id, session_no, skin_type, hair_color, counter_start)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
        """,
        (appointment_id, appt["patient_id"], ctx.user_id, device["id"] if device else None, min(count + 1, 60),
         previous["skin_type"] if previous else None, previous["hair_color"] if previous else None,
         device["pulse_counter"] if device else None),
    ).fetchone()
    if previous:  # same areas as last time, with last time's settings as the starting point
        for a in areas(conn, previous["id"]):
            conn.execute(
                """
                INSERT INTO laser_session_areas (session_id, position, area, fluence, pulse_ms, spot_mm, frequency_hz, pulses)
                VALUES (%s, %s, %s, %s, %s, %s, %s, 0)
                """,
                (row["id"], a["position"], a["area"], a["fluence"], a["pulse_ms"], a["spot_mm"], a["frequency_hz"]),
            )
    return row


# ---------- reading ----------

def detail(conn: psycopg.Connection, ctx: Ctx, session_id) -> dict:
    s = _get(conn, session_id)
    _scope(conn, ctx, s["patient_id"])
    history = conn.execute(
        f"{SESSION_SELECT} WHERE s.patient_id = %s AND s.id <> %s AND s.status = 'signed' ORDER BY s.signed_at DESC LIMIT 6",
        (s["patient_id"], session_id),
    ).fetchall()
    for h in history:
        h["areas"] = areas(conn, h["id"])
    alerts = conn.execute(
        "SELECT id, kind, description, severity FROM patient_alerts WHERE patient_id = %s AND removed_at IS NULL ORDER BY severity",
        (s["patient_id"],),
    ).fetchall()
    appt = conn.execute(f"{appointments.SELECT} WHERE a.id = %s", (s["appointment_id"],)).fetchone() if s["appointment_id"] else None
    draft = s["status"] == "draft"
    return {
        "session": s, "areas": areas(conn, session_id), "history": history, "alerts": alerts, "appointment": appt,
        "devices": devices(conn), "checklist": {"items": CHECKLIST, "stop": sorted(STOP), "must_be_yes": sorted(MUST_BE_YES)},
        "can": {"write": draft and s["operator_id"] == ctx.user_id},
    }


def for_patient(conn: psycopg.Connection, ctx: Ctx, patient_id) -> list[dict]:
    _scope(conn, ctx, patient_id)
    rows = conn.execute(f"{SESSION_SELECT} WHERE s.patient_id = %s ORDER BY s.started_at DESC LIMIT 100", (patient_id,)).fetchall()
    for r in rows:
        r["areas"] = areas(conn, r["id"])
    return rows


def today(conn: psycopg.Connection, ctx: Ctx) -> dict:
    """Today's appointments with a laser service, and the sessions recorded for them."""
    day = clinic_time.today()
    scope = appointments.doctor_scope(ctx)
    appts = conn.execute(
        f"""{appointments.SELECT}
        WHERE a.starts_at >= %(from)s AND a.starts_at < %(to)s AND a.status NOT IN ('cancelled', 'no_show')
          AND (%(doctor)s::uuid IS NULL OR a.doctor_id = %(doctor)s::uuid)
          AND EXISTS (SELECT 1 FROM appointment_services x JOIN services sv ON sv.id = x.service_id
                      WHERE x.appointment_id = a.id AND sv.clinical_record = 'laser')
        ORDER BY a.starts_at
        """,
        {"from": clinic_time.at(day, clinic_time.MIDNIGHT), "to": clinic_time.at(day + timedelta(days=1), clinic_time.MIDNIGHT),
         "doctor": scope},
    ).fetchall()
    ids = [a["id"] for a in appts]
    sessions = conn.execute(f"{SESSION_SELECT} WHERE s.appointment_id = ANY(%s) ORDER BY s.started_at", (ids,)).fetchall() if ids else []
    return {"appointments": appts, "sessions": sessions, "devices": devices(conn)}


# ---------- writing ----------

def _clean(value):
    value = (value or "").strip() if isinstance(value, str) else value
    return value or None


def save(conn: psycopg.Connection, ctx: Ctx, session_id, body: LaserSessionIn) -> None:
    _draft_of_operator(conn, ctx, session_id)
    if body.device_id:
        dv = conn.execute("SELECT status FROM devices WHERE id = %s AND is_active", (body.device_id,)).fetchone()
        if not dv:
            raise AppError(422, "validation", fields={"device_id": "invalid"})
        if dv["status"] != "working":
            raise AppError(409, "device_out_of_service", fields={"device_id": "device_out_of_service"}, device_status=dv["status"])
    checklist = {k: bool(v) for k, v in body.checklist.items() if k in CHECKLIST}
    conn.execute(
        """
        UPDATE laser_sessions SET device_id = %(device)s, session_no = %(no)s, skin_type = %(skin)s, hair_color = %(hair)s,
               checklist = %(checklist)s, checklist_override = %(override)s, counter_start = %(start)s, counter_end = %(end)s,
               test_pulses = %(test)s, counter_note = %(note)s, aftercare = %(aftercare)s, notes = %(notes)s, updated_at = now()
        WHERE id = %(id)s
        """,
        {"device": body.device_id, "no": body.session_no, "skin": body.skin_type, "hair": _clean(body.hair_color),
         "checklist": Jsonb(checklist), "override": _clean(body.checklist_override), "start": body.counter_start,
         "end": body.counter_end, "test": body.test_pulses, "note": _clean(body.counter_note),
         "aftercare": _clean(body.aftercare), "notes": _clean(body.notes), "id": session_id},
    )
    conn.execute("DELETE FROM laser_session_areas WHERE session_id = %s", (session_id,))
    for position, a in enumerate(body.areas):
        conn.execute(
            """
            INSERT INTO laser_session_areas (session_id, position, area, fluence, pulse_ms, spot_mm, frequency_hz, pulses, reaction)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (session_id, position, a.area.strip(), a.fluence, a.pulse_ms, a.spot_mm, a.frequency_hz, a.pulses, _clean(a.reaction)),
        )


def counter_check(s: dict, device_counter: int | None, recorded: int) -> dict:
    """How the pulse counter adds up: what the device counted vs. what the record says."""
    used = (s["counter_end"] - s["counter_start"]) if s["counter_start"] is not None and s["counter_end"] is not None else None
    expected = recorded + (s["test_pulses"] or 0)
    return {
        "used": used, "recorded": recorded, "test": s["test_pulses"] or 0, "difference": None if used is None else used - expected,
        "start_gap": None if device_counter is None or s["counter_start"] is None else s["counter_start"] - device_counter,
    }


def sign(conn: psycopg.Connection, ctx: Ctx, session_id) -> None:
    s = _draft_of_operator(conn, ctx, session_id)
    problems = {}
    checklist = s["checklist"] or {}
    if any(code not in checklist for code in CHECKLIST):
        problems["checklist"] = "incomplete"
    elif not all(checklist.get(code) for code in MUST_BE_YES):
        problems["checklist"] = "consent_required"
    elif any(checklist.get(code) for code in STOP) and len((s["checklist_override"] or "").strip()) < 10:
        problems["checklist_override"] = "required"
    if not s["device_id"]:
        problems["device_id"] = "required"
    if s["counter_start"] is None:
        problems["counter_start"] = "required"
    if s["counter_end"] is None:
        problems["counter_end"] = "required"
    rows = areas(conn, session_id)
    if not rows:
        problems["areas"] = "required"
    if problems:
        raise AppError(422, "laser_incomplete", fields=problems)

    device = conn.execute("SELECT * FROM devices WHERE id = %s FOR UPDATE", (s["device_id"],)).fetchone()
    if device["status"] != "working":  # out of service or under maintenance (stock & devices)
        raise AppError(409, "device_out_of_service", fields={"device_id": "device_out_of_service"}, device_status=device["status"])
    recorded = sum(a["pulses"] for a in rows)
    check = counter_check(s, device["pulse_counter"], recorded)
    if s["counter_end"] < device["pulse_counter"]:
        raise AppError(409, "counter_behind", device_counter=device["pulse_counter"])
    note = (s["counter_note"] or "").strip()
    if (check["difference"] or check["start_gap"]) and len(note) < 5:
        raise AppError(409, "counter_mismatch", fields={"counter_note": "required"}, **check)

    conn.execute("UPDATE laser_sessions SET status = 'signed', signed_at = now(), updated_at = now() WHERE id = %s", (session_id,))
    conn.execute("UPDATE devices SET pulse_counter = %s WHERE id = %s", (s["counter_end"], device["id"]))
    details = {"patient_id": str(s["patient_id"]), "ref": s["ref"], "device": device["name"], "pulses_used": check["used"],
               "areas": [a["area"] for a in rows]}
    if check["difference"] or check["start_gap"]:
        details["counter_difference"] = {**check, "note": note}
    stops = [code for code in STOP if checklist.get(code)]
    if stops:
        details["checklist_override"] = {"answers": stops, "reason": s["checklist_override"]}
    audit.record(conn, "laser.signed", ctx=ctx, entity="laser_session", entity_id=session_id, details=details)


# ---------- devices (kept by the medical director) ----------

def save_device(conn: psycopg.Connection, ctx: Ctx, body: DeviceIn, device_id: int | None = None) -> dict:
    values = {"name": body.name.strip(), "model": _clean(body.model), "serial": _clean(body.serial_no), "room": body.room_id,
              "counter": body.pulse_counter, "active": body.is_active}
    if body.room_id and not conn.execute("SELECT 1 FROM rooms WHERE id = %s", (body.room_id,)).fetchone():
        raise AppError(422, "validation", fields={"room_id": "invalid"})
    try:
        with conn.transaction():
            if device_id is None:
                row = conn.execute(
                    """
                    INSERT INTO devices (kind, type_id, name, model, serial_no, room_id, pulse_counter, is_active)
                    VALUES ('laser', (SELECT id FROM device_types WHERE is_laser ORDER BY is_active DESC, id LIMIT 1),
                            %(name)s, %(model)s, %(serial)s, %(room)s, %(counter)s, %(active)s) RETURNING *
                    """,
                    values,
                ).fetchone()
            else:
                before = conn.execute("SELECT * FROM devices WHERE id = %s FOR UPDATE", (device_id,)).fetchone()
                if not before:
                    raise AppError(404, "not_found")
                if body.pulse_counter < before["pulse_counter"]:
                    raise AppError(422, "validation", fields={"pulse_counter": "counter_backwards"})
                row = conn.execute(
                    """
                    UPDATE devices SET name = %(name)s, model = %(model)s, serial_no = %(serial)s, room_id = %(room)s,
                           pulse_counter = %(counter)s, is_active = %(active)s WHERE id = %(id)s RETURNING *
                    """,
                    {**values, "id": device_id},
                ).fetchone()
    except psycopg.errors.UniqueViolation:
        raise AppError(409, "conflict", fields={"name": "taken"}) from None
    audit.record(conn, "clinical.device_saved", ctx=ctx, entity="device", entity_id=row["id"],
                 details={"name": row["name"], "pulse_counter": row["pulse_counter"], "new": device_id is None})
    return row
