from datetime import date, timedelta
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.core import accounting as acc
from app.core import accounting_reports as reports
from app.core.accounting import L, month_end, month_start, next_month, session_value
from app.core.accounting_schemas import AccountIn, EntryIn, TransferIn
from app.core.errors import AppError

D = Decimal


def test_month_helpers():
    assert month_start(date(2026, 11, 8)) == date(2026, 11, 1)
    assert next_month(date(2026, 12, 1)) == date(2027, 1, 1)
    assert next_month(date(2026, 1, 1)) == date(2026, 2, 1)
    assert month_end(date(2028, 2, 1)) == date(2028, 2, 29)
    assert month_end(date(2026, 10, 1)) == date(2026, 10, 31)


def test_line_sign_is_debit_positive_and_rounded():
    assert L(1, "10.005")["amount"] == D("10.01")
    assert L(1, -5)["amount"] == D("-5.00")


def test_unbalanced_entry_is_refused_before_touching_the_database():
    with pytest.raises(AppError) as err:
        acc.post(None, day=date(2026, 11, 1), memo="x", source_type="manual", lines=[L(1, 100), L(2, -90)])
    assert err.value.code == "unbalanced"


def test_zero_lines_are_dropped_and_an_empty_entry_is_not_written():
    assert acc.post(None, day=date(2026, 11, 1), memo="x", source_type="manual", lines=[L(1, 0), L(2, 0)]) is None


def test_package_session_value_and_the_rounding_left_for_the_last_session():
    pp = {"price_paid": D("1000.00"), "sessions_total": 3}
    value = session_value(pp)
    assert value == D("333.33")
    assert pp["price_paid"] - value * 3 == D("0.01")       # posted when the package is fully used


def test_normal_balance_side():
    assert reports._signed("asset", 100, 30) == D(70)
    assert reports._signed("expense", 100, 30) == D(70)
    assert reports._signed("income", 100, 30) == D(-70)
    assert reports._signed("liability", 10, 40) == D(30)


def test_report_range_checks():
    with pytest.raises(AppError):
        reports._range(date(2026, 11, 5), date(2026, 11, 1))
    with pytest.raises(AppError):
        reports._range(date(2023, 1, 1), date(2026, 11, 1))
    f, t = reports._range(None, date(2026, 10, 20))
    assert f == date(2026, 10, 1) and t == date(2026, 10, 20)


def test_schemas():
    with pytest.raises(ValidationError):
        AccountIn(code="12", name_ar="اسم", name_en="Name", type="asset")          # code is 3–6 digits
    with pytest.raises(ValidationError):
        AccountIn(code="5300", name_ar="اسم", name_en="Name", type="cost")         # unknown type
    with pytest.raises(ValidationError):
        EntryIn(entry_date=date.today(), memo="One line only", lines=[{"account_id": 1, "debit": 10}])
    with pytest.raises(ValidationError):
        TransferIn(moved_on=date.today(), from_id=1, to_id=2, amount=D("10.001"))
    ok = EntryIn(entry_date=date.today() - timedelta(days=1), memo="Accrual of October rent",
                 lines=[{"account_id": 1, "debit": "100.50"}, {"account_id": 2, "credit": "100.50"}])
    assert ok.lines[0].debit == D("100.50") and ok.lines[1].debit == 0


def test_controlled_accounts_are_the_patient_balances():
    assert set(acc.CONTROLLED) == {"receivables", "patient_credit", "deferred_packages"}
    assert all(m in acc.METHOD_ACCOUNT for m in ("cash", "card", "instapay", "wallet", "credit"))
