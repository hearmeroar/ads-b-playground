# ADS-B Playground

A single-page live aircraft tracker for Serbia and its neighboring region.
No build step, no database — a Flask backend proxies five free ADS-B data
sources plus FlightAware AeroAPI, and a static Leaflet page polls them and
renders aircraft as color-coded markers.

## Features

- **Six independent live sources**: five ADS-B sources deduplicated against
  each other by ICAO24/hex address (each one only shows what the sources above it
  don't already cover), plus FlightAware AeroAPI as a separate, non-deduplicating
  overlay.
  - [OpenSky Network](https://opensky-network.org/) — blue
  - [adsb.fi](https://github.com/adsbfi/opendata) — red
  - [adsb.lol](https://adsb.lol/) — purple *(off by default: upstream is
    currently unstable)*
  - [adsb.one](https://adsb.one/) — amber *(off by default: currently
    behind a Cloudflare block)*
  - [airplanes.live](https://airplanes.live/api-guide/) — green
  - [FlightAware AeroAPI](https://www.flightaware.com/commercial/aeroapi/) —
    teal *(requires API key; shown independently, never deduplicated against
    the other five)*

  Each source has its own toggle, and any of them failing degrades that one
  source for a cycle rather than breaking the map.
- **Sidebar enrichment** — clicking a marker opens a details sidebar with
  47 fields grouped into sections (identity, position, speed & heading,
  autopilot, weather, status, signal quality). OpenSky's own data has no
  registration/aircraft type; the other sources fill that in automatically
  when they see the same aircraft, without duplicating fields every source
  agrees on. Groups with nothing to show are omitted.
- **Flight history on click** — draws an aircraft's actual track (not just
  positions polled since the page loaded) via OpenSky's `/tracks/all`,
  colored by altitude. Aircraft OpenSky has no history for (common for
  rotorcraft) fall back to a trail collected in-browser since page load.
- **Photo gallery** in the sidebar — a carousel merged from
  [Planespotters](https://www.planespotters.net/photo/api) (primary) topped
  up from [airport-data.com](https://airport-data.com/), with the
  photographer attribution both require. Loads asynchronously, only on
  click, and is cached client-side.
- **Filters**: airborne/on-ground, aircraft category (unified across
  OpenSky's numeric codes and the other sources' letter+digit codes), a
  metric/imperial unit toggle, and a "hide non-aircraft" toggle (off by
  default) that flags ground vehicles and reference beacons (e.g. tower
  test transponders) misreported alongside real traffic.
- **Icons by category** — marker glyph selection is wired up per aircraft
  category (fixed-wing weight classes, rotorcraft, UAV); most currently
  share one placeholder glyph pending better-looking artwork, but ground
  vehicles/reference beacons already get their own neutral-grey cell-tower
  icon instead of an aircraft glyph.
- **Quota-aware** — OpenSky's two independent daily quotas (map data and
  flight history) are each surfaced with a `(?)` explaining what ran out and
  counting down to when it returns. An exhausted map-data quota auto-disables
  the source instead of polling a dead endpoint, and re-enables it once the
  window elapses. Flight-history responses are cached to disk, so a restart
  doesn't re-spend that much stingier quota.
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
- `FLIGHTAWARE_API_KEY` — API key from [FlightAware
  AeroAPI](https://www.flightaware.com/commercial/aeroapi/). Enables the
  FlightAware source on the map; without it, the source shows empty. Optional.
  Note: this is a paid, metered API; each poll costs quota.

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

Alongside them, `schema/aircraft.schema.json` documents the normalized
aircraft shape the sidebar renders — every field, with the raw source field
name and unit it came from.

See [`CLAUDE.md`](CLAUDE.md) for the detailed architecture notes, non-obvious
gotchas, and rationale behind specific decisions.
