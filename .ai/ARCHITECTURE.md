# Current Architecture

This is a **map**, not a narrative. Read CLAUDE.md for full detail and rationale.

## UI layer

- The frontend uses the Preline UI framework as the base component layer for static assets.
- `static/styles/app.css` carries the project-specific overrides and the current card/panel system.
- `static/style.css` remains as the legacy compatibility layer for older selectors and load-order-sensitive rules.

## Data sources (nine live feeds plus lazy adsbdb enrichment)

1. **OpenSky Network** (`/api/states`, `/api/track`) — 10s cache, own quota system (daily limit + per-track limit). Shares most fields with radius sources; ICAO24 priority below the free/cheap radius feeds. Falls back to anonymous if auth token unavailable. Circuit-breaker on outage (30s cooldown). (CLAUDE.md § "OpenSky endpoints")

2. **adsb.fi** (`/api/adsbfi`) — Radius source (220nm, center-based), 10s cache. Extra fields: `dbFlags`, `messageType`, `adsbVersion`, DO-260B accuracy codes, `operator`, `calc_track`. (CLAUDE.md § "The four radius sources")

3. **adsb.lol** (`/api/adsblol`) — Radius source, 10s cache, on by default. Upstream has known intermittent hangs; failures degrade to null for that cycle, not hard failure. (CLAUDE.md § "adsb.lol shipped off...")

4. **adsb.one** (`/api/adsbone`) — Radius source, 10s cache. **Row is hidden from HUD entirely** (`display: none`) because upstream sits behind Cloudflare anti-bot block. Still wired up server-side. (CLAUDE.md § "adsb.one's HUD row is hidden...")

5. **airplanes.live** (`/api/airplaneslive`) — Radius source, 10s cache, on by default. Highest priority among radius sources (enrichment order). (CLAUDE.md § "The four radius sources")

6. **Aircraft Scatter** (`/api/aircraftscatter`) — ADSBexchange via RapidAPI, **enabled by default when configured; metered**. Fixed 1,000km point query; 60s cache. ADSBExchange-compatible records, ICAO24-deduped after adsb.one and before OpenSky. Requires `RAPIDAPI_KEY` (otherwise safely empty).

7. **FlightAware AeroAPI** (`/api/flightaware`) — **Auth-required, off by default, metered/paid**. Flight-centric (no ICAO24), deduped by callsign. Contributes `originAirport`/`destinationAirport`. (CLAUDE.md § "FlightAware AeroAPI")

8. **FlightRadar24** (`/api/flightradar24`) — **Off by default**, uses unofficial SDK (`FlightRadarAPI`, `curl_cffi`, Cloudflare TLS fingerprinting). ICAO24-keyed, sits below Aircraft Scatter in enrichment order. High failure risk; caught generically. (CLAUDE.md § "FlightRadar24, via the unofficial `JeanExtreme002/FlightRadarAPI` SDK")

9. **OGN — Open Glider Network** (`/api/ogn`) — **Off by default**. Not an HTTP source: a background daemon thread (`ogn_source.py`) holds a persistent APRS-IS connection (`aprs.glidernet.org:14580`, via the `ogn-client` package) filtered to a range around `AREA_CENTER`, continuously updating an in-memory snapshot; the route just reads it. Covers gliders/tow planes/paragliders/UAVs — a mostly non-overlapping population from the other eight sources. Renders as an independent, non-deduplicated overlay (like FlightAware) since most device addresses are FLARM/OGN-assigned, not real ICAO24.

10. **adsbdb.com** (`/api/adsbdb`) — **Lazy fetch only, not in poll loop**. Enriches identity + route + operator on click. Cached indefinitely. (CLAUDE.md § "adsbdb.com")

## Backend flow

