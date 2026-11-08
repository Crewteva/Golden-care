"""Complaints & requests desk endpoints (/api/<role>/complaints/...)."""
from typing import Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends

from app.core import complaints
from app.core.clinical_schemas import TicketIn, TicketUpdateIn
from app.core.session import Ctx
from app.core.visits_api import require_any
from app.storage.db import get_conn

router = APIRouter(prefix="/complaints", tags=["complaints"])
Conn = psycopg.Connection

can_desk = require_any("complaints.create", "complaints.manage")


@router.get("")
def listing(state: Literal["open", "mine", "overdue", "unassigned", "done"] | None = None,
            kind: Literal["complaint", "request", "suggestion", "compliment"] | None = None, q: str | None = None,
            ctx: Ctx = Depends(can_desk), conn: Conn = Depends(get_conn)):
    return complaints.listing(conn, ctx, state=state, kind=kind, q=q)


@router.get("/staff")
def staff(_: Ctx = Depends(can_desk), conn: Conn = Depends(get_conn)):
    return complaints.staff_options(conn)


@router.post("", status_code=201)
def create(body: TicketIn, ctx: Ctx = Depends(can_desk), conn: Conn = Depends(get_conn)):
    row = complaints.create(conn, ctx, body)
    return complaints.detail(conn, ctx, row["id"])


@router.get("/{ticket_id}")
def detail(ticket_id: UUID, ctx: Ctx = Depends(can_desk), conn: Conn = Depends(get_conn)):
    return complaints.detail(conn, ctx, ticket_id)


@router.patch("/{ticket_id}")
def update(ticket_id: UUID, body: TicketUpdateIn, ctx: Ctx = Depends(can_desk), conn: Conn = Depends(get_conn)):
    complaints.update(conn, ctx, ticket_id, body)
    return complaints.detail(conn, ctx, ticket_id)
