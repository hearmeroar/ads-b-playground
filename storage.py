"""
SQLite-backed persistence for this app's *durable* state: user accounts,
saved-aircraft collections, and the resolved-identity cache/history log.

Why this exists (and why it isn't just another JSONL file like
.track_cache.json): app.py used to keep these three stores as module-level
Python dicts/lists, loaded once from a JSONL file at import time and
rewritten to disk on every save. That works for a single process, but this
app's Dockerfile runs gunicorn with `--workers 2` — two independent OS
processes, each with its own copy of that in-memory state. A save in one
process updates its own dict and the file on disk, but never the sibling
process's already-loaded copy; gunicorn distributes requests across
processes unpredictably, so a user could save a collection card via one
process and then not see it moments later via a request served by the
other. That's a real, silent data-consistency bug, not a hypothetical one.

SQLite in WAL (write-ahead log) mode gives correct concurrent reads/writes
across multiple processes sharing one file, without a separate database
server — the same "no signup, no token, no infra" bar every other
technology choice in this app is held to (it's in Python's standard
library; no new dependency).

The ephemeral, short-TTL request caches elsewhere in app.py (OpenSky
states, the four radius sources, tracks, photos) are deliberately *not*
moved here: duplicating them per gunicorn process just means slightly more
upstream traffic, never a correctness bug, so there's no reason to pay for
shared storage there.
"""
import json
import os
import sqlite3
import threading
import time

DB_FILE = os.environ.get("DB_FILE", ".app.db")

IDENTITY_TRACKED_FIELDS = ("registration", "manufacturer", "type", "registered_owner")

_local = threading.local()


