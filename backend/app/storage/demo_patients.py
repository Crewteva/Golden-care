"""Synthetic demo patients (SEED_DEMO only): families, medical alerts and documents in every review state.
Every name, number and document here is invented."""
import hashlib
import logging
import struct
import uuid
import zlib
from datetime import date
from pathlib import Path

import psycopg

from app.config import settings
from app.core.normalize import normalize_name, normalize_phone

log = logging.getLogger(__name__)

# key, Arabic name, English name, birth date, sex, mobile, area, governorate code (for a national ID) or None
PEOPLE = [
    ("ahmed", "أحمد محمود السيد", "Ahmed Mahmoud El-Sayed", date(1984, 3, 15), "male", "01012345678", "الحي الأول", "01"),
    ("heba", "هبة مصطفى كامل", "Heba Mostafa Kamel", date(1988, 7, 22), "female", "01112345679", "الحي الأول", "21"),
    ("malak", "ملك أحمد محمود", "Malak Ahmed Mahmoud", date(2015, 5, 10), "female", None, "الحي الأول", None),
    ("yassin", "ياسين أحمد محمود", "Yassin Ahmed Mahmoud", date(2019, 11, 2), "male", None, "الحي الأول", None),
    ("youssef_jr", "يوسف عمر يوسف", "Youssef Omar Youssef", date(2017, 9, 1), "male", None, "الحي الثالث", None),
    ("sara", "سارة محمد عبد الله", "Sara Mohamed Abdallah", date(1995, 2, 14), "female", "01223456781", "الحي الخامس", "01"),
    ("mahmoud", "محمود علي حسن", "Mahmoud Ali Hassan", date(1958, 6, 30), "male", "01098765432", "الحي الثامن", "13"),
    ("nadia", "نادية سمير فهمي", "Nadia Samir Fahmy", date(1969, 12, 5), "female", "01198765433", "الحي الثاني", "02"),
    ("karim", "كريم أشرف رمضان", "Karim Ashraf Ramadan", date(1990, 9, 18), "male", "01556677889", "الحي السادس", "14"),
    ("reham", "ريهام عادل منصور", "Reham Adel Mansour", date(1987, 4, 2), "female", "01007788990", "الحي الرابع", None),
    ("mostafa", "مصطفى إبراهيم شاهين", "Mostafa Ibrahim Shahin", date(1975, 1, 27), "male", "01223344556", "الحي التاسع", "12"),
    ("hala", "هالة عبد الرحمن", "Hala Abdelrahman", date(1982, 8, 11), "female", "01114455667", "الحي السابع", "01"),
    ("youssef", "يوسف طارق عزت", "Youssef Tarek Ezzat", date(2001, 3, 9), "male", "01005566778", "الحي الأول", "01"),
    ("doaa", "دعاء حسين السيد", "Doaa Hussein El-Sayed", date(1993, 10, 23), "female", "01229988776", "الحي الثاني", None),
    ("amr", "عمرو خالد نصر", "Amr Khaled Nasr", date(1986, 5, 16), "male", "01001122334", "الحي الخامس", "21"),
    ("shaimaa", "شيماء فتحي عبده", "Shaimaa Fathy Abdo", date(1998, 12, 30), "female", "01112233445", "الحي الثالث", "16"),
    ("tarek", "طارق جمال الدين", "Tarek Gamal El-Din", date(1964, 7, 7), "male", "01224455668", "الحي العاشر", "01"),
    ("mona", "منى رأفت زكي", "Mona Raafat Zaki", date(1979, 11, 19), "female", "01067788991", "الحي الرابع", None),
    ("ahmed_b", "أحمد سعيد البنا", "Ahmed Saeed El-Banna", date(1999, 6, 21), "male", "01558899001", "الحي السادس", "17"),
    ("yasmine", "ياسمين وليد حمدي", "Yasmine Walid Hamdy", date(2003, 2, 3), "female", "01009900112", "الحي الأول", "01"),
    ("hossam", "حسام الدين مراد", "Hossam El-Din Mourad", date(1971, 9, 29), "male", "01113344556", "الحي الثامن", "24"),
    ("eman", "إيمان صلاح عبد الحميد", "Eman Salah Abdelhamid", date(1985, 3, 12), "female", "01225566770", "الحي التاسع", "01"),
    ("ziad", "زياد أيمن فؤاد", "Ziad Ayman Fouad", date(2010, 5, 5), "male", None, "الحي التاسع", None),
    ("mohamed", "محمد عبد الفتاح", "Mohamed Abdel-Fattah", date(1952, 1, 8), "male", "01003344557", "الحي الحادي عشر", "01"),
    ("noura", "نورا هشام الشافعي", "Noura Hesham El-Shafei", date(1996, 8, 25), "female", "01117788992", "الحي الثاني", "02"),
    ("khaled", "خالد عبد العزيز", "Khaled Abdelaziz", date(1983, 12, 14), "male", "01556644332", "الحي الخامس", None),
    ("rehab", "رحاب سامي توفيق", "Rehab Samy Tawfik", date(1990, 4, 28), "female", "01001239876", "الحي الثالث", "18"),
    ("aly", "علي حسن متولي", "Aly Hassan Metwally", date(1967, 10, 10), "male", "01229876543", "الحي السابع", "25"),
    ("basma", "بسمة ماهر جرجس", "Basma Maher Gerges", date(2000, 7, 17), "female", "01112347654", "الحي الرابع", "01"),
    ("fatma", "فاطمة الزهراء علي", "Fatma El-Zahraa Aly", date(1994, 9, 9), "female", "01003456789", "الحي العاشر", None),
]

