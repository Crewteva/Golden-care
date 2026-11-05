"""Settings, read once from environment variables."""
import os


def _flag(name: str, default: bool = False) -> bool:
    value = os.environ.get(name, "").strip().lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "on"}


class Settings:
    database_url = os.environ.get("DATABASE_URL", "postgresql://goldencare:goldencare@localhost:5432/goldencare")
    timezone = os.environ.get("APP_TIMEZONE", "Africa/Cairo")

    # Sessions: staff sign out after 12 h or 60 min without activity; patients stay signed in for 7 days.
    cookie_secure = _flag("COOKIE_SECURE", True)
    staff_session_hours = int(os.environ.get("STAFF_SESSION_HOURS", "12"))
    staff_idle_minutes = int(os.environ.get("STAFF_IDLE_MINUTES", "60"))
    patient_session_days = int(os.environ.get("PATIENT_SESSION_DAYS", "7"))

    mfa_issuer = os.environ.get("MFA_ISSUER", "Golden Care Clinics")

    # First admin account, created only when the database has no staff yet.
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@goldencare.local")
    admin_password = os.environ.get("ADMIN_PASSWORD") or None

    # Synthetic demo accounts (one per role). Never enable with real data.
    seed_demo = _flag("SEED_DEMO")
    demo_password = os.environ.get("DEMO_PASSWORD") or None

    api_docs = _flag("API_DOCS")
    log_level = os.environ.get("LOG_LEVEL", "INFO").upper()


settings = Settings()
