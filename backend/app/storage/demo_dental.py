"""Demo data for part 4B and the complaints desk (SEED_DEMO only): laser devices and session history, tooth charts,
treatment plans in every state, dental labs with cases, and complaints & requests. Every person here is invented."""
import logging
import random
from datetime import datetime, time, timedelta
from decimal import Decimal

import psycopg
from psycopg.types.json import Jsonb

from app.core import clinic_time
from app.core.appointments import price_on
from app.core.complaints import SLA_HOURS
from app.core.dental import schedule

log = logging.getLogger(__name__)

DENTAL_RESULTS = {"DNT-FILL": "filling", "DNT-RCT": "root_canal", "DNT-EXT": "extracted", "DNT-ZRC": "crown", "DNT-SEAL": "sealant"}

# laser areas per service: (area, fluence J/cm², pulse ms, spot mm, Hz, typical pulses)
LASER_AREAS = {
    "LSR-FULL": [("Full legs", 18, 3, 18, 2, 980), ("Arms", 16, 3, 18, 2, 520), ("Underarms", 14, 3, 15, 1, 120), ("Bikini", 14, 3, 15, 1, 190)],
    "LSR-FACE": [("Upper lip", 12, 3, 12, 1, 60), ("Chin", 12, 3, 12, 1, 85), ("Cheeks", 13, 3, 15, 1, 140)],
    "LSR-UARM": [("Underarms", 14, 3, 15, 1, 125)],
    "LSR-CO2": [("Full face (fractional)", 30, 1, 10, 5, 1450)],
}
CHECKLIST_OK = {"pregnant": False, "isotretinoin": False, "photosensitive_meds": False, "recent_tan": False, "active_infection": False,
                "herpes_history": False, "tattoo_in_area": False, "epilepsy_light": False, "keloid": False, "consent_signed": True,
                "patch_test": True}


def _ids(conn: psycopg.Connection) -> tuple[dict, dict, dict]:
    users = {r["email"].split("@")[0]: r["id"] for r in conn.execute("SELECT id, email FROM users WHERE email LIKE '%%@demo.goldencare.local'")}
    patients = {r["full_name_en"]: r["id"] for r in conn.execute("SELECT id, full_name_en FROM patients WHERE full_name_en IS NOT NULL")}
    services = {r["code"]: r for r in conn.execute("SELECT * FROM services")}
    return users, patients, services


def _ago(days: float, hour: int = 17) -> datetime:
    day = clinic_time.today() - timedelta(days=int(days))
    return clinic_time.at(day, time(hour, 0))


def seed_demo_dental(conn: psycopg.Connection, branch_id: int) -> None:
    if conn.execute("SELECT 1 FROM devices LIMIT 1").fetchone():
        return
    users, patients, services = _ids(conn)
    derm, dentist = users.get("dr.derm"), users.get("dr.dental")
    if not derm or not dentist:
        return
    rng = random.Random(7)

    # --- services: which clinical record they need; a sealant service for children ---
    conn.execute("UPDATE services SET clinical_record = 'laser' WHERE code LIKE 'LSR-%%' AND clinical_record IS NULL")
    conn.execute("UPDATE services SET clinical_record = 'dental' WHERE code LIKE 'DNT-%%' AND clinical_record IS NULL")
    if "DNT-SEAL" not in services and "DNT-CONS" in services:
        row = conn.execute(
            """
            INSERT INTO services (specialty_id, code, name_ar, name_en, duration_min, room_type_id, sort_order, clinical_record)
            VALUES (%s, 'DNT-SEAL', 'سد الشقوق (للسنة)', 'Fissure sealant (per tooth)', 20, %s, 17, 'dental') RETURNING id
            """,
            (services["DNT-CONS"]["specialty_id"], services["DNT-CONS"]["room_type_id"]),
        ).fetchone()
        conn.execute("INSERT INTO service_prices (service_id, amount, starts_on, note) VALUES (%s, 250, %s, 'Demo price')",
                     (row["id"], clinic_time.today() - timedelta(days=60)))
        conn.execute("INSERT INTO doctor_services (doctor_id, service_id) VALUES (%s, %s) ON CONFLICT DO NOTHING", (dentist, row["id"]))
    for code, result in DENTAL_RESULTS.items():
        conn.execute("UPDATE services SET dental_result = %s WHERE code = %s AND dental_result IS NULL", (result, code))
    users, patients, services = _ids(conn)

    _laser(conn, rng, derm, users.get("nurse"), patients, services)
    _charts(conn, rng, dentist, patients)
    plans = _plans(conn, dentist, patients, services)
    _labs(conn, dentist, patients, plans)
    log.info("Demo laser sessions, dental charts, plans and lab cases created")