def _connect(db_file):
    conn = sqlite3.connect(db_file, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def get_connection():
    """One connection per thread, matching gunicorn's --threads model (a
    sqlite3 connection isn't safe to share across threads without its own
    locking). Reopens if DB_FILE has changed since this thread's connection
    was created — the only way tests (which point DB_FILE at a fresh
    throwaway file per test) can get a clean connection without a full
    process restart."""
    conn = getattr(_local, "conn", None)
    if conn is None or getattr(_local, "db_file", None) != DB_FILE:
        if conn is not None:
            conn.close()
        conn = _connect(DB_FILE)
        _local.conn = conn
        _local.db_file = DB_FILE
    return conn


def reset_connection():
    """Closes and drops this thread's cached connection, if any — used by
    tests right after monkeypatching DB_FILE, so get_connection() can't
    accidentally keep serving the previous test's now-stale connection
    object even if DB_FILE happens to collide (it won't in practice, since
    pytest's tmp_path is unique per test, but this makes the invariant
    explicit rather than relying on that)."""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        conn.close()
    _local.conn = None
    _local.db_file = None


def init_db():
    """Creates the schema if it doesn't exist yet. Safe to call on every
    process start (CREATE TABLE IF NOT EXISTS) and again in tests after
    pointing DB_FILE at a fresh file."""
    conn = get_connection()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            sub TEXT PRIMARY KEY,
            email TEXT,
            name TEXT,
            picture TEXT,
            created_ts REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS collections (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            icao24 TEXT NOT NULL,
            saved_at REAL NOT NULL,
            snapshot_json TEXT NOT NULL,
            location_json TEXT,
            photo_url TEXT,
            photo_link TEXT,
            photo_photographer TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_user_icao
            ON collections(user_id, icao24);

        CREATE TABLE IF NOT EXISTS identity_cache (
            icao24 TEXT PRIMARY KEY,
            registration TEXT,
            manufacturer TEXT,
            type TEXT,
            registered_owner TEXT,
            updated_ts REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS identity_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            icao24 TEXT NOT NULL,
            field TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            ts REAL NOT NULL
        );
        """
    )
    conn.commit()


# --- Users ---
# No password is ever stored here either, same as the old JSONL store —
# Google's own consent screen is the only credential check.

def get_user(sub):
    if not sub:
        return None
    row = get_connection().execute("SELECT * FROM users WHERE sub = ?", (sub,)).fetchone()
    return dict(row) if row else None


def upsert_user(sub, email, name, picture):
    """Creates or updates a user record on every successful login, so a
    changed Google display name/photo is picked up next login — same
    behavior as the old api_login_google_callback's dict assignment.
    created_ts is preserved across an update, never reset."""
    conn = get_connection()
    existing = get_user(sub)
    created_ts = existing["created_ts"] if existing else time.time()
    conn.execute(
        """
        INSERT INTO users (sub, email, name, picture, created_ts)
        VALUES (:sub, :email, :name, :picture, :created_ts)
        ON CONFLICT(sub) DO UPDATE SET
            email=excluded.email, name=excluded.name, picture=excluded.picture
        """,
        {"sub": sub, "email": email, "name": name, "picture": picture, "created_ts": created_ts},
    )
    conn.commit()
    return get_user(sub)


# --- Collections ("save aircraft you like, browse as cards") ---

def _row_to_card(row):
    card = dict(row)
    card["snapshot"] = json.loads(card.pop("snapshot_json"))
    location_json = card.pop("location_json")
    card["location"] = json.loads(location_json) if location_json is not None else None
    return card


def list_collections(user_id):
    rows = get_connection().execute(
        "SELECT * FROM collections WHERE user_id = ? ORDER BY saved_at DESC", (user_id,)
    ).fetchall()
    return [_row_to_card(r) for r in rows]


def get_collection_by_icao(user_id, icao24):
    row = get_connection().execute(
        "SELECT * FROM collections WHERE user_id = ? AND icao24 = ?", (user_id, icao24)
    ).fetchone()
    return _row_to_card(row) if row else None


def save_collection(card):
    """Upsert keyed by (user_id, icao24) — the unique index above is what
    makes "one card per icao24 per user" a database-enforced invariant
    rather than an application-level check-then-write race. The UPDATE
    branch deliberately never touches `id`, so re-saving an already-
    collected aircraft keeps its original card id (matching the old
    behavior of finding-then-mutating-in-place) even though the caller
    always passes a freshly generated uuid for the insert path."""
    conn = get_connection()
    conn.execute(
        """
        INSERT INTO collections (id, user_id, icao24, saved_at, snapshot_json, location_json,
                                  photo_url, photo_link, photo_photographer)
        VALUES (:id, :user_id, :icao24, :saved_at, :snapshot_json, :location_json,
                :photo_url, :photo_link, :photo_photographer)
        ON CONFLICT(user_id, icao24) DO UPDATE SET
            saved_at=excluded.saved_at,
            snapshot_json=excluded.snapshot_json,
            location_json=excluded.location_json,
            photo_url=excluded.photo_url,
            photo_link=excluded.photo_link,
            photo_photographer=excluded.photo_photographer
        """,
        {
            "id": card["id"],
            "user_id": card["user_id"],
            "icao24": card["icao24"],
            "saved_at": card["saved_at"],
            "snapshot_json": json.dumps(card["snapshot"]),
            "location_json": json.dumps(card["location"]) if card.get("location") is not None else None,
            "photo_url": card.get("photo_url"),
            "photo_link": card.get("photo_link"),
            "photo_photographer": card.get("photo_photographer"),
        },
    )
    conn.commit()
    return get_collection_by_icao(card["user_id"], card["icao24"])


def delete_collection(card_id, user_id):
    conn = get_connection()
    cur = conn.execute("DELETE FROM collections WHERE id = ? AND user_id = ?", (card_id, user_id))
    conn.commit()
    return cur.rowcount > 0


# --- Persistent aircraft-identity cache + change history ---
# Same scope/semantics as the old _identity_cache/_update_identity_cache:
# only the four airframe-level fields below are tracked (never flightroute
# fields like operator, which are properties of a flight, not the
# airframe), a null incoming value never erases a known one, and a changed
# non-null value is logged to identity_history before being applied.

def get_identity(icao24):
    row = get_connection().execute(
        "SELECT * FROM identity_cache WHERE icao24 = ?", (icao24,)
    ).fetchone()
    return dict(row) if row else None


def identity_known_icaos():
    rows = get_connection().execute("SELECT icao24 FROM identity_cache").fetchall()
    return {r["icao24"] for r in rows}


def identity_count():
    return get_connection().execute("SELECT COUNT(*) AS n FROM identity_cache").fetchone()["n"]


def identity_history_count():
    return get_connection().execute("SELECT COUNT(*) AS n FROM identity_history").fetchone()["n"]


def update_identity(icao24, aircraft):
    conn = get_connection()
    existing = get_identity(icao24) or {}
    now = time.time()
    changes = []
    updated = dict(existing)
    for field in IDENTITY_TRACKED_FIELDS:
        new_value = aircraft.get(field)
        if new_value is None:
            continue
        old_value = existing.get(field)
        if old_value is not None and old_value != new_value:
            changes.append((icao24, field, old_value, new_value, now))
        updated[field] = new_value
    updated["updated_ts"] = now

    conn.execute(
        """
        INSERT INTO identity_cache (icao24, registration, manufacturer, type, registered_owner, updated_ts)
        VALUES (:icao24, :registration, :manufacturer, :type, :registered_owner, :updated_ts)
        ON CONFLICT(icao24) DO UPDATE SET
            registration=excluded.registration,
            manufacturer=excluded.manufacturer,
            type=excluded.type,
            registered_owner=excluded.registered_owner,
            updated_ts=excluded.updated_ts
        """,
        {
            "icao24": icao24,
            "updated_ts": now,
            **{field: updated.get(field) for field in IDENTITY_TRACKED_FIELDS},
        },
    )
    if changes:
        conn.executemany(
            "INSERT INTO identity_history (icao24, field, old_value, new_value, ts) VALUES (?, ?, ?, ?, ?)",
            changes,
        )
    conn.commit()
    return updated


def identity_history(icao24=None):
    """Returns the change-history log as plain dicts (icao24/field/old/new/ts,
    matching the old IDENTITY_HISTORY_FILE JSONL record shape) — used by
    tests and available for future debugging/inspection tooling. Optionally
    filtered to one aircraft."""
    conn = get_connection()
    if icao24 is not None:
        rows = conn.execute(
            "SELECT icao24, field, old_value, new_value, ts FROM identity_history "
            "WHERE icao24 = ? ORDER BY id", (icao24,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT icao24, field, old_value, new_value, ts FROM identity_history ORDER BY id"
        ).fetchall()
    return [
        {"icao24": r["icao24"], "field": r["field"], "old": r["old_value"], "new": r["new_value"], "ts": r["ts"]}
        for r in rows
    ]
