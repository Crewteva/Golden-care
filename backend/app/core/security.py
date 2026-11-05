"""Passwords (Argon2), session tokens, temporary passwords and authenticator-app codes (TOTP)."""
import hashlib
import hmac
import re
import secrets
import time

import pyotp
import segno
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.config import settings

_hasher = PasswordHasher()
_DUMMY_HASH = _hasher.hash("golden-care-timing-equaliser")

COMMON_PASSWORDS = {
    "password", "password1", "password123", "12345678", "123456789", "1234567890", "qwertyuiop",
    "qwerty123", "11111111", "00000000", "iloveyou", "goldencare", "golden123", "admin123", "welcome1",
}


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def burn_time(password: str) -> None:
    """Same cost as a real check, so unknown accounts can't be detected by timing."""
    verify_password(_DUMMY_HASH, password)


def password_problem(password: str, *, kind: str, identifiers: tuple[str | None, ...] = ()) -> str | None:
    """Returns an error code when the password is too weak, otherwise None."""
    minimum = 10 if kind == "staff" else 8
    if len(password) < minimum:
        return "too_short"
    if len(password) > 128:
        return "too_long"
    if password.lower() in COMMON_PASSWORDS:
        return "too_common"
    if not re.search(r"[^\W\d_]", password) or not re.search(r"[\d\W_]", password):
        return "needs_mix"
    lowered = password.lower()
    for identifier in identifiers:
        if identifier and len(identifier) >= 4 and identifier.lower() in lowered:
            return "contains_identifier"
    return None


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


_TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def temp_password() -> str:
    """Readable one-time password such as Gc-7hq4-Kp2m-9xRt (no 0/O/1/l/I)."""
    while True:
        groups = ["".join(secrets.choice(_TEMP_ALPHABET) for _ in range(4)) for _ in range(3)]
        candidate = "Gc-" + "-".join(groups)
        if any(ch.isdigit() for ch in candidate):
            return candidate


# --- Authenticator app (TOTP, 30-second codes) ---

def new_mfa_secret() -> str:
    return pyotp.random_base32()


def mfa_uri(secret: str, account: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account, issuer_name=settings.mfa_issuer)


def mfa_qr(uri: str) -> str:
    return segno.make(uri, error="m").svg_data_uri(scale=6, border=2, dark="#0B211E")


def match_totp(secret: str, code: str, last_step: int | None) -> int | None:
    """Returns the time step the code belongs to, or None. A step can be used only once."""
    code = re.sub(r"\s", "", code or "")
    if not re.fullmatch(r"\d{6}", code):
        return None
    totp = pyotp.TOTP(secret)
    current = int(time.time() // 30)
    for offset in (0, -1, 1):
        step = current + offset
        if last_step is not None and step <= last_step:
            continue
        if hmac.compare_digest(totp.at(step * 30), code):
            return step
    return None
