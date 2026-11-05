from datetime import date

from app.core.national_id import parse_national_id


def test_valid_id_gives_birth_date_sex_and_governorate():
    parsed = parse_national_id("29001150100375")
    assert parsed["date_of_birth"] == date(1990, 1, 15)
    assert parsed["gender"] == "male"  # 13th digit (7) is odd
    assert parsed["governorate"] == "Cairo"


def test_century_digit_and_female():
    parsed = parse_national_id("٣١٥٠٥١٠٢١٠٠٢٤٣")  # Arabic-Indic digits are accepted
    assert parsed["date_of_birth"] == date(2015, 5, 10)
    assert parsed["gender"] == "female"
    assert parsed["governorate"] == "Giza"


def test_invalid_ids_are_rejected():
    for value in ["", "123", "19001150100385", "29013150100385", "29001159900385", "39901010100385", None]:
        assert parse_national_id(value) is None, value
