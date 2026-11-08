"""What the laser, dental and complaints endpoints accept."""
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

Text = str | None
Surface = Literal["M", "O", "D", "B", "L", "I"]
Result = Literal["filling", "crown", "root_canal", "extracted", "implant", "bridge", "sealant", "veneer"]


# ---------- laser ----------

class LaserAreaIn(BaseModel):
    area: str = Field(min_length=2, max_length=80)
    fluence: float | None = Field(None, gt=0, le=200)
    pulse_ms: float | None = Field(None, gt=0, le=1000)
    spot_mm: float | None = Field(None, gt=0, le=50)
    frequency_hz: float | None = Field(None, gt=0, le=50)
    pulses: int = Field(ge=0, le=100_000)
    reaction: Text = Field(None, max_length=200)


class LaserSessionIn(BaseModel):
    device_id: int | None = None
    session_no: int | None = Field(None, ge=1, le=60)
    skin_type: Literal["I", "II", "III", "IV", "V", "VI"] | None = None
    hair_color: Text = Field(None, max_length=40)
    checklist: dict[str, bool] = Field(default_factory=dict)
    checklist_override: Text = Field(None, max_length=500)
    counter_start: int | None = Field(None, ge=0)
    counter_end: int | None = Field(None, ge=0)
    test_pulses: int = Field(0, ge=0, le=10_000)
    counter_note: Text = Field(None, max_length=500)
    aftercare: Text = Field(None, max_length=1000)
    notes: Text = Field(None, max_length=2000)
    areas: list[LaserAreaIn] = Field(default_factory=list, max_length=20)


class DeviceIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    model: Text = Field(None, max_length=80)
    serial_no: Text = Field(None, max_length=60)
    room_id: int | None = None
    pulse_counter: int = Field(0, ge=0)
    is_active: bool = True


# ---------- dental ----------

class ChartEntryIn(BaseModel):
    tooth: int = Field(ge=11, le=85)
    surfaces: list[Surface] = Field(default_factory=list, max_length=6)
    condition: Literal["caries", "filling", "crown", "root_canal", "missing", "extracted", "implant", "bridge", "fracture",
                       "sealant", "veneer", "watch"]
    status: Literal["existing", "done"] = "existing"
    note: Text = Field(None, max_length=300)


class VoidIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


class PlanIn(BaseModel):
    patient_id: str
    title: str = Field(min_length=2, max_length=120)


class PlanEditIn(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    notes: Text = Field(None, max_length=2000)
    patient_note: Text = Field(None, max_length=2000)
    down_payment: float = Field(0, ge=0)
    installments_count: int = Field(0, ge=0, le=24)


class PlanItemIn(BaseModel):
    service_id: int
    tooth: int | None = Field(None, ge=11, le=85)
    surfaces: list[Surface] = Field(default_factory=list, max_length=6)
    phase: int = Field(1, ge=1, le=9)
    note: Text = Field(None, max_length=300)


class QuoteIn(BaseModel):
    valid_days: int = Field(30, ge=1, le=180)


class AcceptIn(BaseModel):
    signed_paper: bool = False     # staff: the patient signed the printed quotation


class ReasonIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


class ItemDoneIn(BaseModel):
    visit_id: str | None = None
    note: Text = Field(None, max_length=300)


class LabIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    contact_name: Text = Field(None, max_length=80)
    phone: Text = Field(None, max_length=30)
    address: Text = Field(None, max_length=200)
    is_active: bool = True


WorkType = Literal["zirconia_crown", "pfm_crown", "emax_crown", "bridge", "veneer", "implant_crown", "full_denture",
                   "partial_denture", "night_guard", "retainer", "other"]


class LabCaseIn(BaseModel):
    patient_id: str
    doctor_id: str | None = None     # staff other than the doctor must say which doctor ordered it
    lab_id: int
    work_type: WorkType
    teeth: Text = Field(None, max_length=60)
    shade: Text = Field(None, max_length=20)
    instructions: Text = Field(None, max_length=1000)
    due_on: date | None = None
    lab_cost: float | None = Field(None, ge=0, le=1_000_000)
    doctor_share_pct: float = Field(0, ge=0, le=100)
    plan_item_id: int | None = None


class LabCaseEditIn(BaseModel):
    lab_id: int
    work_type: WorkType
    teeth: Text = Field(None, max_length=60)
    shade: Text = Field(None, max_length=20)
    instructions: Text = Field(None, max_length=1000)
    due_on: date | None = None
    lab_cost: float | None = Field(None, ge=0, le=1_000_000)
    doctor_share_pct: float = Field(0, ge=0, le=100)


class LabMoveIn(BaseModel):
    to: Literal["sent", "returned", "remake", "delivered", "cancelled"]
    note: Text = Field(None, max_length=300)
    due_on: date | None = None


# ---------- complaints ----------

Kind = Literal["complaint", "request", "suggestion", "compliment"]
Category = Literal["waiting", "staff", "doctor", "treatment", "billing", "booking", "cleanliness", "results", "other"]


class TicketIn(BaseModel):
    kind: Kind
    channel: Literal["in_person", "phone", "whatsapp", "website", "social", "other"]
    category: Category = "other"
    priority: Literal["low", "normal", "high", "urgent"] = "normal"
    patient_id: str | None = None
    contact_name: Text = Field(None, max_length=80)
    contact_phone: Text = Field(None, max_length=30)
    subject: str = Field(min_length=3, max_length=120)
    details: str = Field(min_length=5, max_length=3000)
    assigned_to: str | None = None


class TicketUpdateIn(BaseModel):
    status: Literal["open", "in_progress", "resolved", "closed"] | None = None
    priority: Literal["low", "normal", "high", "urgent"] | None = None
    assigned_to: str | None = None
    unassign: bool = False
    resolution: Text = Field(None, max_length=2000)
    comment: Text = Field(None, max_length=2000)


class PortalTicketIn(BaseModel):
    kind: Literal["complaint", "request", "suggestion", "compliment"]
    category: Category = "other"
    subject: str = Field(min_length=3, max_length=120)
    details: str = Field(min_length=5, max_length=3000)
