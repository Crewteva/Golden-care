"""The patient file, shared by every role that works with patients (reception, doctor, nurse, ...).
Each role's routes decide which of these functions it may call; permissions are checked in core/patients_api.py."""
from datetime import date
from uuid import UUID

import psycopg

from app.core import audit
from app.core.errors import AppError, field_error
from app.core.national_id import clean_national_id, parse_national_id
from app.core.normalize import clean_name, normalize_email, normalize_name, normalize_phone
from app.core.patient_schemas import FamilyLinkIn, PatientCreate, PatientIn, PatientUpdate
from app.core.security import hash_password, temp_password
from app.core.session import Ctx

SENSITIVE_FIELDS = {"full_name_ar", "full_name_en", "date_of_birth", "gender", "national_id"}
INVERSE = {"parent": "child", "child": "parent", "spouse": "spouse", "sibling": "sibling", "other": "other"}
BRIEF = "p.id, p.mrn, p.full_name_ar, p.full_name_en, p.date_of_birth, p.gender, p.phone"


def _jsonable(value):
    if isinstance(value, (date, UUID)):
        return str(value)
    return value


def get_patient(conn: psycopg.Connection, patient_id) -> dict:
    row = conn.execute("SELECT * FROM patients WHERE id = %s", (patient_id,)).fetchone()
    if not row:
        raise AppError(404, "patient_not_found")
    return row


def age_of(born: date) -> int:
    today = date.today()
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def _clean(body: PatientIn) -> dict:
    """Normalises every field; raises one validation error listing all bad fields."""
    fields = {}

    def phone_of(name, raw):
        if raw and raw.strip():
            value = normalize_phone(raw)
            if not value:
                fields[name] = "invalid_phone"
            return value
        return None

    values = {
        "full_name_ar": clean_name(body.full_name_ar),
        "full_name_en": clean_name(body.full_name_en),
        "date_of_birth": body.date_of_birth,
        "gender": body.gender,
        "phone": phone_of("phone", body.phone),
        "phone2": phone_of("phone2", body.phone2),
        "emergency_phone": phone_of("emergency_phone", body.emergency_phone),
        "email": None,
        "national_id": None,
        "passport_no": clean_name(body.passport_no),
        "nationality": clean_name(body.nationality) or "EG",
        "address": clean_name(body.address),
        "area": clean_name(body.area),
        "emergency_name": clean_name(body.emergency_name),
        "emergency_relation": clean_name(body.emergency_relation),
        "consent_messages": body.consent_messages,
    }
    if body.email and body.email.strip():
        values["email"] = normalize_email(body.email)
        if not values["email"]:
            fields["email"] = "invalid"
    if body.date_of_birth > date.today() or age_of(body.date_of_birth) > 120:
        fields["date_of_birth"] = "invalid_date"
    if body.national_id and clean_national_id(body.national_id):
        parsed = parse_national_id(body.national_id)
        if not parsed:
            fields["national_id"] = "invalid_national_id"
        else:
            values["national_id"] = parsed["national_id"]
            if parsed["date_of_birth"] != body.date_of_birth or parsed["gender"] != body.gender:
                fields["national_id"] = "id_mismatch"
    if values["phone"] and values["phone2"] == values["phone"]:
        values["phone2"] = None
    if fields:
        raise AppError(422, "validation", fields=fields)
    values["name_search"] = normalize_name(f"{values['full_name_ar']} {values['full_name_en'] or ''}")
    return values


# ---------- search & duplicates ----------

SORTS = {
    "name_ar": "p.full_name_ar",
    "name_en": "p.full_name_en",
    "mrn": "p.mrn",
    "age": "p.date_of_birth",
    "created": "p.created_at",
    "updated": "p.updated_at",
}


