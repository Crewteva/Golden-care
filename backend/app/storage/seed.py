"""Starting data, applied at every startup (safe to repeat):
roles, permissions, the main branch, the first admin account and, if SEED_DEMO is on, demo accounts."""
import logging
from datetime import date

import psycopg

from app.config import settings
from app.core.normalize import normalize_name, normalize_phone
from app.core.security import hash_password, temp_password

log = logging.getLogger(__name__)

# code, kind, Arabic name, English name, two-step verification required by default
ROLES = [
    ("admin", "staff", "مدير النظام", "System admin", True),
    ("management", "staff", "الإدارة", "Management", True),
    ("medical_director", "staff", "المدير الطبي", "Medical director", True),
    ("reception", "staff", "الاستقبال", "Reception", False),
    ("patient_relations", "staff", "علاقات المرضى", "Patient relations", False),
    ("doctor", "staff", "طبيب", "Doctor", False),
    ("nurse", "staff", "التمريض", "Nursing", False),
    ("cashier", "staff", "الخزينة", "Cashier", False),
    ("accountant", "staff", "المحاسبة", "Accountant", True),
    ("hr", "staff", "الموارد البشرية", "Human resources", True),
    ("inventory", "staff", "المخازن", "Inventory", False),
    ("marketing", "staff", "التسويق", "Marketing", False),
    ("auditor", "staff", "المراجعة", "Auditor", True),
    ("patient", "patient", "مريض", "Patient", False),
]

PERMISSIONS = [
    ("users.view", "access", "عرض حسابات الموظفين", "View staff accounts"),
    ("users.manage", "access", "إدارة حسابات الموظفين", "Manage staff accounts"),
    ("roles.manage", "access", "إدارة الأدوار والصلاحيات", "Manage roles & permissions"),
    ("delegations.manage", "access", "إدارة التغطية المؤقتة", "Manage temporary cover"),
    ("password_resets.manage", "access", "معالجة طلبات استعادة كلمة المرور", "Handle password reset requests"),
    ("branches.manage", "organization", "إدارة الفروع", "Manage branches"),
    ("audit.view", "audit", "عرض سجل النشاط", "View the activity log"),
    ("patients.view", "patients", "عرض ملفات المرضى", "View patient files"),
    ("patients.create", "patients", "تسجيل مريض جديد", "Register new patients"),
    ("patients.edit", "patients", "تعديل بيانات المريض والعائلة", "Edit patient details & family"),
    ("patients.alerts", "patients", "إدارة التنبيهات الطبية", "Manage medical alerts"),
    ("patients.portal_access", "patients", "منح دخول بوابة المريض", "Give patient portal access"),
    ("patient_files.view_admin", "patient_files", "عرض الهويات والإقرارات", "Open IDs & consents"),
    ("patient_files.view_clinical", "patient_files", "عرض المستندات الطبية", "Open medical documents"),
    ("patient_files.upload_admin", "patient_files", "رفع الهويات والإقرارات", "Upload IDs & consents"),
    ("patient_files.upload_clinical", "patient_files", "رفع المستندات الطبية", "Upload medical documents"),
    ("patient_files.review", "patient_files", "مراجعة النتائج وإتاحتها للمريض", "Review & release results"),
    ("settings.view", "settings", "عرض إعداد العيادة والجداول", "View clinic setup & schedules"),
    ("settings.services", "settings", "إدارة التخصصات والخدمات", "Manage specialties & services"),
    ("settings.prices", "settings", "إدارة الأسعار", "Manage prices"),
    ("settings.rooms", "settings", "إدارة الغرف", "Manage rooms"),
    ("settings.schedules", "settings", "إدارة الأطباء والجداول والإجازات", "Manage doctors, schedules & leave"),
    ("settings.booking", "settings", "تعديل قواعد الحجز", "Change booking rules"),
    ("appointments.view", "appointments", "عرض المواعيد", "View appointments"),
    ("appointments.book", "appointments", "حجز المواعيد", "Book appointments"),
    ("appointments.manage", "appointments", "تأكيد ووصول وإلغاء ونقل المواعيد", "Confirm, check in, cancel & move appointments"),
    ("appointments.treat", "appointments", "استدعاء المريض وإنهاء الزيارة", "Call in & finish visits"),
    ("appointments.overbook", "appointments", "إضافة موعد خارج الأوقات المتاحة", "Squeeze in outside free times"),
    ("visits.write", "clinical", "كتابة وتوقيع زيارات مرضاه", "Write & sign own visits"),
    ("visits.view_all", "clinical", "قراءة زيارات كل الأطباء", "Read every doctor's visits"),
    ("visits.vitals", "clinical", "تسجيل العلامات الحيوية", "Record vital signs"),
    ("prescriptions.restricted", "clinical", "وصف الأدوية المقيّدة", "Prescribe restricted medicines"),
    ("clinical_lists.manage", "clinical", "إدارة قوائم الأدوية والتشخيصات", "Manage drug & diagnosis lists"),
    ("laser.record", "clinical", "تسجيل جلسات الليزر", "Record laser sessions"),
    ("dental.chart", "dental", "تسجيل خريطة الأسنان", "Record the dental chart"),
    ("dental.plans", "dental", "خطط علاج الأسنان وعروض الأسعار", "Dental treatment plans & quotations"),
    ("dental.plans_view", "dental", "عرض خطط العلاج وتسجيل موافقة المريض", "View plans & record patient acceptance"),
    ("dental.lab", "dental", "متابعة أعمال المعمل", "Track dental lab work"),
    ("complaints.create", "complaints", "تسجيل شكوى أو طلب", "Log complaints & requests"),
    ("complaints.manage", "complaints", "متابعة وحل الشكاوى والطلبات", "Handle & resolve complaints"),
    ("billing.view", "billing", "عرض الفواتير والإيصالات", "View invoices & receipts"),
    ("billing.invoice", "billing", "إنشاء وإصدار الفواتير", "Create & issue invoices"),
    ("billing.collect", "billing", "تحصيل المدفوعات وإدارة الوردية", "Take payments & run a cash shift"),
    ("billing.discount", "billing", "منح خصم في حدود المسموح", "Give discounts within the limit"),
    ("billing.approve", "billing", "اعتماد الخصومات والإلغاء والاسترداد", "Approve discounts, voids & refunds"),
    ("settings.billing", "settings", "إدارة الباقات ونسب الأطباء وقواعد الفوترة", "Manage packages, doctor shares & billing rules"),
]

