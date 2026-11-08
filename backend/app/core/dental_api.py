"""Dental endpoints (/api/<role>/dental/...): the tooth chart, treatment plans and lab cases.
dental.chart and dental.plans for the doctor; dental.plans_view for staff who show plans to patients and record
their acceptance; dental.lab for whoever tracks lab work; the lab list is kept with clinical_lists.manage."""
from typing import Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends

from app.core import dental
from app.core.clinical_schemas import (
    AcceptIn, ChartEntryIn, ItemDoneIn, LabCaseEditIn, LabCaseIn, LabIn, LabMoveIn, PlanEditIn, PlanIn, PlanItemIn, QuoteIn,
    ReasonIn, VoidIn,
)
from app.core.session import Ctx, require_permission
from app.core.visits_api import require_any
from app.storage.db import get_conn

router = APIRouter(prefix="/dental", tags=["dental"])
Conn = psycopg.Connection

can_chart_read = require_any("dental.chart", "dental.plans", "visits.view_all")
can_chart = require_permission("dental.chart")
can_plans_read = require_any("dental.plans", "dental.plans_view", "visits.view_all")
can_plans = require_permission("dental.plans")
can_lab = require_any("dental.lab", "visits.view_all")
can_lab_write = require_permission("dental.lab")
can_lab_list = require_permission("clinical_lists.manage")


# --- tooth chart ---

@router.get("/chart/{patient_id}")
def chart(patient_id: UUID, ctx: Ctx = Depends(can_chart_read), conn: Conn = Depends(get_conn)):
    return dental.chart(conn, ctx, patient_id)


@router.post("/chart/{patient_id}", status_code=201)
def add_entry(patient_id: UUID, body: ChartEntryIn, ctx: Ctx = Depends(can_chart), conn: Conn = Depends(get_conn)):
    dental.add_entry(conn, ctx, patient_id, body)
    return dental.chart(conn, ctx, patient_id)


@router.post("/chart/{patient_id}/{entry_id}/void")
def void_entry(patient_id: UUID, entry_id: int, body: VoidIn, ctx: Ctx = Depends(can_chart), conn: Conn = Depends(get_conn)):
    dental.void_entry(conn, ctx, patient_id, entry_id, body.reason)
    return dental.chart(conn, ctx, patient_id)


# --- treatment plans ---

@router.get("/plans")
def plans(state: str | None = None, q: str | None = None, mine: bool = False,
          ctx: Ctx = Depends(can_plans_read), conn: Conn = Depends(get_conn)):
    return dental.plan_list(conn, ctx, state=state, q=q, mine=mine)


@router.get("/plans/patient/{patient_id}")
def patient_plans(patient_id: UUID, ctx: Ctx = Depends(can_plans_read), conn: Conn = Depends(get_conn)):
    return dental.plans_for_patient(conn, ctx, patient_id)


@router.post("/plans", status_code=201)
def create_plan(body: PlanIn, ctx: Ctx = Depends(can_plans), conn: Conn = Depends(get_conn)):
    return dental.create_plan(conn, ctx, body)


@router.get("/plans/{plan_id}")
def plan(plan_id: UUID, ctx: Ctx = Depends(can_plans_read), conn: Conn = Depends(get_conn)):
    return dental.plan_detail(conn, ctx, plan_id)


@router.put("/plans/{plan_id}")
def edit_plan(plan_id: UUID, body: PlanEditIn, ctx: Ctx = Depends(can_plans), conn: Conn = Depends(get_conn)):
    dental.edit_plan(conn, ctx, plan_id, body)
    return dental.plan_detail(conn, ctx, plan_id)


@router.post("/plans/{plan_id}/items", status_code=201)
def add_item(plan_id: UUID, body: PlanItemIn, ctx: Ctx = Depends(can_plans), conn: Conn = Depends(get_conn)):
    dental.add_item(conn, ctx, plan_id, body)
    return dental.plan_detail(conn, ctx, plan_id)


@router.delete("/plans/{plan_id}/items/{item_id}")
def remove_item(plan_id: UUID, item_id: int, ctx: Ctx = Depends(can_plans), conn: Conn = Depends(get_conn)):
    dental.remove_item(conn, ctx, plan_id, item_id)
    return dental.plan_detail(conn, ctx, plan_id)


@router.post("/plans/{plan_id}/quote")
def quote(plan_id: UUID, body: QuoteIn, ctx: Ctx = Depends(can_plans), conn: Conn = Depends(get_conn)):
    dental.quote(conn, ctx, plan_id, body.valid_days)
    return dental.plan_detail(conn, ctx, plan_id)


