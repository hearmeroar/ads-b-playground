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
`static/index.html` (markup) plus `static/js/*.js` (nine plain classic
`<script src>` files, loaded in a fixed order) and `static/style.css` — no
framework, no build step, all of it just plain `<link>`/`<script>`-included
static files. The JS files share one global scope (deliberately NOT ES
modules: the Playwright tests reach top-level names like `openskyMarkers`
via `page.evaluate`, and load-time statements rely on the original
execution order), so their `<script>` order in `index.html` is load-bearing:
`map-init` → `constants` → `route-validation` → `state-filters` →
`sidebar-track` → `icons` → `render-details` → `parsers` → `main`
(`route-validation` holds only pure geometry functions with no DOM/fetch
dependencies of its own — it's placed early since `sidebar-track`'s
`buildMergedDetails()` is its only caller). Where this file says
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
manual sync of six independent constants.

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
  into that source's sidebar. A source that fails resolves to `null` for that cycle and
  is simply skipped (its existing markers and count are kept), so one dead source never
  blocks the rest:
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
  (adsb.fi/airplanes.live-only: `operator`, `manufactureYear`, `dbFlags`,
  `messageType`, `adsbVersion`, and the DO-260B NIC/NACp/NACv/SIL/GVA/SDA
  accuracy fields — no OpenSky equivalents, confirmed against live API
  responses), plus **two new fields unique to FlightAware**: `originAirport`
  and `destinationAirport` (displayed as "Route" in the Identity group,
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
  showing ICAO/Callsign/Registration/Type/Route (Operator/Country/Category
  are still there, just folded into the row's `title` tooltip rather than
  widening the panel). Deliberately a *tall narrow column* (mirrors
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
    country. Expanded from an initial ~20-entry placeholder subset to 192
    entries covering essentially every nationality mark, after a real
    aircraft (`SE-RTJ`, Sweden) came up with no country resolved simply
    because `SE` wasn't in the table yet. Longest-prefix-match, with one
    extra wrinkle: two ICAO territories share their sovereign's base mark
    but get their own sub-block after the dash — Hong Kong (`B-H...`) and
    Macau (`B-M...`) both fall under China's bare `B` — handled by trying
    "prefix + first character after the dash" (`BH`, `BM`) as a more
    specific candidate before falling back to the bare prefix; `callsign.py`
    maps ICAO 3-letter airline designators to an operator
    (confidence 0.8) and that operator's home country (confidence 0.6 —
    two independently-confidenced facts from one lookup, since they feed
    two different priority chains); `aircraft_database.py` holds a
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
  - **Priority chain, agreed with the project owner**: live feed > adsbdb >
    Flywme-computed, i.e. adsbdb is inserted as a *second* tier between the
    two `buildMergedDetails()` already had. Each tier only fills a field
    still empty after the tier above ran: Country/Operator/Registration/
    Manufacturer/Model can all be filled from adsbdb
    (`registered_owner_country_name`/`flightroute.airline.name`/
    `registration`/`manufacturer`/`type` respectively) ahead of Flywme's own
    guess; Year built has no adsbdb tier at all (the API doesn't return
    one); Route (`originAirport`/`destinationAirport`) sits *below*
    FlightAware's existing per-poll callsign-match tier (unchanged) but
    above nothing else, since no tier ever computes a route locally.
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
    row). Operator gets a flag too (`operatorCountryIso`, from
    `flightroute.airline.country_iso`) but only when adsbdb's tier is what
    filled it — a live-sourced or Flywme-computed operator still renders
    without one, the same known limitation as Country's own flag.
  - **Photo (`url_photo`/`url_photo_thumbnail`)**: adsbdb's own sample data
    shows this is, in practice, the *same* photo as our airport-data.com
    top-up (identical numeric id in the path) — so most of the time it's
    already in the gallery and gets deduplicated away. adsbdb doesn't supply
    a `photographer` field at all (unlike airport-data.com's own API this
    app otherwise always credits), so a genuinely unique adsbdb photo is
    still shown, but with `photographer: 'via adsbdb.com'` rather than a
    fabricated name, and appended to the **end** of the gallery — the
    least-prominent slot, since it's the lowest-confidence of the three
    candidates (no photographer credit, and usually a duplicate). Dedup
    matches by the numeric id in the URL (`photoIdFromUrl()`, mirroring
    `app.py`'s own `_AIRPORTDATA_ID_RE`) against every photo already in the
    gallery, not exact URL string equality, since adsbdb's URL host/shape
    differs from our own reconstructed full-size URL for the same photo.
    `loadGallery()` and `loadAdsbdb()` are independent concurrent fetches
    kicked off together from `selectAircraft()`; whichever finishes *last*
    is the one that actually performs the dedup+append+re-render, by
    checking the other's cache (`galleryCache`/`adsbdbPhotoByIcao`) —
    neither blocks on the other.
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
  **UI**: a route scoring below 60 (Low/Reject) is never hidden — it still
  renders, prefixed with a `⚠` and styled via `.route-warning` (amber, not
  red — red stays reserved for emergency/alert fields), **in both normal
  and dev mode**, since a likely-wrong route is misleading regardless of
  dev-mode status. Dev mode additionally makes the Route row's badge
  clickable to a tooltip with the score breakdown (band, total score,
  track/distance/progress numbers) — reusing the same generic
  `#source-tooltip` click mechanism already wired for Flywme's badges
  (`main.js`), just with a route-specific `data-detail` string
  (`routeConfidenceDetail()`, `static/js/render-details.js`) instead of the
  generic per-field badge path, since a route's confidence is a composite
  result, not a single field's resolution tier.
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
  after panning away to look at something else. OpenSky may have no track for a given
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
  `TVP7200`→Smartwings), each orchestrator priority tier in isolation, and
  that `conftest.py`'s `reset_caches` needs no new entry (this route is
  intentionally uncached).
- `test_identity_enrichment.spec.js` covers: dev-mode-off shows resolved
  enrichment values plainly and unresolved ones as literal "Unknown" with
  zero badges; dev-mode-on shows exactly one black `flywme`-sourced badge
  whose tooltip reads "Flywme — computed from `<technique>`, confidence
  `<n>`"; a live value is never overwritten even by a deliberately
  contradicting enrichment response, and gets no Flywme badge alongside its
  real source's badge; Registration is excluded from the "Unknown"
  treatment (shows/hides by the ordinary rule) while the other four
  identity fields aren't. Uses `eeeeee` (adsb.fi+airplanes.live only, no
  live country/operator/year — good for gap-filling) and `dddddd` (has live
  `originCountry`/registration — good for "live wins"). Selects a marker
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
- `test_adsbdb.spec.js` covers: the `#source-adsbdb` dev-mode-only toggle
  (hidden + checked by default, appears checked once dev mode is on,
  hides again when dev mode is switched off); Registered Owner/Operator/
  Route all filling from adsbdb when the live feed has none of them, each
  tagged with an `adsbdb` badge; a live registration is never overwritten
  even by a deliberately contradicting adsbdb response; Registered Owner
  shows literal "Unknown" like the other identity-enrichment fields when
  adsbdb has nothing; a unique adsbdb photo lands at the *end* of the
  gallery behind an existing, properly-credited Planespotters photo; and a
  photo whose numeric id already exists in the gallery is deduplicated
  away rather than appended. Also mocks `/api/photo2/**` itself, since
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