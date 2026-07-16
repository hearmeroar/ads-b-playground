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
- `/api/track/<icao24>` → `/tracks/all?time=0`, giving an aircraft's actual
  flight history (not just positions this page has polled). Has its own
  per-icao24 cache (`TRACK_MIN_INTERVAL`, 15s) so repeated clicks don't spend
  extra quota. Returns 404 passthrough when OpenSky has no track for that
  aircraft. This also works for adsb.fi/airplanes.live markers, since all
  three sources key aircraft by the same ICAO24/hex address.

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

**Planespotters photos** (`/api/photo/reg/<registration>`,
`/api/photo/hex/<icao24>` → `api.planespotters.net/pub/photos/...`, see
https://www.planespotters.net/photo/api): unlike every other proxy above,
this one exists despite CORS being open (`Access-Control-Allow-Origin: *`) —
Planespotters instead 403s any request without a descriptive User-Agent
containing contact info, which browsers don't let JS set at all. `fetch_planespotters()`
sends `PLANESPOTTERS_USER_AGENT` (configurable via `.env`, defaults to a
placeholder that already satisfies their check) and caches by `"reg:X"`/
`"hex:X"` key with no expiry — a photo of a given tail number doesn't change.

**Photo lookup in `static/index.html`:** popups are plain HTML strings built
synchronously (no network calls) and only ever contain a `.photo-box`
spinner placeholder (`photoBoxHtml()`) with `data-icao24`/`data-registration`
attributes. The actual lookup is deferred to Leaflet's `popupopen` event
(bound once on the map, fires for any layer's popup) — `loadAircraftPhoto()`
tries `/api/photo/reg/<registration>` first, falls back to
`/api/photo/hex/<icao24>` if that comes back empty, then patches the
now-open popup's `.photo-box` via `renderPhotoBox()`. Hooking `popupopen`
rather than fetching during marker rendering is what keeps this off the
poll/pan/zoom path entirely — it only ever fires on an explicit click.
`renderPhotoBox()` builds the `<img>`/attribution link via DOM properties
(`.src`, `.href`, `.textContent`), not string-concatenated HTML, since
photographer name and link come from an external API. `photoCache` (client-side,
in-memory) means reopening a popup for an aircraft already looked up this
session costs no network call.

**Gotcha:** `marker.bindPopup(...)` in `syncMarkers()` re-runs every poll for
every marker, and Leaflet replaces an *already-open* popup's DOM immediately
when its bound content changes — without re-firing `popupopen`. Left alone,
a photo that had already loaded would get silently reset to a fresh,
never-loaded spinner on the next poll (12s later) and just stay stuck there,
since nothing re-triggers the fetch. `syncMarkers()` works around this by
checking `marker.isPopupOpen()` right after `bindPopup()` and, if true,
re-calling `loadAircraftPhoto()` against the freshly-rebuilt `.photo-box` —
a no-op network-wise since `photoCache` already has the answer.

**Frontend state (`static/index.html`, all in one inline `<script>`):**
- Three independent `Map<icao24, L.Marker>` objects — `openskyMarkers`,
  `adsbfiMarkers`, `airplanesliveMarkers` — each synced from its source via
  the shared `syncMarkers()` helper (reuses/moves/rotates existing markers in
  place rather than recreating the layer every poll). Marker color is
  source-specific (`SOURCE_COLORS`, whose keys are the canonical list of
  source names used to generalize the HUD counts and toggle wiring). Each
  source can be hidden independently via its HUD checkbox, which clears its
  markers immediately and triggers an immediate `poll()` (rather than waiting
  up to `POLL_INTERVAL_MS` for the next tick) — both on and off toggles
  re-run `poll()` so counts/markers never sit stale after a toggle.
- **Dedup + enrichment rule:** `poll()` fetches all three sources in
  parallel, but defers rendering until they've all arrived, then renders in
  priority order — OpenSky, then adsb.fi, then airplanes.live — since each
  step depends on data or state from the others:
  - OpenSky's popup is enriched with fields it doesn't have itself
    (registration, aircraft type) via `enrichmentByHex`, a lookup merged from
    the adsb.fi and airplanes.live responses (adsb.fi's entry wins if both
    have one). Fields every source already provides (altitude, speed,
    position) are never duplicated — OpenSky's own values are always used.
  - adsb.fi renders next via `updateRadiusSourceMarkers(...)`, passing the
    just-updated `openskyMarkers` keys as an exclusion set.
  - airplanes.live renders last, excluding the union of `openskyMarkers` and
    `adsbfiMarkers` keys — so it only shows what neither of the
    higher-priority sources already covers.
  - What's uniquely visible as an adsb.fi/airplanes.live *marker* is
    therefore exactly what that source contributes beyond the sources above
    it; what it uniquely contributes *data-wise* (registration/type) still
    surfaces through enrichment even when the marker itself is deduped away.
- **Motion filter:** the "Show: All / Air / Ground" segmented control
  (three buttons in `#motion-filter`, tracked in `currentMotionFilter` and
  checked by `passesMotionFilter()`) is a filter, not a data source — it
  doesn't gate any fetch, unlike `sourceToggles`. It's applied inline while
  each source builds its marker items: OpenSky's own `on_ground` field, or
  `alt_baro === 'ground'` for adsb.fi/airplanes.live (their convention for a
  grounded aircraft, parsed into `onGround` by `parseAdsbExchangeAircraft`).
  Changing it also re-runs `poll()` immediately.
- Clicking a marker (any source) fetches `/api/track/<icao24>` and draws the
  result as an orange polyline; clicking empty map area clears the selection.
  The marker click handler calls `L.DomEvent.stopPropagation(e)` defensively,
  but it's not actually load-bearing: `L.Marker` defaults `bubblingMouseEvents`
  to `false` (unlike `L.Path`, which defaults to `true`), confirmed straight
  from Leaflet 1.9.4's source, so a marker click never reaches the map's own
  click handler in the first place. (An earlier session note claimed
  otherwise and was wrong — verify against Leaflet's actual source rather
  than assuming, if this area needs touching again.) OpenSky may have no
  track for a given aircraft (`/api/track` 404s) — common for rotorcraft,
  whose short/local flights often aren't segmented into a continuous
  "flight" by OpenSky's history system; the frontend just draws nothing in
  that case rather than erroring.
- State vector array indices from OpenSky's `/states/all` are fixed by the
  protocol and parsed positionally in `parseOpenSkyState()`: `0 icao24,
  1 callsign, 2 origin_country, 5 longitude, 6 latitude, 7 baro_altitude,
  8 on_ground, 9 velocity, 10 true_track, 11 vertical_rate, 13 geo_altitude,
  14 squawk, 17 category`. adsb.fi/airplanes.live aircraft are parsed by the
  shared `parseAdsbExchangeAircraft()`. Both popup builders share
  `formatSquawk()` (highlights the universal ICAO emergency codes
  7500/7600/7700 in red, regardless of source) and `formatVerticalRate()`
  (climbing/descending/level, normalized to m/s — adsb.fi/airplanes.live
  report `baro_rate`/`geom_rate` in ft/min). The ADSBExchange-style
  `emergency` field (only present/non-"none" on adsb.fi/airplanes.live) also
  reaches OpenSky's popup via enrichment.
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
  `openskyMarkers.get('aaaaaa').openPopup()` for popup-content assertions, or
  `openskyMarkers.get('aaaaaa')._icon.click()` when the actual click handler
  needs to fire (popup content alone doesn't exercise it). This is more
  reliable than pixel-coordinate clicking, which can land on a different,
  overlapping marker at low zoom levels.
- Runs on port 5050, not 5000 — see the Commands section above.

## Conventions

- All UI text and code comments are in English, regardless of the language
  used in conversation.
- Keep this to one or two files (backend + frontend) — no framework, no
  build step, no database. This is an intentional MVP constraint, not an
  oversight.
