# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page live aircraft tracker: a Flask backend proxies six
independent data sources — OpenSky Network, adsb.fi, adsb.lol,
adsb.one, airplanes.live, and FlightAware AeroAPI — and a static Leaflet
page polls the enabled ones and renders aircraft as rotated, color-coded
markers. A seventh source, adsbdb.com, is proxied too but is not part of
that per-poll set — it's a lazy, click-only lookup for identity/route
enrichment with no markers of its own (see "adsbdb.com" further below).
Backend logic lives in `app.py`; the frontend is
`static/index.html` (markup) plus `static/js/*.js` (ten plain classic
`<script src>` files, loaded in a fixed order) and `static/style.css` — no
framework, no build step, all of it just plain `<link>`/`<script>`-included
static files. The JS files share one global scope (deliberately NOT ES
modules: the Playwright tests reach top-level names like `openskyMarkers`
via `page.evaluate`, and load-time statements rely on the original
execution order), so their `<script>` order in `index.html` is load-bearing:
`map-init` → `constants` → `route-validation` → `state-filters` →
`sidebar-track` → `auth-collection` → `icons` → `render-details` →
`parsers` → `main`
(`route-validation` holds only pure geometry functions with no DOM/fetch
dependencies of its own — it's placed early since `sidebar-track`'s
`buildMergedDetails()` is its only caller; `auth-collection` is placed right
after `sidebar-track` since it needs that file's globals — `selectedIcao24`,
`buildMergedDetails`, `galleryCache`, `detailsById` — to snapshot the
selected aircraft, and after `state-filters` too, whose `CATEGORY_ICON_SVGS`
it reuses for the collection panel's empty-state illustration; nothing after
it in the load order depends on anything `auth-collection` defines). Where
this file says
"`static/index.html`" about a JS function, read "the frontend JS" — the
function now lives in one of those `static/js/*.js` files. Leaflet 1.9.4
itself is vendored at `static/leaflet/` (`leaflet.js` + `leaflet.css` +
`images/` + `LICENSE`, copied from the npm package the same way
`static/flag-icons/` is) rather than loaded from the unpkg CDN — the map
keeps working with no third-party uptime dependency, and the Playwright
suite no longer needs network access for the page to boot.
The `enrichment/` package (see Identity enrichment below) is the one
exception to "`app.py` is the whole backend" — a small set of local static
lookup modules, still no framework/database, just organized into their own
directory since they're a genuinely different kind of logic (data lookup,
not HTTP proxying) from everything else in `app.py`.

## Commands

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python app.py        # runs on http://127.0.0.1:5051
```

**Ports 5051 and 5050 are not arbitrary — Google Sign-In's redirect URI is
locked to them.** (The app's default used to be 5000, but that's permanently
occupied on macOS by ControlCenter's AirPlay Receiver — and often 5001 too,
a second port AirPlay/ASP.NET Core/Synology can claim — so the app's real
port was moved to 5051, adjacent to the existing 5050 test port.) The
Google Cloud Console OAuth client backing `GOOGLE_CLIENT_ID`/
`GOOGLE_CLIENT_SECRET` (see "Aircraft collection" below) has its Authorized
redirect URIs and JavaScript origins registered for exactly
`127.0.0.1`/`localhost` on `5051` (the app's normal port) and `5050` (the
Playwright test port) and no others:
- Redirect URIs: `http://127.0.0.1:5051/api/login/google/callback`,
  `http://127.0.0.1:5050/api/login/google/callback`,
  `http://localhost:5051/api/login/google/callback`,
  `http://localhost:5050/api/login/google/callback`
- JavaScript origins: `http://127.0.0.1:5051`, `http://127.0.0.1:5050`,
  `http://localhost:5051`, `http://localhost:5050`

Running `app.py` on any other port (e.g. via `PORT=6000` or picking a free
port automatically) makes Google's OAuth consent screen reject the
callback — always launch it on 5051 (or let `playwright.config.js` launch
it on 5050 for tests), never a different port, even if 5051 looks busy.

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
frontend cannot call it directly from the browser. `app.py` proxies all six
sources so the architecture (caching, error handling) is uniform, even though
most of the radius sources and FlightAware itself may not need a CORS workaround.

**OpenSky endpoints proxied by `app.py`:**
- `/api/states` → `/states/all`, bbox-filtered via `BBOX` (currently centered
  on Serbia, `41.5–46.5°N, 17–25°E`). Cached for `MIN_INTERVAL` (10s) — no
  matter how many frontend polls land in that window, OpenSky is hit at most
  once. On a 429 or network error, the last good response is re-served with
  `stale`/`error` flags instead of failing the request. A 429 also forwards
  OpenSky's `X-Rate-Limit-Retry-After-Seconds` as `retry_after_seconds` (on
  both the stale-cache and the empty-429 path), which is what drives the
  frontend's source lockout countdown.
- `/api/track/<icao24>` → `/tracks/all?time=0`, giving an aircraft's current
  or most-recent flight history (not an arbitrary historical timestamp). Has
  its own per-icao24 cache (`TRACK_MIN_INTERVAL`, 300s) so repeated clicks
  don't spend extra quota. Tracks use OpenSky's independent `/tracks/*`
  credit bucket, separate from `/states/*`, and far stingier: one charge per
  aircraft per fetch, vs. one shared charge for the whole map — which is why
  its TTL is 30× the states one. A 429 response forwards
  `rate_limit_remaining` and `retry_after_seconds` when OpenSky supplies
  those headers. A live check on 2026-07-17 returned a 429 with a 54,789 s
  retry window and no remaining-credit header. Returns 404 passthrough when
  OpenSky has no track for that aircraft. This also works for markers from
  the radius sources, since all five key aircraft by the same ICAO24/hex
  address.
  - **The track cache is also persisted to disk** (`TRACK_CACHE_FILE`,
    `.track_cache.json`) — otherwise every server restart, including Flask
    debug's auto-reload on each file save, re-spends that stingy bucket from
    scratch. `_load_track_cache()` runs at import; `_save_track_cache()`
    rewrites the whole file (atomically, via `os.replace` on a `.tmp`) after
    each fetch, which is cheap because track fetches are per-click and
    TTL-throttled. Timestamps are absolute wall-clock, so the TTL holds
    across restarts, and entries older than `TRACK_CACHE_MAX_AGE` (24h) are
    dropped on load. Both halves are best-effort: a missing, corrupt, or
    unwritable file is ignored rather than raised, since the cache is a quota
    optimization, not a source of truth.

**Optional OAuth2 auth (`app.py`):** If `OPENSKY_CLIENT_ID` and
`OPENSKY_CLIENT_SECRET` are set (via `.env`, loaded through `python-dotenv`),
`get_access_token()` exchanges them for a bearer token via OpenSky's
`client_credentials` flow and `fetch_opensky()` attaches it to both endpoints
above, retrying once on a 401 (token invalidated early). Without those env
vars it silently falls back to anonymous requests. The remaining daily quota
is read from the `X-Rate-Limit-Remaining` response header and forwarded to
the frontend as `rate_limit_remaining`.
**The same fallback also applies when the token endpoint is unreachable**,
not just when it's unconfigured — found via a real production incident
(2026-07-19) where `auth.opensky-network.org` connect-timed-out from the
Northflank hosting network while `opensky-network.org` itself (the actual
states/tracks API) stayed reachable; `get_access_token()` used to let that
exception propagate all the way up through `fetch_opensky()`, failing
`/api/states`/`/api/track` outright (502) even though anonymous access would
have worked fine. It now catches `requests.RequestException` around the
token POST and returns `None` (anonymous) instead, and remembers the failure
for `TOKEN_RETRY_COOLDOWN` (60s) so a genuinely down auth server isn't
retried — and its 10s connect-timeout re-eaten — on every single poll from
every client; the next call after the cooldown tries again in case the
server recovered.
**The same production incident also turned out to affect `opensky-network.org`
itself**, not just the auth subdomain — once the auth fallback above shipped,
`/api/states` started failing with a *different* connect-timeout, this time
to `opensky-network.org` (the states/tracks API host), while the four radius
sources on entirely different hosts kept responding normally. Since neither
`_cache["ts"]` nor `_track_cache[icao24]["ts"]` is updated on a failed fetch,
every single incoming poll from every open tab re-attempted the network call
in parallel, each blocking a gunicorn thread for up to 10s — concurrent
enough to exhaust the whole thread pool and make the app unresponsive well
beyond just the OpenSky-backed endpoints. `_opensky_outage`/
`_opensky_unreachable()`/`_mark_opensky_outage()` add the same circuit-
breaker one level up: a failed `/api/states` or `/api/track` fetch opens a
shared `OPENSKY_OUTAGE_COOLDOWN` (30s) window — shorter than the token's 60s
since states polling drives visible UI and should recover faster — during
which *both* routes skip the network call entirely and return the
error/stale-cache response immediately, instead of each independently
re-discovering the same outage. Shared between the two routes rather than
tracked per-route, since they're the same host/network path — an outage on
one reliably means the other will fail the same way.
**Root cause identified (2026-07-19), and accepted as permanent, not a bug
to keep chasing**: this app's Northflank deployment runs on Google Cloud
(confirmed via the pod's own egress IP, `34.32.227.125` — a GCP range),
and OpenSky's own FAQ states outright that they "may block AWS and other
hyperscalers due to generalized abuse from these IPs," explicitly asking
not to be contacted about whitelisting cloud-hosted dashboards/trackers.
Diagnosed from inside the running pod: DNS for `opensky-network.org`
resolves fine, and unrelated hosts (`google.com`, `opendata.adsb.fi`) both
connect in under 0.1s over the same egress path — but a raw TCP connect to
`opensky-network.org` times out identically on both port 443 and port 80,
meaning packets to that specific host are being silently dropped at
OpenSky's end, not a DNS/routing/app-level problem on this side. Decision:
leave it as-is rather than chase a static-IP/proxy workaround — the four
radius sources (adsb.fi/adsb.lol/adsb.one/airplanes.live) already cover the
same area with no such block, and the circuit breaker above already keeps
a blocked OpenSky from degrading the rest of the app. If this deployment
ever moves off a hyperscaler's IP range, OpenSky may start working again
with zero code changes — the auth-fallback and outage-breaker logic above
stay correct either way.

**The four radius sources** — adsb.fi (`/api/adsbfi` →
`opendata.adsb.fi/api/v3/lat/.../lon/.../dist/...`, see
https://github.com/adsbfi/opendata), adsb.lol (`/api/adsblol` →
`api.adsb.lol/v2/lat/.../lon/.../dist/...`), adsb.one (`/api/adsbone` →
`api.adsb.one/v2/point/.../.../...`), and airplanes.live
(`/api/airplaneslive` → `api.airplanes.live/v2/point/.../.../...`, see
https://airplanes.live/api-guide/) — are all fully anonymous with no daily
quota, so they need none of OpenSky's auth machinery. All four are entries in
one `RADIUS_SOURCES` table (`{name: {url, center, min_interval, cache}}`)
rather than four repeated groups of constants; `radius_source_response(name)`
looks up a table entry and calls `cached_radius_source()`, the shared
cache/retry helper, with it. `/api/source/<name>` serves any table entry
generically, and `/api/adsbfi`/`/api/adsblol`/`/api/adsbone`/`/api/airplaneslive`
are one-line aliases onto it — kept stable since the frontend and the test
suite already call those specific paths. Adding a fifth source is one dict
entry plus (only if it needs its own stable path) a one-line alias route.
None has a bbox query, only lat/lon/radius (nautical miles, max 250), so each
entry's `center` approximates the same area as `BBOX`. All return the same
ADSBExchange-compatible JSON shape (altitude in feet, speed in knots —
converted client-side to match OpenSky's units), which is why one parser
(`parseAdsbExchangeAircraft()`) serves all four.
**adsb.one is off by default** in the HUD: its upstream is currently behind a
Cloudflare block. adsb.lol shipped off for the same kind of reason (its
upstream had intermittent multi-second hangs) but was switched to **on by
default** (2026-07-17, explicit re-approval) despite that known instability —
a failing/slow source degrades to `null` for that cycle rather than breaking
the poll, so the occasional hang costs one cycle, not the map. Both are wired
up and working either way; the `RADIUS_SOURCES` entries and the shared
`cached_radius_source()` plumbing don't distinguish "on by default" from
"off by default" — it's purely a frontend checkbox default.

> **Shorthand:** the rest of this file often says "adsb.fi/airplanes.live"
> where it means *any* radius source — they share one JSON shape, one parser,
> and one set of extra fields, so a claim about one holds for all four.
> adsb.fi and airplanes.live are named because they're two of the three that
> ship enabled (alongside adsb.lol); adsb.one — the one still off by default —
> behaves identically wherever the phrase appears.

**FlightAware AeroAPI (`/api/flightaware` → `aeroapi.flightaware.com/aeroapi/flights/search`):**
This sixth source is structurally unlike the four radius sources in three critical ways.
First, it's **authentication-required**: requests must carry an `x-apikey` header with a
FlightAware API key, and there's no anonymous fallback (returns `{"flights": [], "error": "not_configured"}`
without one). Second, it's **flight-centric, not transponder-centric** — a `{flights: [...]}` array
(real sample: one flight leg has an `ident`/`ident_icao` *callsign* like `"ASL439"`, but no
ICAO24/hex field). Position/altitude/speed/heading live under a nested `last_position` object;
altitude is in hundreds of feet (e.g., `8` = 800 ft). Origin/destination airports (`code_iata`/
`name`) are unique to this source and are surfaced in the sidebar as new `originAirport`/
`destinationAirport` fields. Third, it's **metered/paid** — the user polls it at 10s (same as
free sources) when enabled, accepting the cost tradeoff. It originally shipped **enabled by
default**; the user later gave explicit re-approval (2026-07-17) to switch it to **off by
default** instead, so it now ships unchecked like adsb.one — still fully wired up and
working, just an opt-in toggle rather than a default one. Any further change to this default
(or to its poll interval) needs the same kind of explicit re-approval, not a unilateral
"optimization."
**Dedup strategy:** Since FlightAware has no ICAO24, it uses **callsign-based dedup** against the
other five sources. Every source already carries a callsign field; they are matched case-insensitively
and whitespace-trimmed (`normalizeCallsignKey()`, in the dedup comparison). When a FlightAware flight's
callsign matches an aircraft from OpenSky/adsb.fi/adsb.lol/adsb.one/airplanes.live, the FlightAware
marker is suppressed and its `originAirport`/`destinationAirport` are merged into the matched
aircraft's sidebar (similar to `radiusRecordsByHex` for radius sources). A non-match (formatting
difference, missing callsign, or a FlightAware-only flight) simply leaves FlightAware's own marker
showing — never causes a false merge. Cached like the four radius sources (10s `FLIGHTAWARE_MIN_INTERVAL`).

**Area coupling:** All location-based constants derive from one `AREA_CENTER`
(`{"lat": 44.0, "lon": 21.0}`) in `app.py`: `BBOX` is computed from it,
every `RADIUS_SOURCES[*]["center"]` is set to it (with the appropriate
`dist`/`radius` field per API), and `/api/config` exposes it (plus
`AREA_ZOOM`, the initial map zoom level) so the frontend's `map.setView()`
call in `static/js/map-init.js` fetches the backend-owned values and self-corrects
if they drift. `map-init.js` has a hardcoded fallback (the original `[44.0, 21.0], 8`)
so the map paints synchronously without waiting for `/api/config`; the fetch then
happens and adjusts the view immediately if the backend differs. No more
manual sync of six independent constants. `/api/config` also exposes
`radius_nm` (`AREA_RADIUS_NM`, 220) — the shared query radius every
`RADIUS_SOURCES` entry's `center` is built from — which drives the
scan-radius range rings below.

