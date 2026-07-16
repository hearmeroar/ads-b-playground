# ADS-B Playground

A single-page live aircraft tracker for Serbia and its neighboring region.
No build step, no database — a Flask backend proxies three free ADS-B data
sources, and a static Leaflet page polls them and renders aircraft as
color-coded markers.

## Features

- **Three independent live sources**, deduplicated against each other by
  ICAO24/hex address (OpenSky is primary; adsb.fi and airplanes.live each
  only show what the source(s) above them don't already cover):
  - [OpenSky Network](https://opensky-network.org/) — blue
  - [adsb.fi](https://github.com/adsbfi/opendata) — red
  - [airplanes.live](https://airplanes.live/api-guide/) — green
- **Popup enrichment** — OpenSky's own data has no registration/aircraft
  type; adsb.fi/airplanes.live fill that in automatically when they see the
  same aircraft, without duplicating fields every source agrees on.
- **Flight history on click** — draws an aircraft's actual track (not just
  positions polled since the page loaded), via OpenSky's `/tracks/all`.
- **Aircraft photo** in the popup, from [Planespotters](https://www.planespotters.net/photo/api),
  with required photographer attribution — loads asynchronously, only on
  click, and is cached client-side.
- **Filters**: airborne/on-ground, aircraft category (unified across
  OpenSky's numeric codes and the other two sources' letter+digit codes),
  and a "hide non-aircraft" toggle that flags ground vehicles and reference
  beacons (e.g. tower test transponders) misreported alongside real traffic.
- Optional OAuth2 auth against OpenSky for a much higher daily quota than
  anonymous access.

## Quick start

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

Open http://127.0.0.1:5000.

## Configuration (optional)

Copy `.env.example` to `.env` to enable:

- `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` — OAuth2 credentials from
  your [OpenSky account](https://opensky-network.org/my-opensky/account)
  (API Client section). Raises the daily quota well above anonymous access.
  Without these, the app just falls back to anonymous requests.
- `PLANESPOTTERS_USER_AGENT` — Planespotters requires a descriptive
  User-Agent with contact info; a working default is already set, but you
  can point it at your own contact per their terms.

## Tests

```bash
# Backend (pytest — mocks all outbound HTTP, no live network calls)
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest tests/backend

# Frontend (Playwright — auto-starts the app, mocks every backend route
# with fixtures, so nothing here touches the real external APIs either)
npm install
npx playwright install chromium   # one-time
npx playwright test
```

## Project layout

Two files carry all the logic:

- `app.py` — Flask backend; proxies every external API (mainly to work
  around CORS/User-Agent restrictions) with short-lived caching.
- `static/index.html` — the entire frontend: Leaflet map, polling, marker
  rendering, filters, and the photo/track features, all inline.

See [`CLAUDE.md`](CLAUDE.md) for the detailed architecture notes, non-obvious
gotchas, and rationale behind specific decisions.
