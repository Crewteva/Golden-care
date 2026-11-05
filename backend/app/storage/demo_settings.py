"""Demo clinic setup (SEED_DEMO only). Every specialty, service, price, room and schedule here is an
example for the review; the clinic replaces them from the Clinic setup pages."""
import logging
from datetime import date, time, timedelta

import psycopg

from app.core.normalize import normalize_name

log = logging.getLogger(__name__)

SPECIALTIES = [
    ("derm", "الجلدية والتجميل", "Dermatology & cosmetics", "#1A6B5A"),
    ("laser", "الليزر", "Laser", "#B7862F"),
    ("dental", "الأسنان", "Dental", "#2D5D8A"),
    ("obgyn", "النساء والتوليد", "Obstetrics & gynecology", "#9B3D5C"),
]

ROOM_TYPES = [
    ("consult", "غرفة كشف", "Consultation room"),
    ("laser", "غرفة ليزر", "Laser room"),
    ("dental", "كرسي أسنان", "Dental chair"),
    ("procedure", "غرفة إجراءات", "Procedure room"),
]

ROOMS = [
    ("clinic1", "consult", "عيادة ١", "Clinic 1"),
    ("clinic2", "consult", "عيادة ٢ (سونار)", "Clinic 2 (ultrasound)"),
    ("laser", "laser", "غرفة الليزر", "Laser room"),
    ("chair1", "dental", "كرسي أسنان ١", "Dental chair 1"),
    ("chair2", "dental", "كرسي أسنان ٢", "Dental chair 2"),
    ("procedure", "procedure", "غرفة الإجراءات", "Procedure room"),
]

# specialty, code, Arabic, English, minutes, room type, demo price (EGP)
SERVICES = [
    ("derm", "DRM-CONS", "كشف جلدية", "Dermatology consultation", 20, "consult", 500),
    ("derm", "DRM-FU", "متابعة جلدية", "Dermatology follow-up", 15, "consult", 250),
    ("derm", "DRM-PEEL", "تقشير كيميائي", "Chemical peel", 45, "procedure", 1500),
    ("derm", "DRM-PRP", "بلازما للشعر", "PRP for hair", 45, "procedure", 2000),
    ("derm", "DRM-BTX", "بوتوكس (منطقة واحدة)", "Botox (one area)", 30, "procedure", 3500),
    ("derm", "DRM-FILL", "فيلر (١ مل)", "Filler (1 ml)", 45, "procedure", 6000),
    ("laser", "LSR-FULL", "ليزر إزالة شعر الجسم كامل", "Full-body laser hair removal", 90, "laser", 4500),
    ("laser", "LSR-FACE", "ليزر الوجه", "Face laser hair removal", 30, "laser", 900),
    ("laser", "LSR-UARM", "ليزر تحت الإبط", "Underarm laser", 20, "laser", 600),
    ("laser", "LSR-CO2", "فراكشنال CO2 للوجه", "Fractional CO2 — face", 60, "laser", 3000),
    ("dental", "DNT-CONS", "كشف أسنان", "Dental check-up", 20, "dental", 300),
    ("dental", "DNT-SCAL", "تنظيف وتلميع", "Scaling & polishing", 45, "dental", 800),
    ("dental", "DNT-FILL", "حشو تجميلي", "Composite filling", 45, "dental", 1200),
    ("dental", "DNT-RCT", "علاج عصب (ضرس)", "Root canal (molar)", 90, "dental", 3500),
    ("dental", "DNT-EXT", "خلع", "Extraction", 30, "dental", 700),
    ("dental", "DNT-WHT", "تبييض الأسنان", "Teeth whitening", 60, "dental", 4000),
    ("dental", "DNT-ZRC", "تركيبة زيركون", "Zirconia crown", 60, "dental", 6500),
    ("obgyn", "OBG-CONS", "كشف نساء", "Gynecology consultation", 20, "consult", 600),
    ("obgyn", "OBG-PREG", "متابعة حمل مع سونار", "Pregnancy follow-up with ultrasound", 30, "consult", 700),
    ("obgyn", "OBG-4D", "سونار رباعي الأبعاد", "4D ultrasound", 30, "consult", 1200),
    ("obgyn", "OBG-PAP", "مسحة عنق الرحم", "Pap smear", 20, "consult", 800),
]

