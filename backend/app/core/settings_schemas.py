from datetime import date, time
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class SpecialtyIn(BaseModel):
    name_ar: str = Field(min_length=2, max_length=80)
    name_en: str = Field(min_length=2, max_length=80)
    color: str = Field(default="#1A433C", pattern=r"^#[0-9A-Fa-f]{6}$")
    sort_order: int = Field(default=0, ge=0, le=999)
    is_active: bool = True


class RoomTypeIn(BaseModel):
    name_ar: str = Field(min_length=2, max_length=80)
    name_en: str = Field(min_length=2, max_length=80)


class FirstPriceIn(BaseModel):
    amount: Decimal = Field(ge=0, le=1_000_000, decimal_places=2)
    starts_on: date | None = None


class ServiceIn(BaseModel):
    specialty_id: int
    code: str = Field(min_length=2, max_length=20)
    name_ar: str = Field(min_length=2, max_length=120)
    name_en: str = Field(min_length=2, max_length=120)
    duration_min: int = Field(ge=5, le=480)
    room_type_id: int | None = None
    is_active: bool = True
    sort_order: int = Field(default=0, ge=0, le=999)
    # which clinical record the service needs, and (dental) what the tooth chart shows once it's done
    clinical_record: Literal["laser", "dental"] | None = None
    dental_result: Literal["filling", "crown", "root_canal", "extracted", "implant", "bridge", "sealant", "veneer"] | None = None
    # only used when creating: the service's first standard price
    price: FirstPriceIn | None = None


class PriceIn(BaseModel):
    doctor_id: UUID | None = None
    amount: Decimal = Field(ge=0, le=1_000_000, decimal_places=2)
    starts_on: date
    note: str | None = Field(default=None, max_length=200)


class RoomIn(BaseModel):
    branch_id: int
    room_type_id: int | None = None
    name_ar: str = Field(min_length=1, max_length=80)
    name_en: str = Field(min_length=1, max_length=80)
    notes: str | None = Field(default=None, max_length=300)
    is_active: bool = True
    sort_order: int = Field(default=0, ge=0, le=999)


class DoctorProfileIn(BaseModel):
    specialty_id: int | None = None
    title_ar: str | None = Field(default=None, max_length=120)
    title_en: str | None = Field(default=None, max_length=120)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")


class DoctorServicesIn(BaseModel):
    service_ids: list[int] = Field(max_length=500)


class ScheduleIn(BaseModel):
    branch_id: int
    weekday: int = Field(ge=0, le=6)
    start_time: time
    end_time: time
    room_id: int | None = None
    valid_from: date | None = None
    valid_to: date | None = None


class LeaveIn(BaseModel):
    doctor_id: UUID
    starts_on: date
    ends_on: date
    reason: str | None = Field(default=None, max_length=200)


class HolidayIn(BaseModel):
    branch_id: int | None = None
    on_date: date
    name_ar: str = Field(min_length=2, max_length=120)
    name_en: str = Field(min_length=2, max_length=120)
