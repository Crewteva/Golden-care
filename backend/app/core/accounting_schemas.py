from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.core.billing_schemas import money

AccountType = Literal["asset", "liability", "equity", "income", "expense"]


class AccountIn(BaseModel):
    code: str = Field(pattern=r"^[0-9]{3,6}$")
    name_ar: str = Field(min_length=2, max_length=80)
    name_en: str = Field(min_length=2, max_length=80)
    type: AccountType
    is_money: bool = False
    is_active: bool = True
    description: str | None = Field(default=None, max_length=200)


class EntryLineIn(BaseModel):
    account_id: int
    debit: Decimal = money(default=Decimal(0), le=10_000_000)
    credit: Decimal = money(default=Decimal(0), le=10_000_000)
    memo: str | None = Field(default=None, max_length=120)


class EntryIn(BaseModel):
    entry_date: date
    memo: str = Field(min_length=5, max_length=300)
    lines: list[EntryLineIn] = Field(min_length=2, max_length=40)


class ReverseIn(BaseModel):
    reason: str = Field(min_length=5, max_length=300)
    entry_date: date | None = None


class ReasonIn(BaseModel):
    reason: str = Field(min_length=5, max_length=300)


class TransferIn(BaseModel):
    moved_on: date
    from_id: int
    to_id: int
    amount: Decimal = Field(gt=0, le=10_000_000, decimal_places=2)
    fee: Decimal = money(default=Decimal(0), le=1_000_000)
    reference: str | None = Field(default=None, max_length=80)
    note: str | None = Field(default=None, max_length=300)


class SettlementIn(BaseModel):
    method: Literal["card", "instapay", "wallet"]
    moved_on: date
    to_id: int
    payment_ids: list[int] = Field(min_length=1, max_length=2000)
    fee: Decimal = money(default=Decimal(0), le=1_000_000)
    reference: str | None = Field(default=None, max_length=80)
    note: str | None = Field(default=None, max_length=300)


class PayoutIn(BaseModel):
    doctor_id: UUID
    month: date
    note: str | None = Field(default=None, max_length=300)


class DecideIn(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=300)


class PayoutPayIn(BaseModel):
    paid_on: date
    paid_from_id: int
    reference: str | None = Field(default=None, max_length=80)


class LabPaymentIn(BaseModel):
    lab_id: int
    paid_on: date
    amount: Decimal = Field(gt=0, le=10_000_000, decimal_places=2)
    paid_from_id: int
    reference: str | None = Field(default=None, max_length=80)
    note: str | None = Field(default=None, max_length=300)


class CloseRequestIn(BaseModel):
    note: str | None = Field(default=None, max_length=300)
