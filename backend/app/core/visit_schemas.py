"""What the visit endpoints accept."""
from typing import Literal

from pydantic import BaseModel, Field

Text = str | None


class DiagnosisIn(BaseModel):
    diagnosis_id: int | None = None
    text: str | None = Field(None, max_length=300)


class VisitNoteIn(BaseModel):
    complaint: Text = Field(None, max_length=4000)
    history: Text = Field(None, max_length=8000)
    examination: Text = Field(None, max_length=8000)
    diagnoses: list[DiagnosisIn] = Field(default_factory=list, max_length=8)
    plan: Text = Field(None, max_length=8000)
    follow_up_days: int | None = Field(None, ge=1, le=365)
    follow_up_note: Text = Field(None, max_length=300)
    patient_summary: Text = Field(None, max_length=3000)


class RxItemIn(BaseModel):
    drug_id: int
    dose: str = Field(min_length=1, max_length=120)
    frequency: str = Field(min_length=1, max_length=120)
    duration: str = Field(min_length=1, max_length=120)
    instructions: Text = Field(None, max_length=300)
    restricted_reason: Text = Field(None, max_length=300)
    allergy_reason: Text = Field(None, max_length=300)


class RxIn(BaseModel):
    items: list[RxItemIn] = Field(default_factory=list, max_length=15)


class ReleaseIn(BaseModel):
    patient_summary: str = Field(min_length=1, max_length=3000)


class AddendumIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class VitalsIn(BaseModel):
    appointment_id: str | None = None
    patient_id: str | None = None
    bp_systolic: int | None = Field(None, ge=50, le=260)
    bp_diastolic: int | None = Field(None, ge=30, le=160)
    pulse: int | None = Field(None, ge=25, le=250)
    temperature: float | None = Field(None, ge=33, le=43)
    resp_rate: int | None = Field(None, ge=5, le=60)
    spo2: int | None = Field(None, ge=50, le=100)
    weight_kg: float | None = Field(None, ge=0.5, le=350)
    height_cm: float | None = Field(None, ge=30, le=250)
    note: Text = Field(None, max_length=300)


class DrugIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    generic_name: str = Field(min_length=2, max_length=200)
    form: Literal['tablet', 'capsule', 'syrup', 'suspension', 'drops', 'cream', 'gel', 'ointment', 'lotion', 'solution',
                  'shampoo', 'spray', 'mouthwash', 'injection', 'vaginal', 'sachet', 'other']
    strength: Text = Field(None, max_length=60)
    default_dose: Text = Field(None, max_length=120)
    default_frequency: Text = Field(None, max_length=120)
    default_duration: Text = Field(None, max_length=120)
    restricted: bool = False
    allergy_tags: list[str] = Field(default_factory=list, max_length=12)
    is_active: bool = True


class DiagnosisListIn(BaseModel):
    specialty_id: int | None = None
    code: Text = Field(None, max_length=12)
    name_ar: str = Field(min_length=2, max_length=200)
    name_en: str = Field(min_length=2, max_length=200)
    is_active: bool = True
    sort_order: int = 0
