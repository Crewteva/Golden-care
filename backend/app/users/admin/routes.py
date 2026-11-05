"""/api/admin: everything the system admin's dashboard needs. Only the admin role can call it,
and each action also needs its permission (admins can be given read-only access, for example)."""
from datetime import date
from typing import Literal
from uuid import UUID

import psycopg
from fastapi import Depends, Query

from app.core import audit
from app.core.session import Ctx, require_permission
from app.core.workspace import role_router
from app.storage.db import get_conn
from app.users.admin import service
from app.users.admin.schemas import (
    BranchIn, DelegationIn, PermissionsSet, ReasonIn, RoleUpdate, RolesSet, StaffCreate, StaffUpdate,
)

router = role_router("admin")

can_view = require_permission("users.view")
can_manage = require_permission("users.manage")
can_roles = require_permission("roles.manage")
can_branches = require_permission("branches.manage")
can_cover = require_permission("delegations.manage")
can_resets = require_permission("password_resets.manage")
can_audit = require_permission("audit.view")


@router.get("/overview")
def overview(_: Ctx = Depends(can_view), conn: psycopg.Connection = Depends(get_conn)):
    return service.overview(conn)


# --- staff accounts ---

@router.get("/users")
def list_users(
    q: str | None = None,
    role: str | None = None,
    branch_id: int | None = None,
    status: Literal["active", "inactive", "locked", "mfa_pending"] | None = None,
    sort: str = "name_ar",
    direction: Literal["asc", "desc"] = "asc",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=5, le=100),
    _: Ctx = Depends(can_view),
    conn: psycopg.Connection = Depends(get_conn),
):
    return service.list_staff(conn, q=q, role=role, branch_id=branch_id, status=status, sort=sort,
                              direction=direction, page=page, page_size=page_size)


@router.get("/staff-options")
def staff_options(_: Ctx = Depends(can_view), conn: psycopg.Connection = Depends(get_conn)):
    return service.staff_options(conn)


@router.post("/users", status_code=201)
def create_user(body: StaffCreate, ctx: Ctx = Depends(can_manage), conn: psycopg.Connection = Depends(get_conn)):
    return service.create_staff(conn, ctx, body)


@router.get("/users/{user_id}")
def get_user(user_id: UUID, _: Ctx = Depends(can_view), conn: psycopg.Connection = Depends(get_conn)):
    return service.get_staff(conn, user_id)


@router.put("/users/{user_id}")
def update_user(user_id: UUID, body: StaffUpdate, ctx: Ctx = Depends(can_manage), conn: psycopg.Connection = Depends(get_conn)):
    service.update_staff(conn, ctx, user_id, body)
    return service.get_staff(conn, user_id)


@router.put("/users/{user_id}/roles")
def set_user_roles(user_id: UUID, body: RolesSet, ctx: Ctx = Depends(can_manage), conn: psycopg.Connection = Depends(get_conn)):
    service.set_roles(conn, ctx, user_id, body.roles)
    return service.get_staff(conn, user_id)


@router.post("/users/{user_id}/deactivate")
def deactivate_user(user_id: UUID, body: ReasonIn, ctx: Ctx = Depends(can_manage), conn: psycopg.Connection = Depends(get_conn)):
    service.deactivate(conn, ctx, user_id, body.reason)
    return service.get_staff(conn, user_id)


@router.post("/users/{user_id}/activate")
def activate_user(user_id: UUID, ctx: Ctx = Depends(can_manage), conn: psycopg.Connection = Depends(get_conn)):
    service.activate(conn, ctx, user_id)
    return service.get_staff(conn, user_id)


@router.post("/users/{user_id}/unlock")
def unlock_user(user_id: UUID, ctx: Ctx = Depends(can_manage), conn: psycopg.Connection = Depends(get_conn)):
    service.unlock(conn, ctx, user_id)
    return service.get_staff(conn, user_id)


