"""Patient documents in private storage. Files are only ever read through the API, every opening is logged,
and patients see a document only after a doctor releases it (signed consents are always visible to them)."""
import hashlib
import os
import uuid
from pathlib import Path

import psycopg

from app.config import settings
from app.core import audit
from app.core.errors import AppError, field_error
from app.core.patient_schemas import ReviewIn
from app.core.session import Ctx

CATEGORIES = ("lab_result", "report", "photo", "consent", "id_copy", "other")
ADMIN_CATEGORIES = {"consent", "id_copy"}          # paperwork reception handles
NEEDS_REVIEW = {"lab_result", "report"}            # a doctor must look before anything else happens
RELEASABLE = {"lab_result", "report", "photo", "other"}
ALWAYS_VISIBLE_TO_PATIENT = {"consent"}

SIGNATURES = (
    (b"%PDF-", "application/pdf", "pdf"),
    (b"\xff\xd8\xff", "image/jpeg", "jpg"),
    (b"\x89PNG\r\n\x1a\n", "image/png", "png"),
)

FILE_COLUMNS = """
    f.id, f.patient_id, f.category, f.title, f.original_name, f.mime, f.size_bytes, f.uploaded_at, f.review_status,
    f.reviewed_at, f.internal_note, f.released_at, f.patient_note, f.voided_at, f.void_reason,
    up.full_name_ar AS uploaded_by_ar, up.full_name_en AS uploaded_by_en,
    rv.full_name_ar AS reviewed_by_ar, rv.full_name_en AS reviewed_by_en,
    rl.full_name_ar AS released_by_ar, rl.full_name_en AS released_by_en
"""
FILE_JOINS = """
    JOIN users up ON up.id = f.uploaded_by
    LEFT JOIN users rv ON rv.id = f.reviewed_by
    LEFT JOIN users rl ON rl.id = f.released_by
"""


def can_view(ctx: Ctx, category: str) -> bool:
    if "patient_files.view_clinical" in ctx.permissions:
        return True
    return category in ADMIN_CATEGORIES and "patient_files.view_admin" in ctx.permissions


def can_upload(ctx: Ctx, category: str) -> bool:
    needed = "patient_files.upload_admin" if category in ADMIN_CATEGORIES else "patient_files.upload_clinical"
    return needed in ctx.permissions


def _storage_path(key: str) -> Path:
    root = Path(settings.files_dir).resolve()
    path = (root / key).resolve()
    if root not in path.parents:
        raise AppError(400, "invalid_path")
    return path


def store(conn: psycopg.Connection, ctx: Ctx, patient_id, category: str, title: str, filename: str, data: bytes) -> dict:
    if category not in CATEGORIES:
        raise field_error("category", "invalid")
    if not can_upload(ctx, category):
        raise AppError(403, "forbidden")
    title = " ".join((title or "").split())
    if not 2 <= len(title) <= 120:
        raise field_error("title", "required")
    if not data:
        raise field_error("file", "required")
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise field_error("file", "too_large")
    kind = next(((mime, ext) for magic, mime, ext in SIGNATURES if data.startswith(magic)), None)
    if not kind:
        raise field_error("file", "unsupported_type")
    mime, ext = kind
    if not conn.execute("SELECT 1 FROM patients WHERE id = %s", (patient_id,)).fetchone():
        raise AppError(404, "patient_not_found")

    key = f"{patient_id}/{uuid.uuid4().hex}.{ext}"
    path = _storage_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    tmp.write_bytes(data)
    os.replace(tmp, path)
    try:
        row = conn.execute(
            """
            INSERT INTO patient_files (patient_id, category, title, original_name, mime, size_bytes, sha256, storage_key,
                                       branch_id, uploaded_by, review_status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """,
            (patient_id, category, title, (filename or f"document.{ext}")[:200], mime, len(data),
             hashlib.sha256(data).hexdigest(), key, ctx.active_branch_id, ctx.user_id,
             "pending" if category in NEEDS_REVIEW else "not_needed"),
        ).fetchone()
    except Exception:
        path.unlink(missing_ok=True)
        raise
    audit.record(conn, "patient_file.uploaded", ctx=ctx, entity="patient_file", entity_id=row["id"], details={
        "patient_id": str(patient_id), "category": category, "title": title, "size": len(data),
    })
    return {"id": row["id"]}


def list_for_staff(conn: psycopg.Connection, ctx: Ctx, patient_id) -> dict:
    rows = conn.execute(
        f"SELECT {FILE_COLUMNS} FROM patient_files f {FILE_JOINS} WHERE f.patient_id = %s ORDER BY f.uploaded_at DESC",
        (patient_id,),
    ).fetchall()
    visible = [r for r in rows if can_view(ctx, r["category"])]
    hidden = sum(1 for r in rows if not can_view(ctx, r["category"]) and not r["voided_at"])
    return {"items": visible, "hidden": hidden}


def _get_file(conn: psycopg.Connection, patient_id, file_id) -> dict:
    row = conn.execute(
        "SELECT * FROM patient_files WHERE id = %s AND patient_id = %s FOR UPDATE", (file_id, patient_id),
    ).fetchone()
    if not row:
        raise AppError(404, "file_not_found")
    return row


