"""Database layer: SQLite storage for jobs and settings.

Money is stored as integer cents and time as integer minutes, so totals never
drift from floating-point rounding. Schema changes go through MIGRATIONS,
tracked with SQLite's built-in `user_version` pragma.
"""

import sqlite3
from pathlib import Path

MIGRATIONS = [
    # v1: jobs + settings
    """
    CREATE TABLE jobs (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        job_date         TEXT    NOT NULL,              -- YYYY-MM-DD
        name             TEXT    NOT NULL DEFAULT '',
        revenue_cents    INTEGER NOT NULL DEFAULT 0 CHECK (revenue_cents >= 0),
        chem_cents       INTEGER NOT NULL DEFAULT 0 CHECK (chem_cents >= 0),
        gas_cents        INTEGER NOT NULL DEFAULT 0 CHECK (gas_cents >= 0),
        ad_cents         INTEGER NOT NULL DEFAULT 0 CHECK (ad_cents >= 0),
        other_cents      INTEGER NOT NULL DEFAULT 0 CHECK (other_cents >= 0),
        other_note       TEXT    NOT NULL DEFAULT '',
        minutes          INTEGER NOT NULL DEFAULT 0 CHECK (minutes >= 0),
        labor_rate_cents INTEGER NOT NULL DEFAULT 0 CHECK (labor_rate_cents >= 0),
        notes            TEXT    NOT NULL DEFAULT '',
        created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_jobs_date ON jobs (job_date);

    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    INSERT INTO settings (key, value) VALUES ('hourly_rate_cents', '0');
    """,
]


def connect(path: str) -> sqlite3.Connection:
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    for i, sql in enumerate(MIGRATIONS[version:], start=version + 1):
        conn.executescript(f"BEGIN; {sql}; PRAGMA user_version = {i}; COMMIT;")