@router.post("/users/{user_id}/reset-password")
def reset_password(user_id: UUID, ctx: Ctx = Depends(can_manage), conn: psycopg.Connection = Depends(get_conn)):
    return service.reset_password(conn, ctx, user_id)


@router.post("/users/{user_id}/reset-mfa")
def reset_mfa(user_id: UUID, ctx: Ctx = Depends(can_manage), conn: psycopg.Connection = Depends(get_conn)):
    service.reset_mfa(conn, ctx, user_id)
    return service.get_staff(conn, user_id)


@router.post("/users/{user_id}/sessions/{session_id}/end")
def end_session(user_id: UUID, session_id: UUID, ctx: Ctx = Depends(can_manage), conn: psycopg.Connection = Depends(get_conn)):
    service.end_session(conn, ctx, user_id, session_id)
    return service.get_staff(conn, user_id)


# --- roles & permissions ---

@router.get("/roles")
def list_roles(_: Ctx = Depends(can_view), conn: psycopg.Connection = Depends(get_conn)):
    return service.list_roles(conn)


@router.patch("/roles/{code}")
def update_role(code: str, body: RoleUpdate, ctx: Ctx = Depends(can_roles), conn: psycopg.Connection = Depends(get_conn)):
    service.update_role(conn, ctx, code, body.requires_mfa)
    return service.list_roles(conn)


@router.put("/roles/{code}/permissions")
def set_role_permissions(code: str, body: PermissionsSet, ctx: Ctx = Depends(can_roles), conn: psycopg.Connection = Depends(get_conn)):
    service.set_permissions(conn, ctx, code, body.permissions)
    return service.list_roles(conn)


# --- branches ---

@router.get("/branches")
def list_branches(_: Ctx = Depends(can_view), conn: psycopg.Connection = Depends(get_conn)):
    return service.list_branches(conn)


@router.post("/branches", status_code=201)
def create_branch(body: BranchIn, ctx: Ctx = Depends(can_branches), conn: psycopg.Connection = Depends(get_conn)):
    return service.create_branch(conn, ctx, body)


@router.put("/branches/{branch_id}")
def update_branch(branch_id: int, body: BranchIn, ctx: Ctx = Depends(can_branches), conn: psycopg.Connection = Depends(get_conn)):
    service.update_branch(conn, ctx, branch_id, body)
    return {"ok": True}


# --- temporary cover ---

@router.get("/delegations")
def list_delegations(status: Literal["active", "scheduled", "ended", "revoked"] | None = None,
                     _: Ctx = Depends(can_view), conn: psycopg.Connection = Depends(get_conn)):
    return service.list_delegations(conn, status)


@router.post("/delegations", status_code=201)
def create_delegation(body: DelegationIn, ctx: Ctx = Depends(can_cover), conn: psycopg.Connection = Depends(get_conn)):
    return service.create_delegation(conn, ctx, body)


@router.post("/delegations/{delegation_id}/revoke")
def revoke_delegation(delegation_id: int, ctx: Ctx = Depends(can_cover), conn: psycopg.Connection = Depends(get_conn)):
    service.revoke_delegation(conn, ctx, delegation_id)
    return {"ok": True}


# --- password reset requests ---

@router.get("/password-resets")
def list_resets(_: Ctx = Depends(can_resets), conn: psycopg.Connection = Depends(get_conn)):
    return service.list_reset_requests(conn)


@router.post("/password-resets/{request_id}/{action}")
def resolve_reset(request_id: int, action: Literal["reset", "dismiss"], ctx: Ctx = Depends(can_resets),
                  conn: psycopg.Connection = Depends(get_conn)):
    return service.resolve_reset_request(conn, ctx, request_id, action)


# --- activity log ---

@router.get("/activity")
def activity(
    q: str | None = None,
    category: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(1, ge=1),
    _: Ctx = Depends(can_audit),
    conn: psycopg.Connection = Depends(get_conn),
):
    return audit.search(conn, q=q, category=category, date_from=date_from, date_to=date_to, page=page)
