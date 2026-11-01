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
    # v2: job types, rate-based chem/gas, equipment + overhead, daily ad spend.
    # Each job keeps a snapshot of the rates in effect when it was logged.
    # chem_cents / gas_cents / ad_cents from v1 remain as manual "extra" amounts.
    """
    ALTER TABLE jobs ADD COLUMN chem_gal_x100    INTEGER NOT NULL DEFAULT 0 CHECK (chem_gal_x100 >= 0);
    ALTER TABLE jobs ADD COLUMN chem_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (chem_price_cents >= 0);
    ALTER TABLE jobs ADD COLUMN miles_x10        INTEGER NOT NULL DEFAULT 0 CHECK (miles_x10 >= 0);
    ALTER TABLE jobs ADD COLUMN gas_price_cents  INTEGER NOT NULL DEFAULT 0 CHECK (gas_price_cents >= 0);
    ALTER TABLE jobs ADD COLUMN mpg_x10          INTEGER NOT NULL DEFAULT 0 CHECK (mpg_x10 >= 0);
    ALTER TABLE jobs ADD COLUMN equip_rate_cents INTEGER NOT NULL DEFAULT 0 CHECK (equip_rate_cents >= 0);
    ALTER TABLE jobs ADD COLUMN overhead_cents   INTEGER NOT NULL DEFAULT 0 CHECK (overhead_cents >= 0);

    CREATE TABLE job_types (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        name     TEXT    NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE job_type_links (
        job_id  INTEGER NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
        type_id INTEGER NOT NULL REFERENCES job_types (id),
        PRIMARY KEY (job_id, type_id)
    );
    CREATE INDEX idx_links_type ON job_type_links (type_id);

    -- One row per work day: the ad spend charged that day, split across its jobs.
    CREATE TABLE ad_days (
        job_date TEXT    PRIMARY KEY,
        ad_cents INTEGER NOT NULL DEFAULT 0 CHECK (ad_cents >= 0)
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES
        ('chem_price_cents', '0'),
        ('gas_price_cents', '0'),
        ('mpg_x10', '0'),
        ('default_miles_x10', '0'),
        ('ad_per_day_cents', '0'),
        ('equip_rate_cents', '0'),
        ('overhead_cents', '0');
    """,
    # v3: usual amounts per job type, used to pre-fill the form.
    """
    ALTER TABLE job_types ADD COLUMN default_gal_x100      INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE job_types ADD COLUMN default_minutes       INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE job_types ADD COLUMN default_revenue_cents INTEGER NOT NULL DEFAULT 0;
    """,
    # v4: login password hash and session signing key.
    """
    CREATE TABLE app_secrets (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
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