@router.post("/plans/{plan_id}/revise")
def revise(plan_id: UUID, ctx: Ctx = Depends(can_plans), conn: Conn = Depends(get_conn)):
    dental.revise(conn, ctx, plan_id)
    return dental.plan_detail(conn, ctx, plan_id)


@router.post("/plans/{plan_id}/accept")
def accept(plan_id: UUID, body: AcceptIn, ctx: Ctx = Depends(can_plans_read), conn: Conn = Depends(get_conn)):
    dental.accept(conn, plan_id, ctx=ctx, via="clinic", signed_paper=body.signed_paper)
    return dental.plan_detail(conn, ctx, plan_id)


@router.post("/plans/{plan_id}/decline")
def decline(plan_id: UUID, body: ReasonIn, ctx: Ctx = Depends(can_plans_read), conn: Conn = Depends(get_conn)):
    dental.decline(conn, plan_id, body.reason, ctx=ctx, via="clinic")
    return dental.plan_detail(conn, ctx, plan_id)


@router.post("/plans/{plan_id}/cancel")
def cancel(plan_id: UUID, body: ReasonIn, ctx: Ctx = Depends(can_plans), conn: Conn = Depends(get_conn)):
    dental.cancel_plan(conn, ctx, plan_id, body.reason)
    return dental.plan_detail(conn, ctx, plan_id)


@router.post("/plans/{plan_id}/items/{item_id}/done")
def item_done(plan_id: UUID, item_id: int, body: ItemDoneIn, ctx: Ctx = Depends(can_plans), conn: Conn = Depends(get_conn)):
    dental.item_done(conn, ctx, plan_id, item_id, body.visit_id, body.note)
    return dental.plan_detail(conn, ctx, plan_id)


@router.post("/plans/{plan_id}/items/{item_id}/cancel")
def item_cancel(plan_id: UUID, item_id: int, body: ReasonIn, ctx: Ctx = Depends(can_plans), conn: Conn = Depends(get_conn)):
    dental.item_cancel(conn, ctx, plan_id, item_id, body.reason)
    return dental.plan_detail(conn, ctx, plan_id)


# --- labs & lab cases ---

@router.get("/labs")
def labs(all: bool = False, ctx: Ctx = Depends(require_any("dental.lab", "clinical_lists.manage", "visits.view_all")),
         conn: Conn = Depends(get_conn)):
    return dental.labs(conn, include_inactive=all)


@router.post("/labs", status_code=201)
def add_lab(body: LabIn, ctx: Ctx = Depends(can_lab_list), conn: Conn = Depends(get_conn)):
    return dental.save_lab(conn, ctx, body)


@router.put("/labs/{lab_id}")
def edit_lab(lab_id: int, body: LabIn, ctx: Ctx = Depends(can_lab_list), conn: Conn = Depends(get_conn)):
    return dental.save_lab(conn, ctx, body, lab_id)


@router.get("/lab-cases")
def cases(state: Literal["open", "overdue", "ready", "ordered", "sent", "returned", "remake", "delivered", "cancelled"] | None = None,
          lab_id: int | None = None, q: str | None = None, patient_id: UUID | None = None,
          ctx: Ctx = Depends(can_lab), conn: Conn = Depends(get_conn)):
    return dental.case_list(conn, ctx, state=state, lab_id=lab_id, q=q, patient_id=patient_id)


@router.post("/lab-cases", status_code=201)
def create_case(body: LabCaseIn, ctx: Ctx = Depends(can_lab_write), conn: Conn = Depends(get_conn)):
    row = dental.create_case(conn, ctx, body)
    return dental.case_detail(conn, ctx, row["id"])


@router.get("/lab-cases/{case_id}")
def case(case_id: UUID, ctx: Ctx = Depends(can_lab), conn: Conn = Depends(get_conn)):
    return dental.case_detail(conn, ctx, case_id)


@router.put("/lab-cases/{case_id}")
def edit_case(case_id: UUID, body: LabCaseEditIn, ctx: Ctx = Depends(can_lab_write), conn: Conn = Depends(get_conn)):
    dental.edit_case(conn, ctx, case_id, body)
    return dental.case_detail(conn, ctx, case_id)


@router.post("/lab-cases/{case_id}/move")
def move_case(case_id: UUID, body: LabMoveIn, ctx: Ctx = Depends(can_lab_write), conn: Conn = Depends(get_conn)):
    dental.move_case(conn, ctx, case_id, body)
    return dental.case_detail(conn, ctx, case_id)