# child key → (guardian key, what the guardian is to the child)
FAMILY = [
    ("heba", "ahmed", "spouse", False),
    ("malak", "ahmed", "parent", True),
    ("yassin", "heba", "parent", True),
    ("malak", "yassin", "sibling", False),
    ("ziad", "eman", "parent", True),
    ("youssef_jr", "omar", "parent", True),
]

ALERTS = [
    ("nadia", "allergy", "Penicillin — rash and lip swelling (2019)", "critical"),
    ("nadia", "chronic", "Hypertension, on amlodipine 5 mg", "warning"),
    ("mahmoud", "chronic", "Type 2 diabetes", "warning"),
    ("mahmoud", "medication", "Warfarin (blood thinner) — check INR before procedures", "critical"),
    ("heba", "pregnancy", "Pregnant — expected delivery March 2027", "warning"),
    ("mohamed", "implant", "Cardiac pacemaker — no electrosurgery or RF devices", "critical"),
    ("sara", "allergy", "Lidocaine — use alternative local anaesthetic", "critical"),
    ("omar", "allergy", "Latex", "warning"),
    ("ahmed_b", "other", "Keloid tendency — avoid aggressive laser settings", "info"),
]

# patient key, category, title, uploaded by, days ago, state (pending / internal / released / none), note for patient
DOCUMENTS = [
    ("omar", "lab_result", "CBC — complete blood count", "nurse", 9, "released",
     "نتيجة صورة الدم طبيعية ولا تحتاج أي إجراء. Your blood count is normal; no action needed."),
    ("omar", "consent", "Consent — laser hair removal, 6 sessions", "reception", 21, "none", None),
    ("omar", "report", "Dermatology follow-up report", "doctor", 2, "pending", None),
    ("youssef_jr", "lab_result", "Vitamin D level", "nurse", 5, "released",
     "فيتامين د منخفض قليلًا؛ استمر على النقط الموصوفة مرتين أسبوعيًا. Vitamin D is slightly low — keep the prescribed drops twice a week."),
    ("nadia", "lab_result", "Lipid profile", "nurse", 1, "pending", None),
    ("nadia", "id_copy", "National ID — front and back", "reception", 30, "none", None),
    ("mahmoud", "lab_result", "HbA1c", "nurse", 3, "pending", None),
    ("mahmoud", "report", "Cardiology letter from referring doctor", "reception", 14, "internal", None),
    ("sara", "photo", "Before treatment — face, front view", "nurse", 12, "none", None),
    ("heba", "report", "Obstetric ultrasound — 24 weeks", "doctor", 0, "pending", None),
    ("karim", "lab_result", "Hepatitis B & C screening", "nurse", 6, "released",
     "النتيجة سلبية. Both results are negative."),
]


def _national_id(born: date, gender: str, governorate: str, seq: int) -> str:
    century = "2" if born.year < 2000 else "3"
    gender_digit = (seq * 2 + 1) % 10 if gender == "male" else (seq * 2) % 10
    return f"{century}{born:%y%m%d}{governorate}{seq % 1000:03d}{gender_digit}{(seq * 7) % 10}"