CLINICAL = ["doctor", "nurse", "medical_director"]
# Which roles get each permission by default. Applied when a permission or a role is first created,
# so changes the admin makes later in Roles & permissions are kept.
PERMISSION_DEFAULTS = {
    "users.view": ["admin"],
    "users.manage": ["admin"],
    "roles.manage": ["admin"],
    "delegations.manage": ["admin"],
    "password_resets.manage": ["admin"],
    "branches.manage": ["admin"],
    "audit.view": ["admin", "auditor"],
    "patients.view": ["reception", "patient_relations", *CLINICAL],
    "patients.create": ["reception"],
    "patients.edit": ["reception"],
    "patients.alerts": CLINICAL,
    "patients.portal_access": ["reception"],
    "patient_files.view_admin": ["reception", *CLINICAL],
    "patient_files.view_clinical": CLINICAL,
    "patient_files.upload_admin": ["reception", *CLINICAL],
    "patient_files.upload_clinical": CLINICAL,
    "patient_files.review": ["doctor", "medical_director"],
    "settings.view": ["management", "medical_director", "admin", "reception", "patient_relations", "doctor", "nurse", "cashier"],
    "settings.services": ["management", "medical_director"],
    "settings.prices": ["management"],
    "settings.rooms": ["management", "admin"],
    "settings.schedules": ["management", "medical_director"],
    "settings.booking": ["management"],
    "appointments.view": ["reception", "patient_relations", "doctor", "nurse", "medical_director", "management", "cashier"],
    "appointments.book": ["reception", "patient_relations"],
    "appointments.manage": ["reception", "patient_relations"],
    "appointments.treat": ["doctor"],
    "appointments.overbook": ["reception"],
    "visits.write": ["doctor"],
    "visits.view_all": ["medical_director"],
    "visits.vitals": CLINICAL,
    "prescriptions.restricted": ["doctor"],
    "clinical_lists.manage": ["medical_director"],
    "laser.record": ["doctor", "nurse"],
    "dental.chart": ["doctor"],
    "dental.plans": ["doctor"],
    "dental.plans_view": ["reception", "patient_relations", "medical_director", "management"],
    "dental.lab": ["doctor", "nurse", "reception"],
    "complaints.create": ["reception", "patient_relations", "nurse", "cashier", "doctor"],
    "complaints.manage": ["patient_relations", "management"],
    "billing.view": ["cashier", "reception", "management", "accountant", "auditor"],
    "billing.invoice": ["cashier"],
    "billing.collect": ["cashier"],
    "billing.discount": ["cashier"],
    "billing.approve": ["management"],
    "settings.billing": ["management"],
}

