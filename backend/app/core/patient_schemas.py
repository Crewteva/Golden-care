from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

Relationship = Literal["parent", "child", "spouse", "sibling", "other"]


class FamilyLinkIn(BaseModel):
    relative_id: UUID
    # what the relative is to this patient, e.g. "parent"
    relationship: Relationship
    # the relative manages this patient's file (a parent for a child)
    is_guardian: bool = False


class PatientIn(BaseModel):
    full_name_ar: str = Field(min_length=2, max_length=120)
    full_name_en: str | None = Field(default=None, max_length=120)
    date_of_birth: date
    gender: Literal["female", "male"]
    phone: str | None = Field(default=None, max_length=30)
    phone2: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=200)
    national_id: str | None = Field(default=None, max_length=30)
    passport_no: str | None = Field(default=None, max_length=30)
    nationality: str = Field(default="EG", min_length=2, max_length=40)
    address: str | None = Field(default=None, max_length=300)
    area: str | None = Field(default=None, max_length=80)
    emergency_name: str | None = Field(default=None, max_length=120)
    emergency_relation: str | None = Field(default=None, max_length=60)
    emergency_phone: str | None = Field(default=None, max_length=30)
    consent_messages: bool = False


class PatientCreate(PatientIn):
    family_link: FamilyLinkIn | None = None
    # required to save when the system found possible duplicates
    duplicate_reason: str | None = Field(default=None, max_length=300)


class PatientUpdate(PatientIn):
    # required when changing name, birth date, sex or national ID
    change_reason: str | None = Field(default=None, max_length=300)


class DuplicateCheckIn(BaseModel):
    full_name_ar: str = Field(default="", max_length=120)
    full_name_en: str | None = Field(default=None, max_length=120)
    date_of_birth: date | None = None
    phone: str | None = Field(default=None, max_length=30)
    national_id: str | None = Field(default=None, max_length=30)
    exclude_id: UUID | None = None


class AlertIn(BaseModel):
    kind: Literal["allergy", "chronic", "medication", "pregnancy", "implant", "other"]
    description: str = Field(min_length=2, max_length=300)
    severity: Literal["info", "warning", "critical"] = "warning"


class ReasonIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


class ReviewIn(BaseModel):
    decision: Literal["release", "internal"]
    patient_note: str | None = Field(default=None, max_length=600)
    internal_note: str | None = Field(default=None, max_length=1000)
