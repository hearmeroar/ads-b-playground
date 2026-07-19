# ADS-B Playground

A single-page live aircraft tracker for Serbia and its neighboring region.
No build step, no database — a Flask backend proxies five free ADS-B data
sources plus FlightAware AeroAPI, and a static Leaflet page polls them and
renders aircraft as color-coded markers. The no-build-step choice fits the
project's current size and isn't a hard rule — it's fine to introduce one
later if a real need for it shows up.

## Features

- **Six independent live sources**: five ADS-B sources deduplicated against
  each other by ICAO24/hex address (each one only shows what the sources above it
  don't already cover), plus FlightAware AeroAPI deduplicated by callsign.
  - [OpenSky Network](https://opensky-network.org/) — blue
  - [adsb.fi](https://github.com/adsbfi/opendata) — red
  - [adsb.lol](https://adsb.lol/) — purple *(upstream is occasionally
    unstable, but a failing cycle just degrades rather than breaking the map)*
  - [adsb.one](https://adsb.one/) — amber *(off by default: currently
    behind a Cloudflare block)*
  - [airplanes.live](https://airplanes.live/api-guide/) — green
  - [FlightAware AeroAPI](https://www.flightaware.com/commercial/aeroapi/) —
    teal *(requires API key, paid/metered so off by default; matched to other
    sources by callsign, when matched its route data enriches the main marker)*

  Each source has its own toggle, and any of them failing degrades that one
  source for a cycle rather than breaking the map.
- **Sidebar enrichment** — clicking a marker opens a details sidebar with
  48 fields grouped into sections (identity, position, speed & heading,
  autopilot, weather, status, signal quality), each section headed by its
  own icon. OpenSky's own data has no registration/aircraft type; the
  other sources fill that in automatically when they see the same
  aircraft, without duplicating fields every source agrees on. Groups
  with nothing to show are omitted. The sidebar leads with a masthead —
  registration/ICAO as the title, callsign and aircraft type below it,
  each tappable for a plain-English explanation of what it is — rather
  than burying those fields in the field list below. A crosshair button
  re-centers the map on the selected aircraft's current position at any
  time, keeping the current zoom level.
- **Flight history on click** — draws an aircraft's actual track (not just
  positions polled since the page loaded) via OpenSky's `/tracks/all`,
  colored by altitude. Aircraft OpenSky has no history for (common for
  rotorcraft) fall back to a trail collected in-browser since page load.
- **Photo gallery** in the sidebar — a carousel merged from
  [Planespotters](https://www.planespotters.net/photo/api) (primary) topped
  up from [airport-data.com](https://airport-data.com/), with the
  photographer attribution both require. Loads asynchronously, only on
  click, and is cached client-side. Photos display at their natural aspect
  ratio (no forced letterboxing), with unobtrusive prev/next arrows
  overlaid directly on the image.
- **Route card** — when a route is known (from FlightAware or the adsbdb
  lookup below), it renders as its own card: large origin/destination
  airport codes with city names underneath, a directional icon between
  them (the aircraft's own category glyph), and a confidence indicator
  when the route came from the adsbdb geometric hypothesis (see below) —
  tap it for a plain-English breakdown of why it's trusted or not. A
  route judged implausible is shown as "Not confirmed" rather than naming
  a likely-wrong airport pair.
- **Filters**: airborne/on-ground, aircraft category (unified across
  OpenSky's numeric codes and the other sources' letter+digit codes), a
  metric/imperial unit toggle, and a "hide non-aircraft" toggle (off by
  default) that flags ground vehicles and reference beacons (e.g. tower
  test transponders) misreported alongside real traffic.
- **Scan-radius rings** — an off-by-default HUD toggle draws concentric
  range rings around the tracked area, showing where the four radius
  sources' shared query radius actually ends: round-number scale rings
  (e.g. every 50 nm) plus one visually distinct ring at the true coverage
  edge, each labeled with its distance.
- **Basemap picker** — switch between nine free, no-API-key map styles
  (Light, Dark, Voyager, Streets, Satellite, Terrain, Physical, Terrain
  Base, Hillshade — including a proper elevation-tint relief map) from a
  HUD dropdown.
- **Weather layers** — four independently toggleable, off-by-default HUD
  layers, any combination at once: live Precipitation radar and a
  short-range Forecast (nowcast) composite via
  [RainViewer](https://www.rainviewer.com/) (free, no API key), plus
  **SIGMET** (aviation hazard zones — icing, turbulence, convective
  activity, ash) and **METAR** (airport weather-station observations,
  colored by flight category) via
  [aviationweather.gov](https://aviationweather.gov/) (NOAA), all
  refreshed every ~5 minutes.
- **Icons by category** — each aircraft category (fixed-wing weight classes,
  rotorcraft, glider, lighter-than-air, parachutist, ultralight, UAV) renders
  with its own distinct SVG silhouette from the
  [ADS-B Radar free icon set](https://adsb-radar.com/). Ground vehicles and
  reference beacons get their own neutral-grey cell-tower icon.
- **Quota-aware** — OpenSky's two independent daily quotas (map data and
  flight history) are each surfaced with a `(?)` explaining what ran out and
  counting down to when it returns. An exhausted map-data quota auto-disables
  the source instead of polling a dead endpoint, and re-enables it once the
  window elapses. Flight-history responses are cached to disk, so a restart
  doesn't re-spend that much stingier quota.
- **Dev mode** — a sidebar toggle for debugging data provenance: shows
  every field (dash for missing data) with a small colored dot per source
  that actually reported it. If several enabled sources independently send
  a value for the same field, every one of them gets its own dot — not
  just whichever value ended up displayed — so you can see at a glance how
  many sources agree on an aircraft's data. Click a dot for a tooltip
  naming its source. Also adds a compact "All aircraft" table — a narrow,
  scrollable list of every visible aircraft's ICAO/callsign/registration/
  type/route, one line each, click any row to open its full sidebar.
- **Identity enrichment** — fills gaps the live feeds leave (country,
  operator, manufacturer/model, year built) from small local lookup tables
  (registration-prefix nationality marks, a placeholder ICAO24 database,
  ICAO airline callsign designators, aircraft-type normalization) — no
  external API, no database, and never overrides a value a live feed
  already supplied. Unresolved fields show "Unknown" rather than a blank
  row. Country (the aircraft's own registration) and **Operator Country**
  (the operating airline's home country — a separate field, since the two
  are frequently different countries) each render with their own small SVG
  flag (the [flag-icons](https://github.com/lipis/flag-icons) library,
  vendored locally — no build step). In dev mode, a computed value gets a
  black "Flywme" dot (this application, as a data source in its own right)
  whose tooltip names the technique and confidence behind it.
- **adsbdb.com lookup** — a seventh source, queried lazily on click (not
  per-poll, no markers of its own) for whatever the live feeds and local
  enrichment still don't have: a **Registered Owner** field (the private/
  corporate registrant — a new concept, distinct from the operating
  airline) and, when the aircraft's route isn't already known from
  FlightAware, its origin/destination airports and operating airline.
  Ranked between the live feed and this app's own computed guesses. Its
  toggle only appears once dev mode is on (on by default there), since it
  has no per-poll footprint to show/hide otherwise. Since adsbdb's route
  comes from a historical callsign lookup rather than a live flight plan,
  it's treated as a hypothesis: a geometric check compares the aircraft's
  actual position/track/speed/altitude against the claimed route and flags
  (rather than hides) one that doesn't add up.
- Optional OAuth2 auth against OpenSky for a much higher daily quota than
  anonymous access.
- Optional OAuth2 auth against OpenSky for a much higher daily quota than
  anonymous access.
- **Aircraft collection** — sign in with Google, then save any aircraft
  you're looking at (a bookmark toggle in the sidebar, filled once saved) as
  a compact card: registration, type, and a photo, snapshotted at save time
  so it stays meaningful long after the aircraft is gone from any live feed.
  One card per aircraft — re-saving just refreshes it. Browse saved cards in
  a fullscreen "My collection" panel (opened from the HUD), grouped by
  category (light/small/large/heavy/etc). Removing a card is immediate but
  forgiving — it dims in place with an Undo action for the rest of the
  session. Aircraft with no usable category info at all (ADS-B code "C0")
  can't be saved.

## Quick start

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

Open http://127.0.0.1:5051.

## Configuration (optional)

Copy `.env.example` to `.env` to enable:

- `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` — OAuth2 credentials from
  your [OpenSky account](https://opensky-network.org/my-opensky/account)
  (API Client section). Raises the daily quota well above anonymous access.
  Without these, or if OpenSky's auth server is unreachable, the app just
  falls back to anonymous requests.
- `PLANESPOTTERS_USER_AGENT` — Planespotters requires a descriptive
  User-Agent with contact info; a working default is already set, but you
  can point it at your own contact per their terms.
- `FLIGHTAWARE_API_KEY` — API key from [FlightAware
  AeroAPI](https://www.flightaware.com/commercial/aeroapi/). Enables the
  FlightAware source on the map; without it, the source shows empty. Optional.
  Note: this is a paid, metered API; each poll costs quota.
- `SECRET_KEY` — signs the login session cookie. Without it, a random key is
  generated on every process start, which logs everyone out on every
  restart (including Flask debug's auto-reload on each file save) — set a
  fixed value so logins survive restarts.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — OAuth 2.0 credentials for
  "Sign in with Google" (the aircraft collection feature). Create an OAuth
  client in the [Google Cloud Console](https://console.cloud.google.com/)
  (APIs & Services → Credentials → OAuth client ID → Web application), and
  add both `http://127.0.0.1:5051/api/login/google/callback` (dev) and
  `http://127.0.0.1:5050/api/login/google/callback` (test runner) as
  authorized redirect URIs. Without these, `/api/login/google` returns
  `not_configured` instead of starting the OAuth flow.

## Deployment

The `Dockerfile` targets [Northflank](https://northflank.com/) (port 7860,
gunicorn with gthread workers). Signed-in state and the aircraft collection
are already shared across devices — Google login and saved cards are keyed
by account, not by device — as long as every device talks to the same
running backend.

What isn't automatic is surviving a redeploy or restart: `USERS_FILE`,
`COLLECTIONS_FILE`, `TRACK_CACHE_FILE`, `IDENTITY_CACHE_FILE`, and
`IDENTITY_HISTORY_FILE` all default to plain files written next to `app.py`,
inside the container's own writable layer. Without a persistent volume
mounted there, a redeploy wipes logins, saved collections, and the cached
track/identity data. To persist them, mount a volume on the deployment and
point each of those env vars at a path inside it, e.g.:

```
COLLECTIONS_FILE=/data/.collections.jsonl
USERS_FILE=/data/.users.jsonl
TRACK_CACHE_FILE=/data/.track_cache.json
IDENTITY_CACHE_FILE=/data/.aircraft_identity_cache.jsonl
IDENTITY_HISTORY_FILE=/data/.identity_history.jsonl
```

No code change is required — every one of these already reads its path from
the environment.

**OpenSky specifically won't work from Northflank (or any Google Cloud/AWS/
other hyperscaler-hosted deployment)**: OpenSky's own FAQ states they may
block hyperscaler IP ranges outright due to abuse, and this was confirmed
live from a Northflank pod — DNS resolves fine and unrelated hosts connect
in well under a second, but a raw TCP connect to `opensky-network.org`
times out on both port 80 and 443, meaning the connection is being dropped
at OpenSky's end, not failing locally. The app degrades gracefully (see
`app.py`'s outage circuit-breaker) rather than this taking the rest of the
app down with it, but the OpenSky source itself will simply stay empty on
a hyperscaler deployment. It works fine running locally or on non-
hyperscaler hosting; the other five sources (adsb.fi, adsb.lol, adsb.one,
airplanes.live, FlightAware) are unaffected everywhere.

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

A handful of plain files carry all the logic:

- `app.py` — Flask backend; proxies every external API (mainly to work
  around CORS/User-Agent restrictions) with short-lived caching.
- `enrichment/` — local static lookup tables (registration prefix, ICAO24
  placeholder database, callsign decoding, aircraft type normalization)
  that fill identity gaps the live feeds don't cover, served via
  `/api/identity/<icao24>`. No external API, no database.
- `static/index.html` — the frontend markup (map container, HUD, sidebar).
- `static/js/` — the frontend logic (Leaflet map, polling, marker rendering,
  filters, photo/track features, Google sign-in + the aircraft collection)
  as ten plain classic `<script src>` files loaded in a fixed order — still
  no framework and no build step.
- `static/style.css` — the frontend's styling, linked from `index.html`.
- `static/flag-icons/` — the [flag-icons](https://github.com/lipis/flag-icons)
  SVG library (CSS + `flags/4x3/`), vendored as plain files (via `npm install
  flag-icons` then a one-time copy — no runtime npm dependency, no build step).
- `static/leaflet/` — [Leaflet](https://leafletjs.com) 1.9.4 (`leaflet.js`,
  `leaflet.css`, `images/`, `LICENSE`), vendored the same way instead of
  loading from the unpkg CDN, so the map works without third-party uptime
  (and the Playwright suite runs without touching the network).

Alongside them, `schema/aircraft.schema.json` documents the normalized
aircraft shape the sidebar renders — every field, with the raw source field
name and unit it came from.

See [`CLAUDE.md`](CLAUDE.md) for the detailed architecture notes, non-obvious
gotchas, and rationale behind specific decisions.

## Attribution

**Aircraft SVG icons** by [ADS-B Radar for macOS](https://adsb-radar.com) —
[App Store](https://apps.apple.com/app/id1538149835). Free to use for personal
and commercial projects.

**Aircraft, airline, and flightroute lookup data** via
[adsbdb.com](https://www.adsbdb.com), which itself credits
[PlaneBase](http://planebase.biz/) for aircraft data, flightroute data to
David Taylor (Edinburgh) and Jim Mason (Glasgow), and
[airport-data.com](https://www.airport-data.com) for aircraft photographs.