# demo e-mail, specialty, Arabic title, English title, services (by specialty), schedule [(weekday, start, end, room)]
DOCTORS = [
    ("dr.derm", "derm", "استشاري الجلدية والتجميل", "Consultant dermatologist", ("derm", "laser"),
     [(6, "16:00", "21:00", "clinic1"), (1, "16:00", "21:00", "clinic1"), (3, "16:00", "21:00", "clinic1"), (2, "12:00", "17:00", "laser")]),
    ("dr.dental", "dental", "أخصائي طب وجراحة الفم والأسنان", "Dental surgeon", ("dental",),
     [(0, "15:00", "22:00", "chair1"), (2, "15:00", "22:00", "chair1"), (4, "15:00", "22:00", "chair1"), (6, "11:00", "15:00", "chair1")]),
    ("dr.obgyn", "obgyn", "استشاري النساء والتوليد", "Consultant obstetrician & gynecologist", ("obgyn",),
     [(0, "17:00", "21:00", "clinic2"), (3, "17:00", "21:00", "clinic2")]),
]

# Egypt's fixed-date public holidays. Holidays that follow the lunar calendar (Eid, Ramadan…) are added by the clinic.
FIXED_HOLIDAYS = [
    (1, 7, "عيد الميلاد المجيد", "Coptic Christmas"),
    (1, 25, "عيد الشرطة وثورة ٢٥ يناير", "Police Day & 25 January Revolution"),
    (4, 25, "عيد تحرير سيناء", "Sinai Liberation Day"),
    (5, 1, "عيد العمال", "Labour Day"),
    (6, 30, "ذكرى ثورة ٣٠ يونيو", "30 June Revolution"),
    (7, 23, "عيد ثورة ٢٣ يوليو", "23 July Revolution"),
    (10, 6, "عيد القوات المسلحة", "Armed Forces Day"),
]


