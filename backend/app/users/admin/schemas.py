from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class RoleAssignment(BaseModel):
    role: str = Field(min_length=2, max_length=40)
    branch_id: int | None = None


class StaffCreate(BaseModel):
    full_name_ar: str = Field(min_length=2, max_length=120)
    full_name_en: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    phone: str | None = Field(default=None, max_length=30)
    roles: list[RoleAssignment] = Field(min_length=1, max_length=10)


class StaffUpdate(BaseModel):
    full_name_ar: str = Field(min_length=2, max_length=120)
    full_name_en: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    phone: str | None = Field(default=None, max_length=30)


class RolesSet(BaseModel):
    roles: list[RoleAssignment] = Field(min_length=1, max_length=10)


class ReasonIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


class RoleUpdate(BaseModel):
    requires_mfa: bool


class PermissionsSet(BaseModel):
    permissions: list[str] = Field(max_length=200)


class BranchIn(BaseModel):
    code: str = Field(min_length=2, max_length=6)
    name_ar: str = Field(min_length=2, max_length=120)
    name_en: str = Field(min_length=2, max_length=120)
    address_ar: str | None = Field(default=None, max_length=300)
    address_en: str | None = Field(default=None, max_length=300)
    phone: str | None = Field(default=None, max_length=30)
    whatsapp: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=200)
    hours_ar: str | None = Field(default=None, max_length=200)
    hours_en: str | None = Field(default=None, max_length=200)
    is_active: bool = True


class DelegationIn(BaseModel):
    from_user_id: UUID
    to_user_id: UUID
    role: str = Field(min_length=2, max_length=40)
    branch_id: int | None = None
    starts_at: datetime
    ends_at: datetime
    reason: str = Field(min_length=5, max_length=300)
