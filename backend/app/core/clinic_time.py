"""The clinic's own clock (Africa/Cairo by default), independent of the server's time zone."""
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from app.config import settings

TZ = ZoneInfo(settings.timezone)


def now() -> datetime:
    return datetime.now(TZ)


def today() -> date:
    return now().date()


def at(day: date, clock: time) -> datetime:
    """A clinic-local date and time as an aware datetime (handles daylight saving)."""
    return datetime.combine(day, clock, tzinfo=TZ)


def local(moment: datetime) -> datetime:
    return moment.astimezone(TZ)
