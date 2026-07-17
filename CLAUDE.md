# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page live aircraft tracker: a Flask backend proxies three
independent ADS-B data sources — OpenSky Network, adsb.fi, and
airplanes.live — and a static Leaflet page polls all three and renders
aircraft as rotated, color-coded markers. Two files carry all the logic:
`app.py` (backend) and `static/index.html` (frontend, inline CSS/JS, no
build step).

## Commands

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python app.py        # runs on http://127.0.0.1:5000
```

No linter or build step exists in this project. Tests:

```bash
# Backend (pytest, mocks all outbound requests.get/post — no live network calls)
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest tests/backend

# Frontend (Playwright — auto-starts app.py on :5050 via playwright.config.js,
# a non-default port that avoids macOS's AirPlay Receiver on :5000; every
# backend route is mocked with tests/frontend/fixtures/*.json so nothing here
# touches the real OpenSky/adsb.fi/airplanes.live/Planespotters APIs either)
npm install
npx playwright install chromium   # one-time
npx playwright test
```

## Architecture

**Why there's a backend at all:** OpenSky does not send CORS headers for
arbitrary origins (verified: `Access-Control-Allow-Origin` is hardcoded to
`https://opensky-network.org` regardless of the request's `Origin`), so the
frontend cannot call it directly from the browser. `app.py` proxies all three
sources so the architecture (caching, error handling) is uniform, even though
adsb.fi/airplanes.live themselves may not need a CORS workaround.

**OpenSky endpoints proxied by `app.py`:**
- `/api/states` → `/states/all`, bbox-filtered via `BBOX` (currently centered
  on Serbia, `41.5–46.5°N, 17–25°E`). Cached for `MIN_INTERVAL` (10s) — no
  matter how many frontend polls land in that window, OpenSky is hit at most
  once. On a 429 or network error, the last good response is re-served with
  `stale`/`error` flags instead of failing the request.
- `/api/track/<icao24>` → `/tracks/all?time=0`, giving an aircraft's current
  or most-recent flight history (not an arbitrary historical timestamp). Has
  its own per-icao24 cache (`TRACK_MIN_INTERVAL`, 15s) so repeated clicks
  don't spend extra quota. Tracks use OpenSky's independent `/tracks/*`
  credit bucket, separate from `/states/*`; a 429 response forwards
  `rate_limit_remaining` and `retry_after_seconds` when OpenSky supplies
  those headers. A live check on 2026-07-17 returned a 429 with a 54,789 s
  retry window and no remaining-credit header. Returns 404 passthrough when
  OpenSky has no track for that aircraft. This also works for adsb.fi/
  airplanes.live markers, since all three sources key aircraft by the same
  ICAO24/hex address.

**Optional OAuth2 auth (`app.py`):** If `OPENSKY_CLIENT_ID` and
`OPENSKY_CLIENT_SECRET` are set (via `.env`, loaded through `python-dotenv`),
`get_access_token()` exchanges them for a bearer token via OpenSky's
`client_credentials` flow and `fetch_opensky()` attaches it to both endpoints
above, retrying once on a 401 (token invalidated early). Without those env
vars it silently falls back to anonymous requests. The remaining daily quota
is read from the `X-Rate-Limit-Remaining` response header and forwarded to
the frontend as `rate_limit_remaining`.

