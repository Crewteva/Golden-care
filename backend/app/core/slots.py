"""Which times are free? Built from the doctor's weekly hours on that date, minus leave, holidays,
existing appointments and busy rooms. Booking checks the chosen time again with the same rules, and
the database's no-overlap constraints are the final guard."""
from datetime import date, datetime, timedelta

import psycopg

from app.core import app_settings, clinic_time
from app.core.errors import AppError
from app.core.schedules import dow

ACTIVE = "status NOT IN ('cancelled', 'no_show')"


def doctor_blocks(conn: psycopg.Connection, doctor_id, day: date) -> tuple[list[dict], str | None]:
    """The doctor's working blocks on `day` as aware datetimes, or why there are none (leave / holiday / off)."""
    if conn.execute(
        "SELECT 1 FROM doctor_leave WHERE doctor_id = %s AND %s BETWEEN starts_on AND ends_on", (doctor_id, day),
    ).fetchone():
        return [], "leave"
    rows = conn.execute(
        """
        SELECT s.id, s.branch_id, s.room_id, s.start_time, s.end_time, r.room_type_id, r.is_active AS room_active,
               r.name_ar AS room_name_ar, r.name_en AS room_name_en
        FROM doctor_schedules s LEFT JOIN rooms r ON r.id = s.room_id
        WHERE s.doctor_id = %s AND s.weekday = %s AND s.valid_from <= %s AND (s.valid_to IS NULL OR s.valid_to >= %s)
        ORDER BY s.start_time
        """,
        (doctor_id, dow(day), day, day),
    ).fetchall()
    closed = [h["branch_id"] for h in conn.execute("SELECT branch_id FROM holidays WHERE on_date = %s", (day,))]
    blocks = []
    for row in rows:
        if None in closed or row["branch_id"] in closed:
            continue
        blocks.append({**row, "start": clinic_time.at(day, row["start_time"]), "end": clinic_time.at(day, row["end_time"])})
    if blocks:
        return blocks, None
    return [], ("holiday" if rows else "off")


def _busy(conn: psycopg.Connection, column: str, ids: list, start: datetime, end: datetime, exclude=None) -> dict:
    if not ids:
        return {}
    rows = conn.execute(
        f"""
        SELECT {column} AS key, starts_at, ends_at FROM appointments
        WHERE {column} = ANY(%s) AND {ACTIVE} AND starts_at < %s AND ends_at > %s
          AND (%s::uuid IS NULL OR id <> %s::uuid)
        """,
        (ids, end, start, exclude, exclude),
    ).fetchall()
    out: dict = {}
    for r in rows:
        out.setdefault(r["key"], []).append((r["starts_at"], r["ends_at"]))
    return out


def _free(intervals: list, start: datetime, end: datetime) -> bool:
    return all(not (s < end and e > start) for s, e in intervals)


def room_type_for(conn: psycopg.Connection, service_ids: list[int]) -> int | None:
    row = conn.execute(
        "SELECT room_type_id FROM services WHERE id = ANY(%s) AND room_type_id IS NOT NULL ORDER BY duration_min DESC LIMIT 1",
        (service_ids,),
    ).fetchone()
    return row["room_type_id"] if row else None


class DayPlanner:
    """Answers "is [start, end) free for this doctor, and in which room?" for one doctor and one day."""

    def __init__(self, conn: psycopg.Connection, doctor_id, day: date, room_type_id: int | None, exclude=None):
        self.blocks, self.reason = doctor_blocks(conn, doctor_id, day)
        day_start = clinic_time.at(day, datetime.min.time())
        day_end = day_start + timedelta(days=1)
        self.doctor_busy = _busy(conn, "doctor_id", [doctor_id], day_start, day_end, exclude).get(doctor_id, [])
        branches = list({b["branch_id"] for b in self.blocks})
        self.rooms = conn.execute(
            """
            SELECT id, branch_id, room_type_id, name_ar, name_en FROM rooms
            WHERE is_active AND branch_id = ANY(%s) ORDER BY sort_order, id
            """,
            (branches,),
        ).fetchall() if branches else []
        self.room_busy = _busy(conn, "room_id", [r["id"] for r in self.rooms], day_start, day_end, exclude)
        self.room_type_id = room_type_id

    def room_for(self, block: dict, start: datetime, end: datetime):
        """The room to use, None when no room is needed, or False when every suitable room is taken."""
        wanted = self.room_type_id
        fixed_ok = block["room_id"] and block["room_active"] and (wanted is None or block["room_type_id"] == wanted)
        if fixed_ok:
            free = _free(self.room_busy.get(block["room_id"], []), start, end)
            return {"id": block["room_id"], "name_ar": block["room_name_ar"], "name_en": block["room_name_en"]} if free else False
        if wanted is None:
            return None
        for room in self.rooms:
            if room["branch_id"] == block["branch_id"] and room["room_type_id"] == wanted and _free(self.room_busy.get(room["id"], []), start, end):
                return room
        return False

    def check(self, start: datetime, end: datetime):
        """(block, room) for a time that fits a working block and is free; raises the reason otherwise."""
        if self.reason == "leave":
            raise AppError(409, "doctor_on_leave")
        if self.reason == "holiday":
            raise AppError(409, "clinic_holiday")
        block = next((b for b in self.blocks if b["start"] <= start and end <= b["end"]), None)
        if not block:
            raise AppError(409, "outside_hours")
        if not _free(self.doctor_busy, start, end):
            raise AppError(409, "slot_taken")
        room = self.room_for(block, start, end)
        if room is False:
            raise AppError(409, "room_taken")
        return block, room

    def slots(self, duration: timedelta, step: timedelta, not_before: datetime | None = None) -> list[dict]:
        out = []
        for block in self.blocks:
            t = block["start"]
            while t + duration <= block["end"]:
                end = t + duration
                if (not_before is None or t >= not_before) and _free(self.doctor_busy, t, end):
                    room = self.room_for(block, t, end)
                    if room is not False:
                        out.append({
                            "start": t, "end": end, "branch_id": block["branch_id"],
                            "room_id": room["id"] if room else None,
                            "room_name_ar": room["name_ar"] if room else None,
                            "room_name_en": room["name_en"] if room else None,
                        })
                t += step
        return out


def free_slots(conn: psycopg.Connection, doctor_id, day: date, service_ids: list[int], exclude=None) -> dict:
    durations = conn.execute("SELECT COALESCE(sum(duration_min), 0) AS m FROM services WHERE id = ANY(%s)", (service_ids,)).fetchone()["m"]
    rules = app_settings.booking(conn)
    planner = DayPlanner(conn, doctor_id, day, room_type_for(conn, service_ids), exclude)
    not_before = None
    if day == clinic_time.today():
        not_before = clinic_time.now()
    elif day < clinic_time.today():
        return {"reason": "past", "slots": [], "duration_min": durations}
    slots = planner.slots(timedelta(minutes=durations), timedelta(minutes=int(rules["slot_step_min"])), not_before)
    return {"reason": planner.reason, "slots": slots, "duration_min": durations}
