"""Patients: self-registration from the login page and their own profile."""
from datetime import date

import psycopg
from fastapi import Request

from app.auth.service import start_session
from app.core import audit
from app.core.errors import AppError, field_error
from app.core.normalize import clean_name, normalize_email, normalize_name, normalize_phone
from app.core.ratelimit import register_limit
from app.core.security import hash_password, password_problem
from app.core.session import Ctx, client_info, load_ctx
from app.users.patient.schemas import ProfileUpdate, RegisterIn


def register(conn: psycopg.Connection, body: RegisterIn, request: Request) -> tuple[str, Ctx]:
    ip, user_agent = client_info(request)
    fields = {}
    phone = normalize_phone(body.phone)
    if not phone:
        fields["phone"] = "invalid_phone"
    email = None
    if body.email and body.email.strip():
        email = normalize_email(body.email)
        if not email:
            fields["email"] = "invalid"
    today = date.today()
    age = today.year - body.date_of_birth.year - ((today.month, today.day) < (body.date_of_birth.month, body.date_of_birth.day))
    if body.date_of_birth > today or age > 120:
        fields["date_of_birth"] = "invalid_date"
    elif age < 16:
        fields["date_of_birth"] = "too_young"
    if not body.accept_terms:
        fields["accept_terms"] = "required"
    problem = password_problem(body.password, kind="patient",
                               identifiers=((email or "").split("@")[0] or None, phone[-8:] if phone else None))
    if problem:
        fields["password"] = problem
    if fields:
        raise AppError(422, "validation", fields=fields)

    register_limit.check(ip)
    taken = {}
    if conn.execute("SELECT 1 FROM users WHERE phone = %s", (phone,)).fetchone():
        taken["phone"] = "taken"
    if email and conn.execute("SELECT 1 FROM users WHERE email = %s", (email,)).fetchone():
        taken["email"] = "taken"
    if taken:
        raise AppError(409, "conflict", fields=taken)

    name_ar, name_en = clean_name(body.full_name_ar), clean_name(body.full_name_en)
    search = normalize_name(f"{name_ar} {name_en or ''}")
    user_id = conn.execute(
        """
        INSERT INTO users (kind, full_name_ar, full_name_en, name_search, email, phone, password_hash, password_changed_at)
        VALUES ('patient', %s, %s, %s, %s, %s, %s, now()) RETURNING id
        """,
        (name_ar, name_en, search, email, phone, hash_password(body.password)),
    ).fetchone()["id"]
    conn.execute("INSERT INTO user_roles (user_id, role_code) VALUES (%s, 'patient')", (user_id,))
    patient = conn.execute(
        """
        INSERT INTO patients (user_id, full_name_ar, full_name_en, name_search, phone, email, date_of_birth, gender,
                              consent_terms_at, consent_messages)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now(), %s) RETURNING id, mrn
        """,
        (user_id, name_ar, name_en, search, phone, email, body.date_of_birth, body.gender, body.consent_messages),
    ).fetchone()

    user = conn.execute("SELECT * FROM users WHERE id = %s", (user_id,)).fetchone()
    token = start_session(conn, user, request)
    ctx = load_ctx(conn, token, request)
    audit.record(conn, "patient.registered", ctx=ctx, entity="patient", entity_id=patient["id"],
                 details={"mrn": patient["mrn"], "consent_messages": body.consent_messages}, ip=ip, user_agent=user_agent)
    return token, ctx


def _patient_of(conn: psycopg.Connection, ctx: Ctx) -> dict:
    row = conn.execute("SELECT * FROM patients WHERE user_id = %s", (ctx.user_id,)).fetchone()
    if not row:
        raise AppError(404, "patient_not_found")
    return row


def profile(conn: psycopg.Connection, ctx: Ctx) -> dict:
    p = _patient_of(conn, ctx)
    return {
        "mrn": p["mrn"], "full_name_ar": p["full_name_ar"], "full_name_en": p["full_name_en"], "phone": p["phone"],
        "email": p["email"], "date_of_birth": p["date_of_birth"], "gender": p["gender"],
        "consent_messages": p["consent_messages"], "created_at": p["created_at"],
        "preferred_lang": ctx.user["preferred_lang"],
    }


def update_profile(conn: psycopg.Connection, ctx: Ctx, body: ProfileUpdate) -> dict:
    p = _patient_of(conn, ctx)
    email = None
    if body.email and body.email.strip():
        email = normalize_email(body.email)
        if not email:
            raise field_error("email", "invalid")
        if conn.execute("SELECT 1 FROM users WHERE email = %s AND id <> %s", (email, ctx.user_id)).fetchone():
            raise AppError(409, "conflict", fields={"email": "taken"})
    changes = {}
    if (p["email"] or None) != email:
        changes["email"] = [p["email"], email]
    if p["consent_messages"] != body.consent_messages:
        changes["consent_messages"] = [p["consent_messages"], body.consent_messages]
    conn.execute("UPDATE patients SET email = %s, consent_messages = %s, updated_at = now() WHERE id = %s",
                 (email, body.consent_messages, p["id"]))
    conn.execute("UPDATE users SET email = %s, preferred_lang = %s, updated_at = now() WHERE id = %s",
                 (email, body.preferred_lang, ctx.user_id))
    if changes:
        audit.record(conn, "patient.profile_updated", ctx=ctx, entity="patient", entity_id=p["id"], details={"changes": changes})
    ctx.user["preferred_lang"] = body.preferred_lang
    return profile(conn, ctx)
