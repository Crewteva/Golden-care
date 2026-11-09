from datetime import date, time
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.core.billing_schemas import money

Qty = Decimal


def qty(**kw):
    return Field(gt=0, le=1_000_000, decimal_places=2, **kw)


# ---------- setup lists ----------

class NamedIn(BaseModel):
    """Categories and units."""
    name_ar: str = Field(min_length=1, max_length=60)
    name_en: str = Field(min_length=1, max_length=60)
    is_active: bool = True


class ItemIn(BaseModel):
    name_ar: str = Field(min_length=2, max_length=120)
    name_en: str = Field(min_length=2, max_length=120)
    category_id: int | None = None
    unit_id: int
    min_qty: Decimal = Field(default=Decimal(0), ge=0, le=1_000_000, decimal_places=2)
    tracks_expiry: bool = False
    notes: str | None = Field(default=None, max_length=300)
    is_active: bool = True


class StoreIn(BaseModel):
    branch_id: int
    name_ar: str = Field(min_length=2, max_length=80)
    name_en: str = Field(min_length=2, max_length=80)
    is_active: bool = True


class SupplierIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    contact_name: str | None = Field(default=None, max_length=80)
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=120)
    address: str | None = Field(default=None, max_length=200)
    payment_terms_days: int = Field(default=30, ge=0, le=365)
    notes: str | None = Field(default=None, max_length=300)
    is_active: bool = True


class DeviceTypeIn(BaseModel):
    name_ar: str = Field(min_length=2, max_length=80)
    name_en: str = Field(min_length=2, max_length=80)
    is_laser: bool = False
    is_active: bool = True


class LimitIn(BaseModel):
    approval_limit: Decimal = money(le=10_000_000)


# ---------- stock ----------

class ReceiveLineIn(BaseModel):
    po_line_id: int | None = None
    item_id: int
    qty: Qty = qty()
    unit_cost: Decimal = money(le=1_000_000)
    lot_no: str | None = Field(default=None, max_length=40)
    expiry: date | None = None


class ReceiveIn(BaseModel):
    supplier_id: int | None = None      # taken from the order when receiving against one
    store_id: int | None = None
    po_id: UUID | None = None
    received_on: date
    delivery_note: str | None = Field(default=None, max_length=60)
    note: str | None = Field(default=None, max_length=300)
    lines: list[ReceiveLineIn] = Field(min_length=1, max_length=60)


class IssueLineIn(BaseModel):
    item_id: int
    qty: Qty = qty()


class IssueIn(BaseModel):
    kind: Literal["use", "write_off"] = "use"
    store_id: int
    issued_on: date | None = None
    room_id: int | None = None
    appointment_id: UUID | None = None
    reason: str | None = Field(default=None, max_length=300)
    note: str | None = Field(default=None, max_length=300)
    lines: list[IssueLineIn] = Field(min_length=1, max_length=40)


class CountStartIn(BaseModel):
    store_id: int
    note: str | None = Field(default=None, max_length=300)


class CountLineIn(BaseModel):
    item_id: int
    counted: Decimal | None = Field(default=None, ge=0, le=1_000_000, decimal_places=2)


class CountSaveIn(BaseModel):
    lines: list[CountLineIn] = Field(max_length=2000)
    submit: bool = False


class DecideIn(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=300)


class ReasonIn(BaseModel):
    reason: str = Field(min_length=5, max_length=300)


# ---------- purchasing ----------

class PoLineIn(BaseModel):
    item_id: int
    qty: Qty = qty()
    unit_cost: Decimal = money(le=1_000_000)


class PoIn(BaseModel):
    supplier_id: int
    store_id: int
    ordered_on: date | None = None
    expected_on: date | None = None
    note: str | None = Field(default=None, max_length=300)
    lines: list[PoLineIn] = Field(min_length=1, max_length=60)


class BillIn(BaseModel):
    supplier_id: int
    bill_no: str = Field(min_length=1, max_length=40)
    bill_date: date
    receipt_ids: list[UUID] = Field(default_factory=list, max_length=100)
    maintenance_ids: list[UUID] = Field(default_factory=list, max_length=100)
    note: str | None = Field(default=None, max_length=300)


class SupplierPayIn(BaseModel):
    supplier_id: int
    bill_id: UUID | None = None
    paid_on: date
    amount: Decimal = Field(gt=0, le=10_000_000, decimal_places=2)
    paid_from_id: int
    reference: str | None = Field(default=None, max_length=80)
    note: str | None = Field(default=None, max_length=300)


# ---------- devices ----------

class DeviceIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    type_id: int
    model: str | None = Field(default=None, max_length=80)
    serial_no: str | None = Field(default=None, max_length=80)
    room_id: int | None = None
    supplier_id: int | None = None
    purchase_date: date | None = None
    purchase_price: Decimal | None = money(default=None, le=100_000_000)
    warranty_end: date | None = None
    maintenance_every_days: int | None = Field(default=None, ge=1, le=1095)
    last_maintenance_on: date | None = None
    calibration_every_days: int | None = Field(default=None, ge=1, le=1095)
    last_calibration_on: date | None = None
    pulse_limit: int | None = Field(default=None, ge=1, le=100_000_000)    # lasers: pulses between services
    notes: str | None = Field(default=None, max_length=500)
    is_active: bool = True


class DeviceStatusIn(BaseModel):
    status: Literal["working", "maintenance", "out_of_service"]
    note: str | None = Field(default=None, max_length=300)


class FaultIn(BaseModel):
    device_id: int
    description: str = Field(min_length=5, max_length=500)
    stops_use: bool = False


class FixIn(BaseModel):
    resolution: str = Field(min_length=5, max_length=500)
    back_to_work: bool = True


class BookingIn(BaseModel):
    device_id: int
    day: date
    starts: time
    ends: time
    purpose: str = Field(min_length=3, max_length=200)
    room_id: int | None = None


# ---------- transfers & returns ----------

class TransferLineIn(BaseModel):
    item_id: int
    qty: Qty = qty()


class TransferIn(BaseModel):
    from_store_id: int
    to_store_id: int
    note: str | None = Field(default=None, max_length=300)
    lines: list[TransferLineIn] = Field(min_length=1, max_length=60)


class DispatchLineIn(BaseModel):
    item_id: int
    qty: Qty = Field(ge=0, le=1_000_000, decimal_places=2)     # 0 = not sent


class DispatchIn(BaseModel):
    dispatched_on: date | None = None
    lines: list[DispatchLineIn] = Field(default_factory=list, max_length=60)


class ArrivedLotIn(BaseModel):
    lot_id: int                                                   # stock_transfer_lots.id
    qty_received: Qty = Field(ge=0, le=1_000_000, decimal_places=2)


class ArrivalIn(BaseModel):
    received_on: date | None = None
    lots: list[ArrivedLotIn] = Field(default_factory=list, max_length=200)
    shortage_note: str | None = Field(default=None, max_length=300)


class ReturnIn(BaseModel):
    lot_id: int
    qty: Qty = qty()
    reason: str = Field(min_length=5, max_length=300)
