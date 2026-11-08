"""Demo appointments (SEED_DEMO only): about two weeks around today, placed with the real free-time rules,
in every status (completed, no-show, cancelled, with the doctor, waiting, confirmed, booked, requested online)."""
import logging
import random
from datetime import timedelta

import psycopg
from psycopg.types.json import Jsonb

from app.core import clinic_time
from app.core.appointments import price_on
from app.core.slots import DayPlanner, room_type_for

log = logging.getLogger(__name__)

SOURCES = ["walk_in", "phone", "phone", "whatsapp", "whatsapp", "social"]
# patients who should appear with a given doctor (so their files and results show up for that doctor)
PREFERRED = {
    "dr.derm": ["Omar Youssef", "Nadia Samir Fahmy", "Mahmoud Ali Hassan", "Sara Mohamed Abdallah", "Karim Ashraf Ramadan",
                "Reham Adel Mansour", "Ahmed Saeed El-Banna", "Yasmine Walid Hamdy", "Noura Hesham El-Shafei"],
    "dr.dental": ["Ahmed Mahmoud El-Sayed", "Malak Ahmed Mahmoud", "Youssef Omar Youssef", "Mostafa Ibrahim Shahin",
                  "Ziad Ayman Fouad", "Tarek Gamal El-Din", "Mohamed Abdel-Fattah", "Amr Khaled Nasr"],
    "dr.obgyn": ["Heba Mostafa Kamel", "Mona Raafat Zaki", "Doaa Hussein El-Sayed", "Shaimaa Fathy Abdo", "Rehab Samy Tawfik",
                 "Hala Abdelrahman", "Basma Maher Gerges", "Fatma El-Zahraa Aly"],
}
CANCEL_REASONS = ["Patient travelling", "Rescheduled by phone", "Patient feeling better", "Work commitment"]