def seed_demo_settings(conn: psycopg.Connection, branch_id: int) -> None:
    if conn.execute("SELECT 1 FROM specialties LIMIT 1").fetchone():
        return
    manager = conn.execute("SELECT id FROM users WHERE email = 'owner@demo.goldencare.local'").fetchone()
    by = manager["id"] if manager else None

    spec = {}
    for order, (key, ar, en, color) in enumerate(SPECIALTIES):
        spec[key] = conn.execute(
            "INSERT INTO specialties (name_ar, name_en, color, sort_order) VALUES (%s, %s, %s, %s) RETURNING id",
            (ar, en, color, order),
        ).fetchone()["id"]
    types = {key: conn.execute("INSERT INTO room_types (name_ar, name_en) VALUES (%s, %s) RETURNING id", (ar, en)).fetchone()["id"]
             for key, ar, en in ROOM_TYPES}
    rooms = {}
    for order, (key, kind, ar, en) in enumerate(ROOMS):
        rooms[key] = conn.execute(
            "INSERT INTO rooms (branch_id, room_type_id, name_ar, name_en, sort_order) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (branch_id, types[kind], ar, en, order),
        ).fetchone()["id"]

    today = date.today()
    first_of_next_month = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
    services = {}
    for order, (sp, code, ar, en, minutes, kind, price) in enumerate(SERVICES):
        sid = conn.execute(
            """
            INSERT INTO services (specialty_id, code, name_ar, name_en, duration_min, room_type_id, sort_order)
            VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id
            """,
            (spec[sp], code, ar, en, minutes, types[kind], order),
        ).fetchone()["id"]
        services.setdefault(sp, []).append(sid)
        conn.execute(
            "INSERT INTO service_prices (service_id, amount, starts_on, note, created_by, updated_by) VALUES (%s, %s, %s, %s, %s, %s)",
            (sid, price, today - timedelta(days=60), "Demo price", by, by),
        )
        if code == "DRM-CONS":
            # a price rise scheduled for next month, to show "next price"
            conn.execute(
                "INSERT INTO service_prices (service_id, amount, starts_on, note, created_by, updated_by) VALUES (%s, %s, %s, %s, %s, %s)",
                (sid, 550, first_of_next_month, "Demo: new price list", by, by),
            )

    # a third demo doctor for gynecology, using the same demo password as the others
    template = conn.execute("SELECT password_hash FROM users WHERE email = 'dr.derm@demo.goldencare.local'").fetchone()
    if template and not conn.execute("SELECT 1 FROM users WHERE email = 'dr.obgyn@demo.goldencare.local'").fetchone():
        uid = conn.execute(
            """
            INSERT INTO users (kind, full_name_ar, full_name_en, name_search, email, password_hash, password_changed_at)
            VALUES ('staff', 'د. نرمين فتحي', 'Dr. Nermeen Fathy', %s, 'dr.obgyn@demo.goldencare.local', %s, now()) RETURNING id
            """,
            (normalize_name("د. نرمين فتحي Dr. Nermeen Fathy"), template["password_hash"]),
        ).fetchone()["id"]
        conn.execute("INSERT INTO user_roles (user_id, role_code, branch_id) VALUES (%s, 'doctor', %s)", (uid, branch_id))

    for local, sp, title_ar, title_en, service_groups, schedule in DOCTORS:
        doc = conn.execute("SELECT id FROM users WHERE email = %s", (f"{local}@demo.goldencare.local",)).fetchone()
        if not doc:
            continue
        conn.execute(
            "INSERT INTO doctor_profiles (user_id, specialty_id, title_ar, title_en) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
            (doc["id"], spec[sp], title_ar, title_en),
        )
        for group in service_groups:
            for sid in services[group]:
                conn.execute("INSERT INTO doctor_services (doctor_id, service_id) VALUES (%s, %s) ON CONFLICT DO NOTHING", (doc["id"], sid))
        for weekday, start, end, room in schedule:
            conn.execute(
                """
                INSERT INTO doctor_schedules (doctor_id, branch_id, weekday, start_time, end_time, room_id, valid_from, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (doc["id"], branch_id, weekday, time.fromisoformat(start), time.fromisoformat(end), rooms[room],
                 today - timedelta(days=60), by),
            )
        if local == "dr.derm":
            # the consultant's own consultation price
            conn.execute(
                """
                INSERT INTO service_prices (service_id, doctor_id, amount, starts_on, note, created_by, updated_by)
                VALUES (%s, %s, 600, %s, 'Demo: consultant price', %s, %s)
                """,
                (services["derm"][0], doc["id"], today - timedelta(days=60), by, by),
            )
        if local == "dr.dental":
            monday = today + timedelta(days=(7 - today.weekday()) % 7 or 7)
            conn.execute(
                "INSERT INTO doctor_leave (doctor_id, starts_on, ends_on, reason, created_by) VALUES (%s, %s, %s, %s, %s)",
                (doc["id"], monday, monday + timedelta(days=2), "Dental conference (demo)", by),
            )

    for year in (today.year, today.year + 1):
        for month, day, ar, en in FIXED_HOLIDAYS:
            on = date(year, month, day)
            if today - timedelta(days=30) <= on <= today + timedelta(days=400):
                conn.execute(
                    "INSERT INTO holidays (on_date, name_ar, name_en, created_by) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
                    (on, ar, en, by),
                )
    log.info("Demo clinic setup created: %s specialties, %s services, %s rooms", len(SPECIALTIES), len(SERVICES), len(ROOMS))