def search(conn: psycopg.Connection, *, q=None, gender=None, age_min=None, age_max=None, source=None,
           has_alerts=None, sort="created", direction="desc", page=1, page_size=25) -> dict:
    where, params = [], []
    if q and q.strip():
        term = q.strip()
        digits = clean_national_id(term)
        conds = ["p.name_search LIKE %s", "p.mrn ILIKE %s", "p.passport_no ILIKE %s"]
        params += [f"%{normalize_name(term)}%", f"%{term}%", f"%{term}%"]
        phone = normalize_phone(term)
        if phone:
            conds.append("p.phone = %s OR p.phone2 = %s")
            params += [phone, phone]
        if len(digits) == 14:
            conds.append("p.national_id = %s")
            params.append(digits)
        elif len(digits) >= 5:
            conds.append("p.phone LIKE %s OR p.mrn LIKE %s")
            params += [f"%{digits[-9:]}%", f"%{digits}"]
        where.append("(" + " OR ".join(conds) + ")")
    if gender in ("female", "male"):
        where.append("p.gender = %s")
        params.append(gender)
    if age_min is not None:
        where.append("p.date_of_birth <= current_date - make_interval(years => %s)")
        params.append(age_min)
    if age_max is not None:
        where.append("p.date_of_birth > current_date - make_interval(years => %s)")
        params.append(age_max + 1)
    if source in ("self", "reception"):
        where.append("p.registered_via = %s")
        params.append(source)
    if has_alerts:
        where.append("EXISTS (SELECT 1 FROM patient_alerts a WHERE a.patient_id = p.id AND a.removed_at IS NULL)")
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    order = SORTS.get(sort, SORTS["created"])
    direction = "ASC" if direction == "asc" else "DESC"
    page = max(page, 1)
    rows = conn.execute(
        f"""
        SELECT {BRIEF}, p.registered_via, p.created_at, p.updated_at, p.national_id IS NOT NULL AS has_national_id,
               p.user_id IS NOT NULL AS has_portal,
               COALESCE((SELECT json_agg(json_build_object('kind', a.kind, 'severity', a.severity, 'description', a.description)
                                  ORDER BY a.severity = 'critical' DESC, a.created_at)
                         FROM patient_alerts a WHERE a.patient_id = p.id AND a.removed_at IS NULL), '[]') AS alerts,
               count(*) OVER () AS total
        FROM patients p
        {clause}
        ORDER BY {order} {direction} NULLS LAST, p.mrn
        LIMIT %s OFFSET %s
        """,
        [*params, page_size, (page - 1) * page_size],
    ).fetchall()
    total = rows[0]["total"] if rows else 0
    for row in rows:
        row.pop("total")
    return {"items": rows, "total": total, "page": page, "page_size": page_size}


def find_duplicates(conn: psycopg.Connection, *, name_ar="", name_en=None, dob=None, phone=None,
                    national_id=None, exclude_id=None) -> list[dict]:
    """Existing files that may be the same person, with the reasons they matched."""
    name = normalize_name(name_ar or "") or normalize_name(name_en or "")
    phone = normalize_phone(phone) if phone else None
    nid = clean_national_id(national_id) if national_id else None
    nid = nid if nid and len(nid) == 14 else None
    rows = conn.execute(
        f"""
        SELECT * FROM (
          SELECT {BRIEF}, p.national_id, p.user_id IS NOT NULL AS has_portal,
                 (%(nid)s::text IS NOT NULL AND p.national_id = %(nid)s) AS m_national_id,
                 (%(phone)s::text IS NOT NULL AND (p.phone = %(phone)s OR p.phone2 = %(phone)s)) AS m_phone,
                 (%(dob)s::date IS NOT NULL AND p.date_of_birth = %(dob)s AND length(%(name)s) >= 3
                    AND word_similarity(%(name)s, p.name_search) >= 0.5) AS m_name_dob,
                 (length(%(name)s) >= 8 AND word_similarity(%(name)s, p.name_search) >= 0.8) AS m_similar_name,
                 word_similarity(%(name)s, p.name_search) AS score
          FROM patients p
          WHERE %(exclude)s::uuid IS NULL OR p.id <> %(exclude)s::uuid
        ) x
        WHERE m_national_id OR m_phone OR m_name_dob OR m_similar_name
        ORDER BY m_national_id DESC, m_phone DESC, m_name_dob DESC, score DESC
        LIMIT 8
        """,
        {"nid": nid, "phone": phone, "dob": dob, "name": name, "exclude": exclude_id},
    ).fetchall()
    result = []
    for row in rows:
        reasons = [r for r in ("national_id", "phone", "name_dob", "similar_name") if row.pop(f"m_{r}")]
        row.pop("score")
        row["reasons"] = reasons
        result.append(row)
    return result


