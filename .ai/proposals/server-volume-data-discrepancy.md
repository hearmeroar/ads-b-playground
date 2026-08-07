# Server Volume Data Discrepancy

## What we observed

The local workspace and the deployed Northflank volume do not currently look
the same.

Local workspace:

- the current repo has a local SQLite file at `.app.db`
- this file is not tracked in git
- the local database has been reshaped during investigation

Server volume:

- the Northflank service mounts the `data` volume at `/data`
- `/data` contains `app.db`, `app.db-wal`, `app.db-shm`
- `/data` also still contains the old JSONL files:
  - `.users.jsonl`
  - `.collections.jsonl`
  - `.aircraft_identity_cache.jsonl`
  - `.track_cache.json`

The important point is that the server database is not guaranteed to match the
local one. The deployed environment appears to carry its own persistent data
state, and that state may still be using a different schema or different data
mix than the local checkout.

## Why this matters

This project now has two distinct data histories:

- the local repo's current working database and changes
- the server's persistent volume, which may still include older files and
  different migration state

That means any assumptions about the main aircraft table have to be verified
against the server volume, not inferred from the local checkout.

## Questions to answer

1. Which files on `/data` are actually authoritative at runtime?
2. Is `app.db` on the server built from the old JSONL files, the newer SQLite
   tables, or a mix of both?
3. What schema is present on the server right now, and does it match the local
   schema?
4. Are there any code paths still reading the old JSONL files directly on the
   deployed instance?
5. If local and server diverged, what is the expected source of truth for
   future migrations?

## Suggested next step

Open the server shell and inspect:

```bash
python3 - <<'PY'
import sqlite3
conn = sqlite3.connect('/data/app.db')
for (name,) in conn.execute("select name from sqlite_master where type='table' order by name"):
    print(name)
PY
```

Then compare:

- table list
- row counts
- timestamps
- whether the old JSONL files are still read or only retained as archives

## Current status

This is a documentation-only note. No code change is implied yet.
