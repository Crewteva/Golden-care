from datetime import date, datetime, time
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

Source = Literal["walk_in", "phone", "whatsapp", "social", "website", "portal", "other"]


class WhenIn(BaseModel):
    # either an exact free slot (starts_at, as offered by /slots) or, for squeeze-ins, a clinic-local date + time
    starts_at: datetime | None = None
    local_date: date | None = None
    local_time: time | None = None
    overbook_reason: str | None = Field(default=None, max_length=300)


class BookIn(WhenIn):
    patient_id: UUID
    service_ids: list[int] = Field(min_length=1, max_length=5)
    doctor_id: UUID
    source: Source = "walk_in"
    notes: str | None = Field(default=None, max_length=500)


class RescheduleIn(WhenIn):
    doctor_id: UUID | None = None


class CancelIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)
    by: Literal["patient", "clinic"] = "clinic"


class NotesIn(BaseModel):
    notes: str | None = Field(default=None, max_length=500)


class PortalBookIn(BaseModel):
    patient_id: UUID
    service_id: int
    doctor_id: UUID
    starts_at: datetime


class PortalCancelIn(BaseModel):
    reason: str | None = Field(default=None, max_length=300)


class BookingRulesIn(BaseModel):
    slot_step_min: Literal[5, 10, 15, 20, 30]
    late_after_min: int = Field(ge=0, le=120)
    portal_enabled: bool
    portal_needs_confirmation: bool
    portal_cancel_hours: int = Field(ge=0, le=168)
    portal_days_ahead: int = Field(ge=1, le=180)
    portal_max_upcoming: int = Field(ge=1, le=20)