def seed_demo_appointments(conn: psycopg.Connection) -> None:
    if conn.execute("SELECT 1 FROM appointments LIMIT 1").fetchone():
        return
    rng = random.Random(2026)
    reception = conn.execute("SELECT id FROM users WHERE email = 'reception@demo.goldencare.local'").fetchone()
    by = reception["id"] if reception else None
    patients = {r["full_name_en"]: r["id"] for r in conn.execute("SELECT id, full_name_en FROM patients WHERE full_name_en IS NOT NULL")}
    now = clinic_time.now()
    today = now.date()
    total = 0
    upcoming: dict = {}  # at most 2 future visits per patient, so demo patients can still book online

    for local, preferred in PREFERRED.items():
        doc = conn.execute("SELECT id FROM users WHERE email = %s", (f"{local}@demo.goldencare.local",)).fetchone()
        if not doc:
            continue
        doctor_id = doc["id"]
        services = conn.execute(
            """
            SELECT s.id, s.code, s.duration_min FROM doctor_services ds JOIN services s ON s.id = ds.service_id
            WHERE ds.doctor_id = %s AND s.is_active ORDER BY s.sort_order
            """,
            (doctor_id,),
        ).fetchall()
        if not services:
            continue
        pool = [patients[n] for n in preferred if n in patients]
        first_consult = services[0]
        for offset in range(-4, 10):
            day = today + timedelta(days=offset)
            queue = 0
            in_room_used = False
            arrived_used = 0
            booked_today = []
            planner = None
            t = None
            # walk through the day's blocks, placing appointments with gaps
            probe = DayPlanner(conn, doctor_id, day, None)
            if probe.reason:
                continue
            for block in probe.blocks:
                t = block["start"]
                while t < block["end"]:
                    if rng.random() > 0.62:
                        t += timedelta(minutes=15)
                        continue
                    picked = [first_consult] if rng.random() < 0.45 else [rng.choice(services)]
                    if local == "dr.derm" and rng.random() < 0.12 and len(services) > 4:
                        picked = [first_consult, services[4]]  # consultation + a procedure in one visit
                    ids = [s["id"] for s in picked]
                    duration = timedelta(minutes=sum(s["duration_min"] for s in picked))
                    planner = DayPlanner(conn, doctor_id, day, room_type_for(conn, ids))
                    try:
                        blk, room = planner.check(t, t + duration)
                    except Exception:
                        t += timedelta(minutes=15)
                        continue
                    patient_id = pool[(total + offset) % len(pool)] if rng.random() < 0.8 else rng.choice(list(patients.values()))
                    if patient_id in booked_today or (t > now and upcoming.get(patient_id, 0) >= 2):
                        patient_id = rng.choice(list(patients.values()))
                        if patient_id in booked_today or (t > now and upcoming.get(patient_id, 0) >= 2):
                            t += timedelta(minutes=15)
                            continue
                    if t > now:
                        upcoming[patient_id] = upcoming.get(patient_id, 0) + 1
                    end = t + duration
                    status, extra = _status_for(rng, t, end, now, in_room_used, arrived_used)
                    if status == "in_room":
                        in_room_used = True
                    if status == "arrived":
                        arrived_used += 1
                    queue_no = None
                    if status in ("arrived", "in_room", "completed"):
                        queue += 1
                        queue_no = queue
                    source = "portal" if status == "requested" else rng.choice(SOURCES)
                    prices = [price_on(conn, s["id"], doctor_id, day) for s in picked]
                    total_price = sum(p for p in prices if p is not None)
                    row = conn.execute(
                        """
                        INSERT INTO appointments (patient_id, doctor_id, branch_id, room_id, starts_at, ends_at, status, source,
                                                  estimated_price, queue_no, arrived_at, in_room_at, completed_at, cancelled_at,
                                                  cancel_reason, cancelled_by_kind, booked_by, created_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
                        """,
                        (patient_id, doctor_id, blk["branch_id"], room["id"] if room else None, t, end, status, source,
                         total_price, queue_no, extra.get("arrived_at"), extra.get("in_room_at"), extra.get("completed_at"),
                         extra.get("cancelled_at"), extra.get("cancel_reason"), extra.get("by"),
                         None if source == "portal" else by, t - timedelta(days=rng.randint(1, 6))),
                    ).fetchone()
                    for position, (service, price) in enumerate(zip(picked, prices)):
                        conn.execute(
                            "INSERT INTO appointment_services (appointment_id, position, service_id, duration_min, price) VALUES (%s, %s, %s, %s, %s)",
                            (row["id"], position, service["id"], service["duration_min"], price),
                        )
                    conn.execute(
                        "INSERT INTO appointment_events (appointment_id, actor_label, action, to_status, details, at) VALUES (%s, %s, 'booked', %s, %s, %s)",
                        (row["id"], "Demo data", "requested" if status == "requested" else "booked", Jsonb({"source": source}),
                         t - timedelta(days=2)),
                    )
                    if status not in ("booked", "requested"):
                        conn.execute(
                            "INSERT INTO appointment_events (appointment_id, actor_label, action, from_status, to_status, details, at) VALUES (%s, %s, %s, 'booked', %s, %s, %s)",
                            (row["id"], "Demo data", status, status, Jsonb({"queue_no": queue_no} if queue_no else {}),
                             extra.get("completed_at") or extra.get("arrived_at") or extra.get("cancelled_at") or t),
                        )
                    booked_today.append(patient_id)
                    total += 1
                    t = end + timedelta(minutes=rng.choice([0, 0, 15, 30]))

    # one squeeze-in today for the dermatologist, outside the free times
    derm = conn.execute("SELECT id FROM users WHERE email = 'dr.derm@demo.goldencare.local'").fetchone()
    walkin = patients.get("Youssef Tarek Ezzat")
    blocks = DayPlanner(conn, derm["id"], today, None).blocks if derm else []
    if derm and walkin and blocks:
        start = blocks[0]["start"] + timedelta(minutes=10)
        status = "completed" if start + timedelta(minutes=15) < now else "booked"
        cons = conn.execute("SELECT id, duration_min FROM services WHERE code = 'DRM-FU'").fetchone()
        if cons:
            row = conn.execute(
                """
                INSERT INTO appointments (patient_id, doctor_id, branch_id, starts_at, ends_at, status, source, overbooked,
                                          overbook_reason, estimated_price, booked_by)
                VALUES (%s, %s, %s, %s, %s, %s, 'walk_in', true, 'Post-procedure check, 5 minutes — approved by Dr. Rania', %s, %s) RETURNING id
                """,
                (walkin, derm["id"], blocks[0]["branch_id"], start, start + timedelta(minutes=cons["duration_min"]), status,
                 price_on(conn, cons["id"], derm["id"], today), by),
            ).fetchone()
            conn.execute(
                "INSERT INTO appointment_services (appointment_id, position, service_id, duration_min, price) VALUES (%s, 0, %s, %s, %s)",
                (row["id"], cons["id"], cons["duration_min"], price_on(conn, cons["id"], derm["id"], today)),
            )
            total += 1
    log.info("Demo appointments created: %s", total)


def _status_for(rng: random.Random, start, end, now, in_room_used: bool, arrived_used: int) -> tuple[str, dict]:
    if end <= now:
        roll = rng.random()
        if roll < 0.08:
            return "no_show", {}
        if roll < 0.16:
            return "cancelled", {"cancelled_at": start - timedelta(hours=rng.randint(3, 40)), "cancel_reason": rng.choice(CANCEL_REASONS),
                                 "by": rng.choice(["patient", "patient", "clinic"])}
        arrived = start - timedelta(minutes=rng.randint(0, 12))
        return "completed", {"arrived_at": arrived, "in_room_at": start + timedelta(minutes=rng.randint(0, 10)), "completed_at": end}
    if start <= now < end and not in_room_used:
        return "in_room", {"arrived_at": start - timedelta(minutes=8), "in_room_at": start + timedelta(minutes=2)}
    if start.date() == now.date() and start > now and start - now < timedelta(minutes=75) and arrived_used < 2:
        return "arrived", {"arrived_at": now - timedelta(minutes=rng.randint(2, 20))}
    if start.date() == now.date():
        return ("confirmed" if rng.random() < 0.7 else "booked"), {}
    roll = rng.random()
    if roll < 0.06:
        return "requested", {}
    return ("confirmed" if roll < 0.5 else "booked"), {}
