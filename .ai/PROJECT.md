# Project Overview

## What this is

A **single-tenant live aircraft tracker** built with no framework, no build step, and no signup/API-key data sources — Flask proxies seven independent data feeds (OpenSky, adsb.fi, adsb.lol, adsb.one, airplanes.live, FlightAware AeroAPI, FlightRadar24, plus adsbdb.com for lazy enrichment) to a static Leaflet map and a vanilla-JS frontend. Users can save favorite aircraft to a personal collection (Google OAuth login, SQLite persistence). All components share one source of truth: `AREA_CENTER` (currently Serbia, 44°N 21°E, 220 nm radius), though the Airports layer extends globally.

**Goals:**
- Operate offline (all external data proxied; Leaflet/tiles vendored locally).
- Scale to multi-user without framework overhead (SQLite + gunicorn workers).
- Demonstrate live data collection from multiple independent services and graceful degradation when any fail.
- Stay maintainable by a single developer (no complex abstraction, clear data flow, comprehensive inline documentation in CLAUDE.md).

**Non-goals:**
- Real-time multi-second precision (10s poll cycle is intentional, matching free-tier API limits).
- Predictive routing or flight planning (data is observational, not operational).
- Aircraft photos beyond a small gallery lookup (Planespotters + airport-data.com + adsbdb, not a full archive).

## Hard Constraints

These are lines that must never be crossed without explicit review and documented reasoning:

- **Ports 5051/5050 only:** OAuth client is hardcoded to these ports. Running on any other port breaks Google login. (See CLAUDE.md § "Commands")
- **No build step:** All frontend is classic `<script>` tags in load order; tests verify order-dependent behavior. No bundler, minifier, or transpiler. (See CLAUDE.md § "Conventions")
- **No signup/API-key data sources:** All seven live feed sources are anonymous-access only (OpenSky + four radius sources + FlightAware + FlightRadar24), or they're lazy-fetched enrichment (adsbdb). No paywalls or authentication tokens for map data. (See CLAUDE.md § "Architecture")
- **Single `AREA_CENTER` derivation:** All scan-radius values, bbox queries, and Airports layer filtering derive from one constant. Moving the coverage area requires updating one line, not six. (See CLAUDE.md § "Area coupling")
- **Classic-script load order is significant:** Frontend JS files are not ES modules; they share one global scope, and their `<script>` order in index.html is load-bearing. Tests verify this. (See CLAUDE.md § "What this is")
- **SQLite, not JSONL files:** After 2026-07-20, users/collections/identity/history live in one SQLite database for cross-process consistency (gunicorn workers). JSONL is gone. (See CLAUDE.md § "Aircraft collection" → "Durable storage")
- **Route validation is Layer 2 only, adsbdb-only:** Geometric checks (track, distance, progress, speed/altitude) apply *only* to adsbdb routes, not FlightAware (which is live/paid). "Reject" routes hide names; "Low" routes show with warning; "Medium+" show plainly. (See CLAUDE.md § "Route validation")

## Layout

```
.
├── app.py                    # Flask backend (all routes, all data sources)
├── storage.py               # SQLite persistence layer (users, collections, identity)
├── enrichment/              # Local static lookups (countries, registration prefixes, airlines, ICAO24 blocks, etc.)
│   ├── countries.py
│   ├── registration.py
│   ├── callsign.py
│   ├── aircraft_database.py
│   ├── aircraft_category.py
│   ├── icao24_allocation.py
│   ├── airports.py
│   └── data/                # Vendored CSVs (opensky_year_built.json, ourairports.json)
├── static/
│   ├── index.html           # Markup (one page, no SPA framework)
│   ├── style.css            # All styling (no SCSS, no build)
│   ├── js/
│   │   ├── map-init.js      # Leaflet setup, basemaps, weather, scan-radius rings
│   │   ├── constants.js     # Shared constants (source colors, units, icons)
│   │   ├── route-validation.js  # Geometry functions (bearing, distance, progress)
│   │   ├── state-filters.js # HUD toggles (sources, category, motion, units, dev mode)
│   │   ├── sidebar-track.js # Sidebar rendering, aircraft selection, enrichment merge
│   │   ├── auth-collection.js   # Google OAuth, collection panel
│   │   ├── icons.js         # Marker icons by category, gallery logic
│   │   ├── render-details.js    # Sidebar field formatting, tooltips, source badges
│   │   ├── parsers.js       # Data normalization (OpenSky, adsb.fi, FlightAware, etc.)
│   │   └── main.js          # Poll loop, dedup chain, filter logic
│   ├── leaflet/             # Leaflet 1.9.4 vendor (no CDN)
│   ├── leaflet-markercluster/   # Cluster plugin vendor
│   ├── flag-icons/          # Flag SVGs vendor (CC0)
│   ├── airline-logos/       # Airline icons vendor (soaring-symbols tier 1, airframesio tier 2)
│   ├── ADS-B_Radar_Free_Aircraft_SVG_Icons/  # Aircraft category glyphs vendor
│   └── test-icon.html       # Reference page for icon rendering verification
├── schema/
│   └── aircraft.schema.json # Field definitions + sources
├── tests/
│   ├── backend/             # pytest (mocks all HTTP)
│   └── frontend/            # Playwright (mocks all /api routes)
├── migrate_jsonl_to_sqlite.py   # One-off import script for old JSONL → SQLite
├── CLAUDE.md                # Full documentation for AI agents
├── README.md                # User-facing install/run guide
├── .ai/                     # AI agent memory system (this layer)
│   ├── PROJECT.md           # This file (overview, goals, constraints)
│   ├── ARCHITECTURE.md      # Current-state map (sources, modules, data flow)
│   ├── DECISIONS.md         # ADR log (architecturally-significant decisions)
│   ├── CURRENT.md           # What's actively being worked on
│   └── BACKLOG.md           # Parked ideas/features
├── .github/
│   └── workflows/tests.yml  # CI: pytest + Playwright on every push/PR
├── Dockerfile               # Production deployment (gunicorn 2 workers, 8 threads)
├── playwright.config.js     # Test config (auto-starts app on port 5050)
└── pytest.ini               # Backend test config
```
