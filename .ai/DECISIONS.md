# Architecture Decision Records (ADR)

Append-only log of architecturally-significant decisions. Newest entries at bottom.

---

## 2026-07-20 — SQLite migration for cross-process consistency

**Problem:** Cross-process data loss under gunicorn's 2 worker processes, each holding its own in-memory copy of users/collections/identity loaded from JSONL. Full mechanism: CLAUDE.md § "Aircraft collection" → "Durable storage is SQLite...".

**Decision:** Migrated users/collections/identity caching from per-process JSONL dicts to a **single SQLite database** (`.app.db`) in WAL mode, shared across all gunicorn worker processes.

**Reason:** SQLite's WAL mode ensures correct concurrent reads/writes across multiple processes with zero coordination overhead. No separate database server needed (sqlite3 is Python stdlib). Atomicity and durability for user-facing state (saved aircraft, account info).

**Tradeoffs:**
- SQLite doesn't scale to millions of rows, but this app's persistence is light (hundreds of users, thousands of saved aircraft) — acceptable fit.
- Per-thread connection pooling added (`threading.local`), matching gunicorn's `--threads 8` model. Minimal complexity.
- Short-lived request caches (states, tracks, photos) still live in-process-memory, not SQLite — not critical, can diverge, 10-300s TTL anyway.

**References:** CLAUDE.md § "Aircraft collection" → "Durable storage is SQLite...", § "Identity enrichment" → "Persistent aircraft-identity cache"

---

## 2026-07-20 — Route validation (Layer 2 geometric check) on adsbdb routes only

**Problem:** adsbdb's flightroute lookup is historical/opportunistic (callsign→route via past observation database), not live flight-plan data. Real aircraft can legitimately have mismatched position/track/speed vs. the claimed route (schedule variance, diverts, wrong callsign, expired codeshare). False positives (claiming a route that's provably wrong) need surfacing to the user, but "probably not this route" shouldn't suppress the data.

**Decision:** Built a **Layer 2 validation** (geometric checks on current position/track/speed/altitude against origin/destination) that scores adsbdb routes 0–100 confidence (Reject/Low/Medium/High/Very High bands). Reject and Low routes hide specific airport names in normal mode; Medium+ show plainly. FlightAware routes bypass this (live/paid, assumed correct).

**Reason:** adsbdb doesn't warrant the user's trust the way a live flight-tracking API does. The geometric tests (track alignment, cross-track distance, progress along route, speed/altitude phase-of-flight heuristics) are standard aviation diagnostics; a rejected route that's provably off deserves hiding rather than misdirecting.

**Tradeoffs:**
- Five independent checks (track, distance, progress, terminal-speed, terminal-altitude) each with their own piecewise-linear scoring band — tuned by hand against real data, not rigorous. Could be improved with ML, but overkill for this use case.
- Recomputed on every poll (cheap, no caching), not just on click — updates live as the aircraft moves.
- Route card (in sidebar) is now a visual design piece (IATA codes + direction glyph + confidence dot), not just a text line.

**References:** CLAUDE.md § "Route validation (Layer 2..."

---

## 2026-07-19 — adsb.one hidden, not disabled — Cloudflare anti-bot block

