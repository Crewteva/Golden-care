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
    ("owner", "staff", "المالك", "Owner", True),
    ("director", "staff", "المدير العام", "General manager", True),
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
]

# Applied only when a role is first created, so later changes made by the admin are kept.
DEFAULT_GRANTS = {
    "admin": [code for code, *_ in PERMISSIONS],
    "auditor": ["audit.view"],
}

# Synthetic people only. Never real staff or patients.
DEMO_STAFF = [
    ("admin", "كريم منصور", "Karim Mansour", "admin"),
    ("owner", "د. هشام المصري", "Dr. Hesham El-Masry", "owner"),
    ("director", "منى عبد الرحمن", "Mona Abdelrahman", "director"),
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
    with conn.transaction():
        _roles_and_permissions(conn)
        branch_id = _main_branch(conn)
        _first_admin(conn)
        if settings.seed_demo:
            _demo_accounts(conn, branch_id)


def _roles_and_permissions(conn: psycopg.Connection) -> None:
    for code, module, name_ar, name_en in PERMISSIONS:
        conn.execute(
            """
            INSERT INTO permissions (code, module, name_ar, name_en) VALUES (%s, %s, %s, %s)
            ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, name_ar = EXCLUDED.name_ar, name_en = EXCLUDED.name_en
            """,
            (code, module, name_ar, name_en),
        )
    for order, (code, kind, name_ar, name_en, mfa) in enumerate(ROLES):
        created = conn.execute(
            """
            INSERT INTO roles (code, kind, name_ar, name_en, requires_mfa, sort_order) VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (code) DO NOTHING RETURNING code
            """,
            (code, kind, name_ar, name_en, mfa, order),
        ).fetchone()
        if created:
            for perm in DEFAULT_GRANTS.get(code, []):
                conn.execute("INSERT INTO role_permissions (role_code, permission_code) VALUES (%s, %s)", (code, perm))
        else:
            conn.execute("UPDATE roles SET name_ar = %s, name_en = %s, sort_order = %s WHERE code = %s",
                         (name_ar, name_en, order, code))


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
            (user_id, role, None if role in ("admin", "owner", "director", "auditor") else branch_id),
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
