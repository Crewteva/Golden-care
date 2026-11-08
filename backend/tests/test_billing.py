from datetime import date
from decimal import Decimal

import pytest

from app.core import billing
from app.core.billing import _compute, _schedule, installments_state, package_refund
from app.core.billing_schemas import IssueIn
from app.core.billing_setup import doctor_share
from app.core.errors import AppError

D = Decimal


def line(price, qty=1, vat=0, cost=0):
    return {"unit_price": D(price), "qty": qty, "vat_rate": D(vat), "unit_cost": D(cost)}


def test_discount_shared_by_value_and_adds_up_exactly():
    lines = [line(550), line(1500), line(250, qty=2)]
    t = _compute(lines, D("100"))
    assert t["subtotal"] == D("2550.00") and t["total"] == D("2450.00")
    assert sum(r["discount"] for r in lines) == D("100.00")
    assert lines[1]["discount"] > lines[0]["discount"]          # bigger line, bigger share


def test_vat_on_the_discounted_amount():
    lines = [line(4000, vat=14), line(300)]
    t = _compute(lines, D("430"))
    assert lines[0]["discount"] == D("400.00")
    assert lines[0]["vat_amount"] == D("504.00")                # 14% of 3600
    assert t["total"] == D("4374.00")


def test_free_package_session_takes_no_discount():
    lines = [line(0), line(600)]
    _compute(lines, D("60"))
    assert lines[0]["discount"] == 0 and lines[1]["discount"] == D("60.00")


def test_discount_above_subtotal_refused():
    with pytest.raises(AppError):
        _compute([line(100)], D("101"))


def test_installments_down_payment_then_monthly_remainder_last(monkeypatch):
    monkeypatch.setattr(billing.clinic_time, "today", lambda: date(2026, 11, 8))
    plan = _schedule(D("7500"), IssueIn(installments=3, down_payment=D("1000"), first_due_on=date(2026, 12, 31)), 12)
    assert plan[0] == (0, date(2026, 11, 8), D("1000.00"))
    assert [p[2] for p in plan[1:]] == [D("2166.66"), D("2166.66"), D("2166.68")]
    assert [p[1] for p in plan[1:]] == [date(2026, 12, 28), date(2027, 1, 28), date(2027, 2, 28)]
    assert sum(p[2] for p in plan) == D("7500")
    assert _schedule(D("500"), IssueIn(), 12) == []


def test_installments_limits(monkeypatch):
    monkeypatch.setattr(billing.clinic_time, "today", lambda: date(2026, 11, 8))
    for body in (IssueIn(installments=13), IssueIn(installments=2, down_payment=D("500")),
                 IssueIn(installments=2, first_due_on=date(2026, 11, 1))):
        with pytest.raises(AppError):
            _schedule(D("500"), body, 12)


def test_installment_states(monkeypatch):
    monkeypatch.setattr(billing.clinic_time, "today", lambda: date(2026, 11, 8))
    rows = [{"amount": D(1000), "due_on": date(2026, 10, 1)}, {"amount": D(1000), "due_on": date(2026, 11, 1)},
            {"amount": D(1000), "due_on": date(2026, 12, 1)}]
    assert [r["state"] for r in installments_state([dict(r) for r in rows], D(1500), False)] == ["paid", "overdue", "due"]
    assert [r["state"] for r in installments_state([dict(r) for r in rows], D(0), True)] == ["cancelled"] * 3


def test_doctor_share_rules():
    pct = {"kind": "percent", "value": D(40), "deduct_cost": True}
    assert doctor_share(pct, net=D(3500), cost=D(1200), qty=1) == D("920.00")
    assert doctor_share({**pct, "deduct_cost": False}, net=D(3500), cost=D(1200), qty=1) == D("1400.00")
    assert doctor_share(pct, net=D(500), cost=D(1200), qty=1) == 0                  # never negative
    assert doctor_share({"kind": "fixed", "value": D(100), "deduct_cost": False}, net=D(0), cost=D(0), qty=2) == D("200.00")
    assert doctor_share(None, net=D(900), cost=D(0), qty=1) == 0


def test_package_refund_charges_used_sessions_at_full_price():
    assert package_refund({"price_paid": D(7500), "full_price": D(1500), "used": 2}) == D("4500.00")
    assert package_refund({"price_paid": D(3000), "full_price": D(600), "used": 6}) == 0
