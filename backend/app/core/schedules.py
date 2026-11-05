"""Doctors' working setup: profile, services they perform, weekly hours, leave, and clinic holidays.
`week()` answers "who works when and where" for any 7 days; booking (next step) builds on it."""
from datetime import date, timedelta

import psycopg

from app.core import audit
from app.core.catalog import friendly_db_errors
from app.core.errors import AppError, field_error
from app.core.normalize import clean_name
from app.core.session import Ctx
from app.core.settings_schemas import DoctorProfileIn, HolidayIn, LeaveIn, ScheduleIn

SCHEDULE_COLUMNS = """
    s.id, s.doctor_id, s.branch_id, s.weekday, s.start_time, s.end_time, s.room_id, s.valid_from, s.valid_to,
    r.name_ar AS room_name_ar, r.name_en AS room_name_en, b.name_ar AS branch_name_ar, b.name_en AS branch_name_en
"""


def dow(day: date) -> int:
    """0 = Sunday … 6 = Saturday (same as JavaScript and PostgreSQL)."""
    return (day.weekday() + 1) % 7


def _require_doctor(conn: psycopg.Connection, doctor_id) -> dict:
    row = conn.execute(
        """
        SELECT u.* FROM users u WHERE u.id = %s AND u.is_active
          AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_code = 'doctor')
        """,
        (doctor_id,),
    ).fetchone()
    if not row:
        raise AppError(404, "doctor_not_found")
    return row


# ---------- doctors ----------

def doctors(conn: psycopg.Connection, doctor_id=None) -> list[dict]:
    rows = conn.execute(
        """
        SELECT u.id, u.full_name_ar, u.full_name_en, u.email, dp.specialty_id, dp.title_ar, dp.title_en, dp.color,
               sp.name_ar AS specialty_name_ar, sp.name_en AS specialty_name_en, sp.color AS specialty_color,
               COALESCE((SELECT array_agg(ds.service_id ORDER BY ds.service_id) FROM doctor_services ds WHERE ds.doctor_id = u.id), '{}') AS service_ids
        FROM users u
        LEFT JOIN doctor_profiles dp ON dp.user_id = u.id
        LEFT JOIN specialties sp ON sp.id = dp.specialty_id
        WHERE u.is_active AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_code = 'doctor')
          AND (%(id)s::uuid IS NULL OR u.id = %(id)s::uuid)
        ORDER BY u.full_name_ar
        """,
        {"id": doctor_id},
    ).fetchall()
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    schedules = conn.execute(
        f"""
        SELECT {SCHEDULE_COLUMNS} FROM doctor_schedules s
        LEFT JOIN rooms r ON r.id = s.room_id JOIN branches b ON b.id = s.branch_id
        WHERE s.doctor_id = ANY(%s) AND (s.valid_to IS NULL OR s.valid_to >= current_date)
        ORDER BY s.weekday, s.start_time
        """,
        (ids,),
    ).fetchall()
    leave = conn.execute(
        "SELECT * FROM doctor_leave WHERE doctor_id = ANY(%s) AND ends_on >= current_date ORDER BY starts_on", (ids,),
    ).fetchall()
    for row in rows:
        row["schedule"] = [s for s in schedules if s["doctor_id"] == row["id"]]
        row["leave"] = [lv for lv in leave if lv["doctor_id"] == row["id"]]
        minutes = sum((s["end_time"].hour * 60 + s["end_time"].minute) - (s["start_time"].hour * 60 + s["start_time"].minute)
                      for s in row["schedule"] if s["valid_from"] <= date.today())
        row["weekly_hours"] = round(minutes / 60, 1)
    return rows


def save_profile(conn: psycopg.Connection, ctx: Ctx, doctor_id, body: DoctorProfileIn) -> None:
    _require_doctor(conn, doctor_id)
    if body.specialty_id and not conn.execute("SELECT 1 FROM specialties WHERE id = %s", (body.specialty_id,)).fetchone():
        raise field_error("specialty_id", "invalid")
    values = {"specialty_id": body.specialty_id, "title_ar": clean_name(body.title_ar), "title_en": clean_name(body.title_en),
              "color": body.color.upper() if body.color else None}
    conn.execute(
        """
        INSERT INTO doctor_profiles (user_id, specialty_id, title_ar, title_en, color, updated_by)
        VALUES (%(id)s, %(specialty_id)s, %(title_ar)s, %(title_en)s, %(color)s, %(uid)s)
        ON CONFLICT (user_id) DO UPDATE SET specialty_id = EXCLUDED.specialty_id, title_ar = EXCLUDED.title_ar,
          title_en = EXCLUDED.title_en, color = EXCLUDED.color, updated_by = EXCLUDED.updated_by, updated_at = now()
        """,
        {**values, "id": doctor_id, "uid": ctx.user_id},
    )
    audit.record(conn, "settings.doctor_profile_updated", ctx=ctx, entity="user", entity_id=doctor_id,
                 details={k: str(v) if v is not None else None for k, v in values.items()})