# ---------- create & edit ----------

def _check_link(conn: psycopg.Connection, link: FamilyLinkIn | None) -> dict | None:
    if not link:
        return None
    return get_patient(conn, link.relative_id)


def create(conn: psycopg.Connection, ctx: Ctx, body: PatientCreate) -> dict:
    values = _clean(body)
    link = body.family_link
    relative = _check_link(conn, link)
    if not values["phone"] and not (link and link.is_guardian):
        raise field_error("phone", "required_unless_guardian")

    candidates = find_duplicates(conn, name_ar=values["full_name_ar"], name_en=values["full_name_en"],
                                 dob=values["date_of_birth"], phone=values["phone"], national_id=values["national_id"])
    same_id = [c for c in candidates if "national_id" in c["reasons"]]
    if same_id:
        raise AppError(409, "conflict", fields={"national_id": "taken"}, candidates=same_id)
    linked_id = relative["id"] if relative else None
    same_phone = [c for c in candidates if "phone" in c["reasons"]]
    if same_phone and not any(c["id"] == linked_id for c in same_phone):
        raise AppError(409, "phone_in_use", candidates=same_phone)
    similar = [c for c in candidates if c["id"] != linked_id and {"name_dob", "similar_name"} & set(c["reasons"])]
    reason = (body.duplicate_reason or "").strip()
    if similar and len(reason) < 5:
        raise AppError(409, "possible_duplicates", candidates=similar)

    row = conn.execute(
        """
        INSERT INTO patients (full_name_ar, full_name_en, name_search, phone, phone2, email, date_of_birth, gender,
                              national_id, passport_no, nationality, address, area, emergency_name, emergency_relation,
                              emergency_phone, consent_terms_at, consent_messages, registered_via, registered_branch_id,
                              created_by, updated_by)
        VALUES (%(full_name_ar)s, %(full_name_en)s, %(name_search)s, %(phone)s, %(phone2)s, %(email)s, %(date_of_birth)s,
                %(gender)s, %(national_id)s, %(passport_no)s, %(nationality)s, %(address)s, %(area)s, %(emergency_name)s,
                %(emergency_relation)s, %(emergency_phone)s, now(), %(consent_messages)s, 'reception', %(branch)s,
                %(uid)s, %(uid)s)
        RETURNING id, mrn
        """,
        {**values, "branch": ctx.active_branch_id, "uid": ctx.user_id},
    ).fetchone()
    if link:
        conn.execute(
            "INSERT INTO patient_family (patient_id, relative_id, relationship, is_guardian, created_by) VALUES (%s, %s, %s, %s, %s)",
            (row["id"], link.relative_id, link.relationship, link.is_guardian, ctx.user_id),
        )
    audit.record(conn, "patient.created", ctx=ctx, entity="patient", entity_id=row["id"], details={
        "mrn": row["mrn"],
        "duplicate_override": reason or None,
        "possible_duplicates": [c["mrn"] for c in similar],
        "family": {"relative": relative["mrn"], "relationship": link.relationship, "guardian": link.is_guardian} if link else None,
    })
    return {"id": row["id"], "mrn": row["mrn"]}


