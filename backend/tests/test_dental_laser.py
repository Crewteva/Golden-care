from datetime import date
from decimal import Decimal

from app.core.dental import schedule, valid_tooth
from app.core.laser import counter_check


def test_fdi_numbering():
    assert all(valid_tooth(t) for t in (11, 18, 28, 38, 48, 51, 55, 85))
    assert not any(valid_tooth(t) for t in (19, 10, 49, 56, 86, 90, 9))
    assert valid_tooth(None)


def test_schedule_down_payment_then_monthly_with_remainder_last():
    rows = schedule(Decimal("12000"), Decimal("2000"), 3, date(2026, 1, 31))
    assert [r["seq"] for r in rows] == [0, 1, 2, 3]
    assert rows[0]["amount"] == Decimal("2000") and rows[0]["due_on"] == date(2026, 1, 31)
    assert [r["amount"] for r in rows[1:]] == [Decimal("3333"), Decimal("3333"), Decimal("3334")]
    assert rows[1]["due_on"] == date(2026, 2, 28)  # month end kept valid
    assert sum(r["amount"] for r in rows) == Decimal("12000")


def test_schedule_without_installments_is_pay_as_you_go():
    assert schedule(Decimal("1700"), Decimal("0"), 0, date(2026, 5, 1)) == []
    assert [r["seq"] for r in schedule(Decimal("1700"), Decimal("500"), 0, date(2026, 5, 1))] == [0]


def test_counter_check():
    s = {"counter_start": 1000, "counter_end": 1140, "test_pulses": 10}
    assert counter_check(s, 1000, 130) == {"used": 140, "recorded": 130, "test": 10, "difference": 0, "start_gap": 0}
    assert counter_check({**s, "test_pulses": 0}, 1000, 130)["difference"] == 10
    assert counter_check(s, 990, 130)["start_gap"] == 10