# Synthetic people only. Never real staff or patients.
DEMO_STAFF = [
    ("admin", "كريم منصور", "Karim Mansour", "admin"),
    ("management", "د. هشام المصري", "Dr. Hesham El-Masry", "owner"),
    ("management", "منى عبد الرحمن", "Mona Abdelrahman", "director"),
    ("medical_director", "د. طارق فوزي", "Dr. Tarek Fawzy", "meddir"),
    ("reception", "نورهان عادل", "Nourhan Adel", "reception"),
    ("patient_relations", "ياسمين خالد", "Yasmin Khaled", "relations"),
    ("doctor", "د. رانيا سمير", "Dr. Rania Samir", "dr.derm"),
    ("doctor", "د. أحمد الشريف", "Dr. Ahmed El-Sherif", "dr.dental"),
    ("nurse", "آية مصطفى", "Aya Mostafa", "nurse"),
    ("cashier", "محمود إبراهيم", "Mahmoud Ibrahim", "cashier"),
    ("accountant", "شريف نبيل", "Sherif Nabil", "accountant"),
    ("hr", "دينا فاروق", "Dina Farouk", "hr"),
    ("inventory", "هاني جمال", "Hany Gamal", "inventory"),
    ("marketing", "سلمى حسن", "Salma Hassan", "marketing"),
    ("auditor", "عمرو لطفي", "Amr Lotfy", "auditor"),
]
DEMO_PATIENT = ("عمر يوسف", "Omar Youssef", "01001110001", date(1990, 4, 12), "male")
DEMO_DOMAIN = "demo.goldencare.local"


def run_seed(conn: psycopg.Connection) -> None:
    from app.storage.demo_patients import seed_demo_patients
    from app.storage.demo_appointments import seed_demo_appointments
    from app.storage.demo_settings import seed_demo_settings
    from app.storage.demo_visits import seed_clinical_lists, seed_demo_visits
    from app.storage.demo_dental import seed_demo_complaints, seed_demo_dental
    from app.storage.demo_billing import seed_demo_billing

    with conn.transaction():
        _roles_and_permissions(conn)
        branch_id = _main_branch(conn)
        _first_admin(conn)
        if settings.seed_demo:
            _demo_accounts(conn, branch_id)
            seed_demo_patients(conn, branch_id)
            seed_demo_settings(conn, branch_id)
            seed_demo_appointments(conn)
            seed_clinical_lists(conn)
            seed_demo_visits(conn)
            seed_demo_dental(conn, branch_id)
            seed_demo_complaints(conn)
            seed_demo_billing(conn, branch_id)


def _grant(conn: psycopg.Connection, role: str, permission: str) -> None:
    conn.execute(
        "INSERT INTO role_permissions (role_code, permission_code) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        (role, permission),
    )


def _roles_and_permissions(conn: psycopg.Connection) -> None:
    new_roles = set()
    for order, (code, kind, name_ar, name_en, mfa) in enumerate(ROLES):
        created = conn.execute(
            """
            INSERT INTO roles (code, kind, name_ar, name_en, requires_mfa, sort_order) VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (code) DO NOTHING RETURNING code
            """,
            (code, kind, name_ar, name_en, mfa, order),
        ).fetchone()
        if created:
            new_roles.add(code)
        else:
            conn.execute("UPDATE roles SET name_ar = %s, name_en = %s, sort_order = %s WHERE code = %s",
                         (name_ar, name_en, order, code))
    for code, module, name_ar, name_en in PERMISSIONS:
        created = conn.execute(
            "INSERT INTO permissions (code, module, name_ar, name_en) VALUES (%s, %s, %s, %s) ON CONFLICT (code) DO NOTHING RETURNING code",
            (code, module, name_ar, name_en),
        ).fetchone()
        if not created:
            conn.execute("UPDATE permissions SET module = %s, name_ar = %s, name_en = %s WHERE code = %s",
                         (module, name_ar, name_en, code))
        for role in PERMISSION_DEFAULTS.get(code, []):
            if created or role in new_roles:
                _grant(conn, role, code)