```
Flask app.py (gunicorn 2 workers × 8 threads)
├─ /api/states
│  └─ OpenSky cached (10s TTL) → responses stale-fallback on error
├─ /api/track/<icao24>
│  └─ OpenSky per-ICAO24 (300s TTL) → persistent disk cache
├─ /api/adsbfi, /api/adsblol, /api/adsbone, /api/airplaneslive
│  └─ Radius sources via shared cached_radius_source() (10s TTL)
├─ /api/aircraftscatter
│  └─ ADSBexchange/RapidAPI point query via shared cache (60s TTL)
├─ /api/flightaware
│  └─ FlightAware via cached_flightradar24() with broader Exception catch
├─ /api/flightradar24
│  └─ FlightRadar24 via cached_flightradar24() with broader Exception catch
├─ /api/ogn
│  └─ Reads ogn_source's in-memory snapshot — no fetch/cache/TTL here, a
│     background daemon thread (started from _start_ogn_thread(), both in
│     dev and gunicorn's post_fork) owns a persistent APRS-IS connection
├─ /api/photo/reg/<reg>, /api/photo/hex/<icao24>
│  └─ Planespotters (User-Agent-gated) → infinite cache
├─ /api/photo2/reg/<reg>, /api/photo2/hex/<icao24>
│  └─ airport-data.com top-up (only if Planespotters short) → no cache on error
├─ /api/adsbdb/<icao24>?callsign=<cs>
│  └─ adsbdb aircraft + flightroute → infinite cache
├─ /api/identity/<icao24>
│  └─ Enrichment orchestrator (registration prefix, callsign decode, icao24 blocks, aircraft type+category)
├─ /api/identity/stats
│  └─ Persistent identity-cache counts (SQLite read)
├─ /api/metar, /api/sigmet
│  └─ Aviation weather (aviationweather.gov, 300s TTL, server-filtered by BBOX)
├─ /api/airports
│  └─ OurAirports (vendored, global), filtered by viewport BBOX + scan zone
├─ /api/airports/search
│  └─ search_airports() — ranked name/IATA/ICAO/city/country search, uncached
├─ /api/config
│  └─ AREA_CENTER, initial zoom, radius_nm, active_zone_id, sources
│     (calls _maybe_reload_zone_from_disk() first; sources comes from
│     SOURCES_CONFIG, loaded once at import from config/sources.json,
│     restart-only — no hot-reload counterpart)
├─ /api/zones/active (POST)
│  └─ _apply_zone() + _persist_zone_config() — moves AREA_CENTER/BBOX and every
│     derived value (RADIUS_SOURCES centers, FLIGHTAWARE_QUERY, FLIGHTRADAR24_BOUNDS),
│     clears location-scoped caches, persists only the latest active zone to
│     config/zones.json
├─ /api/collection
│  ├─ GET (list saved aircraft for logged-in user)
│  ├─ POST (save/update one aircraft snapshot)
│  └─ DELETE /<id>
├─ /api/login/google, /api/login/google/callback
│  └─ Authlib OAuth2 + Google → session cookie
├─ /api/me
│  └─ Current session user
└─ /api/logout
   └─ Clear session

Storage (SQLite with WAL mode)
├─ users (sub, email, name, picture, created_ts)
├─ collections (id, user_id, icao24, saved_at, snapshot, location, photo_*) — unique index on (user_id, icao24)
├─ identity_cache (icao24, registration, manufacturer, type, registered_owner)
└─ identity_history (icao24, field, old_value, new_value, ts) — append-only log

Caches (in-memory, per gunicorn process, lost on restart; not critical)
├─ _cache (states) + stale-fallback on error/429
├─ _track_cache (per-ICAO24, persisted to disk .track_cache.json)
├─ radius_source.cache (five entries, one per adsb.fi/lol/one/airplanes.live/Aircraft Scatter)
├─ _flightaware_cache
├─ _flightradar24_cache
├─ _photo_cache (Planespotters + airport-data.com, keyed by "source:reg:value")
├─ _adsbdb_cache (keyed by "icao24:callsign")
└─ _identity_cache (in-memory dict for backward compat, not used for persistence anymore)

Enrichment modules (enrichment/*, pure lookups, no I/O)
├─ countries.py — COUNTRIES dict (194 entries) + country_by_iso() + country_iso_for_name()
├─ registration.py — REGISTRATION_PREFIXES (193 entries, longest-match) + country_for_registration()
├─ callsign.py — AIRLINE_OPERATORS (curated 96 + generated ~5700) + decode_callsign() → (operator, operator_country)
├─ icao24_allocation.py — ICAO24 blocks (184 entries) + country_for_icao24()
├─ aircraft_database.py — TYPE_CODE_TABLE (150+ entries), AircraftDatabaseLookup interface
├─ aircraft_category.py — AIRCRAFT_CATEGORY (150+ entries, MTOW-based) + category_for_type()
├─ airports.py — OurAirports global list (85k entries, lazy-loaded) + nearest_airport() + airports_in_bbox()
├─ icaolist.py — rikgale/ICAOList bottom-tier topup (types 2764, reg prefixes 219, hex ranges 185, airlines 1890) — own "icaolist" source, not folded into Flywme
└─ aircraft_enrichment.py — enrich_identity() orchestrator (live → registration → icao24 → callsign → aircraft_type → category, each with an icaolist fallback below it)

Background tasks (Flask app, daemon thread)
├─ Identity backfill (every 5s: grab visible ICAO24s from cache, resolve any unknown ones to adsbdb, log to identity_cache) — dev-only, not started under gunicorn
├─ One-shot cache warm-up (per process: the five default-enabled feeds; launched after gunicorn `post_fork` or on Flask dev startup; never blocks serving)
└─ OGN APRS-IS connection (ogn_source.py — persistent, not periodic; one per process, started both in dev and via gunicorn's post_fork since the source has no data without it)
```

