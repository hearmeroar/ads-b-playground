#!/usr/bin/env python3
"""
One-off migration: imports the old JSONL stores (.users.jsonl,
.collections.jsonl, .aircraft_identity_cache.jsonl, .identity_history.jsonl)
into the new SQLite database (storage.py, DB_FILE).

Not run automatically by the app — this is a manual deploy step, run once
against the production volume before the SQLite-backed code goes live there
(same "regenerate/run by hand" convention as this project's other one-off
scripts, e.g. the airline-logo manifest or the favicon renderer). Safe to
run more than once: every insert is an upsert keyed the same way the old
JSONL stores were keyed, so re-running against unchanged files is a no-op,
and re-running after the app has already written new SQLite-only data
won't erase it (this script only ever adds/updates rows, never deletes).

Usage:
    python3 migrate_jsonl_to_sqlite.py

Respects the same USERS_FILE/COLLECTIONS_FILE/IDENTITY_CACHE_FILE/
IDENTITY_HISTORY_FILE/DB_FILE env vars the app itself reads, so it can be
pointed at the production paths (e.g. /data/.users.jsonl, /data/app.db on
Northflank) without editing this file.
"""
import json
import os
import sys

import storage

USERS_FILE = os.environ.get("USERS_FILE", ".users.jsonl")
COLLECTIONS_FILE = os.environ.get("COLLECTIONS_FILE", ".collections.jsonl")
IDENTITY_CACHE_FILE = os.environ.get("IDENTITY_CACHE_FILE", ".aircraft_identity_cache.jsonl")
IDENTITY_HISTORY_FILE = os.environ.get("IDENTITY_HISTORY_FILE", ".identity_history.jsonl")


def _read_jsonl(path):
    try:
        with open(path, "r") as f:
            lines = f.readlines()
    except OSError:
        return []
    records = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except ValueError:
            continue
    return records


def migrate_users():
    n = 0
    for entry in _read_jsonl(USERS_FILE):
        sub = entry.get("sub")
        if not sub:
            continue
        conn = storage.get_connection()
        conn.execute(
            """
            INSERT INTO users (sub, email, name, picture, created_ts)
            VALUES (:sub, :email, :name, :picture, :created_ts)
            ON CONFLICT(sub) DO UPDATE SET
                email=excluded.email, name=excluded.name, picture=excluded.picture,
                created_ts=MIN(users.created_ts, excluded.created_ts)
            """,
            {
                "sub": sub, "email": entry.get("email"), "name": entry.get("name"),
                "picture": entry.get("picture"), "created_ts": entry.get("created_ts", 0.0),
            },
        )
        conn.commit()
        n += 1
    return n


def migrate_collections():
    n = 0
    for entry in _read_jsonl(COLLECTIONS_FILE):
        if not (entry.get("id") and entry.get("user_id")):
            continue
        storage.save_collection({
            "id": entry["id"],
            "user_id": entry["user_id"],
            "icao24": entry.get("icao24"),
            "saved_at": entry.get("saved_at", 0.0),
            "snapshot": entry.get("snapshot") or {},
            "location": entry.get("location"),
            "photo_url": entry.get("photo_url"),
            "photo_link": entry.get("photo_link"),
            "photo_photographer": entry.get("photo_photographer"),
        })
        n += 1
    return n


def migrate_identity_cache_and_history():
    n_identity = 0
    conn = storage.get_connection()
    for entry in _read_jsonl(IDENTITY_CACHE_FILE):
        icao24 = entry.get("icao24")
        if not icao24:
            continue
        conn.execute(
            """
            INSERT INTO identity_cache (icao24, registration, manufacturer, type, registered_owner, updated_ts)
            VALUES (:icao24, :registration, :manufacturer, :type, :registered_owner, :updated_ts)
            ON CONFLICT(icao24) DO UPDATE SET
                registration=excluded.registration, manufacturer=excluded.manufacturer,
                type=excluded.type, registered_owner=excluded.registered_owner,
                updated_ts=excluded.updated_ts
            """,
            {
                "icao24": icao24,
                "registration": entry.get("registration"),
                "manufacturer": entry.get("manufacturer"),
                "type": entry.get("type"),
                "registered_owner": entry.get("registered_owner"),
                "updated_ts": entry.get("updated_ts", 0.0),
            },
        )
        n_identity += 1
    conn.commit()

    n_history = 0
    for entry in _read_jsonl(IDENTITY_HISTORY_FILE):
        if not entry.get("icao24"):
            continue
        conn.execute(
            "INSERT INTO identity_history (icao24, field, old_value, new_value, ts) VALUES (?, ?, ?, ?, ?)",
            (entry["icao24"], entry.get("field"), entry.get("old"), entry.get("new"), entry.get("ts", 0.0)),
        )
        n_history += 1
    conn.commit()
    return n_identity, n_history


def main():
    storage.init_db()
    n_users = migrate_users()
    n_collections = migrate_collections()
    n_identity, n_history = migrate_identity_cache_and_history()
    print(f"Migrated into {storage.DB_FILE}:")
    print(f"  users:            {n_users}")
    print(f"  collections:      {n_collections}")
    print(f"  identity_cache:   {n_identity}")
    print(f"  identity_history: {n_history}")


if __name__ == "__main__":
    sys.exit(main())