# ---------- laser ----------

def _laser(conn, rng, derm, nurse, patients, services) -> None:
    laser_room = conn.execute("SELECT r.id FROM rooms r JOIN room_types t ON t.id = r.room_type_id WHERE t.name_en ILIKE '%%laser%%' LIMIT 1").fetchone()
    main = conn.execute(
        "INSERT INTO devices (name, model, serial_no, room_id) VALUES ('GentleMax Pro', 'Candela GentleMax Pro (Alexandrite + Nd:YAG)', 'GMX-21-04417', %s) RETURNING id",
        (laser_room["id"] if laser_room else None,),
    ).fetchone()["id"]
    co2 = conn.execute(
        "INSERT INTO devices (name, model, serial_no, room_id, pulse_counter) VALUES ('CO2 Fractional', 'Lumenis UltraPulse', 'UPL-19-00832', %s, 382600) RETURNING id",
        (laser_room["id"] if laser_room else None,),
    ).fetchone()["id"]

    planned = []  # (when, patient, operator, service code, appointment_id)
    omar = patients.get("Omar Youssef")
    if omar:  # Omar's course of 6 (his consent is in his documents): sessions 1–3 done
        for weeks in (16, 10, 4):
            planned.append((_ago(weeks * 7, 18), omar, derm, "LSR-FULL", None))
    for name, weeks in (("Sara Mohamed Abdallah", (9, 3)), ("Yasmine Walid Hamdy", (12, 6)), ("Noura Hesham El-Shafei", (5,))):
        if patients.get(name):
            for w in weeks:
                planned.append((_ago(w * 7, 13), patients[name], nurse or derm, "LSR-FACE", None))
    done = conn.execute(
        """
        SELECT a.id, a.patient_id, a.in_room_at, a.starts_at, s.code FROM appointments a
        JOIN appointment_services x ON x.appointment_id = a.id JOIN services s ON s.id = x.service_id
        WHERE a.status = 'completed' AND s.clinical_record = 'laser' ORDER BY a.starts_at
        """
    ).fetchall()
    for a in done:
        planned.append((a["in_room_at"] or a["starts_at"], a["patient_id"], derm, a["code"], a["id"]))
    planned.sort(key=lambda p: p[0])

    counter = 1_244_910
    counts: dict = {}
    for when, patient_id, operator, code, appt in planned:
        device = co2 if code == "LSR-CO2" else main
        areas = LASER_AREAS.get(code, LASER_AREAS["LSR-UARM"])
        rows = [(a, f, ms, spot, hz, max(10, int(p * rng.uniform(0.9, 1.08)))) for a, f, ms, spot, hz, p in areas]
        pulses = sum(r[5] for r in rows)
        test = rng.choice([0, 0, 2, 3])
        start = counter if device == main else conn.execute("SELECT pulse_counter FROM devices WHERE id = %s", (co2,)).fetchone()["pulse_counter"]
        end = start + pulses + test
        counts[patient_id] = counts.get(patient_id, 0) + 1
        sid = conn.execute(
            """
            INSERT INTO laser_sessions (appointment_id, patient_id, operator_id, device_id, session_no, skin_type, hair_color, checklist,
                                        counter_start, counter_end, test_pulses, aftercare, started_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """,
            (appt, patient_id, operator, device, counts[patient_id], rng.choice(["III", "III", "IV"]), "Dark brown",
             Jsonb(CHECKLIST_OK), start, end, test,
             "Cold compresses tonight, no sun or hot baths for 48 hours, sunscreen SPF 50 daily.", when, when),
        ).fetchone()["id"]
        for position, (area, f, ms, spot, hz, p) in enumerate(rows):
            conn.execute(
                """
                INSERT INTO laser_session_areas (session_id, position, area, fluence, pulse_ms, spot_mm, frequency_hz, pulses, reaction)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (sid, position, area, f + (counts[patient_id] - 1), ms, spot, hz, p, rng.choice([None, "Mild perifollicular oedema", None])),
            )
        conn.execute("UPDATE laser_sessions SET status = 'signed', signed_at = %s WHERE id = %s", (when + timedelta(minutes=50), sid))
        conn.execute("UPDATE devices SET pulse_counter = %s WHERE id = %s", (end, device))
        if device == main:
            counter = end


# ---------- tooth charts ----------

CHART_PATTERNS = [
    [(18, "missing", []), (28, "missing", []), (36, "filling", ["M", "O"]), (46, "root_canal", []), (46, "crown", []), (47, "caries", ["O"])],
    [(16, "filling", ["O"]), (26, "caries", ["D", "O"]), (38, "missing", []), (48, "missing", []), (21, "veneer", ["B"])],
    [(14, "crown", []), (36, "missing", []), (37, "filling", ["O", "D"]), (24, "caries", ["M"]), (11, "fracture", ["I"])],
    [(17, "filling", ["O"]), (27, "filling", ["O"]), (46, "caries", ["O", "B"]), (31, "watch", [])],
]
CHILD_PATTERN = [(55, "filling", ["O"]), (75, "caries", ["O"]), (16, "watch", []), (36, "watch", [])]


def _charts(conn, rng, dentist, patients) -> None:
    rows = conn.execute(
        """
        SELECT DISTINCT p.id, p.full_name_en, date_part('year', age(p.date_of_birth))::int AS age
        FROM appointments a JOIN patients p ON p.id = a.patient_id
        WHERE a.doctor_id = %s AND a.status NOT IN ('cancelled', 'no_show') ORDER BY p.full_name_en
        """,
        (dentist,),
    ).fetchall()
    for i, p in enumerate(rows):
        pattern = CHILD_PATTERN if p["age"] < 12 else CHART_PATTERNS[i % len(CHART_PATTERNS)]
        when = _ago(30 + i, 16)
        for tooth, condition, surfaces in pattern:
            conn.execute(
                """
                INSERT INTO dental_chart_entries (patient_id, tooth, surfaces, condition, status, note, recorded_by, recorded_at)
                VALUES (%s, %s, %s, %s, 'existing', %s, %s, %s)
                """,
                (p["id"], tooth, surfaces, condition, "Found on first examination" if condition != "watch" else "Monitor at next check-up",
                 dentist, when),
            )


# ---------- treatment plans ----------

def _plans(conn, dentist, patients, services) -> dict:
    today = clinic_time.today()

    def make(name, title, items, *, status, quoted_days_ago=None, valid_days=30, down=0, count=0, accepted_days_ago=None,
             done=(), patient_note=None):
        pid = patients.get(name)
        if not pid:
            return None
        plan = conn.execute(
            "INSERT INTO treatment_plans (patient_id, doctor_id, title, patient_note, created_at) VALUES (%s, %s, %s, %s, %s) RETURNING id, ref",
            (pid, dentist, title, patient_note, _ago((quoted_days_ago or 2) + 1)),
        ).fetchone()
        total = Decimal("0")
        item_ids = []
        for position, (code, tooth, surfaces, phase) in enumerate(items):
            svc = services.get(code)
            if not svc:
                continue
            price = price_on(conn, svc["id"], dentist, today)
            total += Decimal(price)
            item_ids.append(conn.execute(
                """
                INSERT INTO treatment_plan_items (plan_id, position, phase, service_id, tooth, surfaces, condition, price)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
                """,
                (plan["id"], position, phase, svc["id"], tooth, surfaces, svc["dental_result"] if tooth else None, price),
            ).fetchone()["id"])
        if status == "draft":
            return {"id": plan["id"], "items": item_ids, "patient": pid}
        quoted = _ago(quoted_days_ago, 18)
        conn.execute(
            """
            UPDATE treatment_plans SET status = 'quoted', quoted_at = %s, valid_until = %s, quote_total = %s, down_payment = %s,
                   installments_count = %s, updated_at = %s WHERE id = %s
            """,
            (quoted, quoted.date() + timedelta(days=valid_days), total, down, count, quoted, plan["id"]),
        )
        if status in ("accepted", "completed"):
            accepted = _ago(accepted_days_ago, 19)
            conn.execute(
                "UPDATE treatment_plans SET status = 'accepted', accepted_at = %s, accepted_via = 'clinic', accepted_by = %s, updated_at = %s WHERE id = %s",
                (accepted, dentist, accepted, plan["id"]),
            )
            for row in schedule(total, Decimal(down), count, accepted.date()):
                # payments are recorded by billing (requirement 5); until then every installment is just scheduled
                conn.execute("INSERT INTO treatment_plan_installments (plan_id, seq, due_on, amount) VALUES (%s, %s, %s, %s)",
                             (plan["id"], row["seq"], row["due_on"], row["amount"]))
            for index, days_ago in done:
                item_id = item_ids[index]
                item = conn.execute("SELECT * FROM treatment_plan_items WHERE id = %s", (item_id,)).fetchone()
                at = _ago(days_ago, 17)
                conn.execute(
                    "UPDATE treatment_plan_items SET status = 'done', done_at = %s, done_by = %s, billing_status = 'to_bill' WHERE id = %s",
                    (at, dentist, item_id),
                )
                if item["tooth"] and item["condition"]:
                    conn.execute(
                        """
                        INSERT INTO dental_chart_entries (patient_id, tooth, surfaces, condition, status, note, plan_item_id, recorded_by, recorded_at)
                        VALUES (%s, %s, %s, %s, 'done', %s, %s, %s, %s)
                        """,
                        (pid, item["tooth"], item["surfaces"], item["condition"], plan["ref"], item_id, dentist, at),
                    )
            if status == "completed":
                conn.execute("UPDATE treatment_plans SET status = 'completed', completed_at = %s WHERE id = %s", (_ago(1), plan["id"]))
        return {"id": plan["id"], "items": item_ids, "patient": pid}

    plans = {}
    plans["ahmed"] = make(
        "Ahmed Mahmoud El-Sayed", "Root canal and crown 46, filling 36, cleaning",
        [("DNT-SCAL", None, [], 1), ("DNT-RCT", 46, [], 1), ("DNT-FILL", 36, ["M", "O"], 1), ("DNT-ZRC", 46, [], 2)],
        status="accepted", quoted_days_ago=26, down=2000, count=4, accepted_days_ago=24, done=((0, 22), (1, 15), (2, 15)),
        patient_note="The crown is made in the lab after the root canal heals (about 2 weeks).")
    plans["mostafa"] = make(
        "Mostafa Ibrahim Shahin", "Upper left molar: root canal and zirconia crown",
        [("DNT-RCT", 26, [], 1), ("DNT-ZRC", 26, [], 2), ("DNT-FILL", 15, ["D", "O"], 1)],
        status="quoted", quoted_days_ago=3, down=1500, count=3,
        patient_note="Price valid for 30 days. Installments monthly after the down payment.")
    plans["tarek"] = make(
        "Tarek Gamal El-Din", "Replace missing 36: extraction of root remains and crowns 35 & 37",
        [("DNT-EXT", 36, [], 1), ("DNT-ZRC", 35, [], 2), ("DNT-ZRC", 37, [], 2)], status="draft")
    plans["youssef"] = make(
        "Youssef Omar Youssef", "Sealants and a small filling",
        [("DNT-SEAL", 36, ["O"], 1), ("DNT-SEAL", 46, ["O"], 1), ("DNT-FILL", 75, ["O"], 1)],
        status="quoted", quoted_days_ago=1, valid_days=30,
        patient_note="لحماية الضروس الدائمة من التسوس. يمكن عمل الجلسات في زيارة واحدة أو اثنتين.")
    plans["malak"] = make(
        "Malak Ahmed Mahmoud", "Sealants on the first permanent molars",
        [("DNT-SEAL", 36, ["O"], 1), ("DNT-SEAL", 46, ["O"], 1)],
        status="completed", quoted_days_ago=20, accepted_days_ago=19, done=((0, 12), (1, 12)))
    plans["amr"] = make(
        "Amr Khaled Nasr", "Whitening after cleaning", [("DNT-SCAL", None, [], 1), ("DNT-WHT", None, [], 2)],
        status="quoted", quoted_days_ago=40, valid_days=30)
    return plans


# ---------- labs ----------

def _labs(conn, dentist, patients, plans) -> None:
    labs = {}
    for name, contact, phone, address in (
        ("Cairo Smile Dental Lab", "Eng. Wael Fathy", "01005557788", "Nasr City, Cairo"),
        ("Nile Ceramics Lab", "Dr. Sherine Adel", "01224446611", "Heliopolis, Cairo"),
        ("Shorouk Dental Lab", "Mr. Ayman Saad", "01117773322", "El Shorouk City"),
    ):
        labs[name] = conn.execute("INSERT INTO dental_labs (name, contact_name, phone, address) VALUES (%s, %s, %s, %s) RETURNING id",
                                  (name, contact, phone, address)).fetchone()["id"]
    today = clinic_time.today()

    def case(name, lab, work, teeth, shade, cost, share, steps, due_in, plan_item=None, instructions=None):
        pid = patients.get(name)
        if not pid:
            return
        created = _ago(steps[0][1], 18)
        row = conn.execute(
            """
            INSERT INTO lab_cases (patient_id, doctor_id, lab_id, plan_item_id, work_type, teeth, shade, instructions, due_on, lab_cost,
                                   doctor_share_pct, created_by, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """,
            (pid, dentist, labs[lab], plan_item, work, teeth, shade, instructions, today + timedelta(days=due_in), cost, share, dentist, created),
        ).fetchone()
        previous = None
        for status, days_ago, note in steps:
            at = _ago(days_ago, 18)
            conn.execute(
                "INSERT INTO lab_case_events (case_id, at, actor_id, actor_label, action, from_status, to_status, note) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (row["id"], at, dentist, "Dr. Ahmed El-Sherif", status, previous, status, note),
            )
            stamp = {"sent": "sent_at", "returned": "returned_at", "delivered": "delivered_at"}.get(status)
            if stamp:
                conn.execute(f"UPDATE lab_cases SET {stamp} = %s WHERE id = %s", (at, row["id"]))
            if status == "remake":
                conn.execute("UPDATE lab_cases SET remake_count = remake_count + 1 WHERE id = %s", (row["id"],))
            previous = status
        conn.execute("UPDATE lab_cases SET status = %s WHERE id = %s", (previous, row["id"]))

    ahmed_crown = plans.get("ahmed", {}) and plans["ahmed"]["items"][3]
    case("Ahmed Mahmoud El-Sayed", "Nile Ceramics Lab", "zirconia_crown", "46", "A2", 1800, 0,
         [("ordered", 6, "Monolithic zirconia, full anatomy. Scan attached."), ("sent", 5, None)], 2, ahmed_crown,
         "Monolithic zirconia, full anatomy. Light occlusal contact.")
    case("Tarek Gamal El-Din", "Cairo Smile Dental Lab", "pfm_crown", "14", "A3", 950, 0,
         [("ordered", 12, None), ("sent", 11, None), ("returned", 1, "Fit checked on the model.")], -1)
    case("Mohamed Abdel-Fattah", "Shorouk Dental Lab", "full_denture", "Upper full", "A3.5", 2600, 30,
         [("ordered", 25, None), ("sent", 24, None), ("returned", 9, None), ("remake", 8, "Bite too high on the left; re-articulate."),
          ("sent", 7, "Sent back with the new bite record.")], 3)
    case("Amr Khaled Nasr", "Cairo Smile Dental Lab", "night_guard", "Upper arch", None, 600, 0,
         [("ordered", 20, None), ("sent", 19, None), ("returned", 13, None), ("delivered", 10, "Fits well, patient comfortable.")], -12)
    case("Ziad Ayman Fouad", "Shorouk Dental Lab", "retainer", "Lower 33–43", None, 700, 0,
         [("ordered", 10, None), ("sent", 9, "Due in a week.")], -2)
    case("Mostafa Ibrahim Shahin", "Nile Ceramics Lab", "emax_crown", "21", "B1", 2200, 20, [("ordered", 0, "Waiting for the impression.")], 10)


# ---------- complaints & requests ----------

def seed_demo_complaints(conn: psycopg.Connection) -> None:
    if conn.execute("SELECT 1 FROM tickets LIMIT 1").fetchone():
        return
    users, patients, _ = _ids(conn)
    reception, relations = users.get("reception"), users.get("relations")
    if not reception or not relations:
        return
    now = clinic_time.now()
    items = [
        # kind, channel, category, priority, status, patient, contact, subject, details, hours ago, assignee, resolution, comments
        ("complaint", "in_person", "waiting", "high", "in_progress", "Nadia Samir Fahmy", None,
         "Waited 50 minutes past the appointment time",
         "The patient had a 5:20 pm appointment with dermatology and was called in at 6:10 pm. Nobody told her about the delay.",
         20, relations, None, ["Called the patient and apologised. Checking the doctor's schedule for that day."]),
        ("request", "phone", "booking", "normal", "open", None, ("Rana Mostafa", "01098887766"),
         "Asks for Friday evening dental appointments",
         "Works Sunday to Thursday; asks whether the dentist can see patients on Friday evenings.", 5, None, None, []),
        ("complaint", "whatsapp", "billing", "normal", "resolved", "Karim Ashraf Ramadan", None,
         "Thinks the consultation was charged twice",
         "Sent a photo of two receipts for the same day.", 70, relations,
         "Checked with the cashier: the second receipt was the follow-up visit the same evening. Explained to the patient, who agreed.",
         ["Asked the cashier for both receipts."]),
        ("compliment", "portal", "doctor", "low", "closed", "Omar Youssef", None,
         "Thank you, Dr. Rania", "Very clear explanation and the treatment worked. Thanks to the whole team.", 120, relations,
         "Shared with Dr. Rania and the team.", []),
        ("complaint", "in_person", "cleanliness", "urgent", "open", "Heba Mostafa Kamel", None,
         "No soap or tissues in the women's restroom", "Reported at reception during the afternoon clinic.", 6, None, None, []),
        ("suggestion", "website", "other", "low", "open", None, ("Mahmoud Saber", "01276665544"),
         "Pay online before the visit", "Would like to pay for laser sessions online to save time at the desk.", 30, None, None, []),
    ]
    for kind, channel, category, priority, status, patient, contact, subject, details, hours, assignee, resolution, comments in items:
        created = now - timedelta(hours=hours)
        creator = None if channel == "portal" else (reception if channel in ("in_person", "phone") else relations)
        row = conn.execute(
            """
            INSERT INTO tickets (kind, channel, category, priority, status, patient_id, contact_name, contact_phone, subject, details,
                                 assigned_to, due_at, resolution, resolved_at, closed_at, created_by, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """,
            (kind, channel, category, priority, status, patients.get(patient) if patient else None,
             contact[0] if contact else None, ("+20" + contact[1][1:]) if contact else None, subject, details, assignee,
             created + timedelta(hours=SLA_HOURS[priority]), resolution,
             created + timedelta(hours=hours * 0.6) if status in ("resolved", "closed") else None,
             created + timedelta(hours=hours * 0.7) if status == "closed" else None, creator, created, created),
        ).fetchone()
        events = [("created", None, "open", None, created)]
        if assignee:
            events.append(("assigned", None, str(assignee), None, created + timedelta(minutes=20)))
        for i, body in enumerate(comments):
            events.append(("comment", None, None, body, created + timedelta(hours=1 + i)))
        if status in ("in_progress", "resolved", "closed"):
            events.append(("status", "open", "in_progress", None, created + timedelta(hours=1)))
        if status in ("resolved", "closed"):
            events.append(("status", "in_progress", "resolved", resolution, created + timedelta(hours=hours * 0.6)))
        if status == "closed":
            events.append(("status", "resolved", "closed", None, created + timedelta(hours=hours * 0.7)))
        for action, frm, to, body, at in sorted(events, key=lambda e: e[4]):
            actor = relations if action != "created" else creator
            conn.execute(
                "INSERT INTO ticket_events (ticket_id, at, actor_id, actor_label, action, from_value, to_value, body) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (row["id"], at, actor, "Yasmin Khaled" if actor == relations else ("Nourhan Adel" if actor else "Patient"), action, frm, to, body),
            )
    log.info("Demo complaints & requests created")