def update(conn: psycopg.Connection, ctx: Ctx, patient_id, body: PatientUpdate) -> None:
    current = get_patient(conn, patient_id)
    values = _clean(body)
    changes = {k: [_jsonable(current[k]), _jsonable(v)] for k, v in values.items()
               if k != "name_search" and current.get(k) != v}
    if not changes:
        return
    reason = (body.change_reason or "").strip()
    if SENSITIVE_FIELDS & changes.keys() and len(reason) < 3:
        raise field_error("change_reason", "required")
    if "national_id" in changes and values["national_id"] and conn.execute(
        "SELECT 1 FROM patients WHERE national_id = %s AND id <> %s", (values["national_id"], patient_id),
    ).fetchone():
        raise AppError(409, "conflict", fields={"national_id": "taken"})
    if "phone" in changes:
        if values["phone"]:
            others = conn.execute(
                """
                SELECT p.id FROM patients p
                WHERE (p.phone = %(phone)s OR p.phone2 = %(phone)s) AND p.id <> %(id)s
                  AND NOT EXISTS (SELECT 1 FROM patient_family f WHERE f.removed_at IS NULL
                    AND ((f.patient_id = p.id AND f.relative_id = %(id)s) OR (f.relative_id = p.id AND f.patient_id = %(id)s)))
                """,
                {"phone": values["phone"], "id": patient_id},
            ).fetchall()
            if others:
                raise AppError(409, "conflict", fields={"phone": "taken"})
        elif not _has_guardian(conn, patient_id):
            raise field_error("phone", "required_unless_guardian")
    if current["user_id"]:
        _sync_portal_account(conn, current["user_id"], values, changes)

    conn.execute(
        """
        UPDATE patients SET full_name_ar = %(full_name_ar)s, full_name_en = %(full_name_en)s, name_search = %(name_search)s,
               phone = %(phone)s, phone2 = %(phone2)s, email = %(email)s, date_of_birth = %(date_of_birth)s,
               gender = %(gender)s, national_id = %(national_id)s, passport_no = %(passport_no)s,
               nationality = %(nationality)s, address = %(address)s, area = %(area)s, emergency_name = %(emergency_name)s,
               emergency_relation = %(emergency_relation)s, emergency_phone = %(emergency_phone)s,
               consent_messages = %(consent_messages)s, updated_by = %(uid)s, updated_at = now()
        WHERE id = %(id)s
        """,
        {**values, "uid": ctx.user_id, "id": patient_id},
    )
    audit.record(conn, "patient.updated", ctx=ctx, entity="patient", entity_id=patient_id,
                 details={"changes": changes, "reason": reason or None})


def _has_guardian(conn: psycopg.Connection, patient_id) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM patient_family WHERE patient_id = %s AND is_guardian AND removed_at IS NULL", (patient_id,),
    ).fetchone())


def _sync_portal_account(conn: psycopg.Connection, user_id, values: dict, changes: dict) -> None:
    """The patient's sign-in account keeps the same name, mobile and e-mail as the file."""
    if "phone" in changes:
        if not values["phone"]:
            raise field_error("phone", "required_for_portal")
        if conn.execute("SELECT 1 FROM users WHERE phone = %s AND id <> %s", (values["phone"], user_id)).fetchone():
            raise AppError(409, "conflict", fields={"phone": "taken"})
    if "email" in changes and values["email"] and conn.execute(
        "SELECT 1 FROM users WHERE email = %s AND id <> %s", (values["email"], user_id),
    ).fetchone():
        raise AppError(409, "conflict", fields={"email": "taken"})
    conn.execute(
        "UPDATE users SET full_name_ar = %s, full_name_en = %s, name_search = %s, phone = %s, email = %s, updated_at = now() WHERE id = %s",
        (values["full_name_ar"], values["full_name_en"], values["name_search"], values["phone"], values["email"], user_id),
    )


# ---------- reading a file ----------

def family_of(conn: psycopg.Connection, patient_id) -> list[dict]:
    """Relatives from this patient's point of view: what each relative is to them, and who manages whom."""
    rows = conn.execute(
        f"""
        SELECT f.id AS link_id, f.patient_id, f.relative_id, f.relationship, f.is_guardian, f.created_at, {BRIEF},
               p.user_id IS NOT NULL AS has_portal
        FROM patient_family f
        JOIN patients p ON p.id = CASE WHEN f.patient_id = %(id)s THEN f.relative_id ELSE f.patient_id END
        WHERE (f.patient_id = %(id)s OR f.relative_id = %(id)s) AND f.removed_at IS NULL
        ORDER BY f.created_at
        """,
        {"id": patient_id},
    ).fetchall()
    result = []
    for r in rows:
        mine = r["patient_id"] == patient_id
        result.append({
            "link_id": r["link_id"],
            "id": r["id"], "mrn": r["mrn"], "full_name_ar": r["full_name_ar"], "full_name_en": r["full_name_en"],
            "date_of_birth": r["date_of_birth"], "gender": r["gender"], "phone": r["phone"], "has_portal": r["has_portal"],
            # what the relative is to this patient
            "relationship": r["relationship"] if mine else INVERSE[r["relationship"]],
            "manages_this_patient": r["is_guardian"] and mine,
            "managed_by_this_patient": r["is_guardian"] and not mine,
        })
    return result


