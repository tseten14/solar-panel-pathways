"""Schema migrations for the solar scan store.

Why this exists
    connect() used to run ``executescript(schema.sql)`` on *every* connection —
    reading the file off disk and re-parsing the full DDL for each request, each
    agent tool call, each background refresh. That made every schema change an
    edit to one growing file with no record of what a given database had already
    had applied.

    Now the DDL lives in numbered files under ``data/migrations/`` and each one
    is applied at most once, recorded in ``schema_migrations``. A database from
    before this change upgrades in place: 001 is written to be a no-op against
    the tables it already has.

Concurrency
    Migrations run inside an IMMEDIATE transaction, so two processes starting
    together cannot both apply the same file — the loser waits, then sees the
    version already recorded and skips it.
"""

from __future__ import annotations

import logging
import sqlite3
from pathlib import Path

_log = logging.getLogger("uvicorn.error")

MIGRATIONS_DIR = Path(__file__).resolve().parent / "data" / "migrations"


def _ensure_ledger(con: sqlite3.Connection) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version     TEXT PRIMARY KEY,
            applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    con.commit()


def available_migrations() -> list[Path]:
    """Every migration file, in version order."""
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


def applied_versions(con: sqlite3.Connection) -> set[str]:
    _ensure_ledger(con)
    return {r["version"] for r in con.execute("SELECT version FROM schema_migrations")}


def pending_migrations(con: sqlite3.Connection) -> list[Path]:
    done = applied_versions(con)
    return [p for p in available_migrations() if p.stem not in done]


def migrate(con: sqlite3.Connection) -> list[str]:
    """Apply outstanding migrations. Returns the versions applied this call."""
    _ensure_ledger(con)
    applied: list[str] = []

    for path in pending_migrations(con):
        version = path.stem
        # IMMEDIATE takes the write lock up front, so a second process racing us
        # blocks here rather than part-applying the same file alongside us.
        con.execute("BEGIN IMMEDIATE")
        try:
            already = con.execute(
                "SELECT 1 FROM schema_migrations WHERE version = ?", (version,)
            ).fetchone()
            if already:
                con.execute("ROLLBACK")
                continue
            con.executescript(path.read_text())
            con.execute("INSERT INTO schema_migrations(version) VALUES (?)", (version,))
            con.execute("COMMIT")
        except Exception:
            con.execute("ROLLBACK")
            _log.exception("migration %s failed", version)
            raise
        applied.append(version)
        _log.info("applied migration %s", version)

    return applied
