"""Visit endpoints shared by the clinical roles (/api/<role>/visits/...), plus the follow-ups list reception uses.
What each person may do is set by permissions: visits.write (own visits), visits.view_all, visits.vitals,
prescriptions.restricted, clinical_lists.manage."""
from typing import Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query

from app.core import clinical_lists, visits
from app.core.errors import AppError
from app.core.patients_api import guard
from app.core.session import Ctx, ready_ctx, require_permission
from app.core.visit_schemas import AddendumIn, DiagnosisListIn, DrugIn, ReleaseIn, RxIn, VisitNoteIn, VitalsIn
from app.storage.db import get_conn

router = APIRouter(prefix="/visits", tags=["visits"])
Conn = psycopg.Connection


def require_any(*codes: str):
    def dependency(ctx: Ctx = Depends(ready_ctx)) -> Ctx:
        if not any(c in ctx.permissions for c in codes):
            raise AppError(403, "forbidden", permission=codes[0])
        return ctx

    return dependency


can_clinical = require_any("visits.write", "visits.view_all")
can_write = require_permission("visits.write")
can_vitals = require_any("visits.vitals", "visits.write", "visits.view_all")
can_pick = require_any("visits.write", "clinical_lists.manage")
can_lists = require_permission("clinical_lists.manage")
can_follow_ups = require_permission("appointments.book")


@router.get("")
def listing(state: Literal["draft", "signed", "unreleased", "released"] | None = None, q: str | None = None,
            mine: bool = False, page: int = Query(1, ge=1), ctx: Ctx = Depends(can_clinical), conn: Conn = Depends(get_conn)):
    return visits.listing(conn, ctx, state=state, q=q, mine=mine, page=page)


@router.get("/follow-ups")
def follow_ups(_: Ctx = Depends(can_follow_ups), conn: Conn = Depends(get_conn)):
    return visits.follow_ups(conn)


# --- vital signs ---

@router.get("/vitals/today")
def vitals_today(_: Ctx = Depends(can_vitals), conn: Conn = Depends(get_conn)):
    return visits.vitals_today(conn)


@router.post("/vitals", status_code=201)
def record_vitals(body: VitalsIn, ctx: Ctx = Depends(require_permission("visits.vitals")), conn: Conn = Depends(get_conn)):
    if body.patient_id:
        guard(conn, ctx, body.patient_id)
    return visits.record_vitals(conn, ctx, body)


@router.get("/vitals/patient/{patient_id}")
def patient_vitals(patient_id: UUID, ctx: Ctx = Depends(can_vitals), conn: Conn = Depends(get_conn)):
    guard(conn, ctx, patient_id)
    return visits.vitals_for_patient(conn, patient_id)


# --- the drug and diagnosis lists ---

@router.get("/lists/drugs")
def drugs(q: str | None = None, patient_id: UUID | None = None, all: bool = False,
          ctx: Ctx = Depends(can_pick), conn: Conn = Depends(get_conn)):
    return clinical_lists.search_drugs(conn, q, patient_id, include_inactive=all and "clinical_lists.manage" in ctx.permissions,
                                       limit=400 if all else 30)


@router.post("/lists/drugs", status_code=201)
def add_drug(body: DrugIn, ctx: Ctx = Depends(can_lists), conn: Conn = Depends(get_conn)):
    return clinical_lists.save_drug(conn, ctx, body)


@router.put("/lists/drugs/{drug_id}")
def edit_drug(drug_id: int, body: DrugIn, ctx: Ctx = Depends(can_lists), conn: Conn = Depends(get_conn)):
    return clinical_lists.save_drug(conn, ctx, body, drug_id)


@router.delete("/lists/drugs/{drug_id}")
def delete_drug(drug_id: int, ctx: Ctx = Depends(can_lists), conn: Conn = Depends(get_conn)):
    clinical_lists.delete_drug(conn, ctx, drug_id)
    return {"ok": True}


@router.get("/lists/diagnoses")
def diagnoses(q: str | None = None, specialty_id: int | None = None, all: bool = False,
              ctx: Ctx = Depends(can_pick), conn: Conn = Depends(get_conn)):
    return clinical_lists.search_diagnoses(conn, q, specialty_id, include_inactive=all and "clinical_lists.manage" in ctx.permissions,
                                           limit=400 if all else 40)


@router.post("/lists/diagnoses", status_code=201)
def add_diagnosis(body: DiagnosisListIn, ctx: Ctx = Depends(can_lists), conn: Conn = Depends(get_conn)):
    return clinical_lists.save_diagnosis(conn, ctx, body)


@router.put("/lists/diagnoses/{diagnosis_id}")
def edit_diagnosis(diagnosis_id: int, body: DiagnosisListIn, ctx: Ctx = Depends(can_lists), conn: Conn = Depends(get_conn)):
    return clinical_lists.save_diagnosis(conn, ctx, body, diagnosis_id)


@router.delete("/lists/diagnoses/{diagnosis_id}")
def delete_diagnosis(diagnosis_id: int, ctx: Ctx = Depends(can_lists), conn: Conn = Depends(get_conn)):
    clinical_lists.delete_diagnosis(conn, ctx, diagnosis_id)
    return {"ok": True}


# --- visits ---

@router.get("/patient/{patient_id}")
def for_patient(patient_id: UUID, ctx: Ctx = Depends(can_clinical), conn: Conn = Depends(get_conn)):
    guard(conn, ctx, patient_id)
    return visits.for_patient(conn, ctx, patient_id)


@router.post("/start/{appointment_id}")
def start(appointment_id: UUID, ctx: Ctx = Depends(can_write), conn: Conn = Depends(get_conn)):
    return visits.start(conn, ctx, appointment_id)


@router.get("/{visit_id}")
def detail(visit_id: UUID, ctx: Ctx = Depends(can_clinical), conn: Conn = Depends(get_conn)):
    return visits.detail(conn, ctx, visit_id)


@router.put("/{visit_id}")
def save_note(visit_id: UUID, body: VisitNoteIn, ctx: Ctx = Depends(can_write), conn: Conn = Depends(get_conn)):
    visits.save_note(conn, ctx, visit_id, body)
    return {"ok": True}


@router.put("/{visit_id}/rx")
def save_rx(visit_id: UUID, body: RxIn, ctx: Ctx = Depends(can_write), conn: Conn = Depends(get_conn)):
    visits.save_rx(conn, ctx, visit_id, body)
    return {"rx": visits.rx_items(conn, visit_id)}


@router.post("/{visit_id}/sign")
def sign(visit_id: UUID, ctx: Ctx = Depends(can_write), conn: Conn = Depends(get_conn)):
    visits.sign(conn, ctx, visit_id)
    return visits.detail(conn, ctx, visit_id)


@router.post("/{visit_id}/release")
def release(visit_id: UUID, body: ReleaseIn, ctx: Ctx = Depends(can_write), conn: Conn = Depends(get_conn)):
    visits.release(conn, ctx, visit_id, body.patient_summary)
    return visits.detail(conn, ctx, visit_id)


@router.post("/{visit_id}/addenda", status_code=201)
def addendum(visit_id: UUID, body: AddendumIn, ctx: Ctx = Depends(can_clinical), conn: Conn = Depends(get_conn)):
    visits.add_addendum(conn, ctx, visit_id, body.body)
    return visits.detail(conn, ctx, visit_id)