def alerts_of(conn: psycopg.Connection, patient_id) -> list[dict]:
    return conn.execute(
        """
        SELECT a.id, a.kind, a.description, a.severity, a.created_at, u.full_name_ar AS by_ar, u.full_name_en AS by_en
        FROM patient_alerts a JOIN users u ON u.id = a.created_by
        WHERE a.patient_id = %s AND a.removed_at IS NULL
        ORDER BY a.severity = 'critical' DESC, a.created_at
        """,
        (patient_id,),
    ).fetchall()


def detail(conn: psycopg.Connection, patient_id) -> dict:
    p = conn.execute(
        """
        SELECT p.*, b.name_ar AS branch_name_ar, b.name_en AS branch_name_en,
               cu.full_name_ar AS created_by_ar, cu.full_name_en AS created_by_en,
               uu.full_name_ar AS updated_by_ar, uu.full_name_en AS updated_by_en,
               acc.is_active AS portal_active, acc.last_login_at AS portal_last_login, acc.must_change_password AS portal_pending
        FROM patients p
        LEFT JOIN branches b ON b.id = p.registered_branch_id
        LEFT JOIN users cu ON cu.id = p.created_by
        LEFT JOIN users uu ON uu.id = p.updated_by
        LEFT JOIN users acc ON acc.id = p.user_id
        WHERE p.id = %s
        """,
        (patient_id,),
    ).fetchone()
    if not p:
        raise AppError(404, "patient_not_found")
    p.pop("name_search", None)
    p["has_portal"] = p.pop("user_id") is not None
    p["age"] = age_of(p["date_of_birth"])
    p["governorate"] = (parse_national_id(p["national_id"]) or {}).get("governorate") if p["national_id"] else None
    counts = conn.execute(
        """
        SELECT count(*) FILTER (WHERE voided_at IS NULL) AS documents,
               count(*) FILTER (WHERE voided_at IS NULL AND review_status = 'pending') AS pending_review
        FROM patient_files WHERE patient_id = %s
        """,
        (patient_id,),
    ).fetchone()
    return {"patient": p, "alerts": alerts_of(conn, patient_id), "family": family_of(conn, patient_id), "counts": counts}


def history(conn: psycopg.Connection, patient_id, page: int = 1) -> dict:
    get_patient(conn, patient_id)
    return audit.search(conn, patient_id=patient_id, page=page, page_size=25)


# ---------- alerts ----------

def add_alert(conn: psycopg.Connection, ctx: Ctx, patient_id, kind: str, description: str, severity: str) -> None:
    get_patient(conn, patient_id)
    alert_id = conn.execute(
        "INSERT INTO patient_alerts (patient_id, kind, description, severity, created_by) VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (patient_id, kind, description.strip(), severity, ctx.user_id),
    ).fetchone()["id"]
    audit.record(conn, "patient.alert_added", ctx=ctx, entity="patient", entity_id=patient_id,
                 details={"alert_id": alert_id, "kind": kind, "severity": severity, "description": description.strip()})


def remove_alert(conn: psycopg.Connection, ctx: Ctx, patient_id, alert_id: int, reason: str) -> None:
    row = conn.execute(
        "SELECT * FROM patient_alerts WHERE id = %s AND patient_id = %s AND removed_at IS NULL", (alert_id, patient_id),
    ).fetchone()
    if not row:
        raise AppError(404, "alert_not_found")
    conn.execute(
        "UPDATE patient_alerts SET removed_at = now(), removed_by = %s, removed_reason = %s WHERE id = %s",
        (ctx.user_id, reason.strip(), alert_id),
    )
    audit.record(conn, "patient.alert_removed", ctx=ctx, entity="patient", entity_id=patient_id,
                 details={"alert_id": alert_id, "kind": row["kind"], "description": row["description"], "reason": reason.strip()})