## Frontend data flow

```
Poll loop (12s cycle, all enabled sources in parallel, early paint then final dedup+render)
│
├─ Fetch /api/states (OpenSky)
├─ Fetch /api/adsbfi, /api/adsblol, /api/adsbone, /api/airplaneslive, /api/aircraftscatter (in parallel)
├─ Fetch /api/flightaware (if enabled)
├─ Fetch /api/flightradar24 (if enabled)
│
└─ renderPoll() twice: once when the fastest real fetch resolves, then once after all settle
   │
   ├─ updateRadiusSourceMarkers() × 5 (airplanes.live → adsb.fi → adsb.lol → adsb.one → Aircraft Scatter)
   │  └─ Each source renders only aircraft no higher-priority source claimed
   │     → contributes to shared excludeIds set before next source runs
   │
   ├─ updateOpenSkyMarkers()
   │  └─ Enriched with radiusRecordsByHex (all radius-source records for this ICAO24)
   │     → only aircraft no higher-priority source claimed
   │
   ├─ updateFlightRadar24Markers()
   │  └─ Same ICAO24-based dedup chain as radius sources (sits below them)
   │
   └─ updateFlightAwareMarkers()
      └─ Callsign-based dedup (separate from ICAO24 chain)
         → Route fields merged into matched ICAO24 aircraft's sidebar
         → Non-matching FlightAware flights show their own markers

Selection (click marker → loadIdentityEnrichment() + loadAdsbdb() + loadGallery() in parallel)
│
└─ buildMergedDetails(icao24) — three-tier priority merge
   ├─ Live feed values (OpenSky or radius source)
   ├─ adsbdb values (aircraft record + flightroute fields)
   └─ Flywme-computed values (enrichment, lowest priority)

Filters (applied during render, not during fetch)
├─ Source toggles (on/off per source, re-runs poll immediately)
├─ Category filter (light/small/large/etc., filters within render loop)
├─ Motion filter (all/air/ground, inline check during render)
├─ Unit toggle (metric/imperial, re-renders sidebar only, no fetch)
└─ Dev mode (shows all fields + per-source badges + all-aircraft table, no fetch)
```

## Script load order (frontend)

This order is **load-bearing** — not rearrangeable without changes:

