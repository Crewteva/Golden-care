"""PostgreSQL connection pool shared by the whole API.

Each request gets one connection inside one transaction (see `get_conn`): it commits when the
request succeeds and rolls back when it raises.
"""
import logging
import time
from collections.abc import Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.config import settings

log = logging.getLogger(__name__)

pool: ConnectionPool | None = None


def _wait_for_database(attempts: int = 30) -> None:
    for attempt in range(1, attempts + 1):
        try:
            with psycopg.connect(settings.database_url, connect_timeout=3):
                return
        except psycopg.OperationalError as exc:
            log.info("Waiting for the database (%s/%s): %s", attempt, attempts, str(exc).strip())
            time.sleep(2)
    raise RuntimeError("The database is not reachable")


def open_pool() -> None:
    global pool
    _wait_for_database()
    pool = ConnectionPool(
        settings.database_url,
        min_size=1,
        max_size=10,
        kwargs={"row_factory": dict_row, "options": f"-c timezone={settings.timezone}"},
        open=False,
    )
    pool.open(wait=True, timeout=30)


def close_pool() -> None:
    if pool is not None:
        pool.close()


def get_conn() -> Iterator[psycopg.Connection]:
    """FastAPI dependency: one connection and one transaction per request."""
    assert pool is not None, "database pool is not open"
    with pool.connection() as conn:
        yield conn
