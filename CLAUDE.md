# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page live aircraft tracker: a Flask backend proxies six
independent data sources — OpenSky Network, adsb.fi, adsb.lol,
adsb.one, airplanes.live, and FlightAware AeroAPI — and a static Leaflet
page polls the enabled ones and renders aircraft as rotated, color-coded
markers. Backend logic lives in `app.py`; the frontend is
`static/index.html` (markup + inline JS) plus `static/style.css` — no
framework, no build step, `style.css` is just a plain `<link>`ed stylesheet.

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
quota, so they need none of OpenSky's auth machinery. All four go through
`cached_radius_source()`, one shared cache/retry helper, each with its own
`*_MIN_INTERVAL` (10s) and `*_CENTER`; adding a fifth is a URL, a center, an
interval, and a three-line route. None has a bbox query, only lat/lon/radius
(nautical miles, max 250), so each `*_CENTER` approximates the same area as
`BBOX`. All return the same ADSBExchange-compatible JSON shape (altitude in
feet, speed in knots — converted client-side to match OpenSky's units), which
is why one parser (`parseAdsbExchangeAircraft()`) serves all four.
**adsb.lol and adsb.one are off by default** in the HUD: adsb.lol's upstream
is currently unstable (intermittent multi-second hangs) and adsb.one is
behind a Cloudflare block. They're wired up and working, so this is a default,
not a limitation — a failing source degrades to `null` for that cycle rather
than breaking the poll.

> **Shorthand:** the rest of this file often says "adsb.fi/airplanes.live"
> where it means *any* radius source — they share one JSON shape, one parser,
> and one set of extra fields, so a claim about one holds for all four.
> adsb.fi and airplanes.live are named because they're the two that ship
> enabled; adsb.lol and adsb.one behave identically wherever the phrase
> appears.

**FlightAware AeroAPI (`/api/flightaware` → `aeroapi.flightaware.com/aeroapi/flights/search`):**
This sixth source is structurally unlike the four radius sources in three critical ways.
First, it's **authentication-required**: requests must carry an `x-apikey` header with a
FlightAware API key, and there's no anonymous fallback (returns `{"flights": [], "error": "not_configured"}`
without one). Second, it's **flight-centric, not transponder-centric** — a `{flights: [...]}` array
(real sample: one flight leg has an `ident`/`ident_icao` *callsign* like `"ASL439"`, but no
ICAO24/hex field). Position/altitude/speed/heading live under a nested `last_position` object;
altitude is in hundreds of feet (e.g., `8` = 800 ft). Origin/destination airports (`code_iata`/
`name`) are unique to this source and are surfaced in the sidebar as new `originAirport`/
`destinationAirport` fields. Third, it's **metered/paid** — the user deliberately chose to poll
it at 10s (same as free sources) and ship it **enabled by default**, accepting the cost tradeoff;
this is not an oversight and should not be "optimized" to off-by-default or slower intervals
without explicit re-approval.
**Dedup strategy:** Since FlightAware has no ICAO24, it uses **callsign-based dedup** against the
other five sources. Every source already carries a callsign field; they are matched case-insensitively
and whitespace-trimmed (`normalizeCallsignKey()`, in the dedup comparison). When a FlightAware flight's
callsign matches an aircraft from OpenSky/adsb.fi/adsb.lol/adsb.one/airplanes.live, the FlightAware
marker is suppressed and its `originAirport`/`destinationAirport` are merged into the matched
aircraft's sidebar (similar to `enrichmentByHex` for radius sources). A non-match (formatting
difference, missing callsign, or a FlightAware-only flight) simply leaves FlightAware's own marker
showing — never causes a false merge. Cached like the four radius sources (10s `FLIGHTAWARE_MIN_INTERVAL`).

**Area coupling:** `BBOX` and the four `*_CENTER` constants in `app.py`, plus
the map's initial center/zoom in `static/index.html` (`map.setView(...)`),
are six independent constants that must be kept roughly in sync manually —
there's no shared config between backend and frontend.

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
  after a toggle. **OpenSky, adsb.fi and airplanes.live ship checked**;
  adsb.lol and adsb.one ship off (see above). Turning OpenSky off clears the
  quota line and any pending OpenSky warning message.
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
    `enrichmentByHex`, a lookup merged from all four radius responses — see
    `normalizeOpenSky(s, extra)`. It's built by iterating the lists
    *lowest→highest* priority so the highest-priority source writes last and
    wins, matching the marker dedup order below. Fields every source already
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

  The hard part is that **no part of the pipeline otherwise tracks which
  source populated a given field** — `normalizeOpenSky`/
  `normalizeAdsbExchange`/`normalizeFlightAware` return plain flat objects,
  and `enrichmentByHex` (the map that resolves which radius source wins for
  a given aircraft) used to discard the winning source's name once it
  picked a record. A parallel `fieldSources` object (`{fieldName:
  sourceKey}`) is now threaded alongside `info` through the same call
  paths, via `fieldSourcesFor(info, nativeFieldSet, primarySource,
  extraSource, routeSource)`: `enrichmentByHex` values are now `{data,
  source}` instead of a bare parsed record; `updateOpenSkyMarkers` tags its
  OpenSky-native fields (`OPENSKY_NATIVE_FIELDS`) `'opensky'` and every
  enrichment-derived field with whichever radius source won
  `enrichmentByHex`; `updateRadiusSourceMarkers` (which now also takes a
  `sourceName` parameter) and `updateFlightAwareMarkers` tag every field
  with their own single source, since each of their markers' `info` is
  built from exactly one raw record; the two FlightAware route-merge call
  sites additionally tag `originAirport`/`destinationAirport` as
  `'flightaware'` right after setting them. `sourceBadgeHtml(fieldKey,
  fieldSources)` renders the dot(s) — `fieldKey` can be an array for
  composite rows (Route, Wind) that read two raw fields at once. Since the
  sidebar's `<b>label:</b> value<badge>` rows aren't individually wrapped
  elements (just concatenated with `<br>` inside one `.detail-group` div),
  anything that needs to target one specific row's badge (tests, mainly)
  must match on the row's own text/HTML rather than DOM-parent traversal.

  The tooltip itself (`#source-tooltip`, styled in `static/style.css`) is a
  single shared element repositioned per click via event delegation on
  `sidebarDetailsEl` — badges are regenerated HTML on every render (the
  `.innerHTML` swap in `syncMarkers()`/`selectAircraft()`), so a
  `wireHelpPopover()`-style per-element listener would be destroyed each
  time; delegation on the stable container avoids that. Kept as its own
  listener rather than folded into `closeHelpPopovers()`, since that
  mechanism is built for a fixed set of statically-known popovers wired
  once at load, not one dynamic, differently-positioned tooltip.

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
  discarded after filtering.
- **Marker icon by category:** `iconFor(item, color)` dispatches on
  `item.categoryGroup` via the `ICON_BUILDERS` lookup table. Each category
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
  set's "no ADS-B info" variant) via `unknownIcon()`/`UNKNOWN_GLYPH`; the
  `space` category group (absent from `ICON_BUILDERS`, no dedicated icon in
  the set, and removed from the category filter dropdown as not relevant to
  this tracker's region) also falls through to `unknownIcon()` — `iconFor()`
  uses it as the default whenever `ICON_BUILDERS` has no entry for a
  category group, including when category is absent/unrecognized entirely.
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