def set_services(conn: psycopg.Connection, ctx: Ctx, doctor_id, service_ids: list[int]) -> None:
    _require_doctor(conn, doctor_id)
    wanted = set(service_ids)
    known = {r["id"] for r in conn.execute("SELECT id FROM services WHERE id = ANY(%s)", (list(wanted),))}
    if wanted - known:
        raise field_error("service_ids", "invalid")
    current = {r["service_id"] for r in conn.execute("SELECT service_id FROM doctor_services WHERE doctor_id = %s", (doctor_id,))}
    for sid in current - wanted:
        conn.execute("DELETE FROM doctor_services WHERE doctor_id = %s AND service_id = %s", (doctor_id, sid))
    for sid in wanted - current:
        conn.execute("INSERT INTO doctor_services (doctor_id, service_id) VALUES (%s, %s)", (doctor_id, sid))
    if wanted != current:
        audit.record(conn, "settings.doctor_services_updated", ctx=ctx, entity="user", entity_id=doctor_id,
                     details={"added": sorted(wanted - current), "removed": sorted(current - wanted)})


# ---------- weekly schedule ----------

def save_schedule(conn: psycopg.Connection, ctx: Ctx, doctor_id, body: ScheduleIn, schedule_id: int | None = None) -> None:
    doctor = _require_doctor(conn, doctor_id)
    if body.end_time <= body.start_time:
        raise field_error("end_time", "before_start")
    if not conn.execute("SELECT 1 FROM branches WHERE id = %s AND is_active", (body.branch_id,)).fetchone():
        raise field_error("branch_id", "invalid")
    if body.room_id and not conn.execute("SELECT 1 FROM rooms WHERE id = %s AND branch_id = %s", (body.room_id, body.branch_id)).fetchone():
        raise field_error("room_id", "wrong_branch")
    valid_from = body.valid_from or date.today()
    if body.valid_to and body.valid_to < valid_from:
        raise field_error("valid_to", "before_start")
    window = {"doctor": doctor_id, "id": schedule_id or 0, "wd": body.weekday, "start": body.start_time, "end": body.end_time,
              "from": valid_from, "to": body.valid_to, "room": body.room_id}
    overlap = """
        weekday = %(wd)s AND id <> %(id)s AND start_time < %(end)s AND end_time > %(start)s
        AND valid_from <= COALESCE(%(to)s::date, 'infinity'::date) AND COALESCE(valid_to, 'infinity'::date) >= %(from)s
    """
    if conn.execute(f"SELECT 1 FROM doctor_schedules WHERE doctor_id = %(doctor)s AND {overlap}", window).fetchone():
        raise AppError(409, "schedule_overlap")
    if body.room_id:
        busy = conn.execute(
            """
            SELECT u.full_name_ar, u.full_name_en FROM doctor_schedules s JOIN users u ON u.id = s.doctor_id
            WHERE s.room_id = %(room)s AND s.doctor_id <> %(doctor)s AND s.weekday = %(wd)s AND s.id <> %(id)s
              AND s.start_time < %(end)s AND s.end_time > %(start)s
              AND s.valid_from <= COALESCE(%(to)s::date, 'infinity'::date) AND COALESCE(s.valid_to, 'infinity'::date) >= %(from)s
            LIMIT 1
            """,
            window,
        ).fetchone()
        if busy:
            raise AppError(409, "room_busy", doctor_ar=busy["full_name_ar"], doctor_en=busy["full_name_en"])
    values = {**window, "branch": body.branch_id, "uid": ctx.user_id}
    if schedule_id is None:
        row = conn.execute(
            """
            INSERT INTO doctor_schedules (doctor_id, branch_id, weekday, start_time, end_time, room_id, valid_from, valid_to, created_by)
            VALUES (%(doctor)s, %(branch)s, %(wd)s, %(start)s, %(end)s, %(room)s, %(from)s, %(to)s, %(uid)s) RETURNING id
            """,
            values,
        ).fetchone()
        action, schedule_id = "settings.schedule_added", row["id"]
    else:
        row = conn.execute(
            """
            UPDATE doctor_schedules SET branch_id = %(branch)s, weekday = %(wd)s, start_time = %(start)s, end_time = %(end)s,
                   room_id = %(room)s, valid_from = %(from)s, valid_to = %(to)s
            WHERE id = %(id)s AND doctor_id = %(doctor)s RETURNING id
            """,
            values,
        ).fetchone()
        if not row:
            raise AppError(404, "not_found")
        action = "settings.schedule_updated"
    audit.record(conn, action, ctx=ctx, entity="user", entity_id=doctor_id, details={
        "doctor": doctor["full_name_en"] or doctor["full_name_ar"], "schedule_id": schedule_id, "weekday": body.weekday,
        "start": str(body.start_time), "end": str(body.end_time), "room_id": body.room_id,
        "valid_from": str(valid_from), "valid_to": str(body.valid_to) if body.valid_to else None,
    })