def _pdf(lines: list[str]) -> bytes:
    text = " ".join(f"({line.replace('(', '[').replace(')', ']')}) Tj 0 -24 Td" for line in lines)
    content = f"BT /F1 13 Tf 60 780 Td {text} ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def _png(width=240, height=180) -> bytes:
    """A soft gradient placeholder standing in for a clinical photo."""
    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            row += bytes([220 - y // 3, 196 - x // 6, 170 - (x + y) // 8])
        rows.append(bytes(row))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(b"".join(rows))) + chunk(b"IEND", b"")


def seed_demo_patients(conn: psycopg.Connection, branch_id: int) -> None:
    staff = {r["email"].split("@")[0]: r["id"] for r in conn.execute(
        "SELECT id, email FROM users WHERE email LIKE '%%@demo.goldencare.local'")}
    reception, doctor, nurse = staff.get("reception"), staff.get("dr.derm"), staff.get("nurse")
    if not reception or conn.execute("SELECT 1 FROM patients WHERE created_by = %s LIMIT 1", (reception,)).fetchone():
        return

    ids = {}
    omar = conn.execute("SELECT id FROM patients WHERE phone = %s", (normalize_phone("01001110001"),)).fetchone()
    if omar:
        ids["omar"] = omar["id"]
    for seq, (key, name_ar, name_en, born, gender, phone, area, gov) in enumerate(PEOPLE, 11):
        nid = _national_id(born, gender, gov, seq * 37) if gov else None
        ids[key] = conn.execute(
            """
            INSERT INTO patients (full_name_ar, full_name_en, name_search, phone, date_of_birth, gender, national_id, area,
                                  address, consent_terms_at, consent_messages, registered_via, registered_branch_id,
                                  created_by, updated_by, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'مدينة الشروق', now(), %s, 'reception', %s, %s, %s,
                    now() - make_interval(days => %s), now() - make_interval(days => %s))
            RETURNING id
            """,
            (name_ar, name_en, normalize_name(f"{name_ar} {name_en}"), normalize_phone(phone) if phone else None, born,
             gender, nid, area, seq % 3 != 0, branch_id, reception, reception, 70 - seq * 2, 70 - seq * 2),
        ).fetchone()["id"]

    for child, relative, relationship, guardian in FAMILY:
        if child in ids and relative in ids:
            conn.execute(
                "INSERT INTO patient_family (patient_id, relative_id, relationship, is_guardian, created_by) VALUES (%s, %s, %s, %s, %s)",
                (ids[child], ids[relative], relationship, guardian, reception),
            )
    for key, kind, description, severity in ALERTS:
        if key in ids:
            conn.execute(
                "INSERT INTO patient_alerts (patient_id, kind, description, severity, created_by) VALUES (%s, %s, %s, %s, %s)",
                (ids[key], kind, description, severity, doctor or reception),
            )

    root = Path(settings.files_dir)
    uploader = {"reception": reception, "doctor": doctor or reception, "nurse": nurse or reception}
    for key, category, title, who, days, state, note in DOCUMENTS:
        if key not in ids:
            continue
        if category == "photo":
            data, mime, ext = _png(), "image/png", "png"
        else:
            data = _pdf(["Golden Care Clinics - Madinat El Shorouk", "", title, "",
                         "DEMO DOCUMENT - synthetic data, not a real patient record."])
            mime, ext = "application/pdf", "pdf"
        storage_key = f"{ids[key]}/{uuid.uuid4().hex}.{ext}"
        path = root / storage_key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        review_status = {"pending": "pending", "internal": "reviewed", "released": "reviewed"}.get(state, "not_needed")
        if category not in ("lab_result", "report") and state == "released":
            review_status = "not_needed"
        reviewed = state in ("internal", "released") and category in ("lab_result", "report")
        conn.execute(
            """
            INSERT INTO patient_files (patient_id, category, title, original_name, mime, size_bytes, sha256, storage_key,
                                       branch_id, uploaded_by, uploaded_at, review_status, reviewed_by, reviewed_at,
                                       internal_note, released_at, released_by, patient_note)
            VALUES (%(pid)s, %(cat)s, %(title)s, %(name)s, %(mime)s, %(size)s, %(sha)s, %(key)s, %(branch)s, %(by)s,
                    now() - make_interval(days => %(days)s), %(status)s,
                    %(reviewer)s, CASE WHEN %(reviewed)s THEN now() - make_interval(days => %(days)s) + interval '5 hours' END,
                    %(internal)s,
                    CASE WHEN %(released)s THEN now() - make_interval(days => %(days)s) + interval '6 hours' END,
                    %(releaser)s, %(note)s)
            """,
            {
                "pid": ids[key], "cat": category, "title": title, "name": f"{title.split(' —')[0].lower().replace(' ', '-')}.{ext}",
                "mime": mime, "size": len(data), "sha": hashlib.sha256(data).hexdigest(), "key": storage_key,
                "branch": branch_id, "by": uploader[who], "days": days, "status": review_status,
                "reviewer": doctor if reviewed else None, "reviewed": reviewed,
                "internal": "Seen. Reviewed with cardiology letter; no change to plan." if state == "internal" else None,
                "released": state == "released", "releaser": doctor if state == "released" else None, "note": note,
            },
        )
    log.info("Demo patients created: %s files with families, alerts and documents", len(ids))
