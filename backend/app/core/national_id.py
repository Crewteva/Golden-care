"""Egyptian national ID (14 digits): C YYMMDD GG SSS G X
C = century (2 → 1900s, 3 → 2000s), YYMMDD = birth date, GG = governorate of birth,
the 13th digit is odd for males and even for females."""
import re
from datetime import date

from app.core.normalize import to_ascii_digits

GOVERNORATES = {
    "01": "Cairo", "02": "Alexandria", "03": "Port Said", "04": "Suez", "11": "Damietta", "12": "Dakahlia",
    "13": "Sharqia", "14": "Qalyubia", "15": "Kafr El Sheikh", "16": "Gharbia", "17": "Monufia", "18": "Beheira",
    "19": "Ismailia", "21": "Giza", "22": "Beni Suef", "23": "Fayoum", "24": "Minya", "25": "Assiut", "26": "Sohag",
    "27": "Qena", "28": "Aswan", "29": "Luxor", "31": "Red Sea", "32": "New Valley", "33": "Matrouh",
    "34": "North Sinai", "35": "South Sinai", "88": "Born abroad",
}


def clean_national_id(value: str | None) -> str:
    return re.sub(r"\D", "", to_ascii_digits(value or ""))


def parse_national_id(value: str | None) -> dict | None:
    """Returns {national_id, date_of_birth, gender, governorate} or None when the number isn't valid."""
    digits = clean_national_id(value)
    if len(digits) != 14 or digits[0] not in "23":
        return None
    century = 1900 if digits[0] == "2" else 2000
    try:
        born = date(century + int(digits[1:3]), int(digits[3:5]), int(digits[5:7]))
    except ValueError:
        return None
    if born > date.today() or digits[7:9] not in GOVERNORATES:
        return None
    return {
        "national_id": digits,
        "date_of_birth": born,
        "gender": "male" if int(digits[12]) % 2 else "female",
        "governorate": GOVERNORATES[digits[7:9]],
    }