**adsb.fi and airplanes.live** (`/api/adsbfi` →
`opendata.adsb.fi/api/v3/lat/.../lon/.../dist/...`, see
https://github.com/adsbfi/opendata; `/api/airplaneslive` →
`api.airplanes.live/v2/point/.../.../...`, see
https://airplanes.live/api-guide/): both fully anonymous, no daily quota, so
they need none of OpenSky's auth machinery — just `cached_radius_source()`,
a short shared cache/retry helper (`ADSBFI_MIN_INTERVAL` /
`AIRPLANESLIVE_MIN_INTERVAL`). Neither has a bbox query, only lat/lon/radius
(nautical miles, max 250 for both), so `ADSBFI_CENTER` /
`AIRPLANESLIVE_CENTER` approximate the same area as `BBOX`. Both return the
same ADSBExchange-compatible JSON shape (altitude in feet, speed in knots —
converted client-side to match OpenSky's units).

**Area coupling:** `BBOX`, `ADSBFI_CENTER`, `AIRPLANESLIVE_CENTER` in
`app.py`, and the map's initial center/zoom in `static/index.html`
(`map.setView(...)`), are four independent constants that must be kept
roughly in sync manually — there's no shared config between backend and
frontend.

**Aircraft photos, two sources, Planespotters primary + airport-data.com
top-up** (`app.py`):
- `/api/photo/reg/<registration>`, `/api/photo/hex/<icao24>` →
  `api.planespotters.net/pub/photos/...` (see
  https://www.planespotters.net/photo/api) — the primary source, whenever it
  has *anything at all* for that aircraft. Unlike every other proxy above,
  this one exists despite CORS being open (`Access-Control-Allow-Origin: *`)
  — Planespotters instead 403s any request without a descriptive User-Agent
  containing contact info, which browsers don't let JS set at all.
  `fetch_planespotters()` sends `PLANESPOTTERS_USER_AGENT` (configurable via
  `.env`, defaults to a placeholder that already satisfies their check) and
  caches by `"reg:X"`/`"hex:X"` key with no expiry — a photo of a given tail
  number doesn't change. The frontend uses the *entire* returned array, not
  just the first photo.
- `/api/photo2/reg/<registration>`, `/api/photo2/hex/<icao24>` →
  `airport-data.com/api/ac_thumb.json` — queried only to **top up** whatever
  Planespotters didn't fully cover, up to `GALLERY_TARGET_COUNT` (frontend,
  see below); never queried at all if Planespotters alone already meets the
  target. Takes `n` (how many more are wanted) and, for the `hex` route
  only, an optional `reg` query param passed through as airport-data.com's
  own `r` param for a more precise match. `n` is an upper bound, not a
  guarantee — airport-data.com's own docs say so ("Max number of results,
  default is 1"), confirmed in practice (aircraft G-STBC with `n=5` returned
  only `count: 2`) — callers must use however many photos actually came
  back, never assume the count requested. `ac_thumb.json`'s own `image`
  field is always a small ~200px thumbnail
  (`airport-data.com/images/aircraft/thumbnails/.../<id>.jpg`);
  `_airportdata_fullsize_url()` extracts that numeric id from `image` (or
  `link`) and reconstructs a full-size URL at
  `image.airport-data.com/aircraft/<id>.jpg` (confirmed manually: real
  1200×800px photos, watermarked) — used as `thumbnail_large.src` instead of
  the thumbnail. Not every id resolves at that path, so the original
  thumbnail is also passed through unconditionally as `fallback_src`, for
  the frontend to degrade to client-side (see below) rather than leave a
  broken image if the reconstructed URL 404s. `fetch_airportdata()`
  normalizes all of this to the same `{thumbnail_large: {src}, fallback_src,
  link, photographer}` shape Planespotters returns (`fallback_src: null` for
  Planespotters entries), so the frontend's gallery code doesn't need to
  know which source a given photo came from. 404 (nothing found) caches an
  empty list like any stable answer; 429/5xx return an empty list
  *without* caching, so a later open can retry instead of being stuck empty
  for the rest of the session. Must use the bare domain, not
  `www.airport-data.com`: the `www` subdomain's TLS cert doesn't match its
  own hostname.

**Photo gallery in `static/index.html`:** rendered into `#sidebar-gallery` (a
carousel with dot/arrow navigation when there's more than one photo), loaded
only from `selectAircraft()` — i.e. only on an explicit marker click, never
on poll/pan/zoom. `loadGallery()`: fetches Planespotters' full array and
renders it immediately; if that's short of `GALLERY_TARGET_COUNT` (4),
fetches airport-data.com asynchronously for `GALLERY_TARGET_COUNT -
planespottersCount` more and appends whatever comes back once it resolves,
without blocking the first paint. The gallery always shows exactly as many
slides as photos actually found — never padded with placeholder slots up to
the target (2 photos found renders 2 slides, not 4), and dots/prev-next nav
are omitted entirely for a single photo, where carousel chrome would be
pointless. `renderGallery()` renders every photo the same way regardless of
source — filling the card width (`.gallery-image-wrap.stretch`,
`object-fit: contain` so they letterbox rather than crop or stretch) —
*except* an airport-data.com photo whose reconstructed full-size URL 404s:
the `<img>`'s `error` handler swaps it to `fallback_src` (the original
~200px thumbnail) and switches that slide to `.gallery-image-wrap.native`
(shown at native pixel size, centered with padding) rather than stretching
a thumbnail into visible blur. Every photo carries a photographer-credit
link (`.gallery-credit`) — required by both sources' terms. Two caches:
`photoCache` (per source-request, keyed `"<endpoint>:<kind>:<value>[:<query>]"`)
and `galleryCache` (per aircraft, keyed by `icao24`, storing the finished
merged photo array including any top-up) — together they mean reselecting
an aircraft already resolved this session costs no network call and no
re-render work. Building the gallery DOM with `createElement`/property
assignment rather than string-concatenated HTML matters here specifically
because photographer name and photo URL come from an external API.

**Frontend state (`static/index.html`, all in one inline `<script>`):**
- Three independent `Map<icao24, L.Marker>` objects — `openskyMarkers`,
  `adsbfiMarkers`, `airplanesliveMarkers` — each synced from its source via
  the shared `syncMarkers()` helper (reuses/moves/rotates existing markers in
  place rather than recreating the layer every poll). Marker color is
  source-specific (`SOURCE_COLORS`, whose key order is the canonical source
  priority list used to generalize the HUD counts and toggle wiring). Each
  source can be hidden independently via its HUD checkbox, which clears its
  markers immediately and triggers an immediate `poll()` (rather than waiting
  up to `POLL_INTERVAL_MS` for the next tick) — both on and off toggles
  re-run `poll()` so counts/markers never sit stale after a toggle.
  **OpenSky is on by default** (its HUD checkbox ships checked), alongside
  the two free radius sources. Turning it off clears the quota line and any
  pending OpenSky warning message.
- **Dedup + enrichment rule:** `poll()` fetches all enabled sources in
  parallel, but defers rendering until they've all arrived, then renders in
  priority order — OpenSky, then adsb.fi, then airplanes.live — since each
  step depends on data or state from the others:
  - OpenSky renders first (when enabled). Its sidebar data is enriched with
    everything it doesn't have itself (registration, aircraft type,
    `emergency`, IAS/TAS/Mach, mag/true heading, turn rate, roll, autopilot
    targets, wind, OAT/TAT, operator, year, the DO-260B accuracy fields) via
    `enrichmentByHex`, a lookup merged from the adsb.fi and airplanes.live
    responses (adsb.fi's entry wins if both have one) — see
    `normalizeOpenSky(s, extra)`. Fields every source already provides
    (altitude, speed, position, squawk, position source, last-contact time)
    are never taken from `extra` — OpenSky's own values always win for those.
  - adsb.fi renders next, excluding the just-updated `openskyMarkers` keys.
  - airplanes.live renders last, excluding the union of `openskyMarkers` and
    `adsbfiMarkers` keys.
  - What's uniquely visible as an adsb.fi/airplanes.live *marker* is
    therefore exactly what that source contributes beyond the sources above
    it; what a source uniquely contributes *data-wise* still surfaces through
    enrichment even when the marker itself is deduped away.
  - The generic `updated HH:MM:SS` status line is written by `poll()` itself
    (not `fetchOpenSkyStates()`), so it keeps ticking with OpenSky disabled;
    OpenSky's rate-limit/stale/unreachable warnings are stashed in
    `openskyStatusMessage` and shown in its place only while the source is
    enabled and struggling.
- **Sidebar data model:** `parseOpenSkyState()`/`parseAdsbExchangeAircraft()`
  parse each source's raw shape; `normalizeOpenSky()`/`normalizeAdsbExchange()`
  then map both into one common field-name shape (`info` objects — altitude
  in meters, speed in km/h, airspeeds/wind in knots, absent fields `null`).
  This shape is formally documented in `schema/aircraft.schema.json`
  (47 fields, raw source field names/units per property), including a
  7th sidebar group beyond the six above — **Signal & Data Quality**
  (adsb.fi/airplanes.live-only: `operator`, `manufactureYear`, `dbFlags`,
  `messageType`, `adsbVersion`, and the DO-260B NIC/NACp/NACv/SIL/GVA/SDA
  accuracy fields — no OpenSky equivalents, confirmed against live API
  responses). `trackDeg` falls back to adsb.fi/airplanes.live's
  `calc_track` when `track` is absent (observed on military aircraft).
  `fetch_states()` sends OpenSky's `extended=1` param so `category`
  (state vector index 17) is actually populated, not just `categoryDisplay`
  via adsb.fi/airplanes.live enrichment.
  `detailsById` (a `Map<icao24, {info, registration}>`, rebuilt every poll in
  `syncMarkers()`) stores these objects, not rendered HTML — `selectAircraft()`
  and the "keep the open sidebar live across polls" line in `syncMarkers()`
  both call `renderDetailsHtml(info)` on demand instead. This is what lets
  the unit toggle (below) re-render instantly without waiting for a poll or
  re-fetching anything. `renderDetailsHtml()` groups fields into labeled
  sections (Identity, Position, Speed & Heading, Autopilot, Weather, Status)
  via `renderGroup()`/`detailRow()`; a group renders only if at least one of
  its fields is non-null, so an OpenSky-only aircraft with no adsb.fi/
  airplanes.live enrichment simply has no Autopilot/Weather section.
- **Unit toggle** (`#unit-toggle`, `currentUnitSystem` = `'metric'` |
  `'imperial'`): purely a rendering concern. Internal data always stays in
  the units above; only the formatters used inside `renderDetailsHtml()`
  (`formatAltitude`, `formatSpeedKmh`, `formatSpeedKt`,
  `formatVerticalRateUnit`) branch on `currentUnitSystem`. Toggling
  re-renders the currently-open sidebar immediately, same pattern as the
  other filter controls.
- **Motion filter:** the "Show: All / Air / Ground" segmented control
  (three buttons in `#motion-filter`, tracked in `currentMotionFilter` and
  checked by `passesMotionFilter()`) is a filter, not a data source — it
  doesn't gate any fetch, unlike `sourceToggles`. It's applied inline while
  each source builds its marker items: OpenSky's own `on_ground` field, or
  `alt_baro === 'ground'` for adsb.fi/airplanes.live (their convention for a
  grounded aircraft, parsed into `onGround` by `parseAdsbExchangeAircraft`).
  Changing it also re-runs `poll()` immediately.
- Clicking a marker (any source) calls `selectAircraft(icao24)`, which opens
  `#sidebar` — a floating glass-card panel on the left (styled to match the
  `#hud` panel on the right), not a Leaflet popup — fills it with
  `renderDetailsHtml(info)`, loads the photo gallery (see above), and fetches
  `/api/track/<icao24>` to draw the flight history. Clicking empty map area
  (`map.on('click', deselectAircraft)`) or the sidebar's own close button
  clears the selection and removes the track. The marker click handler calls
  `L.DomEvent.stopPropagation(e)` defensively, but it's not actually
  load-bearing: `L.Marker` defaults `bubblingMouseEvents` to `false` (unlike
  `L.Path`, which defaults to `true`), confirmed straight from Leaflet
  1.9.4's source, so a marker click never reaches the map's own click
  handler in the first place. (An earlier session note claimed otherwise and
  was wrong — verify against Leaflet's actual source rather than assuming,
  if this area needs touching again.) OpenSky may have no track for a given
  aircraft (`/api/track` 404s) — common for rotorcraft, whose short/local
  flights often aren't segmented into a continuous "flight" by OpenSky's
  history system. `loadTrack()` then falls back to the small in-browser
  `liveTrailById` history collected from map polls (up to 40 distinct
  positions per ICAO24); this only becomes drawable after at least two
  observed positions and is discarded on page reload. A selected aircraft
  does not re-request OpenSky history on every 12 s poll, preventing the old
  behaviour that rapidly exhausted the separate track-credit bucket; while
  using the fallback, its local path is refreshed from each poll instead.
- **Track is colored by altitude**, like OpenSky's own web map:
  `drawTrack(waypoints)` builds a `trackLayerGroup` — an `L.featureGroup` of
  short two-point polyline segments, one per consecutive waypoint pair,
  each colored via `altitudeColor(avgAltitude)` (a small hand-picked
  gradient: grey when unknown, green at 0m, up through yellow/orange to red
  by ~9000m, linearly interpolated between stops and clamped past the ends)
  — rather than the single flat-colored polyline used before. Waypoints keep
  their per-point `altitude` (meters, from `/api/track`'s `baro_altitude`)
  all the way from `loadTrack()` through to this coloring step.
- **Track status in HUD:** The right sidebar (`#hud`) shows track status in
  `#track-status` when an aircraft is selected: empty when the historical
  track loads successfully, "Track: live fallback" when using the in-browser
  trail (no historical data or rate limited), or "Historical track unavailable:
  rate_limited" (in red) when the track endpoint is rate-limited. This was
  moved from the left sidebar to avoid duplication.
- State vector array indices from OpenSky's `/states/all` are fixed by the
  protocol and parsed positionally in `parseOpenSkyState()`: `0 icao24,
  1 callsign, 2 origin_country, 4 last_contact, 5 longitude, 6 latitude,
  7 baro_altitude, 8 on_ground, 9 velocity, 10 true_track, 11 vertical_rate,
  13 geo_altitude, 14 squawk, 15 spi, 16 position_source, 17 category`
  (`time_position`/3 and `sensors`/12 are deliberately skipped — the former
  duplicates `last_contact`, the latter is always null without an owned
  receiver). adsb.fi/airplanes.live aircraft are parsed by the shared
  `parseAdsbExchangeAircraft()`. Both normalizers share `formatSquawk()`
  (highlights the universal ICAO emergency codes 7500/7600/7700 in red,
  regardless of source) and the unit-aware `formatVerticalRateUnit()`
  (climbing/descending/level — adsb.fi/airplanes.live report
  `baro_rate`/`geom_rate` in ft/min, normalized to m/s internally either
  way). Three concepts that exist in different encodings on each source are
  unified into one field rather than kept as two: **position source**
  (OpenSky's numeric `position_source` 0-3 vs. adsb.fi/airplanes.live's
  `mlat`/`tisb` array non-emptiness → one `positionSource` string),
  **last-update time** (OpenSky's `last_contact` unix timestamp vs.
  ADSBExchange's already-relative `seen` seconds → one
  `secondsSinceContact`, formatted by `formatRelativeSeconds()`), and
  **alert/SPI** (OpenSky's `spi` vs. ADSBExchange's `alert` → one boolean
  `hasAlert`). The ADSBExchange-style `emergency` field (only present/
  non-"none" on adsb.fi/airplanes.live) also reaches OpenSky's sidebar via
  enrichment.
- **Category:** OpenSky's numeric emitter category and adsb.fi/airplanes.live's
  letter+digit code (e.g. "A3") are the same DO-260B taxonomy in two
  encodings. `OPENSKY_CATEGORY_LABELS` / `ADSBEXCHANGE_CATEGORY_LABELS` map
  each to a human-readable string for the popup; `OPENSKY_CATEGORY_GROUP` /
  `ADSBEXCHANGE_CATEGORY_GROUP` map both to one shared set of group keys
  (light/heavy/rotorcraft/glider/etc.) that the category dropdown filters on
  via `passesCategoryFilter()`/`categoryGroupFor()` — one filter works
  uniformly across both encodings.
- **Hide non-aircraft filter:** `looksLikeGroundVehicle()` flags surface
  vehicles/obstacles/reference beacons reported alongside real aircraft —
  category in the surface-vehicle/obstacle range (OpenSky 16-20, ADSBExchange
  C1-C5), a known non-aircraft registration/type marker (`GROUND_VEHICLE_MARKERS`,
  currently just `"TWR"`), or a callsign matching the airport-ground-vehicle
  pattern `^[A-Z]{4}\d{2}$` (e.g. "TXLU01"). On by default; toggling re-runs
  `poll()` immediately like the other filters. Items it flags (whether shown
  or hidden) carry `isGroundVehicle: true` on their render item, which
  `iconFor()` uses to draw `groundVehicleIcon()` (a warning triangle) instead
  of the plane glyph — so if the filter is turned off to inspect them, they
  don't visually read as aircraft.
- **Category dropdown** (`#category-filter`) is a hand-built component (plain
  `<div>`s, not a native `<select>`) so it can be fully styled and carry a
  small inline-SVG icon per option (`CATEGORY_ICON_SVGS`/`categoryIconHtml()`).
  Its trigger's click handler calls `stopPropagation()` — here it's genuinely
  load-bearing (unlike the marker one above): this is a plain native DOM
  click on a `<button>`, which really does bubble to the `document`-level
  "click outside closes the menu" listener, and would otherwise immediately
  close what the same click just opened.

## Tests

- `tests/backend/` (pytest): mocks `app.requests.get`/`.post` per test via
  `conftest.py`'s `mock_get`/`mock_post` fixtures and a `make_response()`
  helper — no real network calls. An autouse `reset_caches` fixture clears
  every module-level cache dict before each test, since they're shared global
  state; forgetting this for a newly-added cache is the most likely way a
  future backend test starts failing only when run after another one.
- `tests/frontend/` (Playwright, config in `playwright.config.js` at the
  repo root): every backend route is mocked via `page.route()` with fixture
  JSON in `tests/frontend/fixtures/` (`helpers.js`'s `mockAllSources()`) —
  real external data drifts between requests (observed firsthand while
  building this app), so nothing here depends on live OpenSky/adsb.fi/
  airplanes.live/Planespotters data. Tests target a *specific* known aircraft
  by reaching into the page's own marker `Map`s directly — e.g.
  `openskyMarkers.get('aaaaaa')._icon.click()` when the actual click handler
  needs to fire. This is more reliable than pixel-coordinate clicking, which
  can land on a different, overlapping marker at low zoom levels.
- Runs on port 5050, not 5000 — see the Commands section above.
- `test_track.spec.js` targets an adsb.fi marker for the successful track
  path (OpenSky is nevertheless the first-priority source), asserts the
  actual `trackLayerGroup` rather than a fixed stroke color, and covers
  empty/404 tracks plus the local live-trail fallback. Also tests track status
  display in the HUD (`#track-status`).

## Conventions

- All UI text and code comments are in English, regardless of the language
  used in conversation.
- Keep this to one or two files (backend + frontend) — no framework, no
  build step, no database. This is an intentional MVP constraint, not an
  oversight.