**Problem:** `api.adsb.one` blocks all scripted access via Cloudflare anti-bot (JA3/JA4 TLS fingerprinting) — deliberate upstream policy, not a bug. Full confirmation details (two-network test, header-spoofing attempts, ADSB-One's stated feeder policy): CLAUDE.md § "adsb.one's HUD row is hidden...".

**Decision:** Removed the adsb.one row from the HUD entirely (`display: none` in CSS, not DOM removal). Checkbox and backend route left untouched for future restoration.

**Reason:** A disabled toggle that never works is worse UX than no control at all. If the Cloudflare block lifts in the future (either adsb.one policy changes or they add an authenticated path), reverting is a one-line CSS change, not re-wiring the whole HUD.

**Tradeoffs:**
- User loses that data source entirely (but the four other radius sources + OpenSky cover the same area, so not a regression).
- Backend route (`/api/adsbone`) still exists and would work if Cloudflare block lifted — zero wasted logic, just silently unused.
- Code smell: `#toggle-adsbone`, `sourceToggles['adsbone']`, and marker map keys still reference a user-invisible source. Intentional — recoveability is worth the one-line override.

**References:** CLAUDE.md § "adsb.one's HUD row is hidden...", § "adsb.lol shipped off..."

---

## 2026-07-18 — Basemap picker default = Voyager (CARTO colorful), not Light

**Problem:** The original hardcoded basemap was CARTO Positron (Light — monochrome, minimalist). User asked for options and explicitly re-approved switching the default to Voyager (colorful labeled streets).

**Decision:** Added a basemap picker dropdown (nine free styles: three CARTO, one OSM, five Esri) with Voyager as the default (no longer Light).

**Reason:** Voyager is more visually engaging and helps users orient themselves faster on unfamiliar areas. The reachability of the same data didn't change — toggle still refreshes markers live — just the background layer.

**Tradeoffs:**
- Voyager has slightly more visual noise than Light (more labels = potential marker occlusion at low zoom). Accepted trade.
- Basemap choice is session-only (no localStorage persistence) — users pick again on reload. Intentional, matching the app's "no persistence except login" philosophy.

**References:** CLAUDE.md § "Basemap picker"

---

## 2026-07-17 — FlightAware AeroAPI off by default (metered/paid)

**Problem:** FlightAware is the only live, flight-plan-backed flight tracking source available (6th source). But it's metered access with per-request cost. Even at 10s poll intervals, enabling it 24/7 racks up charges. User needs control over whether to burn that budget.

**Decision:** Ship FlightAware off by default (visible checkbox, unchecked). Same structure as other sources, but default is opt-in, not opt-out.

**Reason:** Respects the user's cost consciousness while keeping the feature available. On/off toggle is trivial and visible in the HUD.

**Tradeoffs:**
- Two "paid/risky" sources now ship off (FlightAware + FlightRadar24). Users who want them enabled have to remember to toggle. Acceptable — the conscious choice is the point.

**References:** CLAUDE.md § "FlightAware AeroAPI"

---

## 2026-07-20 — ICAO24 block corroboration for callsign-decoded operator (rotorcraft suppression)

**Problem:** Callsign-decoded operator can collide with an unrelated airline's ICAO designator (real example found and detailed in CLAUDE.md § "Identity enrichment" → "icao24_allocation.py"), with no independent way to catch it.

**Decision:** Added ICAO24 block allocation table as an independent signal (every aircraft's hex address is permanently assigned to a state by ICAO). When callsign-decoded operator disagrees with ICAO24's state, flag the match as unconfirmed. For rotorcraft (where cross-border leasing is rare), suppress the mismatched value entirely in normal mode; for fixed-wing (where it's routine), show it plainly. Dev mode shows the suppressed value with `⚠ Unconfirmed` tag.

**Reason:** Rotorcraft are predominantly domestic ops (EMS, police, military); a mismatch is a real red flag there. Fixed-wing regularly crosses borders and leases internationally, so a mismatch isn't inherently wrong.

**Tradeoffs:**
- Adds one more lookup (icao24_allocation.py, 184 ICAO blocks, ~0.1ms scan). Negligible.
- Increases complexity of the "which source to display" logic for Operator Country. Mitigated by documenting the rule clearly in dev-mode tooltips.

**References:** CLAUDE.md § "Identity enrichment" → "icao24_allocation.py", § "Registered Owner is a brand new field" (context on three-way country confusion that prompted this)

---

## 2026-07-21 — Runtime zone switching: file persistence + mtime-poll cross-worker sync

**Problem:** `config/zones.json` (loaded 2026-07-20, commit `b2d49fb`) only ever loaded once at import time — there was no way to change the app's coverage area without editing the file by hand and restarting. Building a search-driven "jump to this airport" feature meant deciding how a runtime zone change should behave under this app's actual deployment shape: 2 gunicorn worker processes, each with its own copy of `AREA_CENTER`/`BBOX`/etc. as plain module globals (the same structural issue `storage.py`'s SQLite migration, 2026-07-20, already solved for collections/identity).

**Decision:** Zone changes persist to `config/zones.json` (survive a restart, matching the file's existing role as the single source of truth for the coverage area) rather than staying session-only in memory. Cross-worker propagation uses a cheap `os.path.getmtime()` poll (`_maybe_reload_zone_from_disk()`, called at the top of every route that reads a zone-derived value) rather than a second SQLite table — a zone change is a rare, low-frequency event, so a stat-call-per-request is negligible next to the outbound HTTP calls those routes already make, and it reuses the existing file rather than adding new schema.

**Reason:** File persistence was chosen over session-only because this is a single-tenant app where the zone is a shared, backend-authoritative setting (unlike per-user preferences such as basemap/units, which stay in frontend-only state) — losing it on every restart would make the feature feel broken. Mtime-polling was chosen over a SQLite-backed active-zone table because the access pattern (rare writes, cheap reads, no relational query need) doesn't justify a second persistence mechanism when `storage.py` already exists for state that actually needs it — this stays consistent with `config/zones.json`'s pre-existing role rather than duplicating it.

**A second, related finding drove most of the actual implementation work:** three more values were frozen at import time and never revisited before this (full enumeration and the "seven values" list: CLAUDE.md § "Area coupling"). `_apply_zone()` is the one function that now recomputes all of them together, so this class of bug can't recur even if a future change touches only one by mistake.

**Tradeoffs:**
- A worker can serve up to one request with a stale zone before its own `_maybe_reload_zone_from_disk()` check fires — acceptable for a rare, human-triggered event, not treated as a hard real-time guarantee.
- Radius/zoom are deliberately left untouched by a zone change (center-only) — a v1 scope decision; extending the search UI to also offer a radius override is a possible follow-up, not built here.
- `_persist_zone_config()`'s disk write is best-effort (an unwritable `config/zones.json` doesn't fail the request) — matches this app's existing pattern of treating disk persistence as an optimization (e.g. the track cache), not a hard requirement, for state that isn't the source of truth for anything else running in the same request.

**References:** CLAUDE.md § "Zone search", `app.py`'s `_apply_zone()`/`_persist_zone_config()`/`_maybe_reload_zone_from_disk()` docstrings, `.ai/BACKLOG.md`'s superseded "make the app's geographic view zone easy to change" item