**Scan-radius range rings** (`static/js/map-init.js`, toggled via
`#toggle-scan-radius` in the HUD, wired in `static/js/state-filters.js`):
a visual indicator of where the four radius sources' shared query area
(`AREA_RADIUS_NM`) actually ends — off by default, its own HUD row (not
grouped with the six data-source toggles, since it's a display option with
no count/data of its own, same category as "Hide non-aircraft"). Drawn as
concentric `L.circle` rings rather than one, since a single circle gives
no sense of scale with nothing to compare it against — modeled on ATC/
marine-radar range rings, which always use round evenly-spaced distances
so the labels are instantly readable. `niceRingStepNm()` picks a spacing
from `[25, 50, 100, 150, 200, 250]` such that `radius / step` lands at ≤5
rings (50 nm for the current 220 nm radius, giving ticks at 50/100/150/
200), so the ring count still looks right if `AREA_RADIUS_NM` is ever
changed — a fixed "3 rings" or "quarters of the radius" scheme would
instead label an arbitrary, hard-to-read distance like "73 nm". The true
coverage edge (220 nm, where the four sources' data actually stops) is a
different kind of fact than a scale tick, so it's drawn as one additional
ring in a distinct accent color/weight rather than folded into the
round-number sequence. Each ring gets a small text label (`"NN nm"`,
`.radius-ring-label` in `static/style.css`, `pointer-events: none` so it
never intercepts map clicks/drags) positioned at the ring's true-north
point via a new `destinationPoint(lat, lon, bearingDeg, distanceKm)`
helper in `static/js/route-validation.js` — the standard spherical
"point at distance+bearing from origin" formula, same Aviation-Formulary
family as that file's existing `initialBearingDeg`. `L.circle`'s `radius`
option is meters, so nm values are converted (`nm * 1852`); circles use no
special Leaflet pane, since the default `overlayPane` (z-index 400)
already renders below `markerPane` (z-index 600), so aircraft markers stay
on top automatically. **Load-order pitfall avoided**: `map-init.js` loads
*before* `route-validation.js` (see the script-order list at the top of
this file), so the initial `scanRadiusLayer` is built as an empty
`L.layerGroup()` placeholder rather than calling the ring-building
function (which needs `destinationPoint`) synchronously at load time —
the real rings are built once the (genuinely async) `/api/config` fetch
resolves, by which point every script has already loaded. The toggle
defaults to off, so there's no visible gap from this.

**Basemap picker** (`static/js/map-init.js`'s `BASE_LAYERS`/`baseLayers`/
`setBaseLayer()`, `#basemap-filter` in the HUD, wired in `static/js/
state-filters.js`): nine free, no-API-key tile styles the user can switch
between — the same "no signup, no token" constraint that picked CARTO
over Mapbox in the first place, applied to the rest of the set too.
Light (CARTO Positron, the original hardcoded layer before this feature)
and two siblings from the same CDN — Dark (`dark_all`) and **Voyager**
(`rastertiles/voyager`, colorful labeled streets — **the default**,
re-approved 2026-07-18 over Light) — plus Streets (standard
`tile.openstreetmap.org` — the single most recognizable web map look; its
tile usage policy discourages embedding in a high-traffic production app
without self-hosting, accepted here since this is a low-traffic personal
tracker, not a production service) and five from Esri's free public
ArcGIS Online basemap services (**all five share the `{z}/{y}/{x}` tile
URL order, not `{z}/{x}/{y}` like every CARTO/OSM/OpenTopoMap layer
here** — an easy transposition bug if copied carelessly): Satellite
(World Imagery), Terrain (OpenTopoMap — a different provider than the
Esri three below, free community topographic tiles derived from OSM data,
same informal "don't hammer it" courtesy norm as OSM itself), **Physical**
(`World_Physical_Map`, added 2026-07-18 to answer "a map with heights" —
a genuine standalone hypsometric-tint relief map, colored by elevation
from green lowlands to tan/white highlands; its native data tops out
around zoom 8, so it's given `maxNativeZoom: 8` while `maxZoom` stays 19
like every other layer, so Leaflet upscales its last real tile past zoom 8
instead of just showing blank tiles), **Terrain Base** and **Hillshade**
(`World_Terrain_Base`/`Elevation/World_Hillshade` — both intentionally
pale/muted layers designed to be combined with a labels overlay this app
doesn't add, included anyway for side-by-side comparison since that's
what was asked for; `maxNativeZoom: 13` for both). All nine
`L.tileLayer` objects are constructed once up front — cheap, since a tile
layer fetches nothing until actually added to the map — and kept in the
`baseLayers` lookup rather than recreated on every switch, so switching
back to a previously-viewed style redraws from Leaflet's own tile cache
instead of refetching; `setBaseLayer(key)` just `removeLayer`s the
current one and `addLayer`s the new one. The picker reuses the exact
custom-dropdown markup/CSS/wiring pattern already built for
`#category-filter` (`.dropdown`/`.dropdown-trigger`/
`.dropdown-value-wrap`/`.dropdown-option`) rather than inventing a second
widget — a small color swatch per option (reusing `#hud .swatch`, the same
dot already used for the six data sources) stands in for category's
per-option SVG icons, since a full icon isn't needed here. Purely
presentational, unlike the category filter: switching basemaps never
calls `poll()`, since it doesn't change what data is fetched or rendered.
**No persistence across reloads** — matches every other preference in
this app (unit system, dev mode, motion/category filters are all
session-only; nothing here uses `localStorage`) — always resets to
Voyager on load.

**Weather layers** (`static/js/map-init.js`'s weather section, `#weather-
filter` in the HUD — four `source-row` checkboxes, not a single-select
dropdown like the basemap picker, since e.g. Precipitation + SIGMET
together is a completely normal combination to want on at once — wired in
`static/js/state-filters.js`): four independent, off-by-default overlays,
researched against what real trackers show (FlightRadar24/FlightAware/
ADS-B Exchange all have some precipitation-radar toggle; Windy.com is the
fuller reference UX with wind/clouds/temperature too — noted as possible
future additions, not built here) and picked to be genuinely free with no
API key:
- **Precipitation / Forecast** — [RainViewer](https://www.rainviewer.com/api.html)
  tile composites. Free, no key, and (confirmed via `curl -I -H "Origin:
  ..."`) sends `Access-Control-Allow-Origin: *` on both its discovery JSON
  and its tile images — the one weather source callable directly from the
  browser with **no backend proxy**, since CORS (not licensing) was
  always the actual reason every other proxied source in this app needs
  one. `refreshWeatherTileLayer(key)` fetches
  `https://api.rainviewer.com/public/weather-maps.json`, takes the latest
  entry from `radar.past` (Precipitation) or `radar.nowcast` (Forecast —
  not always published; an empty result is normal, not an error, and
  simply shows nothing for that layer), and builds an `L.tileLayer` from
  it. **`maxNativeZoom: 7`**: RainViewer's radar tiles genuinely stop at
  native zoom 7 — confirmed by fetching actual tile *bytes*, not just the
  HTTP status (which is 200 either way) — past that the server returns a
  real, valid, ~1-3KB PNG that just reads "Zoom Level Not Supported" in
  gray text, at both its 256 and 512 tileSize options.  `maxNativeZoom`
  stops Leaflet from ever requesting past z=7 (upscaling the z=7 tile
  instead), while `maxZoom` stays 19 so the layer still renders at the
  map's actual max zoom, just blurry past z=7 rather than showing that
  placeholder image. Both layers live in their own Leaflet pane
  (`weatherPane`, z-index 350, between `tilePane`'s 200 and `overlayPane`'s
  400) rather than the default `tilePane` the basemap tiles also use —
  Leaflet stacks same-pane layers by add order, so switching basemaps
  (which re-`addLayer`s the new one *after* an already-active weather tile
  layer) would otherwise silently bury the radar under the new base tiles,
  which looked like the weather layer "disappearing" on every basemap
  switch. Refreshed every 5 minutes while enabled (RainViewer's own
  composite updates roughly every 10) via `setWeatherTileLayerEnabled(key,
  enabled)`, which owns that key's own `setInterval`/`clearInterval` —
  each of the two layers is independent, so turning one off doesn't stop
  the other's timer.
- **SIGMET** — significant weather hazards for aviation (icing,
  turbulence, convective activity, volcanic ash), from
  [aviationweather.gov](https://aviationweather.gov/)'s international-
  SIGMET endpoint via a new `/api/sigmet` proxy in `app.py`. Unlike
  RainViewer, this source sends **no CORS header at all** (confirmed the
  same way, with an explicit `Origin` header) — same situation as OpenSky,
  so it genuinely needs a backend proxy, not a stylistic choice. The
  endpoint itself **ignores bbox/loc query params entirely** (confirmed
  live: an identical ~144-record global response regardless of what's
  passed), so `/api/sigmet` fetches the full global list and filters
  server-side via `_sigmet_intersects_area()` — any SIGMET with at least
  one vertex inside `BBOX` padded by `SIGMET_FILTER_PADDING_DEG` (10°,
  generous since a hazard polygon can be large and centered outside the
  exact box while still overlapping it) is kept; the rest are dropped
  before the response ever reaches the frontend. **Two coordinate
  shapes**, keyed by the SIGMET's own `geom` field — a single-polygon
  SIGMET (`"AREA"`) has `coords` as a flat list of `{lat, lon}` points, but
  a multi-polygon one (`"AREAS"` — e.g. two separate boxes describing a
  "west of this line / east of that line" corridor, confirmed against a
  real FCBB/Brazzaville SIGMET) has `coords` as a list of *rings*, each
  itself a list of points. A first version assumed the flat shape
  unconditionally and 500'd the moment a real `"AREAS"` record came
  through in production — `_sigmet_coord_points()` (backend) and the
  matching ring-detection in `refreshSigmet()` (frontend) both normalize
  either shape into "a list of rings" (length 1 for `"AREA"`) before doing
  anything else with it. Rendered as one `L.polygon` per ring (all sharing
  the same hazard's color/popup), colored by `sigmetColor(hazard)`
  (`SIGMET_HAZARD_COLORS` — red for convective/thunderstorm, orange for
  turbulence, blue for icing, gray for ash, purple for IFR/mountain
  obscuration, gray fallback for anything else), each with a popup showing
  the hazard/qualifier, FIR name, and altitude range. Cached server-side
  for `SIGMET_MIN_INTERVAL` (300s) like every other proxied source; a
  network error re-serves the last good list if one exists, otherwise 502
  (same stale-or-fail pattern as the four radius sources).
- **METAR** — airport weather-station observations (wind, visibility,
  ceiling, raw text) from the same aviationweather.gov source, via a new
  `/api/metar` proxy — same no-CORS situation as SIGMET, but this endpoint
  *does* respect a `bbox` query (confirmed live, returned exactly the
  nearby stations for a test bbox), so `/api/metar` just passes `BBOX`
  straight through as `"{lamin},{lomin},{lamax},{lomax}"` rather than
  filtering a global list itself. Rendered as a small `L.circleMarker` per
  station, colored by `metarColor(fltCat)` (`METAR_CATEGORY_COLORS` — the
  standard aviation flight-category convention: green VFR, blue MVFR, red
  IFR, magenta LIFR — the same colors pilots and every other aviation
  weather display already use), with a popup showing the station name and
  raw METAR text. Cached for `METAR_MIN_INTERVAL` (300s) — station
  observations update roughly hourly, so this is generous headroom, not a
  tight budget.
- All four share one `WEATHER_REFRESH_INTERVAL_MS` (5 min) cadence and the
  same enable/disable shape: a `{layer, enabled, timer}` state object per
  layer (`weatherTileState.precip`/`.nowcast`, `weatherSigmetState`,
  `weatherMetarState`), where the `enabled` flag is checked again inside
  the fetch's `.then()` — a layer toggled off while its own fetch was
  still in flight must not add itself back after the fact.
- **Help tooltips (required for all weather layers):** Each weather layer
  in the HUD includes a small `(?)` help button with a click-to-toggle
  popover explaining the layer's source, update frequency, and any caveats
  (e.g., RainViewer's native zoom limits, SIGMET color legend). This is a
  required pattern: any new weather layer added must include this same
  affordance. Implement via: (1) add a `<button>` with `class="source-help"`
  and an inline SVG question mark icon, plus a `<div class="source-help-popover"`
  in `static/index.html`'s weather filter section; (2) write a
  `refreshWeather<LayerName>Help()` function in `static/js/main.js` that
  populates the popover text (concise, 2–3 sentences covering source,
  frequency, and notable limits); (3) call `wireHelpPopover(btnId, popoverId,
  refreshFunction)` to attach the click-to-toggle listener alongside the
  existing weather layer wiring. Follow the Precipitation/Forecast/SIGMET/METAR
  implementation as a template.

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

**Frontend state (`static/js/*.js`, classic scripts sharing one global scope):**
- Five independent `Map<icao24, L.Marker>` objects — `openskyMarkers`,
  `adsbfiMarkers`, `adsblolMarkers`, `adsboneMarkers`,
  `airplanesliveMarkers`, reachable by name via `markerMapsBySource` — each
  synced from its source via the shared `syncMarkers()` helper
  (reuses/moves/rotates existing markers in place rather than recreating the
  layer every poll). Marker color is source-specific (`SOURCE_COLORS`, whose
  key order is the canonical source priority list used to generalize the HUD
  counts and toggle wiring). Each source can be hidden independently via its
  HUD checkbox, which clears its markers immediately and triggers an immediate
  `poll()` (rather than waiting up to `POLL_INTERVAL_MS` for the next tick) —
  both on and off toggles re-run `poll()` so counts/markers never sit stale
  after a toggle. **OpenSky, adsb.fi, adsb.lol and airplanes.live ship
  checked**; adsb.one and FlightAware ship off (see above). Turning OpenSky
  off clears the quota line and any pending OpenSky warning message.
- **HUD counts** (`updateCounts()`) render as a pill per source, collapsed via
  `.source-count:empty` when the source is off. Between enabling a source and
  the poll it triggers landing, the slot holds a `.count-spinner` instead
  (`showSourceCountSpinner()`, called from the toggle handler, the
  quota-lockout release, and once at startup for the sources that ship
  enabled). Deliberately **no pending state is tracked**: `updateCounts()` runs
  at the end of every poll and rewrites every slot, which is what clears the
  spinner — including for a source that failed and whose real count is 0, so
  there's no path where a spinner outlives its fetch.
- **A `#map-loader` overlay** covers the first paint — without it the map
  opens visibly empty for a second or two and reads as broken rather than
  loading. It's hidden from the initial `poll().finally(...)`, deliberately
  `finally` and not `then`: if that first poll fails, the overlay must still
  go away and let the (empty) map and its error line show, rather than
  spinning forever over them.
- **Dedup + enrichment rule:** `poll()` fetches all enabled sources in
  parallel, builds a `flightawareByCallsign` lookup (callsign-normalized for matching),
  then defers rendering until all arrive. Rendering happens in one fixed priority order
  — **OpenSky > adsb.fi > adsb.lol > adsb.one > airplanes.live > FlightAware** — since
  each step depends on data or state from the others. **FlightAware uses callsign-based dedup:**
  after the ICAO24-keyed chain above, FlightAware flights matching any other source's
  callsign (trimmed, case-insensitive) are suppressed, and their route data is merged
  into that source's sidebar. A failing source degrades to `null` and is skipped for
  that cycle (see the radius-sources note above) — its existing markers/count are kept:
  - OpenSky renders first (when enabled). Its sidebar data is enriched with
    everything it doesn't have itself (registration, aircraft type,
    `emergency`, IAS/TAS/Mach, mag/true heading, turn rate, roll, autopilot
    targets, wind, OAT/TAT, operator, year, the DO-260B accuracy fields) via
    `radiusRecordsByHex`, a lookup merged from all four radius responses — see
    `normalizeOpenSky(s, extra)` (`extra` is that lookup's highest-priority
    entry for this aircraft). It's built by iterating the lists
    *lowest→highest* priority so the highest-priority source is pushed last
    and wins, matching the marker dedup order below. Fields every source already
    provides (altitude, speed, position, squawk, position source,
    last-contact time) are never taken from `extra` — OpenSky's own values
    always win for those.
  - Each radius source then renders in turn against a single growing
    `excludeIds` set: it contributes only aircraft no higher-priority source
    already claimed, and its own keys are added before the next one runs.
  - What's uniquely visible as a lower-priority *marker* is therefore exactly
    what that source contributes beyond every source above it; what a source
    uniquely contributes *data-wise* still surfaces through enrichment even
    when the marker itself is deduped away.
  - The generic `updated HH:MM:SS` status line is written by `poll()` itself
    (not `fetchOpenSkyStates()`), so it keeps ticking with OpenSky disabled;
    OpenSky's stale/unreachable warnings are stashed in
    `openskyStatusMessage` and shown in its place only while the source is
    enabled and struggling. A *rate-limited* OpenSky no longer lands here at
    all — it triggers the source lockout below instead.
- **Sidebar data model:** `parseOpenSkyState()`/`parseAdsbExchangeAircraft()`/`parseFlightAware()`
  parse each source's raw shape; `normalizeOpenSky()`/`normalizeAdsbExchange()`/`normalizeFlightAware()`
  then map all into one common field-name shape (`info` objects — altitude
  in meters, speed in km/h, airspeeds/wind in knots, absent fields `null`).
  This shape is formally documented in `schema/aircraft.schema.json`
  (47+ fields, raw source field names/units per property), including a
  7th sidebar group beyond the six above — **Signal & Data Quality**
  (adsb.fi/airplanes.live-only: `dbFlags`, `messageType`, `adsbVersion`, and
  the DO-260B NIC/NACp/NACv/SIL/GVA/SDA accuracy fields — no OpenSky
  equivalents, confirmed against live API responses). `operator` and
  `manufactureYear` are *not* in this group despite being adsb.fi/
  airplanes.live-only raw fields too — they render inside the **Identity**
  group instead, via the `identityRow()` closure (`static/js/
  render-details.js`) shared with Country/Manufacturer/Model/Registered
  Owner, since all of those are enrichment-fillable fields that show the
  literal word "Unknown" rather than hiding the row (see Identity
  enrichment below). Plus **two new fields unique to FlightAware**:
  `originAirport` and `destinationAirport` (displayed as "Route" in the
  Identity group,
  `"Catania-Fontanarossa Airport (CTA) → Belgrade Nikola Tesla Int'l (BEG)"`). `trackDeg` falls back to adsb.fi/airplanes.live's
  `calc_track` when `track` is absent (observed on military aircraft).
  `icao24` (the transponder hex address — already the Map key every marker
  is stored/looked up under, and the shared dedup key across all five
  ICAO24-based sources) is now also carried in `info` itself and rendered
  as the very first Identity row ("ICAO", uppercased for display). It's
  tagged an OpenSky-native field (`OPENSKY_NATIVE_FIELDS`) since OpenSky's
  own state vector reports it directly rather than via enrichment; it's
  always `null` for FlightAware, which has no ICAO24/hex field at all
  (flight-centric, identified by `fa_flight_id`/callsign instead — see the
  FlightAware section above).
  `fetch_states()` sends OpenSky's `extended=1` param so `category`
  (state vector index 17) is actually populated, not just `categoryDisplay`
  via adsb.fi/airplanes.live enrichment.
  `detailsById` (a `Map<icao24, {info, registration, fieldSources}>`,
  rebuilt every poll in `syncMarkers()`) stores these objects, not rendered
  HTML — `selectAircraft()` and the "keep the open sidebar live across
  polls" line in `syncMarkers()` both call `renderDetailsHtml(info,
  fieldSources)` on demand instead. This is what lets the unit toggle
  (below) re-render instantly without waiting for a poll or re-fetching
  anything. `renderDetailsHtml()` groups fields into labeled sections
  (Identity, Position, Speed & Heading, Autopilot, Weather, Status) via
  `renderGroup()`/`detailRow()` (local closures inside `renderDetailsHtml`,
  not module-scope, so they can close over that render's `fieldSources`); a
  group renders only if at least one of its fields is non-null, so an
  OpenSky-only aircraft with no adsb.fi/airplanes.live enrichment simply has
  no Autopilot/Weather section.
- **Dev mode** (`#toggle-dev-mode`, `currentDevMode`): a sidebar-only
  toggle, same closure-var pattern as `currentUnitSystem` below, that (1)
  shows every field always — no group or row is hidden for being empty —
  with a `—` dash placeholder in place of a missing value, and (2) shows a
  small colored dot next to any populated field, indicating which source
  supplied it, with a click-to-toggle tooltip (not hover — consistent with
  this app's other "(?)" popovers, since hover doesn't work on touch)
  naming the source. `detailRow`'s/`specialRow`'s dev-mode branch is purely
  additive: with `currentDevMode` at its default `false`, their logic
  reduces to exactly today's hide-when-empty behavior, so dev mode is
  strictly opt-in with zero effect on the default view.

  **"All aircraft" table** (`#dev-aircraft-panel`, `renderDevAircraftTable()`
  in `main.js`): a second dev-mode-only panel, alongside the sidebar-only
  behavior above — a compact, narrow, vertically-scrolling list of every
  aircraft currently on the map (any enabled source), one line each,
  showing ICAO/Callsign/Registration/Type/Route (Operator/Operator
  Country/Registration Country/Category are still there, just folded into
  the row's `title` tooltip rather than widening the panel — Registered
  Owner is not, a pre-existing gap this session's Operator Country
  addition didn't extend to). Deliberately a *tall narrow column* (mirrors
  `#sidebar`'s own footprint on the same left edge, which simply covers it
  via z-index while a specific aircraft's sidebar is open) rather than a
  short wide bar, so many rows are visible at once instead of a handful —
  an earlier wide-table version was reworked into this shape specifically
  for that reason. Built from each enabled source's own marker map (`for
  (const id of markerMapsBySource[name].keys())`), **not** `detailsById`
  directly — `detailsById` entries are never removed for an aircraft that
  left the map or whose source got disabled, while marker maps are cleared
  correctly each poll (`clearStaleMarkers`/`clearAllMarkers`), so building
  the list from `detailsById`'s own keys would show stale ghosts. Each
  row's fields come from `buildMergedDetails(id)` — the exact same merge a
  click would produce — but this reads only whatever's *already* cached
  (adsbdb/Flywme are still lazy-on-click everywhere, this table doesn't
  special-case itself into forcing new fetches for 50+ visible aircraft at
  once): a row for an aircraft never clicked this session shows only its
  live-only fields until it is. Refreshed alongside `updateCounts()` at
  the end of every `poll()` while `currentDevMode` is on, and once
  immediately when dev mode is switched on. Clicking a row calls
  `selectAircraft(id)` — same as clicking the marker itself.

  **`#sidebar.dev-shifted`**: while dev mode is on, `#sidebar` docks to
  `left: 368px` (the table's own 14px inset + 340px width + 14px gap)
  instead of its usual `left: 14px` — otherwise it (higher z-index) simply
  covers the table the moment an aircraft is selected, defeating the point
  of having both open at once. The closed-state `translateX` distance is
  calibrated against the *default* `left: 14px` (moves it exactly its own
  width + 14px further left, landing it just off-screen) — `dev-shifted`
  needs its own larger closed-state transform (`calc(-100% - 368px)`) or
  the sidebar would sit partially back on-screen while "closed" once its
  `left` grew to 368px. Toggled by the same `devModeToggle` handler that
  shows/hides `#dev-aircraft-panel` and `#source-adsbdb`
  (`static/js/state-filters.js`).

  The hard part is that **no part of the pipeline otherwise tracks which
  source populated a given field** — `normalizeOpenSky`/
  `normalizeAdsbExchange`/`normalizeFlightAware` return plain flat objects,
  and the old `enrichmentByHex` (the map that resolves which radius source
  wins for a given aircraft) discarded every non-winning source's record
  once it picked one. A parallel `fieldSources` object (`{fieldName:
  [sourceKey, ...]}`, an *array* — see below) is now threaded alongside
  `info` through the same call paths. `enrichmentByHex` was replaced by
  `radiusRecordsByHex` (`Map<icao24, Array<{source, data}>>`, built in
  `poll()`): instead of one `{data, source}` winner per aircraft, it keeps
  every enabled radius source's own record, in priority order low→high
  (`array[length-1]` is the same "highest-priority wins" entry used for
  enrichment *values*, so that part of the behavior is unchanged).
  `fieldSourcesFor(info, entries, routeSource)` — `entries` is that
  aircraft's full `{source, data}` list, plus (in `updateOpenSkyMarkers`) a
  synthetic `{source: 'opensky', data: pickFields(info,
  OPENSKY_NATIVE_FIELDS)}` entry standing in for OpenSky's own state vector
  — checks *every* entry for a non-empty value at each field key and
  attributes a badge to each one that has it, not just whichever one's
  value `info` ends up displaying: if three enabled sources all
  independently report a registration for the same aircraft, three badges
  show, even though only one value is ever rendered. `false` is treated as
  "no value" rather than a real one, since the sidebar's only boolean field
  (`hasAlert`) uses it to mean "no alert" — without that carve-out, a
  source with no alert would still badge as if it had "reported" the
  field. Raw parsed records mostly share `info`'s own key names 1:1 (a
  radius record's `registration`/`iasKt`/`squawk`/etc. are literally the
  same keys `normalizeAdsbExchange` copies them under), except two:
  `category`→`categoryDisplay` and `track`→`trackDeg`, both computed by a
  lookup/format function rather than copied — `RAW_FIELD_ALIASES` is the
  (deliberately short) map of those exceptions, checked as a fallback only
  when the direct key lookup comes back `undefined`, so it never masks a
  genuine `null` from a source that has the field but no value for it.
  `updateOpenSkyMarkers` builds `entries` from `radiusRecordsByHex.get(s.icao24)`
  plus the synthetic OpenSky entry; `updateRadiusSourceMarkers` (which now
  also takes a `radiusRecordsByHex` parameter) passes that same aircraft's
  full entry list straight through — `sourceName` (the source whose list is
  currently being rendered) is guaranteed to already be one of those
  entries, so no separate single-source fallback is needed; `updateFlightAwareMarkers`
  passes a one-element `entries` of just itself, since FlightAware never
  joins `radiusRecordsByHex` (it dedupes by callsign, not ICAO24). The two
  FlightAware route-merge call sites tag `originAirport`/`destinationAirport`
  as `['flightaware']` directly (bypassing `entries`) right after setting them.
  `sourceBadgeHtml(fieldKey, fieldSources)` renders one dot per distinct
  source across all of `fieldKey`'s badge arrays — `fieldKey` can itself be
  an array for composite rows (Route, Wind) that read two fields at once,
  deduped so a composite row whose two fields came from the same source
  doesn't double the dot. Since the sidebar's `<b>label:</b> value<badge>`
  rows aren't individually wrapped elements (just concatenated with `<br>`
  inside one `.detail-group` div), anything that needs to target one
  specific row's badges (tests, mainly) must match on the row's own
  text/HTML up to the next `<br>` rather than DOM-parent traversal.

  The tooltip itself (`#source-tooltip`, styled in `static/style.css`) is a
  single shared element repositioned per click via event delegation on
  `sidebarDetailsEl` — badges are regenerated HTML on every render (the
  `.innerHTML` swap in `syncMarkers()`/`selectAircraft()`), so a
  `wireHelpPopover()`-style per-element listener would be destroyed each
  time; delegation on the stable container avoids that. Kept as its own
  listener rather than folded into `closeHelpPopovers()`, since that
  mechanism is built for a fixed set of statically-known popovers wired
  once at load, not one dynamic, differently-positioned tooltip.
  `#source-tooltip` is a DOM sibling of `#sidebar`, not a child of it, so
  it doesn't inherit `#sidebar`'s own `font-family` declaration and falls
  back to the browser default serif font unless it sets its own — it does
  (`static/style.css`), the same self-contained-font pattern `#hud` and
  `#sidebar` each already use rather than relying on inheriting a
  page-wide font from `body` (which sets none).

  The Dev mode row itself carries a `(?)` (`#dev-mode-help`/
  `#dev-mode-help-popover`), wired through the same static
  `wireHelpPopover()`/`helpPopovers` mechanism as the OpenSky-quota and
  track-status ones (`refreshDevModeHelp()` just repaints static text —
  there's no countdown to keep live here, unlike the other two). It
  explains what the toggle does (every field shown, `—` for missing data,
  colored per-source dots) and, since that alone doesn't explain *why* a
  given field has the source it does, spells out the enrichment order in
  the same terms as the priority chain above: OpenSky's own fields win
  whenever OpenSky is on, gaps are filled from whichever single radius
  source's response has that aircraft, and FlightAware's route fields are
  merged in separately by callsign match rather than by ICAO24.
- **Identity enrichment** (`enrichment/` package, `app.py`'s
  `/api/identity/<icao24>`, `static/index.html`'s `enrichmentById`/
  `buildMergedDetails`): fills identity gaps (Country, Operator,
  Manufacturer, Model, Year built) live feeds didn't cover, using small
  local static lookup tables — no external API, no database (static dicts
  loaded at import time aren't a database any more than `SOURCE_COLORS`/
  `OPENSKY_CATEGORY_LABELS` are).
  - **`enrichment/`** (new, root-level, sibling to `static/`/`tests/`/
    `schema/` — the first backend module that isn't an HTTP-proxy):
    `countries.py` is the Country entity (`{name, iso}` — this module never
    renders a flag itself, only ever hands out the ISO code; see the
    frontend `flagHtml()` note below for where the actual flag rendering
    lives), covering essentially every ICAO member state (194 entries — it
    started as a ~20-country placeholder set but had to grow to match
    `registration.py`'s own coverage below, since a prefix resolving to an
    ISO code missing from this table would silently resolve to nothing);
    `registration.py` maps ICAO/ITU registration prefixes — a real,
    standardized convention (ICAO Annex 7), not a placeholder guess — to a
    country. Expanded from an initial ~20-entry placeholder subset to 193
    entries covering essentially every nationality mark, after real
    aircraft came up with no country resolved simply because their prefix
    wasn't in the table yet — first `SE-RTJ` (Sweden), then later `4X-ABS`
    (Israel, an Israir A320) turned up the same gap for `4X`. "192/193
    entries" is a moving target in this doc, not a guarantee of
    completeness — treat any future "no country for a real, valid
    registration" report the same way: check whether the prefix is simply
    missing before assuming a deeper bug. Longest-prefix-match, with one
    extra wrinkle: two ICAO territories share their sovereign's base mark
    but get their own sub-block after the dash — Hong Kong (`B-H...`) and
    Macau (`B-M...`) both fall under China's bare `B` — handled by trying
    "prefix + first character after the dash" (`BH`, `BM`) as a more
    specific candidate before falling back to the bare prefix; `callsign.py`
    maps ICAO 3-letter airline designators to an operator (confidence 0.8)
    and that operator's home country (confidence 0.6 — two independently-
    confidenced facts from one lookup), returned as two separate results
    from `enrich_identity()` — `operator` and `operator_country` — rather
    than one field carrying the other's country as a side attribute; see
    "Registered Owner is a brand new field" below for why that distinction
    matters; `aircraft_database.py` holds a
    swappable ICAO24→full-record lookup (`AircraftDatabaseLookup.lookup()`,
    a small placeholder dataset behind an interface a real data source
    could later implement with zero caller changes) plus a separate ICAO
    type-code/free-text→manufacturer+model normalization table;
    `aircraft_enrichment.py`'s `enrich_identity()` is the orchestrator,
    resolving each field through its own priority chain that always tries
    a live value first (`source: "live"`) before ever touching a local
    table — enrichment only fills a gap the live feeds didn't cover, never
    overrides one.
  - **`/api/identity/<icao24>`** (`app.py`) is fetched lazily from
    `selectAircraft()` — same lazy-on-click pattern as `loadTrack`/
    `loadGallery`, never during the main poll, so the 50+ on-screen
    aircraft nobody clicks never cost a request. Deliberately **uncached**,
    unlike every other route: it makes zero I/O calls (pure sub-millisecond
    dict lookups), and every existing cache here exists specifically to
    protect a rate-limited *external* HTTP source, which doesn't apply.
  - **Frontend merge**: `syncMarkers()` fully replaces each aircraft's
    `detailsById` entry every poll, so enrichment can't be merged into it
    directly — it would be silently discarded on the next poll. Enrichment
    results live in their own `enrichmentById` Map (keyed by icao24,
    session-cached like `galleryCache`) that polling never touches;
    `buildMergedDetails(icao24)` recombines the two fresh at render time,
    enforcing "live wins" client-side too (belt-and-suspenders with the
    backend's own short-circuit) by only filling a field that's currently
    null/empty. Every render path (`selectAircraft`, the poll resync in
    `syncMarkers()`, the unit-toggle and dev-mode-toggle handlers) now goes
    through one shared `renderSelectedDetails()` so none of them can drift
    out of sync with each other.
  - **`loadIdentityEnrichment()`/`loadAdsbdb()` cross-pollination**: the two
    are independent concurrent fetches kicked off together from
    `selectAircraft()` (same pattern as `loadGallery()`/`loadAdsbdb()`
    below) — neither sees the other's result by default. That means
    `loadIdentityEnrichment()`'s local tables (`registration_prefix`/
    `callsign_decode`) are blind to a registration/callsign that only
    adsbdb resolved, since `/api/identity` is only ever called once, with
    whatever the *live* feed had at click time. Found via a real aircraft
    (`4X-ABS`, an Israir A320 with no live registration) whose Registration
    Country stayed "Unknown" even though adsbdb went on to resolve its
    tail number and `registration_prefix` could have used it. Fixed by
    `maybeRefetchIdentityWithAdsbdbData(icao24, liveInfo, adsbdbData)`
    (`sidebar-track.js`), called at the end of `loadAdsbdb()`'s success
    path: if adsbdb resolved a registration or callsign the live feed
    didn't have, it clears `enrichmentById`'s cached (mostly-empty) result
    for that icao24 and re-runs `loadIdentityEnrichment()` with the new
    value merged in — a second, better-informed `/api/identity` call. A
    no-op whenever live already had a registration/callsign (the first
    call already covered it) — this only recovers the specific gap where
    adsbdb identified an aircraft the live feed couldn't.
  - **"Flywme"** is a new, separate synthetic source in `SOURCE_COLORS`/
    `SOURCE_DISPLAY_NAMES` (badged black), parallel to the six live sources
    — not a stand-in for anything. It represents "this application" as the
    source whenever `buildMergedDetails` filled a field from enrichment
    rather than a live feed (tagged `fieldSources[key] = ['flywme']`). The
    specific technique that computed it (`registration_prefix`/
    `icao24_lookup`/`callsign_decode`/`aircraft_type_db`) is real metadata
    too, but it's *how* Flywme computed the value, not a competing source —
    so it drives the tooltip text via `ENRICHMENT_BASIS_LABELS` (e.g.
    *"Flywme — computed from registration prefix, confidence 1.0"*), not a
    separate badge color. `sourceBadgeHtml()` takes two more params
    (`fieldConfidence`, `fieldComputationBasis`) to build that string, a
    harmless no-op for the six live sources since both are only ever
    populated for enrichment fields.
  - **New Identity rows**: `Manufacturer`/`Model` (brand new — no existing
    field). `Country`/`Operator`/`Year built` already existed and just gain
    Flywme as an additional possible `fieldSources` entry. All five (plus
    Country's own upgrade) use a new `identityRow()` closure inside
    `renderDetailsHtml()` instead of `detailRow()` — unlike every other
    field in this app, they show the literal word **"Unknown"** instead of
    hiding the row (or, in dev mode, a dash) when nothing resolved,
    regardless of `currentDevMode`. Registration is deliberately excluded
    from this treatment (stays on plain `detailRow`) — the spec's
    "Unknown" list names Country/Operator/Manufacturer/Model/Year built
    only. Country's flag leads the country name, rendered by `flagHtml(iso2)`
    (`static/index.html`) from `info.countryIso` — a small SVG via the
    [flag-icons](https://github.com/lipis/flag-icons) library
    (`<span class="fi fi-cz">`), vendored at `static/flag-icons/` (`css/` +
    `flags/4x3/`, plus its `LICENSE`, copied from the npm package the same
    way `static/ADS-B_Radar_Free_Aircraft_SVG_Icons/` is vendored — no
    build step, just static files, `flag-icons/css/flag-icons.min.css`
    linked in `<head>`). Only the `4x3` (rectangular) variant is vendored,
    not `1x1` (square) — its CSS rules reference `../flags/1x1/*.svg` for
    the unused `.fis` modifier class, but browsers only fetch a
    `background-image` when the rule actually matches a rendered element,
    so those never-applied rules never 404. `flagHtml()` accepts upper- or
    lowercase and returns `''` for anything that isn't a plausible 2-letter
    code, so a missing/invalid ISO degrades to no flag rather than a broken
    element. **The flag shows regardless of which source supplied the
    country** — not just enrichment-resolved ones. `enrich_identity()`'s
    country tier always tries `country_iso_for_name()` (`enrichment/
    countries.py`, an exact case-insensitive reverse lookup: name → ISO)
    even for a `"live"`-sourced value, attaching `country_iso` alongside it
    without touching its `source`/`confidence` — a flag is a presentation
    add-on, never a sign the value itself was enriched. On the frontend,
    `buildMergedDetails()` picks up `resolved.country_iso` unconditionally
    (before the "value already resolved, skip" check that guards the
    *value*, which does not gate the flag). First implementation only set
    `info.countryIso` on the enrichment path, so a country already known
    from a live feed (e.g. OpenSky's own `origin_country`) silently never
    got a flag — fixed by moving the ISO lookup earlier on the backend and
    decoupling it from the value-overwrite guard on the frontend. A country
    string that matches nothing in `countries.py`'s placeholder set (not
    exhaustive) still renders without a flag — a real, accepted limitation,
    not a bug.
  - **Pitfall hit once, worth remembering**: `Object.keys(SOURCE_COLORS)`
    is iterated in a few places (the per-source toggle wiring, HUD count
    updates, the startup spinner loop) under the assumption that every
    `SOURCE_COLORS` key has a matching HUD checkbox in `sourceToggles`.
    Adding `flywme` to `SOURCE_COLORS` broke all three until they were
    switched to iterate `Object.keys(sourceToggles)` instead (the object
    that actually only has the six live, toggleable sources) — any future
    synthetic/non-toggleable source added to `SOURCE_COLORS` needs the same
    check.
- **adsbdb.com** (`app.py`'s `/api/adsbdb/<icao24>`, `static/js/
  sidebar-track.js`'s `loadAdsbdb()`/`buildMergedDetails()`): a seventh data
  source, fetched lazily on marker select like `/api/identity` — never
  during the poll loop, no markers/counts of its own. Unlike Flywme (locally
  computed) and the six live/poll sources, it's a genuine external database
  (https://api.adsbdb.com, docs at github.com/mrjackwills/adsbdb) queried
  for two things in **one combined request**:
  `GET /v0/aircraft/{icao24}?callsign={callsign}` returns both an `aircraft`
  object (type/manufacturer/registration/**registered owner**) and a
  `flightroute` object (origin/destination airports + the operating
  airline) together — `flightroute.airline` is already nested in that
  response, so the separate `/v0/airline/` endpoint is never called.
  If the callsign is unknown but the aircraft is, adsbdb still answers 200
  with just `aircraft`. Cached indefinitely in `_adsbdb_cache` (keyed
  `"<icao24>:<callsign-or-empty>"`), same rationale as Planespotters: an
  aircraft's identity and a given callsign's route are stable facts, not
  live telemetry. A 404 (unknown aircraft) is cached as an empty result; a
  network error/5xx is deliberately left uncached so a later click retries.
  **Not proxied at all**: `/v0/stats`, `/v0/mode-s/`, `/v0/n-number/` (out
  of scope for this app), and adsbdb's **PATCH** routes — those exist for
  *adsbdb's own operators* to correct their database (need their
  `env.allow_update` config and their own `Authorization` token, which this
  app has no access to and no reason to seek), not something a consumer of
  their read API can use.
  - **Persistent aircraft-identity cache** (`_identity_cache`,
    `IDENTITY_CACHE_FILE`/`.aircraft_identity_cache.jsonl`,
    `IDENTITY_HISTORY_FILE`/`.identity_history.jsonl`): a backend-only
    side-effect persistence layer (its only frontend-visible surface is
    the dev-mode stats line below, not a full API) — the deliberately
    narrow slice of a much broader "aircraft
    identity intelligence layer" idea (persistent identity + history +
    observations graph) discussed and rejected at that full scope for this
    project (no ground truth registry to validate confidence against, no
    relational query need yet, and the space is already occupied by
    entrenched players like ch-aviation/Cirium/airframes.org who have
    decades of curation and registry licensing this project doesn't).
    What survives: whenever `fetch_adsbdb()` resolves a real `aircraft`
    object on a fresh (non-cached) upstream fetch, `_update_identity_cache()`
    merges four *airframe-level* fields — `registration`, `manufacturer`,
    `type`, `registered_owner` — into `_identity_cache[icao24]`, persisted
    to disk with the same atomic-write pattern as `_track_cache`/
    `TRACK_CACHE_FILE` (`_load_identity_cache()` runs at import,
    `_save_identity_cache()` rewrites the file after each update), just
    without a TTL — identity facts don't expire the way a flight track
    does, so the file only grows by one entry per distinct aircraft ever
    resolved, not per poll. **One JSON object per line** (`{"icao24":,
    ...fields}`), not one giant single-line blob like `_track_cache`'s own
    file — the same readable/diffable-by-hand JSONL convention
    `IDENTITY_HISTORY_FILE` already used, applied here too after the
    project owner asked for it explicitly. `flightroute`'s own fields
    (`registered_owner_country_name`, and especially `airline`/operator)
    are deliberately excluded from this cache — they're properties of a
    specific flight/callsign, not the airframe itself, and can legitimately
    differ across leases/codeshares, which would conflate "who owns this
    plane" with "who's operating this particular flight." A null incoming
    value never overwrites a previously known one (adsbdb responses are
    sometimes partial). When a tracked field *does* change to a different
    non-null value, one line is appended to `IDENTITY_HISTORY_FILE`
    (`{icao24, field, old, new, ts}`) before the cache is overwritten —
    the only "history" this layer keeps, a flat append-only log rather
    than a versioned entity graph. This is intentionally the entire scope
    of Phase 1 from that discussion; phases 2 (merging in external
    registries) and 3 (a full identity-graph product) are not planned.
    **`/api/identity/stats`** (a static route registered ahead of the
    dynamic `/api/identity/<icao24>` below, though Werkzeug would resolve
    the static path correctly either way) exposes this layer's two raw
    counters — `identity_count` (`len(_identity_cache)`) and
    `history_count` (a line count of `IDENTITY_HISTORY_FILE`, recomputed
    from disk on each request rather than kept as a separately-maintained
    in-memory counter that could drift) — for the dev-mode-only frontend
    panel below. Deliberately uncached, same rationale as
    `/api/identity/<icao24>` itself.
  - **Background identity backfill** (`_collect_visible_icao24s()`,
    `_backfill_queue`, `_identity_backfill_tick()`,
    `_start_identity_backfill_thread()`): the cache above only ever grew
    from a real marker click — this passively resolves identity for
    aircraft the tracker actually sees, without waiting for a click and
    without a bulk download (adsbdb has none — only the per-ICAO24 endpoint
    above, so scraping its whole database via speculative requests would
    be out of scope/impolite, same posture as every other proxied source
    here). `_collect_visible_icao24s()` doesn't fetch anything new — it
    just reads the icao24/`hex` values already sitting in `_cache["data"]`
    (OpenSky) and each `RADIUS_SOURCES[*]["cache"]["data"]` (the four
    radius sources), which the frontend's own poll cycle keeps warm anyway;
    FlightAware's cache is skipped (flight-centric, no ICAO24 field).
    `_identity_backfill_tick()` refills `_backfill_queue` from that set
    minus whatever's already in `_identity_cache` whenever the queue runs
    dry, and resolves exactly one aircraft per call via `_resolve_adsbdb()`
    (the plain, non-Flask-response half of `fetch_adsbdb()` — split
    specifically so this can be called from a background thread with no
    request/app context) — skipping it instead if a real click already
    resolved it since being queued. `_start_identity_backfill_thread()`
    runs this once every `IDENTITY_BACKFILL_INTERVAL` seconds (env var,
    default 5; `<= 0` disables the whole feature) in a daemon thread — a
    few seconds apart, so it never competes meaningfully with real user
    traffic to adsbdb. **Only ever started from the `if __name__ ==
    "__main__":` block**, immediately before `app.run(...)` — never at
    plain module import time (unlike `_load_track_cache()`/
    `_load_identity_cache()`, which are harmless file reads) — so
    importing `app` in the test suite never spins up a real thread hitting
    the network. Guarded by `_should_start_background_thread()` against
    Flask's debug-mode reloader, which re-execs the whole process into a
    "watcher" parent (imports `app.py`, `app.debug` True, `WERKZEUG_RUN_MAIN`
    unset — starts nothing) and a child that actually serves requests
    (`WERKZEUG_RUN_MAIN=true` — starts the thread); `app.debug` is set
    explicitly right before this check since Flask doesn't actually set it
    until `app.run(debug=True)` begins executing, one line later.
  - **Dev-mode stats display** (`#dev-identity-stats`, a line inside the
    existing `#dev-aircraft-panel` header — no new panel, just reuses that
    one's existing show/hide wiring): `refreshIdentityStats()`
    (`static/js/main.js`) fetches `/api/identity/stats` and renders
    `"Identity cache: N aircraft · N changes logged"`. Refreshed at the
    same two points `renderDevAircraftTable()` already is — the end of
    `poll()` and the dev-mode toggle switching on — rather than its own
    timer, since both numbers only change on an adsbdb fetch, which
    already triggers a re-render of that table anyway.
  - **Priority chain, agreed with the project owner**: live feed > adsbdb >
    Flywme-computed, i.e. adsbdb is inserted as a *second* tier between the
    two `buildMergedDetails()` already had. Each tier only fills a field
    still empty after the tier above ran: Operator/Operator Country/
    Registration/Manufacturer/Model can all be filled from adsbdb
    (`flightroute.airline.name`/`flightroute.airline.country`/
    `registration`/`manufacturer`/`type` respectively) ahead of Flywme's own
    guess; Registration Country has **no** adsbdb tier at all —
    `registered_owner_country_name` feeds only Registered Owner (see
    "Registered Owner is a brand new field" below), never Registration
    Country, so it falls through to Flywme's `registration_prefix`/
    `icao24_lookup` tiers instead; Year built likewise has no adsbdb tier
    at all (the API doesn't return one); Route (`originAirport`/
    `destinationAirport`) sits *below* FlightAware's existing per-poll
    callsign-match tier (unchanged) but above nothing else, since no tier
    ever computes a route locally.
  - **Flywme co-displays even when a higher tier already won** (added after
    the project owner noticed only one source badge ever showed once
    adsbdb resolved a field — the losing tier's own guess was silently
    never computed at all): `buildMergedDetails()`'s Flywme loop always
    evaluates `enrichmentById`'s resolution for every field, even one
    live/adsbdb already filled. If Flywme resolved something too, its
    source is *appended* to that field's `fieldSources` (never replacing
    the displayed value) — badge order is display order, so the winning
    tier's dot renders first and Flywme's second, mirroring the actual
    priority chain. **Exception**: skipped when `resolved.source ===
    'live'` — that tier of `enrich_identity()` just echoes back the same
    `known_*` hint the caller already passed in, not an independent guess,
    so badging it a second time would be redundant rather than informative.
  - **Registered Owner is a brand new field** (`info.registeredOwner` +
    `registeredOwnerCountryIso` for its flag) — the *private/corporate*
    registrant (e.g. `"Falcon Landing LLC"`), a concept the `enrichment/`
    package never had (it only ever models an operating *airline*, via
    `Operator`). adsbdb is its only possible tier — no live feed or Flywme
    fallback exists for it — so it renders via `identityRow()` like
    Country/Operator/etc. (literal "Unknown" when unresolved, not a hidden
    row). **`Registration Country`, `Operator Country`, and `Registered
    Owner` are three deliberately distinct concepts, never conflated, each
    with its own row and its own flag** — `Operator` itself stays plain
    text with no flag at all: Registration Country means the aircraft's
    country of *registration* (ICAO Annex 7 nationality mark — from
    live/`registration_prefix`/`icao24_lookup` only; labeled "Country" in
    an earlier version of this UI, renamed after a user repeatedly
    confused it with operator/owner across a whole session — see the
    tooltip note below), **Operator Country** (`info.operatorCountry` +
    `operatorCountryIso`, a brand new field/row, same treatment as
    Registered Owner) means the operating airline's home country, and
    Registered Owner means the private/corporate registrant's country.
    adsbdb's `registered_owner_country_name`/`registered_owner_country_iso_name`
    fields feed *only* Registered Owner, never Registration Country — an
    earlier version of this code let them leak into Registration Country
    too, which silently mixed "who owns this plane" into a field meant to
    mean "where it's registered"; fixed by scoping that adsbdb data to
    `registeredOwner`/`registeredOwnerCountryIso` alone. Operator Country
    resolves through two tiers: adsbdb's `flightroute.airline.country`/
    `country_iso` (name and ISO given together, no reverse lookup needed)
    first, falling back to `enrich_identity()`'s own `operator_country`
    field — a byproduct of `callsign_decode`'s ICAO-designator lookup
    (`enrichment/callsign.py`), which resolves `operator` and
    `operator_country` as two independently sourced results from one table
    lookup, never smuggling the country onto `operator` itself. Only a
    *live-sourced* Operator has no possible Operator Country at all (no
    live feed reports an operator's home country), which just means that
    row shows "Unknown" — the same known limitation as Registration
    Country's own flag on a live value with no `countries.py` name match.
    **Each of the four rows' labels** (Operator/Operator Country/
    Registered Owner/Registration Country) **carries a click-to-toggle
    `.info-tip`** (`IDENTITY_FIELD_EXPLANATIONS`, `static/js/
    render-details.js`, same shared `#source-tooltip` mechanism as
    Category/header pieces/route confidence — see "Unified tooltip
    mechanism" below) whose text explicitly cross-references the other
    three, so the four concepts read as one disambiguated set rather than
    four isolated labels. Wraps the row's *label*, not its value — unlike
    Category, these rows show "Unknown" as often as a real value
    (`identityRow()`'s whole point), and the explanation needs to work
    either way; always visible regardless of dev mode, same as every other
    `.info-tip`, since knowing what a field means isn't a dev-only concern.
  - **Photo (`url_photo`/`url_photo_thumbnail`), last-resort only**: live
    checks against api.adsbdb.com (4+ real aircraft) found `url_photo` —
    the field that in theory points at a full-size image — **consistently
    404s**, and so does the full-size URL `app.py`'s own
    `_airportdata_fullsize_url()` logic would reconstruct from it (adsbdb's
    photo data points at airport-data.com paths that airport-data.com no
    longer serves, likely stale since adsbdb's own DB was populated). Only
    `url_photo_thumbnail` — a genuinely tiny ~2-4KB image — ever actually
    resolves, and adsbdb supplies no `photographer` field at all (unlike
    airport-data.com's own API this app otherwise always credits). Given
    both of those, it's shown only as a **strict last resort**: appended
    (with `photographer: 'via adsbdb.com'`, never a fabricated name) only
    when Planespotters + airport-data.com together found **zero** photos —
    never alongside a real, properly-credited one, even a genuinely
    different photo (an earlier version deduplicated by numeric photo id
    instead; replaced after confirming the "usually a duplicate of our own
    top-up" assumption behind that no longer held once `url_photo` turned
    out to be dead). Rendered at native size from the start
    (`photo.forceNative`, checked in `renderGallery()`'s `setIndex()`)
    rather than stretched-then-degraded via the `img.onerror` fallback
    path other undersized photos use — pointless here since the "large"
    source is already known to fail, not just occasionally.
    `loadGallery()` and `loadAdsbdb()` are independent concurrent fetches
    kicked off together from `selectAircraft()`; whichever finishes *last*
    is the one that actually performs the append+re-render
    (`appendAdsbdbPhotoAsLastResort()`), by checking the other's cache
    (`galleryCache`/`adsbdbPhotoByIcao`) — neither blocks on the other.
  - **Dev-mode-only toggle** (`#source-adsbdb`, `#toggle-adsbdb`): a new UI
    pattern, distinct from the six `sourceToggles` — this row is `display:
    none` until dev mode is switched on (mirroring how `#opensky-help`
    shows/hides via the quota-lockout state machine, just driven by
    `devModeToggle`'s own `change` handler instead), and checked by default
    in the markup so it's already "on" the moment it becomes visible. It's
    intentionally **not** added to `sourceToggles`/`markerMapsBySource` —
    same reasoning as the `flywme` pitfall above: adsbdb has no per-poll
    fetch, no markers, no HUD count, so pulling it into those loops would be
    wrong, not just superfluous. Unchecking it only gates *future*
    `loadAdsbdb()` calls (`adsbdbEnabled`) — it doesn't purge `adsbdbById`,
    same as every other lazy-cache in this app.
- **Route validation (Layer 2 geometric check, `static/js/
  route-validation.js`)**: adsbdb's flightroute is a historical
  callsign→route lookup, not a live flight plan — reused callsigns,
  schedule/seasonal changes, and irregular ops all produce wrong matches,
  so it's treated as a hypothesis, not ground truth. **Scoped to adsbdb
  routes only** — checked in `buildMergedDetails()` via `fieldSources.
  originAirport` being exactly `['adsbdb']` — since FlightAware's route
  comes from a live paid tracking service, not a historical guess, and
  doesn't need this scrutiny.
  `validateAdsbdbRoute({curLat, curLon, trackDeg, speedKmh, altitudeM,
  originLat, originLon, destLat, destLon})` computes a 0–100 confidence
  score from five geometric checks against standard spherical-navigation
  formulas (Ed Williams' Aviation Formulary — not novel math), summed with
  a fixed 30-point baseline (present whenever there's a route to validate
  at all) so the total maxes at 100:
  - **Track alignment (20 pts)**: how closely the aircraft's current
    ground `trackDeg` matches the bearing from its **current position** to
    the destination — recomputed fresh each render, not a single fixed
    origin→destination bearing. This is a deliberate correction to the
    naive version of this check: great-circle bearing isn't constant along
    a route (can drift 20–30°+ from the initial bearing on
    transatlantic-scale distances), so comparing against a stale fixed
    bearing produces false negatives mid-flight on long routes. Uses
    ground track, not `magHeadingDeg`/`trueHeadingDeg` — track already
    reflects actual direction of travel over ground (accounts for wind
    drift, which is exactly what this check needs), and it's reliably
    present on both OpenSky and adsb.fi/airplanes.live, unlike the heading
    fields (enrichment-only, often null).
  - **Distance to route (25 pts)**: cross-track distance from the
    aircraft's current position to the origin→destination great circle.
  - **Route progress (10 pts)**: along-track projection as a percentage
    (0–100% expected; a negative or >100% projection means the aircraft
    is behind departure or past arrival, penalized smoothly).
  - **Speed/altitude plausibility (10 + 5 pts)**: a phase-of-flight
    heuristic — near either end of the route (progress ≤8% or ≥92%,
    "terminal") a high-cruise-like speed/altitude is incongruous (the
    doc-derived examples this was designed against: 780 km/h 8km from
    departure, FL380 12km from departure); mid-route ("cruise") gets no
    penalty regardless of value, since cruise altitudes/speeds vary hugely
    by aircraft type. Explicitly the two least rigorously specified/lowest-
    weighted checks — reasonable heuristics, not validated aviation
    science, tunable later without touching anything else.
  All five checks use smooth piecewise-linear interpolation between the
  same band boundaries a discrete Excellent/Good/Weak/Invalid scale would
  use (`interpolateFraction()`), rather than cliff-edged step functions, so
  the score doesn't jump discontinuously right at e.g. exactly 20° of track
  deviation. Bands: 96–100 Very High, 80–95 High, 60–79 Medium, 40–59 Low,
  0–39 Reject.
  **`DISTANCE_GATE_KM` (300km) hard gate, found via live testing, not
  synthetic cases**: cross-track distance only carries 25 of the 100
  points, so an aircraft that's a completely different flight from the
  claimed route (not just slightly off it) could still land in "Medium"
  territory on the strength of the other four checks alone, if those
  happen to look coincidentally plausible in isolation. Confirmed against
  a real mismatch: a Norse Atlantic 787 (`47b217`) cruising over Bosnia,
  whose callsign `IGO49F` adsbdb resolved to an unrelated IndiGo Mumbai→
  Manchester flight — ~760km cross-track, scored 74.6/Medium before this
  gate existed. Past `DISTANCE_GATE_KM`, the total score is capped to 39
  (Reject) regardless of the other four checks — the aircraft simply isn't
  "on" this route in any meaningful sense at that distance, so no
  combination of the other signals should be able to rescue the score.
  **No lat/lon existed anywhere for the currently-selected aircraft before
  this** — `info`/`detailsById` never carried position (only the Leaflet
  marker itself did, via `marker.getLatLng()`, dropped before reaching
  `detailsById`). Fixed by threading `item.lat`/`item.lon` through into the
  object `syncMarkers()` stores in `detailsById` (`static/js/icons.js`).
  Recomputed on **every** render (poll resync, not just the initial click)
  since position/speed/altitude change continuously — deliberately
  uncached, unlike the network-backed adsbdb/enrichment lookups, since it's
  a cheap pure computation with no I/O of its own.
  **UI**: every adsbdb-validated route carries a small colored
  `.route-confidence-dot` (`routeConfidenceDotHtml()`, `static/js/
  render-details.js`) next to the Route value — **always visible, not
  dev-mode-gated**, unlike the per-source badges — since knowing how much
  to trust a route matters regardless of dev mode. Five colors,
  `ROUTE_CONFIDENCE_BAND_COLORS`, green→red matching the five bands
  (Reject reuses emergency red — a deliberate exception to "red is
  reserved for emergencies", justified since this is a distinct element, a
  dot rather than text color, and "don't trust this" deserves the same
  urgency cue). Clicking it reuses the same generic `#source-tooltip`
  click-to-toggle mechanism already wired for the per-source badges
  (`main.js`, extended to also match `.route-confidence-dot`), showing
  `routeConfidenceDetail()`'s band name, score, and the
  track/distance/progress breakdown numbers — **in both normal and dev
  mode**, a deliberate choice (the team considered plain-language-only but
  picked showing the numbers immediately, everywhere).
  **Reject-band routes name no airports at all** — replaced with the
  literal text "Not confirmed" (`.route-not-confirmed`, muted italic)
  rather than showing a specific, likely-wrong city pair. This isn't a
  rare edge case: live research across 100+ real aircraft found roughly a
  **quarter of all adsbdb routes land in Reject** (e.g. a real aircraft
  cruising over the Balkans whose callsign resolved to `JFK→DEL` or
  `ICN→TSN`, thousands of km away) — naming the wrong cities would be more
  misleading than a plain "unconfirmed". **Low-band routes still show the
  real airport pair**, prefixed with `⚠` and styled via `.route-warning`
  (amber) — unlike Reject, a Low route is plausibly still correct, just
  imperfect, so hiding the names there isn't warranted. The dev-mode
  per-source badge (`sourceBadgeHtml`, shows which source populated
  `originAirport`/`destinationAirport` — almost always `adsbdb` here)
  renders separately from the confidence dot, since they answer two
  different questions ("which source" vs. "how much to trust it") that
  happened to get conflated in an earlier version of this feature.
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
  if this area needs touching again.) A small crosshair icon button
  (`#sidebar-center-map`, top-left of the sidebar, mirroring `#sidebar-close`
  at top-right) re-centers the map on the selected aircraft's *current*
  position — reads `detailsById.get(selectedIcao24)`'s `lat`/`lon` (kept
  fresh every poll, not a snapshot from whenever the sidebar first opened)
  and calls `map.setView([lat, lon], map.getZoom())`, preserving whatever
  zoom the user was already at rather than forcing one — useful for an
  aircraft that's drifted off-screen while its sidebar stayed open, or
  after panning away to look at something else.
- **Sidebar visual hierarchy** (`#sidebar-header`, `#sidebar-gallery`,
  `#sidebar-route`, `#sidebar-details` — four sibling elements inside
  `#sidebar`, in that visual order): reworked from a single flat field list
  into a title-first layout. `renderDetailsHtml()` (`static/js/
  render-details.js`) now returns `{header, route, body}` instead of one
  HTML string; `renderSelectedDetails()` (`static/js/sidebar-track.js`)
  writes each piece into its own container. `#sidebar-close`/
  `#sidebar-center-map` float over `#sidebar-header` now (they used to
  float over the gallery, before a header existed) — `#sidebar-header`'s
  `padding-top: 40px` keeps the title text starting entirely below both
  28px-tall buttons rather than sharing their vertical band (an early
  version had them nearly touching).
  - **Header**: ICAO/Callsign/Registration/Aircraft type — promoted out of
    the Identity group into a masthead (registration or ICAO24 as the big
    title, callsign/type/ICAO as a middot-joined subtitle) rather than
    four more rows in a field list. Each piece is wrapped in the shared
    `.info-tip` click-tooltip (`HEADER_FIELD_EXPLANATIONS`) explaining what
    it actually is — a first-time viewer has no other way to know "TC-LGY"
    is a registration and "THY1RT" is a callsign, not two arbitrary codes.
    Dev-mode source badges still apply here (`badgeFor()`/`headerPiece()`
    in `render-details.js`) — **`.source-badge`'s CSS had to be widened
    from `#sidebar-details .source-badge` to also cover `#sidebar-header`/
    `#sidebar-route`**, a real bug caught after shipping: badges rendered
    correctly into the DOM with the right colors, but with zero size/shape
    at all outside `#sidebar-details`, so they were completely invisible
    in the header despite "working."
  - **Route card** (`#sidebar-route`, populated only when a route
    resolved): replaces the old plain-text `<b>Route:</b> A → B` row —
    big IATA codes, small city names below each (wrapped, not
    ellipsis-truncated — a name cut off mid-word read as broken, and
    there's no real space pressure the truncation was solving since the
    card is free to grow taller), a direction icon between them, and (for
    an adsbdb-sourced route) the Layer 2 confidence badge in a footer.
    Both Reject- and Low-band routes are **hidden entirely in normal mode**
    — no route card at all (confidence too uncertain to show specific
    airports), since showing specific city pairs with <60 confidence reads
    as misleading to a non-expert user. Dev mode keeps showing both with
    their distinct tags — Reject gets "Not confirmed", Low gets
    "⚠ Unverified" — and the real airport pair, so debugging the
    enrichment chain remains possible. Medium+ routes (60+) show normally
    without any hiding. The confidence badge (`routeConfidenceBadgeHtml()`)
    is itself an `.info-tip` — clicking it shows the same score breakdown
    tooltip as before, just via the unified mechanism (see below) instead
    of a bespoke one.
    **Direction icon**: reuses the exact per-category glyph the map marker
    itself uses (`CATEGORY_GLYPHS`, `static/js/icons.js`) rather than a
    generic arrow — neutral gray, rotated 90° (the same 0°=north/up
    convention every rotating marker uses, so 90° points right). Since
    `categoryGroup` only ever lives on the per-poll render `item`
    (`parsers.js`), never on `info`/`detailsById`, `render-details.js`
    rebuilds it via a reverse lookup (`CATEGORY_LABEL_TO_GROUP`, built once
    from `OPENSKY_CATEGORY_GROUP`/`ADSBEXCHANGE_CATEGORY_GROUP` +
    the label tables) keyed off the same bare label text
    `splitCategoryDisplay()` already extracts for the Category row.
    Falls back to the same "unknown" silhouette the map itself falls back
    to when the category can't be determined.
  - **Group icons** (`GROUP_ICONS`, one per `.detail-group`, not per
    field): Material Design Icons (pictogrammers.com/MaterialDesign,
    Apache-2.0) — copied verbatim from the MDI source repo rather than
    hand-approximated, vendored the same no-build-step way as every other
    icon set in this app (inline SVG string constants, no external
    request). `renderGroup(title, rows, iconKey)` gained a third param
    that prepends the icon into `.detail-group-title` when given.
  - **Category row**: `splitCategoryDisplay()` splits the previously
    always-inline "A1 — Light (<15,500 lbs)" into a compact "A1 · Light"
    (middot, matching the same "homogeneous values, middot-separated"
    convention the route confidence detail text also uses) with the
    parenthetical weight-range explanation moved into a tooltip —
    `CATEGORY_DESCRIPTIONS` adds one genuinely informative sentence per
    DO-260B category (not just the weight range) keyed by that same bare
    label text, so `OK-SWC`-style "just the code" rows became "code +
    label, explanation on demand" instead of one long always-visible string.
  - **Unified tooltip mechanism** (`.info-tip`, `infoTipHtml()` in
    `render-details.js`): the Category and route-confidence explanations
    reuse the exact same click-to-toggle `#source-tooltip` popover the
    per-source dev-mode badges already used, rather than introducing a
    third tooltip pattern (native `title`, a `wireHelpPopover()`-style
    popover, and this would have been a third). `main.js`'s shared click
    listener was widened from `sidebarDetailsEl` to `sidebarEl` (so it
    also covers the header/route containers) and now matches
    `.source-badge, .info-tip` — `.info-tip`'s `data-detail` is shown
    directly (no source-name prefix, unlike `.source-badge`).
  - **Gallery tuning**: `.gallery-image-wrap` no longer has a flat gray
    `background` or a forced `aspect-ratio: 4/3` box — a photo whose real
    aspect ratio wasn't exactly 4:3 (nearly all of them) used to show
    visible gray bars where the box was larger than the actual rendered
    image; now the wrap just sizes to its image (capped by `max-height`
    for the rare very-tall/very-wide case). Prev/next nav buttons went
    through three iterations: first an opaque dark circle absolutely
    positioned at the image's vertical middle (obscured photo content
    there); then a light glass pill moved to the top corners (still sat
    visibly on top of photo content/watermarks); settled on the original
    vertical-middle position but with **no background shape at all** —
    just the bare chevron glyph plus a `drop-shadow` for legibility, which
    reads as "part of the photo's own UI" rather than "a control placed on
    top of it." `.gallery-credit` gained its own `padding-top` (rather than
    relying on `.gallery-dots`' padding for the only vertical gap above
    it) — a lone photo has no dots row at all, so the credit line used to
    sit flush against the image with zero gap. Its link itself is
    underlined only on hover now (was always underlined), to read as less
    visually noisy.
  - **Slider rework + true infinite loop** (`renderGallery()`,
    `static/js/sidebar-track.js`): the gallery used to rebuild its single
    `<img>`'s `src`/classes on every click (`setIndex()`), which was
    perceptibly janky switching slides. Reworked into a `.gallery-slider-
    track` of GPU-accelerated `translate3d` slides (one `.gallery-slide`
    per photo, `display:flex` track, each slide `flex: 0 0 100%`) —
    switching is now a single `transform` change instead of several
    sequential class/src mutations. Looping past either end is a genuine
    infinite carousel, not a modulo-wrap that rewinds back across the
    whole strip: the DOM holds `[clone-of-last, real photos..., clone-of-
    first]`, and a `domIdx` (always `logicalIdx + 1`) tracks the physical
    position while `currentIdx` stays the public 0..N-1 index dots/credit
    key off. `next()`/`prev()` always step `domIdx` one slide in the
    requested direction — including onto a clone when crossing the
    boundary, which is pixel-identical to the real slide it stands in for
    — then, once that transition finishes (`transitionend`, one-shot),
    silently snap `domIdx` back to the matching real slide with
    `transition: none`. Clones are built via the same `buildSlide(photo)`
    helper as real slides (not `cloneNode()`, which would silently drop
    `img.onerror`'s fallback-to-thumbnail handler — a JS property, not an
    HTML attribute, so it isn't copied). Touch-drag anchors its live
    preview transform on `domIdx` too, so dragging past either edge already
    previews the correct neighboring clone for free, with no special-casing.
  - **Fixed 16:9 slider box + `object-fit: cover`** (superseding two earlier
    attempts at this same problem — a flat gray CSS fallback, then a
    canvas-sampled per-photo "ambient" tint, both abandoned; the fixed box
    itself started at 3:2, changed to 16:9 shortly after): the slider
    container (`.gallery-slider-container`) has an explicit `aspect-ratio:
    16 / 9` and `width: 100%` — a fixed box that doesn't reflow or jump as
    photos of different native aspect ratios load in, unlike the original
    "wrap sizes to its image" approach earlier in this section. Photos fill
    that box completely via `object-fit: cover` (replacing `contain`),
    which crops a small amount off the top/bottom of any photo shorter/
    wider than 16:9 — accepted trade-off, since that's usually the least
    informative part of an aircraft photo (sky/tarmac) and the alternative
    (letterbox gaps) had no fully satisfying fix. `.gallery-credit` is
    positioned relative to this fixed container, not to any individual
    photo, so it always lands on real photo pixels in the same corner
    regardless of what's loaded — no more letterbox-collision problem to
    solve for it at all, since there's no letterbox gap left once every
    photo covers the box. The one exception is `.gallery-slide.native`
    (adsbdb's thumbnail-only last-resort photo, a genuinely tiny ~2-4KB
    image — see "adsbdb.com" below): forcing that into `cover` would
    visibly blur it, so it keeps `object-fit: contain` at a capped
    `max-height` instead, same as before this rework.
  OpenSky may have no track for a given
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
- **Quota states are told through a shared "(?)" popover.** OpenSky has two
  independent quotas that fail in similar ways, so both are surfaced with the
  same affordance: a small `(?)` button that click-toggles a popover
  (`wireHelpPopover(btnId, popoverId, refresh)` wires both; only one opens at
  a time, a click anywhere else closes them). Click-to-toggle rather than a
  hover `title` so it works on touch. `refresh` repaints the text just before
  opening, which is what keeps a countdown correct after the popover sat
  closed. Countdowns are formatted by `formatRetryTime()` (Xh Ym Zs). Neither
  state is red — both render in the footer's ordinary muted grey; red is
  reserved for the sidebar's emergency fields.
  - **Map-data quota (`/states/*`) → source lockout.** When `/api/states`
    reports `rate_limited` (or a 200 with `rate_limit_remaining === 0`),
    polling it only ever re-serves stale cache, so `applyOpenSkyQuotaLockout()`
    auto-disables the source: unchecks *and* disables its toggle (it can't be
    re-enabled while dead), clears its markers and quota line, adds `.locked`
    to `#source-opensky`, and reveals `#opensky-help`. A 1s ticker
    (`tickOpenSkyQuota`) keeps the countdown live and is the *only* thing that
    can lift the lock (nothing polls OpenSky while locked) —
    `clearOpenSkyQuotaLockout()` restores the toggle and calls `poll()` once
    the reset time passes. The backend forwards OpenSky's
    `X-Rate-Limit-Retry-After-Seconds` as `retry_after_seconds`; without it
    the lock falls back to `nextUtcMidnight()` and the popover says "after the
    daily quota resets" rather than a countdown.
  - **Track quota (`/tracks/*`) → status line.** `#track-status-row` (hidden
    entirely when the historical track loads fine) shows a short label —
    "Track: cached data", "Track: live fallback", or "Historical track
    unavailable" — via `setTrackStatus(label, detail)`, with the *whole*
    explanation in its `(?)` popover, never inline. `detail` may be a function,
    which is what lets the rate-limit countdown tick live while open;
    `renderTrackRateLimited()` runs it on a 1s timer and re-attempts
    `loadTrack()` the moment the window elapses. The popover text says
    explicitly that this bucket is separate from the map-data one, since the
    two lockouts otherwise look identical to a user.
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
  uniformly across both encodings. `categoryGroupFor()`'s result is also
  stored on each render item as `categoryGroup` (computed once per item and
  reused for both the filter check and icon selection below), rather than
  discarded after filtering. **Category fallback:** OpenSky's category values
  0 and 1 both map to "unknown" (no info). If OpenSky returns 0 or 1, the
  category is taken from adsb.fi/airplanes.live if available, so an
  aircraft with unknown OpenSky category but known radius-source category still
  gets the correct icon and filter behavior. OpenSky's category takes
  priority only when it's a meaningful value (2+).
- **Marker icon by category:** `iconFor(item, color)` dispatches on
  `item.categoryGroup` via the `ICON_BUILDERS` lookup table, which is built
  from `CATEGORY_GLYPHS` (a `{group: glyph}` table) by the shared
  `categoryIcon(group, headingDeg, color)` factory — the per-category CSS
  class is derived as `group.replace(/_/g, '-') + '-icon'`, which must keep
  producing the exact class names style.css and the tests key off
  (`light-icon`, `high-vortex-large-icon`, ...). Each category
  group (`light`, `small`, `large`, `heavy`, `high_performance`,
  `high_vortex_large`, `rotorcraft`, `glider`, `lighter_than_air`,
  `parachutist`, `ultralight`, `uav`, `unknown`) has its own dedicated SVG
  glyph from the ADS-B Radar free icon set
  (`static/ADS-B_Radar_Free_Aircraft_SVG_Icons/`, mapped 1:1 by DO-260B code:
  `a0.svg`–`a7.svg`, `b0.svg`–`b4.svg`), rendered inline at 200×200 viewBox
  and scaled down to 28×28 marker pixels. Glyphs are colored per source (see
  `SOURCE_COLORS`) via a wrapping `<g fill="COLOR">` and outlined in white
  with `vector-effect="non-scaling-stroke"` to keep the outline a constant
  ~1px on-screen regardless of scale. `unknown` uses `a0.svg` (the icon
  set's "no ADS-B info" variant, `UNKNOWN_GLYPH`); the
  `space` category group (absent from `CATEGORY_GLYPHS`, no dedicated icon in
  the set, and removed from the category filter dropdown as not relevant to
  this tracker's region) also falls through to the unknown icon — `iconFor()`
  uses `categoryIcon('unknown', ...)` as the default whenever `ICON_BUILDERS`
  has no entry for a category group, including when category is
  absent/unrecognized entirely.
  `uav` is kept as a generic Material Design glyph even though the icon set
  has a UAV-shaped file (`b0.svg`) — that file is used for the category
  dropdown only (see below), not the map marker, since no re-approval was
  given to change the on-map UAV glyph. `rotatedDivIcon()` is the shared builder every rotating icon
  goes through; it stamps a `data-color` attribute on the marker's wrapper
  `<div>` recording the source color regardless of how many colored `<path>`s
  the glyph itself uses — this is what lets tests count markers by source
  color (`colorCounts()` in `tests/frontend/helpers.js`) without assuming
  "exactly one colored path per icon." The required attribution for the ADS-B
  Radar icon set is shown in the sidebar footer (visible when any aircraft
  details are open).
- **Hide non-aircraft filter:** `looksLikeGroundVehicle()` flags surface
  vehicles/obstacles/reference beacons reported alongside real aircraft —
  category in the surface-vehicle/obstacle range (OpenSky 16-20, ADSBExchange
  C1-C5), a known non-aircraft registration/type marker (`GROUND_VEHICLE_MARKERS`,
  currently just `"TWR"`), or a callsign matching the airport-ground-vehicle
  pattern `^[A-Z]{4}\d{2}$` (e.g. "TXLU01"). **Off by default** — ground
  stations render as their own recognizable tower icon (see below) rather
  than being filtered away, so there's no need to hide them by default the
  way the old warning-triangle rendering arguably warranted; toggling it on
  re-runs `poll()` immediately like the other filters. Items it flags (whether shown
  or hidden) carry `isGroundVehicle: true` on their render item; `iconFor()`
  draws `towerIcon()` (a cell-tower glyph, fixed neutral grey — not
  source-colored, since these aren't really an aircraft "source" reading in
  the same sense) for any item with `isGroundVehicle: true` OR
  `categoryGroup === 'surface_obstacle'` (the `isGroundVehicle` check on its
  own still matters — it also catches registration/callsign heuristic
  matches whose category is absent/unknown) instead of the plane glyph — so
  if the filter is turned off to inspect them, they don't visually read as
  aircraft.
- **Category dropdown** (`#category-filter`) is a hand-built component (plain
  `<div>`s, not a native `<select>`) so it can be fully styled and carry a
  small inline-SVG icon per option (`CATEGORY_ICON_SVGS`/`categoryIconHtml()`).
  `CATEGORY_ICON_SVGS` stores `{viewBox, inner}` per category rather than a
  single shared viewBox, since the underlying source geometry differs: most
  entries are the actual ADS-B Radar icon-set paths at their native
  `0 0 200 200` viewBox (verified against `static/test-icon.html`, a
  scratch reference page kept in the repo for visually diffing every
  category icon at 16×16 before touching this object), while `all` and
  `space`'s dropdown-only equivalent are small hand-drawn glyphs at
  `0 0 16 16`. All entries render via `fill="currentColor"` so `.dropdown-icon`'s
  CSS `color` is the only thing controlling icon color — no per-category
  color overrides. No `space` option exists in the dropdown itself (removed
  as not relevant to this tracker's region), but its `CATEGORY_ICON_SVGS`
  entry is harmless to keep since nothing references it. Its trigger's click
  handler calls `stopPropagation()` — here it's genuinely load-bearing
  (unlike the marker one above): this is a plain native DOM click on a
  `<button>`, which really does bubble to the `document`-level "click
  outside closes the menu" listener, and would otherwise immediately close
  what the same click just opened.
- **Aircraft collection** (`app.py`'s `/api/login/google*`, `/api/logout`,
  `/api/me`, `/api/collection*`; `static/js/auth-collection.js`): the first
  user/session concept anywhere in this codebase — everything above this
  section is single-tenant with no login. Lets a signed-in user save an
  aircraft they're looking at and browse saved ones later as cards, in a
  new HUD-opened overlay panel.
  - **Sign-in is Google OAuth, not a hand-rolled login form** — via
    [Authlib](https://authlib.org) (`oauth = OAuth(app)`, registered with
    Google's OpenID discovery document), the one new external-auth
    dependency in this codebase. Hand-rolling the authorization-code
    exchange/ID-token verification would be a real security risk for no
    benefit over a well-audited library. `GOOGLE_CLIENT_ID`/
    `GOOGLE_CLIENT_SECRET` are optional env vars — lazily-configured the
    same way OpenSky's own OAuth2 client-credentials flow already degrades
    to anonymous when unset (see `CLIENT_ID`/`CLIENT_SECRET` above):
    without them, `/api/login/google` returns `{"error": "not_configured"}`
    (503) instead of crashing, the same pattern FlightAware uses for a
    missing API key. `app.secret_key` (needed for Flask's signed session
    cookie) falls back to `os.urandom(32)` when `SECRET_KEY` isn't set in
    `.env` — meaning every restart, including Flask debug's reloader
    re-exec on each file save (see `_should_start_background_thread()`
    below for the same restart-vs-reloader distinction), silently logs
    everyone out; set `SECRET_KEY` for logins to survive restarts.
    **The OAuth client's redirect URI/JS origins are registered for ports
    5051 and 5050 only** — see the "Commands" section at the top of this
    file for the exact list; running the app on any other port breaks
    the Google login flow even though everything else about the app
    works fine on an arbitrary port.
  - **Users store** (`_users`, `USERS_FILE`/`.users.jsonl`): same atomic
    tmp-file-then-`os.replace` JSONL idiom as `_identity_cache`/
    `IDENTITY_CACHE_FILE` above — `_load_users()`/`_save_users()` mirror
    `_load_identity_cache()`/`_save_identity_cache()` line for line, just
    keyed by Google's `sub` (a stable unique id) rather than `icao24`.
    **No password is ever stored** — Google's own consent screen is the
    only credential check; the stored record is just `{sub, email, name,
    picture, created_ts}`. `/api/login/google/callback` creates or updates
    that record on every successful login (so a changed Google display
    name/photo is picked up next login) and sets `session["user_id"]`;
    `/api/logout` clears it; `/api/me` reflects the current session's user
    (or `{"user": null}` when logged out).
  - **Collection store** (`_collections`, `COLLECTIONS_FILE`/
    `.collections.jsonl`): one shared JSONL file (not split per user),
    filtered by `user_id` on read — mirrors `_identity_cache`'s "one dict,
    filter per request" shape rather than multiplying file-handling code
    across N per-user files. Each card is `{id, user_id, icao24, saved_at,
    snapshot, photo_url, photo_link, photo_photographer}`; `id` is a
    server-generated `uuid.uuid4().hex`. **One `icao24` = one card per
    user** (re-approved 2026-07-18, superseding the original "each save is
    its own card" design): `api_collection_save()` looks up an existing
    card by `(user_id, icao24)` and updates its snapshot/photo/`saved_at`
    in place (200) rather than appending a duplicate (201 only for a truly
    new aircraft) — this is what makes the sidebar's save button a simple
    filled/outline toggle rather than an ambiguous "which of N saved
    copies" question.
  - **Persistence across devices and deploys**: `_users`/`_collections`
    (like `_track_cache`/`_identity_cache` above) are keyed by account
    (`user_id`, Google's `sub`), not by device or session — logging in
    from any device against the *same running backend* already sees the
    same collection, with no extra work needed. The actual persistence
    boundary is the backend process's own local disk: `USERS_FILE`/
    `COLLECTIONS_FILE` (like every other `*_FILE` env var in this app —
    `TRACK_CACHE_FILE`, `IDENTITY_CACHE_FILE`, `IDENTITY_HISTORY_FILE`)
    default to a plain relative path (`.users.jsonl`, `.collections.jsonl`,
    ...) written next to `app.py`. On an ephemeral container platform —
    this app's `Dockerfile` targets Northflank — that path lives inside the
    container's own writable layer, with no volume mounted onto it, so a
    redeploy or even a plain restart wipes every one of these files. Fix is
    infrastructure, not code: mount a persistent volume on the deployment
    and point each `*_FILE` env var at a path inside it (e.g.
    `COLLECTIONS_FILE=/data/.collections.jsonl`) — every one of these
    stores already reads its path from the environment, so no code change
    is needed, only the volume + env var configuration on the host.
  - **Snapshot, not live-refetch, by design**: a card stores `SNAPSHOT_FIELDS`
    (`registration`, `aircraftType`, `manufacturer`, `model`,
    `manufactureYear`, `operator`, `operatorCountry`/`operatorCountryIso`,
    `originCountry`/`countryIso`, `registeredOwner`/
    `registeredOwnerCountryIso`, `categoryDisplay`, `callsign`,
    `categoryGroup`) copied from `buildMergedDetails(icao24).info` at save
    time — deliberately excluding live telemetry (altitude, speed, squawk,
    position...) *and*, as of the same 2026-07-18 rework, **route fields**
    (`originAirport`/`destinationAirport` were dropped entirely) — a
    specific flight's route isn't a property of the airframe being
    collected, any more than its position is. `categoryGroup` is the one
    field added in that rework, persisted specifically so the panel can
    group saved cards without recomputing anything server-side.
    `api_collection_save()` filters the client-sent `snapshot` object to
    exactly this allowlist before persisting — the client is never trusted
    to have sent only permitted keys. The one photo saved alongside a card
    comes from whatever `galleryCache` already resolved for that aircraft
    this session (its already-normalized `{thumbnail_large:{src}, link,
    photographer}` shape, shared by Planespotters/airport-data.com — see
    the photo section above) — no new photo fetching or normalization
    logic.
  - **"C0" aircraft, and any ground vehicle/tower, can't be saved at all —
    and show no save button, not a disabled one**: `"C0"` is the literal
    ADS-B DO-260B letter+digit code (adsb.fi/airplanes.live's own encoding)
    for "surface vehicle, no category info whatsoever". Separately, an
    aircraft flagged by `looksLikeGroundVehicle()` (`state-filters.js` —
    a known ground-vehicle registration/type marker like `"TWR"`, or a
    callsign matching the airport-ground-vehicle pattern) can be a
    non-aircraft even with *no* `"C0"` category code at all (e.g. an
    OpenSky-only ground beacon with an empty/absent category, still caught
    by the registration heuristic) — so the two checks are independent,
    not one subsuming the other. A card for either would have essentially
    nothing useful in its snapshot and would always land in the panel's
    "Unknown / no info" group with zero identifying content. First shipped
    as a *disabled* button with an explanatory tooltip; changed
    (2026-07-19, explicit re-approval) to **hide the button from the DOM
    entirely** (`sidebarSaveCollectionBtn.hidden = true` in
    `updateSaveButtonState()`, `auth-collection.js`) instead — a disabled
    control still implies "this is a thing you could maybe save," which
    isn't true for a non-aircraft, so no control should render at all.
    `#sidebar-save-collection[hidden] { display: none; }` is needed in
    `static/style.css` specifically because the base rule sets
    `display: flex` on the same ID selector, which otherwise wins over the
    `[hidden]` attribute selector on specificity (both are one selector
    deep, but an ID beats an attribute) — without that override rule the
    browser's default `[hidden]` behavior would be silently defeated and
    the button would stay visible.
    `isGroundVehicle` didn't reach `detailsById` before this (only
    `categoryGroup`/`categoryCode` did, via `syncMarkers()` in
    `icons.js`) — added as a sibling property the same way those two
    already were, read by `updateSaveButtonState()` via
    `detailsById.get(selectedIcao24).isGroundVehicle`.
    The frontend sends both the aircraft's raw category code as
    `category_code` and a boolean `is_ground_vehicle` in the save request
    (see the frontend bullet below for where `category_code` comes from);
    the backend rejects with 400 `{"error": "category_not_collectible"}`
    if `category_code` is exactly `"C0"` **or** `is_ground_vehicle` is
    truthy — checked server-side too, never trusting the frontend's own
    hidden-button state alone. The `"C0"` check is deliberately narrower
    than `categoryGroup === 'unknown'` (which also covers OpenSky's own
    numeric 0/1 and several other ADS-B codes) — only the literal `"C0"`
    string is blocked by that half of the check; `is_ground_vehicle` is
    what catches everything else `looksLikeGroundVehicle()` flags.
  - **Routes**: `GET /api/collection` (401 if logged out; else the
    session's own cards, newest first), `POST /api/collection` (body
    `{icao24, snapshot, category_code, photo_url, photo_link,
    photo_photographer}` → 201 for a new card, 200 for an upsert of an
    existing one, 400 for a rejected `"C0"` code), `DELETE
    /api/collection/<id>` (only deletes if `user_id` matches the session's
    current user; a wrong-owner or unknown id both return a plain 404 —
    never a distinguishing 403, consistent with `/api/track`'s own
    plain-404-for-"not found" style, so a delete attempt can't be used to
    probe whether some other user's card id exists). Deletion here is
    always real and immediate — the "soft delete" experience described
    below is entirely a frontend illusion built on top of it, not a
    server-side flag.
  - **Category data plumbing** (`static/js/parsers.js`/`icons.js`): the raw
    ADS-B category code and `categoryGroup` used to never reach `info`/
    `detailsById` at all (only the per-poll render `item` had them,
    confirmed the same way the `render-details.js` comment already
    documents for `categoryGroup` specifically). Fixed the same way `lat`/
    `lon` were threaded through for route validation: `updateOpenSkyMarkers`/
    `updateRadiusSourceMarkers` now also push `categoryCode` onto each
    `item` (`extra && extra.category` for OpenSky-sourced items — OpenSky's
    own numeric category isn't an ADS-B letter+digit code at all, so
    there's nothing to carry when no radius-source `extra` is present; the
    raw `a.category` for radius-source items), and `icons.js`'s
    `syncMarkers()` carries both `categoryGroup`/`categoryCode` onto the
    `detailsById` entry as sibling properties (not merged into `info`
    itself, to avoid touching the dev-mode field-badge machinery that
    `info`'s keys drive).
  - **Frontend** (`static/js/auth-collection.js`, loaded right after
    `sidebar-track.js` and `state-filters.js` in the script order — see the
    top of this file; it reuses `state-filters.js`'s
    `CATEGORY_ICON_SVGS.unknown` glyph for the empty-state illustration and
    its category-group taxonomy for the panel's grouping): `checkAuth()`
    calls `/api/me` on load and renders `#auth-status` (either "Sign in
    with Google" or "Hi, `<name>` · Logout"); once logged in it also
    fetches `/api/collection` once to populate a client-side `savedCardsByIcao`
    (`Map<icao24, card>`) — this is what lets the sidebar button's filled/
    outline state track "is *this* aircraft already saved" without a fetch
    on every selection. Signing in is a **full-page navigation** to
    `/api/login/google` (`window.location.href =`, not `fetch()`) since
    OAuth needs a real browser redirect to Google's consent screen, not an
    XHR.
    - **Sidebar toggle** (`#sidebar-save-collection`, the bookmark-icon
      button, a third circle alongside `#sidebar-close`/
      `#sidebar-center-map`): `updateSaveButtonState()` — called from
      `selectAircraft()` on every new selection, and after every login/
      save/unsave — sets three things at once: the `.saved` class (filled
      vs outline, a pure CSS fill-toggle on the SVG path — see
      `static/style.css`, no duplicate markup needed since a CSS rule
      always overrides an SVG presentation attribute), a `title` tooltip,
      and `disabled` when the selected aircraft's `categoryCode` (read
      directly off `detailsById.get(selectedIcao24)`, the same way route
      validation reads `.lat`/`.lon` off that same entry — never through
      `buildMergedDetails().info`) is exactly `"C0"`.
      `saveCurrentAircraftToCollection()` branches on `savedCardsByIcao
      .has(selectedIcao24)`: not yet saved → `POST` (the upsert route);
      already saved → `unsaveAircraft()` → immediate `DELETE`, no ghost/
      undo of its own (unlike the panel below) since there's no list
      context in the sidebar and re-saving from there is trivial.
    - **Fullscreen panel** (`#collection-panel`, `position:fixed; inset:0`,
      re-approved 2026-07-18 over the original centered 640px modal):
      opened via the HUD's "My collection" button, closable via its "×"
      button or `Escape`. Renders from the two in-memory Maps
      (`savedCardsByIcao` + `removedCards`, see below) rather than
      re-fetching on every open — a fresh `/api/collection` fetch would
      have no memory of a card removed-with-undo this session (the server
      has already really deleted it), so re-fetching would silently drop
      the ghost.
    - **Grouped by category, not by literal aircraft type**: cards are
      bucketed by `snapshot.categoryGroup` and rendered in the same fixed
      weight-class order as `#category-filter`'s own dropdown (`light,
      small, large, high_vortex_large, heavy, high_performance, rotorcraft,
      glider, lighter_than_air, parachutist, ultralight, uav,
      surface_obstacle, unknown`), reusing that dropdown's exact label
      text for each group header + a live per-group count. Within a group,
      most-recently-saved first.
    - **Descriptive empty state**: a centered, muted illustration (the
      exact same "no ADS-B info" glyph `CATEGORY_ICON_SVGS.unknown` already
      uses elsewhere, reused rather than inventing a second icon language)
      plus a title + hint line, rather than the original's plain-text-only
      placeholder.
    - **Compact per-card view**: photo + registration/ICAO + aircraft type
      only (operator and everything else in the snapshot is dropped from
      the card body to stay compact — still persisted server-side, just
      not surfaced in this view). Every card in this view is, by
      definition, currently saved, so its toggle icon (`.collection-card-
      icon-btn`, the same bookmark glyph/fill rule as the sidebar's) always
      renders filled. `.collection-card-photo-wrap` uses the same fixed
      `aspect-ratio: 16 / 9` + `object-fit: cover` treatment as the sidebar
      gallery slider (see "Fixed 16:9 slider box" above) — one consistent
      photo-box shape across every place this app shows an aircraft photo.
    - **"Elegant" soft delete + session-scoped Undo**: clicking a card's
      icon (`removeCardWithUndo()`) fires the real `DELETE` immediately —
      no confirmation dialog — but the card stays in the DOM, dimmed
      (reduced opacity + greyscale) with a "Removed" label and an "Undo"
      button, tracked in the `removedCards` `Map<id, card>` (populated from
      that click, since the server has already forgotten it). Undo
      (`undoRemoveCard()`) re-`POST`s the remembered snapshot/photo
      (creating a fresh card, new `id`) and removes the entry from
      `removedCards`. `removedCards` is in-memory only and never persisted
      anywhere — a page reload clears it for free, which is exactly the
      intended "gone for good after a refresh" behavior; nothing needed to
      be built to make that true.
    - Cards render via `document.createElement`/property assignment, not
      string-concatenated HTML — `snapshot.operator`/`registration`/etc.
      ultimately originated from external APIs (adsbdb, OpenSky), so the
      same "don't trust external strings as markup" discipline
      `renderGallery()` already applies to photographer credits applies
      here too. A card's `<img>` gets an `error` handler that swaps in a
      plain "No photo" placeholder — there's no second stored URL to fall
      back to the way the live gallery's `fallback_src` two-tier degrade
      has.
  - **Tests can't exercise real Google OAuth** (no browser automation can
    complete Google's actual consent screen), so both layers mock around
    it rather than through it: `tests/backend/test_google_auth.py`
    monkeypatches `oauth.google.authorize_redirect`/
    `authorize_access_token` directly, and `conftest.py`'s `login_as
    (client, user_id)` helper sets the session cookie via Flask's test
    client `session_transaction()` — bypassing the real redirect/callback
    dance entirely — for every other backend test that needs an
    already-logged-in user (`test_collections.py`).
    `tests/frontend/test_auth_status.spec.js`/`test_collection.spec.js`
    mock `/api/me` (and `/api/collection`) via `page.route()` to simulate
    a logged-in session, the same way every other Playwright spec here
    mocks external data.

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
- Runs on port 5050, not 5051 — see the Commands section above.
- `test_track.spec.js` targets an adsb.fi marker for the successful track
  path (OpenSky is nevertheless the first-priority source), asserts the
  actual `trackLayerGroup` rather than a fixed stroke color, and covers
  empty/404 tracks plus the local live-trail fallback. Also tests the HUD
  track status (`#track-status`) and its `(?)` popover.
- `test_opensky_quota.spec.js` covers the map-data quota lockout: a
  `rate_limited` `/api/states` auto-disables and locks the source, and a short
  `retry_after_seconds` proves the 1s ticker restores it (with polling and
  markers resuming) once the window elapses.
- `test_source_count_spinner.spec.js` covers the count slot's three states
  (off → spinner → pill). To observe the pending state at all it holds the
  route's response open behind a promise it resolves by hand, rather than
  racing a mock that answers instantly — the same trick works for any
  "loading" UI here.
- Assert countdown text with a regex (`/available in 3h \d+m/`), never a fixed
  string: both countdowns are live and tick between the page load that starts
  them and the click that reads them — a literal `3h 3m` passes locally and
  fails whenever the assertion lands a second late.
- `test_dev_mode.spec.js` covers the dev-mode toggle: dev-mode-off is
  byte-identical to today's default rendering (regression guard), dev-mode-on
  shows a normally-hidden group as dashes, a populated field renders a
  `.source-badge` with the correct `data-source`, clicking it reveals
  `#source-tooltip` with the right display name and closes on an outside
  click, and re-toggling off restores the exact non-dev-mode markup. Uses
  `dddddd` (OpenSky's dedup-winning marker, enriched with adsb.fi's
  registration/aircraft type) to exercise both an OpenSky-native field and
  an adsb.fi-enrichment field in one sidebar. Since sidebar rows aren't
  individually wrapped elements, the badge-scoping assertions match against
  the group's `innerHTML` (or walk `nextSibling` from the row's own `<b>`
  tag) rather than DOM-parent traversal, which would grab the *first* badge
  in the whole group instead of the one for a specific field.
- `test_opensky_quota.spec.js`'s "auto-restores once the retry window
  elapses" test is occasionally flaky under full-suite parallel load (a 1s
  ticker racing real wall-clock time) — passes reliably standalone or with
  fewer parallel workers; not a sign of an actual regression if seen
  failing only in a full `npx playwright test` run.
- `tests/backend/test_enrichment.py` covers both the `enrichment/` package's
  pure lookup functions (no `mock_get`/`mock_post` needed at all — the
  first backend test file with no HTTP mocking, since there's no HTTP call
  to mock) and the `/api/identity/<icao24>` route via Flask's test client
  directly. Verifies every worked example from the original spec exactly
  (`OK-SWC`→Czech Republic, `49d3d3`→Smartwings/Boeing/737 MAX 8/2021,
  `TVP7200`→Smartwings, `4X-ABS`→Israel — the last one added after a real
  Israir aircraft turned up with `4X` missing from `registration.py`'s
  prefix table), each orchestrator priority tier in isolation (including
  `operator_country`'s own `callsign_decode`-only tier, kept separate from
  `operator` itself), and that `conftest.py`'s `reset_caches` needs no new
  entry (this route is intentionally uncached).
- `test_identity_enrichment.spec.js` covers: dev-mode-off shows resolved
  enrichment values plainly and unresolved ones as literal "Unknown" with
  zero badges; dev-mode-on shows exactly one black `flywme`-sourced badge
  whose tooltip reads "Flywme — computed from `<technique>`, confidence
  `<n>`"; a live value is never overwritten even by a deliberately
  contradicting enrichment response, and gets no Flywme badge alongside its
  real source's badge; a Flywme-resolved Operator Country (via
  `callsign_decode`) gets its own flag even with no adsbdb data at all;
  each of the four `.info-tip`-bearing identity-row labels (Operator/
  Operator Country/Registered Owner/Registration Country) has a
  click-to-toggle tooltip whose text cross-references the other three,
  reachable with dev mode off; Registration is excluded from the "Unknown"
  treatment (shows/hides by the ordinary rule) while the other six
  identity fields (Manufacturer/Model/Year built/Operator/Operator
  Country/Registered Owner/Registration Country) aren't. Uses `eeeeee`
  (adsb.fi+airplanes.live only, no live country/operator/year — good for
  gap-filling) and `dddddd` (has live `originCountry`/registration — good
  for "live wins"). Selects a marker
  via `markerMapsBySource[sourceName].get(hex)` rather than the bare
  `openskyMarkers`/`adsbfiMarkers` globals used elsewhere in this suite,
  since the source name needs to be a runtime string here; waits for
  `enrichmentById.has(hex)` before asserting, since the identity fetch is
  async and lands after `selectAircraft()` returns.
- `tests/backend/test_adsbdb.py` covers `/api/adsbdb/<icao24>`: the
  combined aircraft+callsign request and its exact upstream `params`,
  aircraft-only (no/unknown callsign, including adsbdb's "200 with just
  aircraft" behavior for a known aircraft + unknown callsign), the 404
  "unknown aircraft" response, indefinite caching (including that a
  different callsign for the same icao24 is a distinct cache entry), and
  that a network error returns 502 *without* caching. `conftest.py`'s
  `reset_caches` gained a `_adsbdb_cache.clear()` entry.
- `tests/backend/test_identity_cache.py` covers the persistent
  aircraft-identity cache: a fresh fetch populates `_identity_cache` with
  the four tracked fields; a later fetch (different callsign, so a fresh
  upstream request rather than a cache hit) with a changed field both
  updates the cache and appends exactly one line to
  `IDENTITY_HISTORY_FILE`; a null field in a later response never erases a
  previously known value (and logs nothing); the cache persists to and
  reloads from disk (same style as `test_track.py`'s restart test); an
  unknown (404) aircraft never touches the cache at all. `conftest.py`'s
  `reset_caches` redirects `IDENTITY_CACHE_FILE`/`IDENTITY_HISTORY_FILE` to
  throwaway files, same rationale as the existing `TRACK_CACHE_FILE`
  redirect. Also covers `/api/identity/stats`: zero counts on an empty
  cache, and both counters incrementing correctly after a fetch followed
  by a field change. Also covers the background backfill helpers directly
  (never the real thread/sleep loop, which would be slow and flaky to
  test): `_collect_visible_icao24s()` unions fixture-shaped OpenSky +
  radius-source cache data, lowercases and dedupes, and ignores
  FlightAware's cache; `_identity_backfill_tick()` resolves exactly one
  not-yet-cached aircraft per call, is a no-op when nothing new is visible,
  and skips (doesn't re-fetch) an aircraft a simulated real click already
  resolved after being queued; `_should_start_background_thread()` is
  tested as a pure predicate over all three `(app.debug, WERKZEUG_RUN_MAIN)`
  combinations via `monkeypatch`, with no thread ever actually started.
  `conftest.py`'s `reset_caches` also clears `app._backfill_queue`.
- `test_dev_mode.spec.js` also covers the `#dev-identity-stats` line:
  hidden whenever dev mode is off (it's inside `#dev-aircraft-panel`,
  which shares that show/hide state), and shows the exact
  `"Identity cache: N aircraft · N changes logged"` text once dev mode is
  on. Registers its own `/api/identity/stats` route override (Playwright
  matches the most-recently-registered route) since `mockAllSources()`'s
  blanket `**/api/identity/**` mock — meant for the unrelated per-aircraft
  enrichment route — would otherwise also swallow this distinct stats
  route and produce `"undefined"` text.
- `test_adsbdb.spec.js` covers: the `#source-adsbdb` dev-mode-only toggle
  (hidden + checked by default, appears checked once dev mode is on,
  hides again when dev mode is switched off); Registered Owner/Operator/
  Route all filling from adsbdb when the live feed has none of them, each
  tagged with an `adsbdb` badge; a live registration is never overwritten
  even by a deliberately contradicting adsbdb response; Registered Owner
  shows literal "Unknown" like the other identity-enrichment fields when
  adsbdb has nothing; adsbdb's photo is never shown when a real
  Planespotters photo already exists (last-resort only, not merely
  deduplicated); and, when Planespotters/airport-data.com found nothing at
  all, adsbdb's thumbnail *is* shown, rendered at native size from the
  start rather than stretched. Also mocks `/api/photo2/**` itself, since
  this suite's aircraft always fall short of `GALLERY_TARGET_COUNT` from
  Planespotters alone and would otherwise trigger it — see the next bullet
  for why that mock can't be left to `mockAllSources()`'s own defaults yet.
- **Pre-existing test-suite gap, found while adding `test_adsbdb.spec.js`,
  not introduced by it**: unlike `/api/photo/**`, `/api/photo2/**` has no
  default mock in `helpers.js`'s `mockAllSources()` at all — any spec that
  opens a sidebar for an aircraft with fewer than `GALLERY_TARGET_COUNT`
  Planespotters photos (the default mock returns none) genuinely calls out
  to the real airport-data.com during the test run. Worth fixing at some
  point (adding a default `/api/photo2/**` mock to `mockAllSources()`
  itself), but out of scope for the adsbdb work that surfaced it.
- `test_route_validation.spec.js` covers both the pure geometry (reached
  directly via `page.evaluate`, the same style used elsewhere for
  `normalizeAdsbExchange`/etc.): `initialBearingDeg` against the design
  doc's own EGLL→KJFK worked example (~288°), `routeProgressPercent` at
  the two route endpoints, and `validateAdsbdbRoute` scoring a
  geometrically consistent flight Medium+ and an implausible one (position
  and track both far off a fabricated route) into Reject — and the Route
  row end-to-end: a consistent route renders with no warning, an
  implausible one shows the `⚠`/`.route-warning` styling even with dev
  mode off, and dev mode's badge tooltip contains the band name and score.
  Uses `aaaaaa` (`states.json`) — its live lat/lon/track/speed/altitude are
  the "current state" fed into every check.
- `test_dev_aircraft_table.spec.js` covers the "All aircraft" dev-mode
  panel: hidden by default and appears with one row per currently-visible
  aircraft (9, the default fixture total also asserted in
  `test_filters.spec.js`) once dev mode is on; a row shows the sidebar's
  own Identity fields including Route once resolved (and correctly shows
  nothing yet for a never-clicked aircraft, proving the table doesn't force
  new adsbdb fetches); clicking a row calls `selectAircraft()` exactly like
  clicking the marker; and disabling a source drops its rows from the
  table (verifies the list is built from live marker maps, not the
  never-pruned `detailsById`).
- `test_center_map.spec.js` covers `#sidebar-center-map`: clicking it
  re-centers on the selected aircraft's known fixture position while
  preserving the current zoom level (rather than resetting it), and
  clicking it with nothing selected is a safe no-op (the map's view is
  left untouched).
- `test_basemap.spec.js` covers the basemap picker: Voyager is the only
  active `baseLayers` entry on load; switching to each of the other eight
  styles swaps which single entry `map.hasLayer()` reports true for and
  updates the dropdown's label; the dropdown closes after a selection,
  same as `#category-filter`'s own behavior.
- `test_weather.spec.js` covers the four weather layers: all off with zero
  network activity by default; enabling Precipitation/Forecast fetches
  RainViewer's discovery JSON and builds a tile layer from the latest
  matching frame (asserting the real `pane`/`maxZoom`/`maxNativeZoom`
  values, not just that a layer exists); Precipitation and Forecast can be
  on simultaneously and toggle independently of each other; switching the
  basemap doesn't remove an active Precipitation layer (the dedicated-pane
  fix); enabling SIGMET/METAR fetches their own backend routes and renders
  a polygon/marker respectively; and all four layers together at once.
  `tests/backend/test_metar_sigmet.py` covers `/api/metar`/`/api/sigmet`
  directly: the bbox param passed to METAR, caching, stale-cache-on-error
  and no-cache-502 for both, SIGMET's area-filtering (a nearby one kept, a
  far-away one dropped), and — the one real bug this shipped with — a
  `geom: "AREAS"` (multi-polygon) SIGMET's nested-rings coordinate shape,
  which the first version 500'd on since it assumed every SIGMET's
  `coords` was a flat list.

## SVG Icon Rendering

**Problem:** Inline SVG paths with coordinates in the range -100 to 200 need to scale responsively in containers of varying sizes (16px dropdown, 80px–200px test sizes, etc.) while remaining centered and not clipped.

**Solution:** Use `viewBox="0 0 200 200"` with `transform` on the containing `<g>` group, paired with `width="100%" height="100%"` and `display: flex; align-items/justify-content: center` on the container.

**Why this works:**
- `viewBox="0 0 200 200"` defines a 200×200 coordinate region (0 to 200 on both axes) for SVG rendering. The SVG engine automatically scales this region to fill the `<svg>` element's dimensions (set by the container's `width`/`height`).
- The `<g>` group applies a transform like `transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)"` which rotates and repositions the paths within that 200×200 region. This happens *before* the viewBox scaling, so the transform coordinates stay stable regardless of container size.
- Paths with coordinates -100 to 200 (e.g., aircraft silhouettes from the ADS-B Radar icon set) work because the viewBox captures the region they occupy; no clipping or off-canvas rendering occurs.
- Container-level `flex` with `align-items: center; justify-content: center` ensures the SVG is centered within its parent, even if the parent is smaller than the SVG's natural size.

**Example structure:**
```html
<div style="width: 200px; height: 200px; display: flex; align-items: center; justify-content: center; border: 1px solid #ddd;">
  <svg width="100%" height="100%" viewBox="0 0 200 200">
    <g transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)">
      <path d="M 137.678 -39.456 C ... Z" fill="currentColor"/>
    </g>
  </svg>
</div>
```

**Do not use:**
- `viewBox="-100 -100 200 200"` (larger viewBox than content region) — causes clipping or off-center rendering depending on browser/coordinates.
- `transform="translate(...) scale(...)"` on the group without proper viewBox — transforms are applied in coordinate space, not pixels, making centering difficult and brittle.
- `width/height` set as fixed pixel values on the SVG — breaks responsive scaling.

**Testing:** [test-icon.html](static/test-icon.html) demonstrates Icon 2 and Icon 3 (from `a1.svg` and `a2.svg`) with this approach across three sizes (80px, 120px, 200px). Icon 1 (without viewBox) is included as a counter-example showing clipping/misalignment.

## Conventions

- All UI text and code comments are in English, regardless of the language
  used in conversation.
- Keep this to a handful of plain files (backend, markup+JS, stylesheet) —
  no framework, no build step, no database. This is an intentional MVP
  constraint, not an oversight. `static/style.css` is a `<link>`ed
  stylesheet, not a build artifact, so it doesn't violate "no build step."
  Not a hard requirement, though — the project isn't attached to staying
  build-step-free forever. If a future need (bundling, minification,
  TypeScript, whatever) makes a build step the better tradeoff, adopt one;
  this convention just reflects that nothing so far has justified it.