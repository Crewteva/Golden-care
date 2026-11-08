from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

Money = Decimal
PayMethod = Literal["cash", "card", "instapay", "wallet", "credit"]
RefundMethod = Literal["cash", "card", "instapay", "wallet"]


def money(le: int = 1_000_000, ge: int = 0, **kw):
    return Field(ge=ge, le=le, decimal_places=2, **kw)


class LineIn(BaseModel):
    kind: Literal["service", "package_sale", "package_use", "plan_item"]
    service_id: int | None = None
    package_id: int | None = None
    patient_package_id: UUID | None = None
    plan_item_id: int | None = None
    appointment_id: UUID | None = None
    doctor_id: UUID | None = None
    qty: int = Field(default=1, ge=1, le=100)


class InvoiceCreateIn(BaseModel):
    patient_id: UUID
    appointment_id: UUID | None = None


class InvoiceUpdateIn(BaseModel):
    lines: list[LineIn] = Field(max_length=60)
    discount_amount: Money = money(default=Decimal(0))
    discount_reason: str | None = Field(default=None, max_length=300)
    notes: str | None = Field(default=None, max_length=500)


class IssueIn(BaseModel):
    # 0 = paid in full now; otherwise the rest (after the down payment) is split into monthly installments
    installments: int = Field(default=0, ge=0, le=24)
    down_payment: Money = money(default=Decimal(0))
    first_due_on: date | None = None


class ReasonIn(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


class VoidIn(ReasonIn):
    # what was already paid goes to the patient's credit; with a method it's also given back (once approved)
    refund_method: RefundMethod | None = None


class PaymentLineIn(BaseModel):
    method: PayMethod
    amount: Money = Field(gt=0, le=1_000_000, decimal_places=2)
    reference: str | None = Field(default=None, max_length=80)


class PaymentIn(BaseModel):
    patient_id: UUID
    invoice_id: UUID | None = None          # empty = a deposit to the patient's credit
    payments: list[PaymentLineIn] = Field(min_length=1, max_length=5)
    note: str | None = Field(default=None, max_length=300)


class ShiftOpenIn(BaseModel):
    opening_float: Money = money(200_000)


class ShiftCloseIn(BaseModel):
    counted_cash: Money = money(5_000_000)
    difference_reason: str | None = Field(default=None, max_length=300)
    note: str | None = Field(default=None, max_length=300)


class RefundIn(BaseModel):
    patient_id: UUID
    amount: Money = Field(gt=0, le=1_000_000, decimal_places=2)
    method: RefundMethod
    reason: str = Field(min_length=5, max_length=500)


class RefundPayIn(BaseModel):
    reference: str | None = Field(default=None, max_length=80)


class DecideIn(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=300)


class PackageCancelIn(ReasonIn):
    refund_method: RefundMethod | None = None


# ---------- setup (management) ----------

class PackageIn(BaseModel):
    service_id: int
    name_ar: str = Field(min_length=2, max_length=120)
    name_en: str = Field(min_length=2, max_length=120)
    sessions: int = Field(ge=1, le=100)
    price: Money = money()
    valid_days: int | None = Field(default=None, ge=7, le=1825)
    notes: str | None = Field(default=None, max_length=300)
    is_active: bool = True
    sort_order: int = Field(default=0, ge=0, le=999)


class ShareRuleIn(BaseModel):
    doctor_id: UUID
    service_id: int | None = None           # empty = every service of that doctor
    kind: Literal["percent", "fixed"]
    value: Money = money(1_000_000)
    deduct_cost: bool = True
    starts_on: date


class BillingRulesIn(BaseModel):
    max_discount_pct: int = Field(ge=0, le=100)
    max_installments: int = Field(ge=0, le=24)
    receipt_note_ar: str = Field(default="", max_length=200)
    receipt_note_en: str = Field(default="", max_length=200)
