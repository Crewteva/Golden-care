"""Cleans names, phone numbers and e-mails so the same person is always stored the same way."""
import re

_DIGITS = str.maketrans("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9", "01234567890123456789")
_DIACRITICS = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")
_LETTERS = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ة": "ه", "ى": "ي", "ؤ": "و", "ئ": "ي"})
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")


def to_ascii_digits(value: str) -> str:
    return value.translate(_DIGITS)


def normalize_name(value: str) -> str:
    """Search key for a name: no diacritics or tatweel, one spelling for alef / taa marbuta / yaa."""
    text = _DIACRITICS.sub("", value or "").translate(_LETTERS).lower()
    return re.sub(r"\s+", " ", text).strip()


def clean_name(value: str | None) -> str | None:
    if value is None:
        return None
    text = re.sub(r"\s+", " ", value).strip()
    return text or None


def normalize_phone(value: str | None) -> str | None:
    """Egyptian mobile number in international form (+201XXXXXXXXX), or None when it isn't one.

    Accepts 010…, +20 10…, 0020 10…, 20 10…, spaces/dashes and Arabic-Indic digits.
    """
    if not value:
        return None
    digits = re.sub(r"\D", "", to_ascii_digits(value))
    if digits.startswith("0020"):
        digits = digits[4:]
    elif digits.startswith("20") and len(digits) == 12:
        digits = digits[2:]
    if len(digits) == 10 and digits.startswith("1"):
        digits = "0" + digits
    if re.fullmatch(r"01[0125]\d{8}", digits):
        return "+20" + digits[1:]
    return None


def normalize_email(value: str | None) -> str | None:
    if not value:
        return None
    email = value.strip().lower()
    return email if _EMAIL.match(email) and len(email) <= 200 else None