# ---------- family ----------

def link_family(conn: psycopg.Connection, ctx: Ctx, patient_id, link: FamilyLinkIn) -> None:
    patient = get_patient(conn, patient_id)
    relative = get_patient(conn, link.relative_id)
    if patient["id"] == relative["id"]:
        raise field_error("relative_id", "same_person")
    if conn.execute(
        """
        SELECT 1 FROM patient_family WHERE removed_at IS NULL
          AND LEAST(patient_id, relative_id) = LEAST(%s::uuid, %s::uuid) AND GREATEST(patient_id, relative_id) = GREATEST(%s::uuid, %s::uuid)
        """,
        (patient_id, link.relative_id, patient_id, link.relative_id),
    ).fetchone():
        raise AppError(409, "already_linked")
    conn.execute(
        "INSERT INTO patient_family (patient_id, relative_id, relationship, is_guardian, created_by) VALUES (%s, %s, %s, %s, %s)",
        (patient_id, link.relative_id, link.relationship, link.is_guardian, ctx.user_id),
    )
    audit.record(conn, "patient.family_linked", ctx=ctx, entity="patient", entity_id=patient_id, details={
        "relative": relative["mrn"], "relative_id": str(relative["id"]), "relationship": link.relationship,
        "guardian": link.is_guardian,
    })


def unlink_family(conn: psycopg.Connection, ctx: Ctx, patient_id, link_id: int, reason: str) -> None:
    row = conn.execute(
        "SELECT * FROM patient_family WHERE id = %s AND (patient_id = %s OR relative_id = %s) AND removed_at IS NULL",
        (link_id, patient_id, patient_id),
    ).fetchone()
    if not row:
        raise AppError(404, "link_not_found")
    if row["is_guardian"] and row["patient_id"] == patient_id:
        child = get_patient(conn, patient_id)
        if not child["phone"]:
            raise AppError(409, "guardian_needed")
    conn.execute(
        "UPDATE patient_family SET removed_at = now(), removed_by = %s, removed_reason = %s WHERE id = %s",
        (ctx.user_id, reason.strip(), link_id),
    )
    audit.record(conn, "patient.family_unlinked", ctx=ctx, entity="patient", entity_id=patient_id,
                 details={"link_id": link_id, "reason": reason.strip()})


# ---------- portal access ----------

def give_portal_access(conn: psycopg.Connection, ctx: Ctx, patient_id) -> dict:
    p = get_patient(conn, patient_id)
    if p["user_id"]:
        raise AppError(409, "portal_exists")
    if not p["phone"]:
        raise AppError(409, "phone_required_for_portal")
    if age_of(p["date_of_birth"]) < 16:
        raise AppError(409, "too_young_for_portal")
    if conn.execute("SELECT 1 FROM users WHERE phone = %s", (p["phone"],)).fetchone():
        raise AppError(409, "phone_has_account")
    email = p["email"]
    if email and conn.execute("SELECT 1 FROM users WHERE email = %s", (email,)).fetchone():
        email = None
    password = temp_password()
    user_id = conn.execute(
        """
        INSERT INTO users (kind, full_name_ar, full_name_en, name_search, phone, email, password_hash, must_change_password, created_by)
        VALUES ('patient', %s, %s, %s, %s, %s, %s, true, %s) RETURNING id
        """,
        (p["full_name_ar"], p["full_name_en"], p["name_search"], p["phone"], email, hash_password(password), ctx.user_id),
    ).fetchone()["id"]
    conn.execute("INSERT INTO user_roles (user_id, role_code) VALUES (%s, 'patient')", (user_id,))
    conn.execute("UPDATE patients SET user_id = %s, updated_at = now() WHERE id = %s", (user_id, patient_id))
    audit.record(conn, "patient.portal_access_given", ctx=ctx, entity="patient", entity_id=patient_id,
                 details={"mrn": p["mrn"]})
    return {"temp_password": password, "phone": p["phone"]}