def open_for_staff(conn: psycopg.Connection, ctx: Ctx, patient_id, file_id) -> tuple[Path, dict]:
    row = _get_file(conn, patient_id, file_id)
    if not can_view(ctx, row["category"]):
        raise AppError(403, "forbidden")
    path = _storage_path(row["storage_key"])
    if not path.exists():
        raise AppError(410, "file_missing")
    audit.record(conn, "patient_file.opened", ctx=ctx, entity="patient_file", entity_id=file_id,
                 details={"patient_id": str(patient_id), "category": row["category"], "title": row["title"]})
    return path, row


def review(conn: psycopg.Connection, ctx: Ctx, patient_id, file_id, body: ReviewIn) -> None:
    row = _get_file(conn, patient_id, file_id)
    if row["voided_at"]:
        raise AppError(409, "file_voided")
    internal_note = (body.internal_note or "").strip() or None
    if body.decision == "release":
        if row["category"] not in RELEASABLE:
            raise AppError(409, "not_releasable")
        if row["released_at"]:
            raise AppError(409, "already_released")
        note = (body.patient_note or "").strip()
        if len(note) < 5:
            raise field_error("patient_note", "required")
        conn.execute(
            """
            UPDATE patient_files SET review_status = CASE WHEN review_status = 'pending' THEN 'reviewed' ELSE review_status END,
                   reviewed_by = COALESCE(reviewed_by, %(uid)s), reviewed_at = COALESCE(reviewed_at, now()),
                   internal_note = COALESCE(%(internal)s, internal_note),
                   released_at = now(), released_by = %(uid)s, patient_note = %(note)s
            WHERE id = %(id)s
            """,
            {"uid": ctx.user_id, "internal": internal_note, "note": note, "id": file_id},
        )
        audit.record(conn, "patient_file.released", ctx=ctx, entity="patient_file", entity_id=file_id,
                     details={"patient_id": str(patient_id), "title": row["title"], "patient_note": note})
    else:
        if row["review_status"] != "pending":
            raise AppError(409, "nothing_to_review")
        conn.execute(
            "UPDATE patient_files SET review_status = 'reviewed', reviewed_by = %s, reviewed_at = now(), internal_note = %s WHERE id = %s",
            (ctx.user_id, internal_note, file_id),
        )
        audit.record(conn, "patient_file.reviewed", ctx=ctx, entity="patient_file", entity_id=file_id,
                     details={"patient_id": str(patient_id), "title": row["title"], "kept_internal": True})


def void(conn: psycopg.Connection, ctx: Ctx, patient_id, file_id, reason: str) -> None:
    row = _get_file(conn, patient_id, file_id)
    if not can_upload(ctx, row["category"]):
        raise AppError(403, "forbidden")
    if row["voided_at"]:
        return
    conn.execute(
        "UPDATE patient_files SET voided_at = now(), voided_by = %s, void_reason = %s WHERE id = %s",
        (ctx.user_id, reason.strip(), file_id),
    )
    audit.record(conn, "patient_file.voided", ctx=ctx, entity="patient_file", entity_id=file_id,
                 details={"patient_id": str(patient_id), "title": row["title"], "reason": reason.strip(),
                          "was_released": row["released_at"] is not None})


def review_queue(conn: psycopg.Connection) -> list[dict]:
    return conn.execute(
        f"""
        SELECT {FILE_COLUMNS}, p.mrn, p.full_name_ar, p.full_name_en, p.date_of_birth, p.gender
        FROM patient_files f {FILE_JOINS} JOIN patients p ON p.id = f.patient_id
        WHERE f.review_status = 'pending' AND f.voided_at IS NULL
        ORDER BY f.uploaded_at
        LIMIT 200
        """
    ).fetchall()


# ---------- patient portal ----------

def _patient_visible_clause() -> str:
    return "f.voided_at IS NULL AND (f.released_at IS NOT NULL OR f.category = 'consent')"


def list_for_patient(conn: psycopg.Connection, patient_ids: list) -> list[dict]:
    if not patient_ids:
        return []
    return conn.execute(
        f"""
        SELECT f.id, f.patient_id, f.category, f.title, f.mime, f.size_bytes, f.uploaded_at, f.released_at, f.patient_note,
               rl.full_name_ar AS released_by_ar, rl.full_name_en AS released_by_en,
               p.full_name_ar AS patient_name_ar, p.full_name_en AS patient_name_en
        FROM patient_files f
        JOIN patients p ON p.id = f.patient_id
        LEFT JOIN users rl ON rl.id = f.released_by
        WHERE f.patient_id = ANY(%s) AND {_patient_visible_clause()}
        ORDER BY COALESCE(f.released_at, f.uploaded_at) DESC
        """,
        (patient_ids,),
    ).fetchall()


def open_for_patient(conn: psycopg.Connection, ctx: Ctx, patient_ids: list, file_id) -> tuple[Path, dict]:
    row = conn.execute(
        f"SELECT f.* FROM patient_files f WHERE f.id = %s AND f.patient_id = ANY(%s) AND {_patient_visible_clause()}",
        (file_id, patient_ids),
    ).fetchone()
    if not row:
        raise AppError(404, "file_not_found")
    path = _storage_path(row["storage_key"])
    if not path.exists():
        raise AppError(410, "file_missing")
    audit.record(conn, "patient_file.opened_by_patient", ctx=ctx, entity="patient_file", entity_id=file_id,
                 details={"patient_id": str(row["patient_id"]), "title": row["title"]})
    return path, row