def _main_branch(conn: psycopg.Connection) -> int:
    row = conn.execute("SELECT id FROM branches ORDER BY id LIMIT 1").fetchone()
    if row:
        return row["id"]
    return conn.execute(
        """
        INSERT INTO branches (code, name_ar, name_en, address_ar, address_en)
        VALUES ('SHR', 'جولدن كير — مدينة الشروق', 'Golden Care — Madinat El Shorouk', 'مدينة الشروق، القاهرة', 'Madinat El Shorouk, Cairo')
        RETURNING id
        """
    ).fetchone()["id"]


def _first_admin(conn: psycopg.Connection) -> None:
    if conn.execute("SELECT 1 FROM users WHERE kind = 'staff' LIMIT 1").fetchone():
        return
    password = settings.admin_password or temp_password()
    email = settings.admin_email.strip().lower()
    user_id = conn.execute(
        """
        INSERT INTO users (kind, full_name_ar, full_name_en, name_search, email, password_hash, must_change_password)
        VALUES ('staff', 'مدير النظام', 'System Administrator', %s, %s, %s, true) RETURNING id
        """,
        (normalize_name("مدير النظام System Administrator"), email, hash_password(password)),
    ).fetchone()["id"]
    conn.execute("INSERT INTO user_roles (user_id, role_code) VALUES (%s, 'admin')", (user_id,))
    conn.execute(
        "INSERT INTO audit_log (action, entity, entity_id, actor_label, details) VALUES ('system.first_admin', 'user', %s, 'system', '{}')",
        (str(user_id),),
    )
    if settings.admin_password:
        log.warning("First admin account created: %s (password from ADMIN_PASSWORD, must be changed at first sign-in)", email)
    else:
        log.warning("First admin account created: %s / temporary password: %s (must be changed at first sign-in)", email, password)


def _demo_accounts(conn: psycopg.Connection, branch_id: int) -> None:
    if conn.execute("SELECT 1 FROM users WHERE email LIKE %s LIMIT 1", (f"%@{DEMO_DOMAIN}",)).fetchone():
        return
    password = settings.demo_password or temp_password()
    password_hash = hash_password(password)
    for role, name_ar, name_en, local in DEMO_STAFF:
        user_id = conn.execute(
            """
            INSERT INTO users (kind, full_name_ar, full_name_en, name_search, email, password_hash, password_changed_at)
            VALUES ('staff', %s, %s, %s, %s, %s, now()) RETURNING id
            """,
            (name_ar, name_en, normalize_name(f"{name_ar} {name_en}"), f"{local}@{DEMO_DOMAIN}", password_hash),
        ).fetchone()["id"]
        conn.execute(
            "INSERT INTO user_roles (user_id, role_code, branch_id) VALUES (%s, %s, %s)",
            (user_id, role, None if role in ("admin", "management", "auditor") else branch_id),
        )

    name_ar, name_en, phone_raw, dob, gender = DEMO_PATIENT
    phone = normalize_phone(phone_raw)
    search = normalize_name(f"{name_ar} {name_en}")
    user_id = conn.execute(
        """
        INSERT INTO users (kind, full_name_ar, full_name_en, name_search, phone, password_hash, password_changed_at)
        VALUES ('patient', %s, %s, %s, %s, %s, now()) RETURNING id
        """,
        (name_ar, name_en, search, phone, password_hash),
    ).fetchone()["id"]
    conn.execute("INSERT INTO user_roles (user_id, role_code) VALUES (%s, 'patient')", (user_id,))
    conn.execute(
        """
        INSERT INTO patients (user_id, full_name_ar, full_name_en, name_search, phone, date_of_birth, gender,
                              consent_terms_at, consent_messages)
        VALUES (%s, %s, %s, %s, %s, %s, %s, now(), true)
        """,
        (user_id, name_ar, name_en, search, phone, dob, gender),
    )
    log.warning("Demo accounts created (*@%s and patient %s). Demo password: %s", DEMO_DOMAIN, phone_raw, password)
