"""Applies the SQL files in storage/migrations/ in name order, once each.

Applied files are recorded in `schema_migrations`. An advisory lock keeps two API processes
from migrating at the same time. Never edit a file that has been applied: add a new one.
"""
import logging
from pathlib import Path

import psycopg

log = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
_LOCK_ID = 727_001


def run_migrations(conn: psycopg.Connection) -> None:
    with conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_ID,))
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        applied = {row["version"] for row in conn.execute("SELECT version FROM schema_migrations")}
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.stem in applied:
                continue
            log.info("Applying migration %s", path.name)
            conn.execute(path.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (path.stem,))
