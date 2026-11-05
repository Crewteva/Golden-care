import time

import pyotp

from app.core.security import (
    hash_password, match_totp, password_problem, temp_password, verify_password,
)


def test_password_hash_round_trip():
    hashed = hash_password("Sunrise-Clinic-42")
    assert verify_password(hashed, "Sunrise-Clinic-42")
    assert not verify_password(hashed, "sunrise-clinic-42")
    assert not verify_password("not-a-hash", "anything")


def test_password_rules():
    assert password_problem("short1", kind="patient") == "too_short"
    assert password_problem("abcdefgh1", kind="staff") == "too_short"
    assert password_problem("password123", kind="patient") == "too_common"
    assert password_problem("onlyletters", kind="patient") == "needs_mix"
    assert password_problem("1234567890123", kind="patient") == "needs_mix"
    assert password_problem("karim2026!x", kind="staff", identifiers=("karim",)) == "contains_identifier"
    assert password_problem("Nile-Sunrise-77", kind="staff") is None


def test_temp_passwords_pass_the_rules_and_differ():
    seen = {temp_password() for _ in range(50)}
    assert len(seen) == 50
    for pw in seen:
        assert password_problem(pw, kind="staff") is None


def test_totp_code_works_once():
    secret = pyotp.random_base32()
    code = pyotp.TOTP(secret).now()
    step = match_totp(secret, code, None)
    assert step is not None
    assert match_totp(secret, code, step) is None  # replay refused
    assert match_totp(secret, "000000" if code != "000000" else "111111", None) is None
    assert match_totp(secret, "12ab56", None) is None
    assert step in {int(time.time() // 30) + d for d in (-1, 0, 1)}