def delete_schedule(conn: psycopg.Connection, ctx: Ctx, doctor_id, schedule_id: int) -> None:
    row = conn.execute("DELETE FROM doctor_schedules WHERE id = %s AND doctor_id = %s RETURNING *", (schedule_id, doctor_id)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    audit.record(conn, "settings.schedule_deleted", ctx=ctx, entity="user", entity_id=doctor_id, details={
        "weekday": row["weekday"], "start": str(row["start_time"]), "end": str(row["end_time"]),
    })


# ---------- leave & holidays ----------

def leave(conn: psycopg.Connection, include_past: bool = False) -> list[dict]:
    return conn.execute(
        """
        SELECT l.*, u.full_name_ar AS doctor_name_ar, u.full_name_en AS doctor_name_en
        FROM doctor_leave l JOIN users u ON u.id = l.doctor_id
        WHERE %s OR l.ends_on >= current_date - 30
        ORDER BY l.starts_on DESC
        """,
        (include_past,),
    ).fetchall()


def save_leave(conn: psycopg.Connection, ctx: Ctx, body: LeaveIn, leave_id: int | None = None) -> None:
    doctor = _require_doctor(conn, body.doctor_id)
    if body.ends_on < body.starts_on:
        raise field_error("ends_on", "before_start")
    if (body.ends_on - body.starts_on).days > 365:
        raise field_error("ends_on", "too_long")
    if conn.execute(
        "SELECT 1 FROM doctor_leave WHERE doctor_id = %s AND id <> %s AND starts_on <= %s AND ends_on >= %s",
        (body.doctor_id, leave_id or 0, body.ends_on, body.starts_on),
    ).fetchone():
        raise AppError(409, "leave_overlap")
    values = (body.doctor_id, body.starts_on, body.ends_on, clean_name(body.reason))
    if leave_id is None:
        leave_id = conn.execute(
            "INSERT INTO doctor_leave (doctor_id, starts_on, ends_on, reason, created_by) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (*values, ctx.user_id),
        ).fetchone()["id"]
        action = "settings.leave_added"
    else:
        if not conn.execute(
            "UPDATE doctor_leave SET doctor_id = %s, starts_on = %s, ends_on = %s, reason = %s WHERE id = %s RETURNING id",
            (*values, leave_id),
        ).fetchone():
            raise AppError(404, "not_found")
        action = "settings.leave_updated"
    audit.record(conn, action, ctx=ctx, entity="user", entity_id=body.doctor_id, details={
        "doctor": doctor["full_name_en"] or doctor["full_name_ar"], "leave_id": leave_id,
        "from": str(body.starts_on), "to": str(body.ends_on), "reason": clean_name(body.reason),
    })


def delete_leave(conn: psycopg.Connection, ctx: Ctx, leave_id: int) -> None:
    row = conn.execute("DELETE FROM doctor_leave WHERE id = %s RETURNING *", (leave_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    audit.record(conn, "settings.leave_deleted", ctx=ctx, entity="user", entity_id=row["doctor_id"],
                 details={"from": str(row["starts_on"]), "to": str(row["ends_on"])})


def holidays(conn: psycopg.Connection) -> list[dict]:
    return conn.execute(
        """
        SELECT h.*, b.name_ar AS branch_name_ar, b.name_en AS branch_name_en
        FROM holidays h LEFT JOIN branches b ON b.id = h.branch_id
        WHERE h.on_date >= current_date - 30
        ORDER BY h.on_date
        """
    ).fetchall()


def save_holiday(conn: psycopg.Connection, ctx: Ctx, body: HolidayIn, holiday_id: int | None = None) -> None:
    if body.branch_id and not conn.execute("SELECT 1 FROM branches WHERE id = %s", (body.branch_id,)).fetchone():
        raise field_error("branch_id", "invalid")
    values = (body.branch_id, body.on_date, clean_name(body.name_ar), clean_name(body.name_en))
    with friendly_db_errors("on_date"), conn.transaction():
        if holiday_id is None:
            holiday_id = conn.execute(
                "INSERT INTO holidays (branch_id, on_date, name_ar, name_en, created_by) VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (*values, ctx.user_id),
            ).fetchone()["id"]
            action = "settings.holiday_added"
        else:
            if not conn.execute(
                "UPDATE holidays SET branch_id = %s, on_date = %s, name_ar = %s, name_en = %s WHERE id = %s RETURNING id",
                (*values, holiday_id),
            ).fetchone():
                raise AppError(404, "not_found")
            action = "settings.holiday_updated"
    audit.record(conn, action, ctx=ctx, entity="holiday", entity_id=holiday_id,
                 details={"date": str(body.on_date), "name": clean_name(body.name_en)})


def delete_holiday(conn: psycopg.Connection, ctx: Ctx, holiday_id: int) -> None:
    row = conn.execute("DELETE FROM holidays WHERE id = %s RETURNING *", (holiday_id,)).fetchone()
    if not row:
        raise AppError(404, "not_found")
    audit.record(conn, "settings.holiday_deleted", ctx=ctx, entity="holiday", entity_id=holiday_id,
                 details={"date": str(row["on_date"]), "name": row["name_en"]})


# ---------- week view ----------

def week(conn: psycopg.Connection, start: date, doctor_id=None) -> dict:
    """Seven days from `start`: every doctor's working blocks per day, with leave and holidays applied."""
    days = [start + timedelta(days=i) for i in range(7)]
    end = days[-1]
    docs = doctors(conn, doctor_id)
    ids = [d["id"] for d in docs]
    schedules = conn.execute(
        f"""
        SELECT {SCHEDULE_COLUMNS} FROM doctor_schedules s
        LEFT JOIN rooms r ON r.id = s.room_id JOIN branches b ON b.id = s.branch_id
        WHERE s.doctor_id = ANY(%s) AND s.valid_from <= %s AND (s.valid_to IS NULL OR s.valid_to >= %s)
        ORDER BY s.start_time
        """,
        (ids, end, start),
    ).fetchall() if ids else []
    leave_rows = conn.execute(
        "SELECT * FROM doctor_leave WHERE doctor_id = ANY(%s) AND starts_on <= %s AND ends_on >= %s", (ids, end, start),
    ).fetchall() if ids else []
    holiday_rows = conn.execute(
        """
        SELECT h.*, b.name_ar AS branch_name_ar, b.name_en AS branch_name_en
        FROM holidays h LEFT JOIN branches b ON b.id = h.branch_id WHERE h.on_date BETWEEN %s AND %s
        """,
        (start, end),
    ).fetchall()

    result_days = [{"date": d, "weekday": dow(d), "holidays": [h for h in holiday_rows if h["on_date"] == d]} for d in days]
    result_doctors = []
    for doc in docs:
        cells = []
        for d in days:
            on_leave = next((lv for lv in leave_rows if lv["doctor_id"] == doc["id"] and lv["starts_on"] <= d <= lv["ends_on"]), None)
            blocks = []
            for s in schedules:
                if s["doctor_id"] != doc["id"] or s["weekday"] != dow(d) or s["valid_from"] > d or (s["valid_to"] and s["valid_to"] < d):
                    continue
                closed = next((h for h in holiday_rows if h["on_date"] == d and h["branch_id"] in (None, s["branch_id"])), None)
                blocks.append({**s, "closed_for": closed["name_en"] if closed else None,
                               "closed_for_ar": closed["name_ar"] if closed else None})
            cells.append({"date": d, "blocks": blocks, "leave": on_leave})
        result_doctors.append({k: doc[k] for k in ("id", "full_name_ar", "full_name_en", "title_ar", "title_en", "color",
                                                   "specialty_name_ar", "specialty_name_en", "specialty_color")} | {"days": cells})
    return {"start": start, "days": result_days, "doctors": result_doctors}