1. `map-init.js` — Leaflet setup, basemaps, weather
2. `constants.js` — SOURCE_COLORS, FT_TO_M, etc. (used by everyone below)
3. `route-validation.js` — Geometry helpers (pure functions, no DOM/fetch)
4. `state-filters.js` — HUD toggle wiring (uses CATEGORY_ICON_SVGS, SOURCE_COLORS)
5. `sidebar-track.js` — Aircraft selection, sidebar render (uses state-filters' globals)
6. `auth-collection.js` — Google OAuth, collection panel (uses sidebar-track's globals)
7. `icons.js` — Marker icon builders (uses constants, icons)
8. `render-details.js` — Sidebar field formatting (used by sidebar-track at render time)
9. `parsers.js` — Data normalization (OpenSky, adsb.fi, FlightAware, etc.)
10. `main.js` — Poll loop, dedup chain, render orchestration (calls everything above)

Test verifies this order is enforced via `#app > script[src*="..."].src`.

## Key decisions (see DECISIONS.md for ADR details)

- **SQLite over JSONL** (2026-07-20) — Cross-process consistency (gunicorn workers).
- **adsb.one hidden, not disabled** (2026-07-19) — Cloudflare anti-bot blocks it; row remains in DOM but `display: none` to avoid null-crash loops.
- **FlightAware off by default** (2026-07-17) — Metered/paid source; opt-in only.
- **Route validation (Layer 2) on adsbdb only** (2026-07-20) — Geometric checks suppress "Reject" routes in normal mode.
- **Basemap picker default = Voyager** (2026-07-18) — CARTO colorful (not monochrome Light).
- **ICAO24 block corroboration for callsign-decoded operator** (2026-07-20) — Suppresses mismatches for rotorcraft only; dev mode shows them flagged.
- **Runtime zone switching: file persistence + mtime-poll sync** (2026-07-21; compacted 2026-07-27) — Zone changes (via airport search) persist only the latest `active_zone` to `config/zones.json` rather than staying session-only or accumulating unused presets; cross-worker propagation uses a cheap `getmtime()` poll rather than a new SQLite table. `_apply_zone()` recomputes all seven values derived from `AREA_CENTER`/`BBOX` together (three of which were previously frozen at import time and never revisited).
- **Operator-configurable source visibility, gated behind Dev Mode; restart-only config file, no hot-reload** (2026-07-27) — `config/sources.json` moves per-source `visible`/`enabled_by_default` out of hardcoded `index.html` markup, following `config/zones.json`'s convention, but deliberately skips the mtime-poll/cross-worker-sync machinery zones.json needed — this file is hand-edited by an operator, never mutated via an API, so a plain import-time load is sufficient. The whole per-source toggle list only shows at all once Dev Mode is on (moved next to `#source-adsbdb`); `visible` then curates which specific rows Dev Mode actually reveals.
- **Safari blank-map fix: symptom-triggered self-heal, not a blanket 3D-disable** (2026-07-29, resolved) — a blanket `window.L_DISABLE_3D` for every Safari visitor silently killed zoom/pan animation project-wide as a side effect (`L.Browser.any3d` also gates Leaflet's `_zoomAnimated`); replaced with a `sessionStorage`-scoped fallback that only disables 3D transforms (and reloads once) for a tab that has actually observed the blank-map symptom, confirmed fixed in real prod Safari.
- **rikgale/ICAOList as its own bottom-tier source, not folded into Flywme** (2026-07-30) — a broader-but-less-vetted topup dataset (type designators, reg prefixes, hex ranges, airlines) for four existing enrichment tables; kept as a distinct `source: "icaolist"`/badge/dev-mode toggle rather than merged into Flywme's always-on local lookups, so its lower-confidence, less-curated contribution stays visible and independently toggleable.
- **OGN (Open Glider Network) as a ninth source, over a persistent APRS-IS connection, not an HTTP proxy** (2026-08-05) — no plain HTTP GET API exists for OGN; `ogn_source.py` owns a background daemon thread holding one long-lived APRS-IS connection (`aprs.glidernet.org:14580`) and an in-memory snapshot, started both in dev and via gunicorn's `post_fork` since (unlike every other background thread here) the source has no data at all without it running. Renders as an independent, non-deduplicated overlay (like FlightAware) since most OGN device addresses aren't real ICAO24.
