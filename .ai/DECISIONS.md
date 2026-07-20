# Architecture Decision Records (ADR)

Append-only log of architecturally-significant decisions. Newest entries at bottom.

---

## 2026-07-20 — SQLite migration for cross-process consistency

**Problem:** The app runs in gunicorn with 2 worker processes. Each process had its own in-memory dict (`_identity_cache`, `_users`, `_collections`) loaded once from JSONL files on import. When one process saved a new entry and rewrote the JSONL file, the other process never saw it — a save in process A could vanish moments later when a request hit process B. Silent data loss, unpredictable, hard to debug.

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

**Problem:** `api.adsb.one` sits behind Cloudflare's anti-bot layer and rejects all scraped/non-browser requests with a 403 "Sorry, you have been blocked" page. Confirmed on two independent networks (residential ISP + Northflank/GCP production pod). No User-Agent/Referer/Origin spoofing helps — it's JA3/JA4 TLS fingerprinting, which only real browsers pass. ADSB-One's own policy (per sibling project adsb.lol's docs) is that scripted API access requires feeding the network as a contributor — not a bug, deliberate.

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

**Problem:** The app decodes callsigns to airlines (ICAO 3-letter designator → operator + operator country). But callsign collisions exist: a Romanian rescue helicopter's "MAI" callsign (Ministry Internal Affairs) matches Mauritania Airlines International. The decoded operator is wrong, but there's no way to know without independent corroboration.

**Decision:** Added ICAO24 block allocation table as an independent signal (every aircraft's hex address is permanently assigned to a state by ICAO). When callsign-decoded operator disagrees with ICAO24's state, flag the match as unconfirmed. For rotorcraft (where cross-border leasing is rare), suppress the mismatched value entirely in normal mode; for fixed-wing (where it's routine), show it plainly. Dev mode shows the suppressed value with `⚠ Unconfirmed` tag.

**Reason:** Rotorcraft are predominantly domestic ops (EMS, police, military); a mismatch is a real red flag there. Fixed-wing regularly crosses borders and leases internationally, so a mismatch isn't inherently wrong.

**Tradeoffs:**
- Adds one more lookup (icao24_allocation.py, 184 ICAO blocks, ~0.1ms scan). Negligible.
- Increases complexity of the "which source to display" logic for Operator Country. Mitigated by documenting the rule clearly in dev-mode tooltips.

**References:** CLAUDE.md § "Identity enrichment" → "icao24_allocation.py", § "Registered Owner is a brand new field" (context on three-way country confusion that prompted this)
