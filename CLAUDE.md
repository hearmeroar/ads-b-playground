# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**`PLAN_NOTES.md`** (repo root, gitignored, not committed) holds the working
architecture audit + the in-progress implementation plan for the current
round of improvements (SQLite migration, CI, marker interpolation, etc.) —
check it at the start of a session if picking this work back up, so it
doesn't need to be re-derived from scratch.

## AI Memory System (`.ai/`)

This file is large (210KB) and mixes stable architectural facts, historical rationale, and detailed how-tos together. For efficient AI-agent context, the repo includes a committed project memory layer (`.ai/` directory):

@.ai/PROJECT.md
@.ai/ARCHITECTURE.md
@.ai/CURRENT.md

**Auto-imported above:** PROJECT.md (overview, goals, hard constraints), ARCHITECTURE.md (current-state map of sources/modules/data flow), CURRENT.md (what's actively being worked on). These three load automatically into context via `@` includes.

**On-demand files** (not auto-imported, read when relevant):
- `.ai/DECISIONS.md` — Architecture Decision Records (ADR log) for historically-significant decisions. Read when you need the rationale behind an architectural choice.
- `.ai/BACKLOG.md` — Parked ideas and features not yet scheduled. Read before proposing new features or when asked about roadmap.

**Session-start checklist:**
1. Read CLAUDE.md (you're here).
2. The three auto-imported `.ai/` files load as part of CLAUDE.md's own context.
3. Optionally read `.ai/DECISIONS.md` (recent entries) if exploring why a past architectural choice was made.
4. Optionally read `.ai/BACKLOG.md` if adding features or proposing ideas.

**Before creating a commit:**
If your changes represent an architecturally-significant decision (new data source, changed priority chain, changed storage approach, new constraint), add an entry to `.ai/DECISIONS.md` (format: date, problem, decision, reason, tradeoffs). Update `.ai/ARCHITECTURE.md` if the current-state map itself changed. Update `.ai/CURRENT.md` if the active task status changed. Place new parked ideas in `.ai/BACKLOG.md`, not DECISIONS.md. Mark completed backlog items with `✅ ` prefix (e.g., `✅ **Item Name**`) — they are auto-pruned on commit.

**Mechanical enforcement** (commit-time hooks in `.claude/settings.json` that
back the rules above — staging `.ai/CURRENT.md`, auto-pruning `✅`-marked
`.ai/BACKLOG.md` items, nudging on `app.py`/`storage.py`/`enrichment/`
changes, and — since 2026-07-21 — blocking a commit unless pytest/Playwright/
a real curl against a running server actually ran and passed for whatever
area the commit touches, closing the "tests passed but the real endpoint
404s" gap): see `.agents/architect.md` for the full hook behavior and
bypass flags.

**What NOT to write in `.ai/` files:**
- Temporary debugging traces or "tried X, didn't work" logs (keep those in CURRENT.md only while actively working, then remove them).
- Duplication of README's install/run instructions (link to README instead).
- Duplication of CLAUDE.md's full narrative (link to relevant sections instead).
- Anything git-log derivable (commit history is authoritative via `git log`).

---

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

Both suites also run automatically on every push/PR via GitHub Actions
(`.github/workflows/tests.yml`, added 2026-07-20) — before this, 300+
already-written tests existed but nothing ran them without a human
remembering to, at a commit cadence (dozens/day during active work) where
that's an easy thing to forget.

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
**Update, same day**: confirmed OpenSky reachable again from this exact
Northflank deployment a few hours later — a live `/api/states` request
returned real state vectors and `rate_limit_remaining`, no stale/error
flags. The hyperscaler block is evidently intermittent on OpenSky's end,
not a fixed, permanent property of this deployment as first assumed —
treat "accepted as permanent" above as superseded. Don't rule out OpenSky
when debugging just because of this history, and don't be surprised if it
goes silent again later — that's exactly the scenario the auth-fallback
and outage-breaker logic above already handle gracefully either way.

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
**adsb.one's HUD row is hidden entirely** (`static/index.html`,
`display:none` on the `.source-row`, since 2026-07-19) rather than merely
unchecked-by-default: its upstream, `api.adsb.one`, sits behind a blanket
Cloudflare anti-bot block on the *whole subdomain*, confirmed live from two
independent networks — a local residential IP and this app's own
Northflank/GCP production pod (via `northflank exec`) both got an identical
403 "Sorry, you have been blocked" page on every path tried
(`/v2/point/...`, `/robots.txt`, `/v2/openapi.json`), regardless of
`User-Agent`/`Origin`/`Referer` spoofing (tested with a real Chrome UA and
an `Origin`/`Referer` matching adsb.one's own frontend, `globe.adsb.one` —
still 403). This rules out a header fix or an IP-specific ban — it's
Cloudflare's bot-management layer keying off TLS/HTTP client fingerprint
(JA3/JA4), which no plain HTTP client (curl, `requests`, this app's own
`fetch_opensky`-style proxying) can pass, only a real browser (or a
Cloudflare-verified bot) can. ADSB-One is a volunteer feeder-network project
(`ADSB-One/feedclient`, `mlat-server`, `readsb`, `tar1090` on GitHub — the
same stack as adsb.fi/adsb.lol), and its sibling project `adsb.lol`
documents the same family's actual policy in its own repo README: anonymous
scripted API access is exactly what's being blocked, and the intended path
is either the project's own web frontend or an API key earned by *feeding*
the network — not a bug to work around, but the upstream's deliberate
anti-scraping stance. Since no toggle would ever do anything useful even if
shown, hiding the row (rather than leaving a checkbox that always silently
fails) was the right call. `display:none` was used instead of an HTML
comment deliberately: `state-filters.js`'s `sourceToggles`/
`markerMapsBySource` and several `Object.keys(sourceToggles)` loops in
`main.js` (toggle wiring, `isSourceEnabled()`, the startup count spinner)
all call `document.getElementById('toggle-adsbone')` directly and
dereference it unconditionally — actually removing the element from the DOM
would null-crash all of those on page load, taking down the whole app, not
just adsb.one. The checkbox itself, `RADIUS_SOURCES['adsbone']`, the
`/api/adsbone` backend route, and every line of JS wiring above are
otherwise completely untouched (still defaults to unchecked/off under the
hood) — restoring the row to visible is a one-line revert (drop the
`display:none`) if the Cloudflare block ever lifts.
adsb.lol shipped off for a related but lesser reason (its upstream had
intermittent multi-second hangs, not a hard block) and was switched to **on
by default** (2026-07-17, explicit re-approval) despite that known
instability — a failing/slow source degrades to `null` for that cycle
rather than breaking the poll, so the occasional hang costs one cycle, not
the map. Both are wired up in the backend either way; the `RADIUS_SOURCES`
entries and the shared `cached_radius_source()` plumbing don't distinguish
"hidden"/"off by default" from "on by default" — that distinction is purely
a frontend concern (a checkbox default for adsb.lol, a hidden row for
adsb.one).

> **Shorthand:** the rest of this file often says "adsb.fi/airplanes.live"
> where it means *any* radius source — they share one JSON shape, one parser,
> and one set of extra fields, so a claim about one holds for all four.
> adsb.fi and airplanes.live are named because they're two of the three whose
> HUD row ships enabled (alongside adsb.lol); adsb.one — the one whose row is
> now hidden from the HUD entirely — behaves identically at the backend/JS
> level wherever the phrase appears; only its visibility in the UI differs.

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
default** instead, so it now ships unchecked (visible, but off, unlike
adsb.one's hidden row) — still fully wired up and working, just an opt-in
toggle rather than a default one. Any further change to this default
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

**FlightRadar24, via the unofficial `JeanExtreme002/FlightRadarAPI` SDK
(`/api/flightradar24`)**: a seventh source, added after researching whether
any project streams the *real* ADS-B Exchange feed (see this repo's git
history/session notes around 2026-07-19–20 for the full investigation —
short version: ADSBX itself has no free no-feed path, its legacy TCP/HTTP
bridges are dead or Cloudflare-blocked, and every other commercial network
checked — RadarBox, ADSBHub, PlaneFinder, Wingbits — gates live streaming
behind feeder status or payment). This SDK (409★, MIT,
https://github.com/JeanExtreme002/FlightRadarAPI) is the one surviving free
lead: it talks to FlightRadar24's own *private* web API (the same one
flightradar24.com's frontend uses), **not** FR24's official paid `fr24api`.
**Known, ongoing risk, not hypothetical**: the SDK depends on `curl_cffi`
specifically for TLS/JA3 impersonation to get past FlightRadar24's
Cloudflare bot-fingerprinting, and ships a dedicated `CloudflareError`
exception because FlightRadar24 does sometimes block it. Its own README says
it "should only be used for your own educational purposes." This is the
same category of risk that already killed a comparable PlaneFinder wrapper
(`wiseman/node-planefinder`, dead since 2015 per its own README — PlaneFinder
deliberately obfuscated their data against it) — it could stop working the
day FlightRadar24 tightens detection, through no bug of this app's own.
Because of that, it's built exactly like FlightAware's paid/risky pattern:
**ships off by default**, and `cached_flightradar24()` (`app.py`) catches
bare `Exception` — not just `requests.RequestException` — since it wraps a
third-party client whose failure surface (curl_cffi errors, parsing errors)
isn't fully typed; a failure always degrades to the same stale-cache-or-502
pattern every other source uses, never breaks the rest of the poll.
**Refactored 2026-07-20**: `cached_flightradar24()` used to hand-duplicate
`cached_radius_source()`'s whole TTL/stale-fallback structure just to widen
the exception catch. Both now call a shared `_cached_fetch(cache,
min_interval, fetch_fn, empty_payload=None, catch=(requests.RequestException,))`
— `fetch_fn` is a zero-arg callable returning the parsed payload (a
`requests.get(...).json()` closure for `cached_radius_source()`, an
`_fr24_client.get_flights(...)` closure here), and `catch` is FlightRadar24's
one remaining point of difference, passed as `(Exception,)`. No behavior
changed; the duplicated cache/stale/502 logic did not need to exist twice.
`_fr24_client.get_flights(bounds=...)` returns `Flight` objects
(`icao_24bit`, `latitude`/`longitude`, `heading`, `altitude` in feet,
`ground_speed` in knots, `squawk`, `aircraft_code`, `registration`,
`origin_airport_iata`/`destination_airport_iata`, `callsign`, `on_ground`,
`vertical_speed`) with no login required — `FLIGHTRADAR24_FIELDS`
(`app.py`) is the exact allowlist serialized into the `/api/flightradar24`
response; anything beyond that (full airport name/city/country, aircraft
photos, flight history) only exists behind the SDK's separate, per-flight
`get_flight_details()` call, which this app doesn't use (would need to be
lazy/click-only, same pattern as adsbdb, not spent on every poll).
**Unlike FlightAware, this source *is* ICAO24-keyed** — `icao_24bit` maps
straight to `icao24` — so `parseFlightRadar24Aircraft()` (`static/js/
parsers.js`) converts the raw fields into this app's own "raw record"
convention (the same field names `parseAdsbExchangeAircraft()` produces),
which is what lets it slot into the *same* `radiusRecordsByHex` map the four
radius sources share, with zero changes to `normalizeOpenSky()`/
`fieldSourcesFor()`/`RAW_FIELD_ALIASES` — dedup and enrichment badging both
just work. **Priority: sits below even airplanes.live**, both in
`radiusRecordsByHex`'s enrichment order and in the marker `excludeIds`
render chain (`static/js/main.js`'s `poll()`) — the newest, least-proven,
most failure-prone source never outranks any of the four established free
ones, mirroring why FlightAware ships off by default too. **Route fields**
(`originAirport`/`destinationAirport`) come directly from FR24's own data,
not a FlightAware-style callsign match — but since the basic feed only ever
has a bare IATA code (no airport name), `parseFlightRadar24Aircraft()`
formats it as `" (CODE)"` (a leading space before the parens) so the shared
Route card's `splitAirportString()` regex (built for FlightAware/adsbdb's
`"Name (CODE)"` strings) still parses it correctly — empty city name, just
the big code — rather than building a second, bespoke rendering path for
two bare codes. `fieldSources.originAirport`/`.destinationAirport` are set
by hand to `['flightradar24']` in `updateFlightRadar24Markers()`, the same
"generic call, then hand-overwrite" idiom FlightAware's own callsign-match
branch already uses, since `fieldSourcesFor()`'s `ROUTE_FIELDS` handling
only ever trusts an explicit `routeSource` override, not the generic
per-entry lookup, for these two fields.

**Area coupling:** All location-based constants derive from one `AREA_CENTER`
(`{"lat": 44.0, "lon": 21.0}` by default) in `app.py`, loaded from
`config/zones.json` at import (`_load_zone_config()`, `ZONES_FILE` env var
overridable; falls back to the same hardcoded default if the file is
missing/malformed): `BBOX` is computed from it, every
`RADIUS_SOURCES[*]["center"]` is set to it (with the appropriate
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

**This coupling is a hard constraint that runtime zone changes (below) must
respect, not just the import-time load described above**: `AREA_CENTER`/
`BBOX` feed **three more values frozen at import time**, not re-read
per-request — `RADIUS_SOURCES[*]["center"]`, `FLIGHTAWARE_QUERY` (a
pre-formatted `-latlong "..."` string), and `FLIGHTRADAR24_BOUNDS` (from a
call to `_fr24_client.get_bounds()`). Any code that moves the coverage area
at runtime has to recompute all seven values together — see `_apply_zone()`
immediately below, which exists specifically to be the one place that does.

**Zone search** (`#zone-search` in the HUD, `static/js/state-filters.js`,
`enrichment/airports.py`'s `search_airports()`, `app.py`'s `_apply_zone()`/
`_persist_zone_config()`/`_maybe_reload_zone_from_disk()` + `POST
/api/zones/active`): lets the user move the app's entire coverage area —
not just the Leaflet view — by typing an airport name/IATA/ICAO/city/country
and picking a result, rather than hand-editing `config/zones.json` and
restarting.
- **Search** (`GET /api/airports/search?q=...`) runs against the same
  global OurAirports dataset the Airports layer already loads
  (`enrichment/airports.py`'s `_MAP_AIRPORTS` — see that section above for
  why OurAirports over OpenFlights), not a separate index — a flat scan
  over ~85,700 rows is sub-millisecond, the same "rare event, no index
  needed" reasoning as `nearest_airport()`'s own linear scan, though this
  one runs per keystroke rather than per click, which is why the frontend
  debounces (`ZONE_SEARCH_DEBOUNCE_MS`, 250ms) and both sides enforce a
  2-character minimum query length. Ranking is four tiers: exact IATA/ICAO
  code match, then the query as a prefix of the *whole* name/municipality/
  country, then as a prefix of some *word* within one of those fields
  (without this third tier, searching "heathrow" would rank an obscure
  small airport literally named "Heathrow Airport" correctly but leave
  "London Heathrow Airport" — whose name doesn't *start* with the query —
  in the lowest, substring-only tier, which is backwards from what a user
  typing a recognizable landmark name expects), then any substring match.
  File order (large → small airports, per the vendored data's own sort) is
  preserved within each tier. `limit` is capped server-side at 50
  regardless of what's requested. No caching — same zero-I/O rationale as
  `/api/airports` and `/api/identity/<icao24>`.
- **`_apply_zone(center, zoom, radius_nm, zone_id)`** is the one function
  that moves all seven derived values together (see the hard-constraint
  note above) and clears every location-scoped cache (`_cache`, the four
  `RADIUS_SOURCES` caches, `_flightaware_cache`, `_flightradar24_cache`,
  `_metar_cache`, `_sigmet_cache` — the exact set
  `tests/backend/conftest.py`'s `reset_caches` fixture already enumerates)
  so the next poll after a zone change doesn't re-serve one more round of
  stale-region data before each cache's own TTL would have naturally
  expired. A failed `_fr24_client.get_bounds()` call (FlightRadar24
  blocking this process, same known risk as its regular polling — see
  that section above) is caught and leaves the old bounds in place rather
  than aborting the rest of the zone change.
- **Persists to `config/zones.json`** (`_persist_zone_config()`, keyed by
  the picked airport's ICAO, or `"custom"` if absent) rather than staying
  session-only — a zone change survives a restart, the explicitly chosen
  design (over an in-memory-only change) since this is a single-tenant
  app where the zone is backend-authoritative shared state, unlike a
  per-user preference like basemap/units. Best-effort: an unwritable file
  doesn't fail the request, matching this app's general "disk persistence
  is an optimization, not a hard requirement" posture elsewhere (e.g. the
  track cache).
- **Cross-worker sync**: this app runs under gunicorn with multiple worker
  processes (see storage.py's own docstring for the identical problem that
  motivated moving collections/identity to SQLite), each with its own copy
  of `AREA_CENTER`/etc. as plain module globals — a zone change applied by
  the worker that handled the `POST` only updates that worker's own
  memory. Rather than adding a second SQLite-backed table for a rare,
  low-frequency write, `_maybe_reload_zone_from_disk()` compares
  `os.path.getmtime(ZONES_FILE)` against the mtime recorded the last time
  *this* process applied a zone, and reloads+reapplies via `_apply_zone()`
  if the file changed underneath it — called at the top of every route
  that reads a zone-derived value per-request (`/api/config`,
  `/api/states`, the four radius-source routes via
  `radius_source_response()`, `/api/flightaware`, `/api/flightradar24`,
  `/api/metar`, `/api/sigmet`, `/api/airports`). A single cheap
  `getmtime()` stat call is negligible next to the outbound HTTP calls
  these routes already make. A worker can therefore serve up to one
  request with a stale zone before its own next check — accepted, not
  treated as a hard real-time guarantee, for a rare human-triggered event.
- **`POST /api/zones/active`** (body `{lat, lon, zone_id}`) validates
  coordinates (400 `invalid_coordinates` for anything non-numeric or out
  of `[-90,90]`/`[-180,180]`), calls `_apply_zone()` then
  `_persist_zone_config()`, and returns the same shape `/api/config` does
  — the frontend reuses that response directly rather than making a
  second round trip. **Radius and zoom are deliberately left untouched**
  (only `center` moves) — a v1 scope decision, not an oversight; a future
  version could let the search UI also offer a radius override.
- **Frontend**: the zone-search box is the one HUD input that isn't a
  click-only `.dropdown-trigger` button like the basemap/category pickers
  — it's a real `<input>` (`.zone-search-input`), reusing
  `.dropdown-menu`/`.dropdown-option` only for the results list. Selecting
  a result calls `map.setView()` with the response's center (keeping the
  current zoom) and `poll()` immediately rather than waiting for the next
  `POLL_INTERVAL_MS` tick. The Airports layer's own viewport-scoped
  re-fetch needs no explicit nudge — `map.setView()` fires Leaflet's
  `moveend`, which `map-init.js`'s `scheduleAirportsRefresh` already
  listens on — but METAR/SIGMET are timer-only (no `moveend` listener), so
  their refresh functions are called explicitly when those layers are
  enabled. A failed `POST` shows an inline status message
  (`#zone-search-status`) and leaves the map untouched rather than failing
  silently.

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
  (same stale-or-fail pattern as the four radius sources). **Bug fixed
  2026-07-20**: both `/api/metar` and `/api/sigmet`'s error handlers used to
  write `except requests.RequestException:` with no `as exc` at all — the
  only two handlers in `app.py` where the exception text was fully
  unrecoverable, not even available to log, let alone surface — unlike
  every other proxied source, which at least captures it (e.g.
  `cached_radius_source()`'s stale-cache branch puts `str(exc)` into the
  response). Both now capture `as exc` and include `str(exc)` in the 502
  (no-cache) response body; the 200 stale-cache path is untouched, since its
  payload is a bare list (unlike the dict-shaped radius sources), so there's
  no field to attach an error string to without changing that response's
  shape.
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

**Airports layer** (`#toggle-airports` in the HUD, `static/js/map-init.js`'s
Airports section, `enrichment/airports.py`'s `list_map_airports()`/
`airports_in_bbox()`, `/api/airports` in `app.py`): renders every airport —
large/medium/small airports, heliports, seaplane bases, balloonports —
worldwide as map markers, off by default like every other optional overlay.
- **Source: [OurAirports](https://ourairports.com/data/)**, not the
  OpenFlights table `enrichment/airports.py` already used for the
  collection's nearest-airport lookup — chosen specifically because
  OurAirports classifies each row's `type` (`large_airport`/
  `medium_airport`/`small_airport`/`heliport`/`seaplane_base`/
  `balloonport`/`closed`), which OpenFlights' `airports.dat` doesn't, and
  that classification is what lets the layer size/style markers by real
  significance and skip defunct airports. Public domain (CC0), updated
  nightly, plain CSV on GitHub
  (`https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv`)
  — no signup, no API key, the same constraint that has picked every other
  data source in this app. Vendored as `enrichment/data/ourairports.json`
  (85,776 entries, ~16 MB, generated the same one-off/uncommitted-script
  convention as `opensky_year_built.json`) — see
  `enrichment/airports.py`'s module docstring for the exact regeneration
  steps and field list (`ident, type, name, lat, lon, elevation_ft,
  country, municipality, iata, icao`).
- **Global by explicit product decision, not trimmed to this app's own
  coverage area**: an earlier draft of this feature pre-filtered the
  *stored* dataset to a 600 km radius around `AREA_CENTER`, matching every
  other area-scoped feature in this app — reverted after the project owner
  asked for every airport to be available, not a curated regional slice.
  This makes `ourairports.json` by far the largest vendored dataset here
  (~16 MB vs. `opensky_year_built.json`'s 3.3 MB, the previous largest).
  `list_map_airports(include_closed=False)` drops `closed` airports by
  default (showing a defunct airport as if active would be misleading) —
  a judgment call the function makes so callers don't have to remember it.
  Each entry's raw `country` field is OurAirports' own 2-letter ISO code,
  not a display name — `list_map_airports()` adds a `country_name` key via
  `country_by_iso()` (`enrichment/countries.py`, the same lookup the
  aircraft sidebar's own country rows already use), so the map popup below
  isn't stuck showing a bare code next to the flag.
- **What reaches the browser is scoped to the current viewport, not the
  whole dataset**: `/api/airports` accepts a `bbox` query param
  (`lamin,lomin,lamax,lomax`, same shape this app's own `BBOX` constant
  already uses for outbound METAR/SIGMET calls) and calls
  `airports_in_bbox()`, falling back to this app's own home-region `BBOX`
  when `bbox` is missing/malformed. The frontend sends `map.getBounds()`
  on toggle-on and again on every `moveend` (debounced
  `AIRPORTS_FETCH_DEBOUNCE_MS`, 500ms, so a drag/zoom gesture doesn't
  hammer the backend mid-gesture) — panning from one region to another
  swaps in that region's airports, the same "only load what's in view" idea
  as any tile layer, without ever shipping the ~16 MB global dataset to the
  browser at once. Airport positions don't change during a session, so
  there's no periodic refresh timer here (unlike the weather layers above)
  — only the viewport moving triggers a re-fetch. No caching on the
  backend side either: `airports_in_bbox()` makes zero I/O calls (a plain
  in-memory list comprehension), the same "nothing external to protect
  with a TTL" rationale as `/api/identity/<icao24>`.
- **Further scoped to this app's own scan zone, independent of the
  viewport** (2026-07-20, explicit product decision): `api_airports()`
  also passes `center=(AREA_CENTER["lat"], AREA_CENTER["lon"]),
  radius_km=AREA_RADIUS_KM` (`AREA_RADIUS_KM = AREA_RADIUS_NM * 1.852`,
  next to `AREA_RADIUS_NM` itself) into `airports_in_bbox()` — the same
  220 nm circle the scan-radius range rings draw, i.e. the area the four
  radius sources actually cover. `airports_in_bbox()`'s new `center`/
  `radius_km` params apply a haversine distance check on top of the
  existing bbox check, so an airport must pass *both* to be returned: in
  view *and* inside the scan zone. Panning far away from the scan zone
  (e.g. to Tokyo) still sends a valid viewport `bbox` and gets a normal
  200 response, just with an empty `airports` array — the four radius
  sources don't cover that area either, so airport markers shouldn't
  imply they do. The full ~85,700-airport dataset stays exactly as global
  in memory as described above (`enrichment/airports.py`'s module
  docstring) — this is purely a response-shaping filter, not a trim of
  what's loaded, so it stays correct if `AREA_CENTER` is ever moved.
- **Marker clustering is still needed even with viewport scoping**: a
  zoomed-out view (a whole country or continent) can still hold thousands
  of airports/heliports in view at once. `Leaflet.markercluster` (MIT,
  vendored at `static/leaflet-markercluster/` — `leaflet.markercluster.js`
  + `MarkerCluster.css` + `MarkerCluster.Default.css` + `LICENSE`, same
  one-time-copy-from-the-npm-package convention as `static/leaflet/`
  itself) groups nearby markers into a numbered bubble that expands as the
  user zooms in. `airportsState.clusterGroup` is one
  `L.markerClusterGroup({ clusterPane: 'airportPane', maxClusterRadius: 60
  })`, cleared and repopulated on every `refreshAirportsInView()` call
  rather than diffed/reused like `syncMarkers()` does for aircraft — airport
  data for a given viewport is small and fetched fresh each time, so there's
  no per-marker state (heading, selection) worth preserving across a refresh.
- **Dedicated Leaflet pane** (`airportPane`, z-index 460): sits between
  `overlayPane` (400, scan-radius rings/SIGMET polygons/METAR markers) and
  `groundPane` (450, ground-vehicle markers) below, and `markerPane` (600,
  real aircraft) above — an airport pin should never visually compete with
  an aircraft actually sitting over it. Both individual airport markers
  (`pane: 'airportPane'` in their own options) and the cluster group's own
  bubble icon (`clusterPane: 'airportPane'`) use it — `clusterPane` only
  covers the *cluster* icon; child markers keep whatever pane their own
  marker options specify, so both had to be set explicitly.
- **Icons** (`static/js/icons.js`): two Material Design Icons glyphs
  (pictogrammers.com/MaterialDesign, Apache-2.0, same vendoring convention
  as `GROUP_ICONS`/the favicon) — a generic airport pin (`AIRPORT_GLYPH`)
  for every type except heliports, and a distinct helicopter glyph
  (`HELIPORT_GLYPH`) for `heliport` — visually and operationally different
  enough to want telling apart at a glance rather than reusing the same
  pin. Fixed neutral slate color (`AIRPORT_MARKER_COLOR`, `#475569`), not
  source-colored — like `towerIcon()`, an airport is static ground
  infrastructure, not a "source" of aircraft data. Never rotated (`0`
  heading, same idiom `towerIcon()` already uses). Icon size scales with
  real-world significance (`AIRPORT_ICON_SIZES` — large airports render
  biggest, small strips/heliports/balloonports smallest) rather than every
  type looking identical regardless of size, the same idea as varying line
  weight on a paper aviation chart. `.plane-icon:not(.surface-obstacle-icon):not(.airport-icon)`
  in `style.css` opts airport markers out of the drop-shadow filter every
  rotating aircraft icon gets — a cast shadow reads oddly on a flat ground
  marker.
- **Popup, not a sidebar**: clicking an airport marker opens a plain
  Leaflet popup (`airportPopupHtml()`) with the name, type label, IATA/ICAO
  codes, municipality/country (with a flag via the existing `flagHtml()`
  from `render-details.js`), and elevation — the same pattern METAR/SIGMET
  markers already use, not the aircraft sidebar (`#sidebar`), since an
  airport isn't a trackable, selectable entity the way an aircraft is.
  Values are HTML-escaped (`escapeHtml()`) before interpolation, since
  `name`/`municipality` originate from a community-maintained external
  dataset.
- **Help popover**: follows the same required `(?)` click-to-toggle pattern
  as the weather layers (`#airports-help`/`#airports-help-popover`,
  `refreshAirportsHelp()` in `main.js`, wired via the shared
  `wireHelpPopover()`) even though this isn't a weather layer — the pattern
  is the house style for any toggleable map layer with source/caveat
  details worth explaining on demand, not weather-specific.

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
  checked**; FlightAware ships off (see above); adsb.one's row is hidden
  from the HUD entirely (see above) rather than shipping an always-off
  checkbox. Turning OpenSky off clears the quota line and any pending
  OpenSky warning message.
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
  — **OpenSky > adsb.fi > adsb.lol > adsb.one > airplanes.live > FlightRadar24 > FlightAware**
  — since each step depends on data or state from the others. FlightRadar24 is
  ICAO24-keyed like the radius sources (not callsign-keyed like FlightAware), so it
  sits inside the same `excludeIds`/`radiusRecordsByHex` chain as them, just last —
  see the FlightRadar24 section above for why. **Single source of truth for
  this order (2026-07-20):** the ICAO24-keyed portion of this priority
  (adsb.fi/adsb.lol/adsb.one/airplanes.live/FlightRadar24 — OpenSky and
  FlightAware aren't in it, see below) used to be written twice in
  `poll()` — once low→high to build `radiusRecordsByHex` (so the
  highest-priority entry is pushed last and wins), once high→low for the
  `excludeIds` chain — as two independently hand-written, mirrored array
  literals with no link between them, a real risk of drifting out of sync
  on a future reorder. Both are now derived from one `RADIUS_SOURCE_PRIORITY`
  array (`constants.js`), reversed for the former. **FlightAware uses callsign-based dedup:**
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
  **Bug fixed 2026-07-20**: the synthetic OpenSky entry built by
  `pickFields(info, OPENSKY_NATIVE_FIELDS)` never carried a raw `category`
  key at all — `OPENSKY_NATIVE_FIELDS` deliberately excludes
  `categoryDisplay` (it's computed, not copied 1:1), so `RAW_FIELD_ALIASES`'s
  `categoryDisplay → category` fallback had nothing to find on that entry.
  Net effect: whenever OpenSky's own category won (see the Category section
  below), its badge either didn't render at all, or — if a radius source
  also happened to report a category for the same aircraft — silently
  credited that source instead. Fixed in `updateOpenSkyMarkers` by setting
  `category` on the synthetic entry by hand, but only when
  `openskyCategoryIsMeaningful(s.category)` is true (the same check
  `normalizeOpenSky` uses to decide whether to prefer OpenSky's label at
  all), so the badge appears exactly when OpenSky's category was actually
  used, never when it was 0/1/absent.
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
    matters.
    **`AIRLINE_OPERATORS` is itself two merged tiers**, not one flat table
    (the same "priority chain inside a single Flywme slot" shape used
    throughout this app, e.g. Planespotters+airport-data.com or the airline
    logos above): `_CURATED_AIRLINE_OPERATORS` (the original ~90
    hand-picked majors) always wins on conflict, merged over
    `_GENERATED_AIRLINE_OPERATORS` (~5700 entries, built from the
    [OpenFlights](https://github.com/jpatokal/openflights) project's
    `data/airlines.dat` — Open Database License + Database Contents
    License, used here as a small attributed derived extract, not a
    redistribution of the database). The curated tier survives specifically
    *because* OpenFlights turned out to be stale enough to lack some
    currently-flying airlines outright — confirmed missing: `"ITY"` (ITA
    Airways, launched 2021) and `"TVP"` (Smartwings' current designator,
    both worked examples this test suite already relies on) — and to
    disagree with the curated tier's own naming for at least one it does
    have (`"QFA"` → plain `"Qantas"` in OpenFlights vs. `"Qantas Airways"`
    curated). Generation (a one-off script, not committed, same
    "regenerate by hand" convention as the airline-logos manifest and the
    favicon PNGs) filters `airlines.dat` rows to a plausible 3-character
    ICAO code, a name, and a country string `enrichment/countries.py` can
    resolve — directly, or via a small alias table used only at generation
    time (`"Ivory Coast"`, `"Republic of Korea"`, `"Burma"`, `"Russian
    Federation"`, etc. → this app's own canonical country names) — which is
    also why `countries.py` gained two more entries (**Taiwan**, **South
    Sudan**) neither of which had a real ICAO-member-state entry there
    before, despite both having genuine airlines/designators in the data.
    When OpenFlights lists the same ICAO code more than once (a defunct
    airline's designator later reassigned — routine in real ICAO Doc 8585
    history), the row marked active wins. `aircraft_database.py` holds a
    swappable ICAO24→full-record lookup (`AircraftDatabaseLookup.lookup()`,
    a small placeholder dataset behind an interface a real data source
    could later implement with zero caller changes) plus a separate ICAO
    type-code/free-text→manufacturer+model normalization table.
    **`year_built` has a real second tier**, `_GENERATED_YEAR_BUILT`
    (~249,000 icao24→year entries, `enrichment/data/opensky_year_built.json`),
    generated from the [OpenSky Network](https://opensky-network.org)
    public aircraft metadata CSV (unlicensed, offered as-is — used here as
    a small icao24→year extract, not a redistribution of the full
    database). Same curated-wins-over-generated shape as
    `AIRLINE_OPERATORS` above, but scoped to `year_built` alone —
    `registration`/`operator`/`manufacturer`/`model`/`country` are
    deliberately never sourced from this CSV even though the same rows
    carry them, since their naming doesn't match this project's own
    `TYPE_CODE_TABLE`/curated-airline vocabulary. Coverage is real but
    regionally lopsided: ~49% of the CSV's 520,000 rows globally, but only
    ~4% of aircraft actually seen live over this app's own coverage area
    (Balkans) — still strictly additive over having nothing, which is why
    it shipped anyway. **A pre-existing data bug was found and fixed while
    adding this**: the placeholder `_PLACEHOLDER_RECORDS` table used to
    have 7 hand-written entries, but cross-checking each ICAO24 hex against
    OpenSky's own real database showed 6 of them named the wrong aircraft
    entirely for that hex (two were private/homebuilt light aircraft, not
    the airliners claimed) — fabricated example data that was never
    verified against a real registry. Those 6 were deleted; only `49d3d3`
    (OK-SWC / Smartwings), independently confirmed correct, remains.
    `aircraft_enrichment.py`'s `enrich_identity()` is the orchestrator,
    resolving each field through its own priority chain that always tries
    a live value first (`source: "live"`) before ever touching a local
    table — enrichment only fills a gap the live feeds didn't cover, never
    overrides one.
    **`aircraft_category.py`** is a small, standalone sibling module (not
    folded into `aircraft_database.py`, since it's a genuinely different
    concept from that file's ICAO24/type-code lookups): a static
    `(manufacturer, model) → ADS-B emitter category code` table (`"A1"`
    through `"A7"`), one entry per `TYPE_CODE_TABLE` pair (verified 1:1 by
    `test_aircraft_category.py`, so it can never silently drift out of sync
    as that table grows), each looked up from the real, publicly published
    maximum takeoff weight (MTOW) of that aircraft type against the fixed
    DO-260B/FAA weight thresholds (A1 <15,500 lb, A2 15,500–75,000 lb, A3
    75,000–300,000 lb, A5 >300,000 lb; A7 for every rotorcraft
    unconditionally, since DO-260B assigns that code by aircraft kind, not
    weight; A4 only for the Boeing 757, the standard textbook "high vortex
    large" example) — not guessed. Several of these turned out to be
    genuinely counter-intuitive from general size class alone and were
    confirmed by looking up each type's real MTOW rather than assumed: the
    Airbus A320 and Boeing 737 families are both well past the 75,000 lb
    Large threshold (~170,000+ lb) despite reading as "just a narrow-body",
    while the Gulfstream G450 (74,600 lb, Small) and G550 (91,000 lb,
    Large) sit on opposite sides of that exact threshold despite being
    adjacent models in the same family. This is `enrich_identity()`'s
    **lowest-priority tier in the whole category chain** — OpenSky's own
    numeric category and adsb.fi/airplanes.live's letter+digit code (see
    "Category" further below) always win when a live source actually
    reports one; this table is only ever consulted once manufacturer and
    model are already resolved (by one of the tiers above) *and* no live
    source reported a category for that aircraft at all. Returned as
    `category` in `enrich_identity()`'s result dict, `{"value": "A3",
    "source": "aircraft_category_db", "confidence": 0.9}` — confidence
    deliberately below the exact-match `aircraft_type_db` tier's 1.0, since
    a specific tail number's real certified MTOW can vary slightly by
    sub-variant/operator configuration in ways one representative-per-model
    table can't capture. On the frontend, `buildMergedDetails()`
    (`sidebar-track.js`) special-cases this field rather than folding it
    into the generic `ENRICHMENT_FIELD_MAP` loop, since the backend's raw
    code needs formatting into the same `"A3 — Large (...)"` shape a real
    adsb.fi/airplanes.live response would produce before it can fill
    `info.categoryDisplay` — done by calling `formatAdsbExchangeCategory()`
    (`render-details.js`) directly, which is what lets the existing
    `splitCategoryDisplay()`/`CATEGORY_LABEL_TO_GROUP` rendering machinery
    handle a Flywme-sourced category with no changes of its own. Like every
    other Flywme field, it only fills `categoryDisplay` when empty and
    still co-displays its own badge alongside a live source's when one
    already won, so the fallback stays visible/debuggable in dev mode
    rather than silently disappearing.
  - **`icao24_allocation.py`** — ICAO24 (Mode S transponder hex address) to
    country via the official ICAO block allocation table (Annex 10, Volume
    III, Part I, Appendix to Chapter 9, Table 9-1, "Allocation of aircraft
    addresses to States"). Unlike `registration.py`'s own prefix-based
    lookup, this is a *permanent* assignment directly from the State of
    Registry that never changes for an airframe's lifetime — a real,
    independent corroboration signal, not derived from and not a replacement
    for the registration string. Contains 184 blocks covering essentially
    every ICAO member state. A `country_for_icao24(icao24_hex)` function
    does a linear scan (fine — this is click-triggered, not per-poll) and
    returns `{"country", "country_iso", "source": "icao24_block",
    "confidence": 0.85}` or `None` for invalid/unallocated input. Confidence
    capped below `registration_prefix`'s 1.0 since a small number of blocks
    are subdivided for special use rather than exclusive state ownership.
    **Real bug this fixed**: a callsign-decoded operator's home country can
    legitimately differ from the aircraft's own registration country
    (cross-border leasing, flag-of-convenience registries) *or* disagree due
    to a callsign collision — a non-commercial aircraft (government/EMS/
    police/military) whose callsign prefix coincidentally matches an unrelated
    real airline's ICAO designator (found via a real Romanian rescue
    helicopter's "MAI" callsign — Ministry of Internal Affairs — decoding to
    Mauritania Airlines International). Since ICAO24 is assigned directly by
    the aircraft's own state, not influenced by operator/callsign, a
    disagreement is a real signal: `enrich_identity()` marks such matches
    with a `needs_corroboration` flag when Operator/Operator Country come
    from `callsign_decode` and their country differs from
    `country_for_icao24(icao24)`. The flag suppresses the mismatched value
    entirely in normal mode *for rotorcraft specifically* (where a genuine
    cross-border "airline" flight is rare, unlike fixed-wing leasing where
    it's routine) — the field renders "Unknown" instead. Dev mode shows the
    suppressed value anyway, tagged with `⚠ Unconfirmed`, and the badge
    tooltip carries the extra conflict detail. Non-rotorcraft always display
    the value plainly (cross-border is normal for them), just with the
    tooltip flag for context. Tests verify the behavior across both aircraft
    categories and dev-mode visibility.
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
    **`COUNTRY_NAME_ALIASES`** (`enrichment/countries.py`), a real bug fix,
    not the accepted limitation above: `country_iso_for_name()`'s exact
    match failed for a genuine, spelled-correctly country name simply
    because a live source reports a country's official/long-form name
    rather than the short name `COUNTRIES` itself uses — caught on a real
    aircraft, PH-BHG (KLM564), whose OpenSky `origin_country` is "Kingdom
    of the Netherlands", not "Netherlands", so the Registration Country row
    showed the right text with no flag. `country_iso_for_name()` now checks
    this alias table as a fallback after the direct lookup misses. **182
    entries, generated from the real ISO 3166-1 dataset** (pycountry/
    iso-codes' `src/pycountry/databases/iso3166-1.json`, fetched and diffed
    against `COUNTRIES` programmatically — every `name`/`official_name`/
    `common_name` field that disagrees with this table's own canonical
    name) rather than hand-typed from memory, after a first hand-typed pass
    turned out to get official name word order wrong for three countries
    (`"iran (islamic republic of)"`, `"bolivia (plurinational state of)"`,
    `"venezuela (bolivarian republic of)"` — none of which are the real ISO
    string; the real ones are `"islamic republic of iran"`, `"plurinational
    state of bolivia"`, `"bolivarian republic of venezuela"`) and invented
    one outright (`"the bahamas"` — the real ISO official name is
    `"commonwealth of the bahamas"`). Four entries are real but don't come
    from that JSON file and are kept from the original hand-typed table on
    purpose: `"swaziland"` (Eswatini's pre-2018 name), `"burma"` (Myanmar's
    pre-1989 name), `"the former yugoslav republic of macedonia"` (North
    Macedonia's pre-2019 UN/ISO name), and `"republic of korea"` (South
    Korea's actual, universally-used official name — the ISO dataset's own
    `name` field for `KR` is oddly reordered as `"Korea, Republic of"` with
    no natural-order `official_name` at all, so the generation pass alone
    would have missed it). Not exhaustive — a live source using some other
    phrasing not covered here still degrades to no flag, per the limitation
    above.
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
  - **Persistent aircraft-identity cache** (`storage.py`'s `identity_cache`/
    `identity_history` SQLite tables): a backend-only side-effect
    persistence layer (its only frontend-visible surface is the dev-mode
    stats line below, not a full API) — the deliberately narrow slice of a
    much broader "aircraft identity intelligence layer" idea (persistent
    identity + history + observations graph) discussed and rejected at
    that full scope for this project (no ground truth registry to validate
    confidence against, no relational query need yet, and the space is
    already occupied by entrenched players like ch-aviation/Cirium/
    airframes.org who have decades of curation and registry licensing this
    project doesn't). What survives: whenever `fetch_adsbdb()` resolves a
    real `aircraft` object on a fresh (non-cached) upstream fetch,
    `storage.update_identity()` merges four *airframe-level* fields —
    `registration`, `manufacturer`, `type`, `registered_owner` — into that
    aircraft's row, upserted via SQLite's `ON CONFLICT ... DO UPDATE`, just
    without a TTL — identity facts don't expire the way a flight track
    does, so the table only grows by one row per distinct aircraft ever
    resolved, not per poll. `flightroute`'s own fields
    (`registered_owner_country_name`, and especially `airline`/operator)
    are deliberately excluded from this cache — they're properties of a
    specific flight/callsign, not the airframe itself, and can legitimately
    differ across leases/codeshares, which would conflate "who owns this
    plane" with "who's operating this particular flight." A null incoming
    value never overwrites a previously known one (adsbdb responses are
    sometimes partial). When a tracked field *does* change to a different
    non-null value, one row is inserted into `identity_history`
    (`icao24, field, old_value, new_value, ts`) before the `identity_cache`
    row is overwritten — the only "history" this layer keeps, a flat
    append-only log rather than a versioned entity graph. This is
    intentionally the entire scope of Phase 1 from that discussion; phases
    2 (merging in external registries) and 3 (a full identity-graph
    product) are not planned. **`/api/identity/stats`** (a static route
    registered ahead of the dynamic `/api/identity/<icao24>` below, though
    Werkzeug would resolve the static path correctly either way) exposes
    this layer's two raw counters — `identity_count`
    (`storage.identity_count()`, a `SELECT COUNT(*)`) and `history_count`
    (`storage.identity_history_count()`, same) — for the dev-mode-only
    frontend panel below. Deliberately uncached, same rationale as
    `/api/identity/<icao24>` itself — a local SQLite `COUNT(*)` on a table
    this small costs nothing worth caching.
    **Migrated off JSONL files to SQLite (2026-07-20)** — see "Durable
    storage is SQLite, not per-store JSONL files" further down (in the
    Aircraft collection section) for the full rationale: this table used
    to be a per-process Python dict (`_identity_cache`) loaded once from
    `.aircraft_identity_cache.jsonl` at import and rewritten whole on every
    update, which silently diverged between this app's two gunicorn worker
    processes. `migrate_jsonl_to_sqlite.py` is the one-off script that
    imports an existing deployment's old JSONL files (including
    `.identity_history.jsonl`) into the new database; see the Aircraft
    collection section for how to run it.
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
    minus whatever `storage.identity_known_icaos()` already has whenever
    the queue runs dry, and resolves exactly one aircraft per call via
    `_resolve_adsbdb()` (the plain, non-Flask-response half of
    `fetch_adsbdb()` — split specifically so this can be called from a
    background thread with no request/app context) — skipping it instead
    if a real click already resolved it since being queued. `_start_
    identity_backfill_thread()` runs this once every
    `IDENTITY_BACKFILL_INTERVAL` seconds (env var, default 5; `<= 0`
    disables the whole feature) in a daemon thread — a few seconds apart,
    so it never competes meaningfully with real user traffic to adsbdb.
    **Only ever started from the `if __name__ == "__main__":` block**,
    immediately before `app.run(...)` — never at plain module import time
    (unlike `_load_track_cache()`/`storage.init_db()`, which are harmless
    file/schema reads) — so importing `app` in the test suite never spins
    up a real thread hitting the network. Guarded by
    `_should_start_background_thread()` against
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
- **Airline logos** (`static/airline-logos/`, `airlineLogoHtml()` in
  `static/js/render-details.js`): a small logo prefixed to the Operator row,
  looked up from the **3-letter ICAO airline designator that leads a flight
  callsign** (e.g. `"RYR1234"` → `"RYR"`) — deliberately *not* derived from
  however the Operator *name* itself resolved (live/adsbdb/Flywme), so a
  logo can render even when the name didn't (falls back to the literal
  "Unknown" text next to the logo, same as every other `identityRow` field).
  No new backend field was needed for this — the callsign is already on
  `info` for the click-scoped selected aircraft.
  Unlike `flag-icons`/the MDI icon set (properly OFL/Apache-licensed generic
  glyphs), there is no single clean, fully-licensed source of *real* airline
  logos — these are corporate trademarks, not generic icons — so this uses
  **two vendored tiers, tried in priority order and never silently
  overridden once a higher tier has an answer**, the same
  higher-tier-wins shape as every other multi-source field in this app
  (Operator's own `live > adsbdb > Flywme` chain, or Planespotters +
  airport-data.com for photos):
  - **Tier 1 — `static/airline-logos/soaring/`**: 93 airlines' `icon.svg`
    (falling back to `logo.svg`/`icon-mono.svg` for the handful of airlines
    missing that file — see the vendoring notes below), copied from
    [soaring-symbols](https://github.com/anhthang/soaring-symbols) (MIT,
    curated, actively maintained) plus its `LICENSE`, same one-time-copy/
    no-build-step vendoring pattern as `static/flag-icons/`. Files are
    renamed to their ICAO code (`RYR.svg`, not the upstream's slug-based
    `assets/ryanair/icon.svg` path) for a flat, simple lookup.
  - **Tier 2 — `static/airline-logos/airframes/`**: 1101 PNGs (some
    airlines/regional subsidiaries intentionally share identical art, e.g.
    American Eagle's `AAL`/`JIA`/`PDT` all point at the same American
    Airlines logo) from
    [airframesio/airline-images](https://github.com/airframesio/airline-images)'s
    `flightaware_logos/` subfolder — generated by running Jack Sweeney's
    `airline-logo-scraper` against FlightAware. This repo carries **no
    LICENSE file** ("made available for the common good" is the only
    stated terms) and its content is itself scraped from other commercial
    trackers (FlightAware/FR24/RadarBox) — legally murkier than tier 1, so
    it's only ever a fallback for the ~900 airlines tier 1 doesn't have, per
    `static/airline-logos/airframes/NOTICE.md`. Both tiers are used purely
    for aircraft-operator identification (matching an ICAO code to a
    callsign), non-commercially; every logo remains the trademark/property
    of its respective airline.
  - **A commercial API tier (AirHex/logostream) was considered and
    rejected**: both would give always-current, properly-licensed logos via
    a live URL, but require signing up for an API key — breaking this
    project's established "no signup, no token" rule (the same rule that
    picked CARTO/OSM/Esri over Mapbox for the basemap picker, and every
    `RADIUS_SOURCES` entry over a paid alternative). Not built; could be a
    future *opt-in* tier the same way FlightAware AeroAPI is opt-in, if
    ever revisited.
  - **`static/airline-logos/manifest.json`**: one generated `{ICAO:
    {soaring, airframes}}` lookup, built once from both tiers' own file
    listings (a throwaway script, not committed — same "regenerate by hand"
    convention as the favicon PNGs' render script). Small enough (~50KB) to
    fetch once with a plain `fetch('airline-logos/manifest.json')` in
    `static/js/map-init.js` — no `/api` round trip needed, since it's a
    static file, not backend-generated. Starts as `{}` so an aircraft
    selected before the fetch resolves just renders no logo (graceful
    degradation, not an error) — the fetch is normally far faster than the
    time it takes a user to open a sidebar.
  - **Vendoring note for whoever regenerates this**: soaring-symbols'
    upstream repo and `airframesio/airline-images` both store their binary
    assets via **Git LFS** — a plain `git clone` (or GitHub's raw/API
    content endpoints) only returns the LFS *pointer* text, not the actual
    image bytes. `git lfs pull`/`git sparse-checkout` work but need
    `git-lfs` installed; the images here were fetched via the LFS HTTP
    batch protocol directly (`POST .../info/lfs/objects/batch` with each
    pointer's `oid`/`size`, then a plain `curl` of the returned signed
    download URL) — plain HTTP, no `git-lfs` binary required, useful if a
    future regeneration hits the same tooling friction.
  - CSS: `#sidebar-details .airline-logo` (`static/style.css`) mirrors
    `#sidebar-details .fi`'s sizing/vertical-align so the flag and the logo
    read as one visual family of "small icon before a text value" rows.
    Attribution for both tiers used to be a static line in
    `#sidebar-attribution` (`static/index.html`, right after
    `#sidebar-details`); moved to README.md's Attribution section instead
    (2026-07-20) — neither tier's license requires runtime UI display
    (MIT only requires the notice ship with copies of the software, already
    satisfied by the vendored `LICENSE`/`NOTICE.md` files under
    `static/airline-logos/`; airframesio/airline-images has no formal
    license terms at all), so the credit lives in the repo's docs rather
    than the sidebar footer. `#sidebar-attribution` and its CSS were
    removed as unused once nothing populated it anymore.
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
  **Bug fixed 2026-07-20**: `alt_baro === 'ground'` used to leave `altitudeM`
  `null` (the same value as a genuinely missing reading), even though
  "ground" is a definite, known signal, not missing data — the sidebar's
  Altitude row went blank for a grounded aircraft instead of reading `0`.
  `parseAdsbExchangeAircraft` now maps it to `altitudeM: 0` explicitly.
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
  **Bug fixed 2026-07-21 — spurious sidebar close on cross-source marker
  handoff:** earlier code in `static/js/icons.js`'s `clearStaleMarkers()` was
  calling `deselectAircraft()` whenever a single source's render list no
  longer included a selected aircraft, intending to catch "aircraft left the
  map entirely" — but this fired incorrectly for every cross-source dedup
  handoff (e.g. aircraft moves from adsb.fi to OpenSky priority between polls,
  so adsb.fi's next render excludes it even though it's still alive). Fixed by
  removing the deselect from `clearStaleMarkers()` (per-source scope can't know
  global liveness) and moving it to the end of `poll()` in `static/js/main.js`,
  which checks whether the aircraft has disappeared from *every* source's
  marker map, not just one. Regression test in `tests/frontend/test_track.spec.js`
  covers the handoff scenario (3-poll sequence: aircraft appears in adsb.fi
  only, then OpenSky joins, then both disappear; sidebar must stay open for
  step 2 and close only for step 3).
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
  `parseAdsbExchangeAircraft()`. **Coordinate validation (2026-07-20):**
  every `update*Markers` function used to only check `lat == null || lon ==
  null` before rendering a marker — a malformed upstream record (NaN, or a
  value outside the physically valid `[-90,90]`/`[-180,180]` range) would
  have silently rendered rather than being skipped like a genuinely missing
  position. All four now call a shared `isValidCoordinate(lat, lon)`
  (`constants.js`) instead. **Shared unit constants:** `FT_TO_M` (0.3048)
  and `KT_TO_KMH` (1.852), also in `constants.js`, replace what used to be
  the same two literals repeated across `parsers.js`/`render-details.js` —
  including a `196.850` in `render-details.js`'s `formatVerticalRateUnit()`
  that was really just `1/FT_TO_M*60` hardcoded as its own separate number,
  with no link back to the constant it was derived from. Both normalizers share `formatSquawk()`
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
  priority only when it's a meaningful value, via `openskyCategoryIsMeaningful()`
  (`state-filters.js`) — a shared helper, not the two independently-written
  checks this used to be. **Bug fixed 2026-07-20**: `normalizeOpenSky()`
  (`parsers.js`) used to decide "meaningful" via a bare `category >= 2`,
  while `categoryGroupFor()` decided it via `group !== 'unknown'` — these
  disagreed for category 13 ("Reserved"), which passes `>= 2` but maps to
  `'unknown'` in `OPENSKY_CATEGORY_GROUP`. The sidebar could show
  "Category: Reserved" while the marker icon and category filter treated
  the same aircraft as unknown-category (and possibly fell through to a
  radius source's own category instead). Both call sites now go through
  `openskyCategoryIsMeaningful(category)`, defined once next to
  `OPENSKY_CATEGORY_GROUP` itself so the two checks can't drift apart again.
  **A third, even-lower-priority fallback** exists one level below both of
  these — `enrichment/aircraft_category.py`'s static MTOW-derived
  `(manufacturer, model) → category` table, wired into `enrich_identity()`
  and consumed by `buildMergedDetails()` (see the Identity enrichment
  section above) — but it only ever fills the sidebar's `categoryDisplay`
  text when *neither* OpenSky nor a radius source reported anything at
  all. Unlike the OpenSky/radius-source fallback above, it never touches
  `categoryGroup`, the map marker icon, or the category filter dropdown —
  those are all computed once per poll from live data only, before this
  click-triggered enrichment tier has even run.
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
  - **Durable storage is SQLite, not per-store JSONL files (migrated
    2026-07-20)**: `storage.py` — a new root-level module, sibling to
    `app.py` — holds `users`, `collections`, `identity_cache`, and
    `identity_history` as tables in one SQLite database file (`DB_FILE`,
    default `.app.db`), opened in WAL (write-ahead log) mode. This
    replaced the original design (a per-process Python dict/list per
    store, loaded once from a JSONL file at import via `_load_users()`/
    `_load_collections()`/`_load_identity_cache()`, rewritten whole to
    disk on every save) after a real architectural bug was found, not
    hypothetically: this app's `Dockerfile` runs gunicorn with
    `--workers 2` — two independent OS processes, each with its own copy
    of that in-memory state. A save in one process updated its own dict
    and the file on disk, but never the sibling process's already-loaded
    copy, and gunicorn distributes requests across processes
    unpredictably — so a user could save a collection card via one
    process and then not see it moments later via a request served by the
    other. That's a silent, hard-to-reproduce data-consistency bug (would
    present as "sometimes my saved aircraft aren't there, refreshing
    sometimes helps"), not a performance nitpick. SQLite's WAL mode gives
    correct concurrent reads/writes across multiple processes sharing one
    file, with no separate database server — `sqlite3` is in Python's
    standard library, so this is the one place in the project where "no
    database" (see Conventions at the bottom of this file) was
    deliberately retired for the stores that actually need cross-process
    consistency; every ephemeral, short-TTL request cache elsewhere
    (`_cache`, the four `RADIUS_SOURCES` caches, `_track_cache`,
    `_photo_cache`, `_adsbdb_cache`, ...) stays exactly as it was — those
    duplicating per gunicorn process only costs a little extra upstream
    traffic, never a correctness bug, so there was no reason to move them.
    `storage.get_connection()` keeps one connection per thread
    (`threading.local`), matching gunicorn's `--threads 8` model — a
    sqlite3 connection isn't safe to share across threads without its own
    locking. `storage.init_db()` runs at `app.py` import time
    (`CREATE TABLE IF NOT EXISTS`, safe on every process start) rather
    than only from `if __name__ == "__main__":`, unlike the identity
    backfill thread — creating tables is a harmless, idempotent schema
    operation, not something that spawns background work or touches the
    network, so it's fine (and necessary) for the test suite's plain
    `import app` to trigger it too. `migrate_jsonl_to_sqlite.py` (repo
    root) is a one-off, not-run-automatically script (same "regenerate/run
    by hand" convention as this project's other one-off scripts) for
    importing an existing deployment's old `.users.jsonl`/
    `.collections.jsonl`/`.aircraft_identity_cache.jsonl`/
    `.identity_history.jsonl` files into the new database — idempotent
    (every insert is an upsert), safe to re-run, never deletes anything.
  - **Users table** (`storage.get_user()`/`storage.upsert_user()`): keyed
    by Google's `sub` (a stable unique id). **No password is ever
    stored** — Google's own consent screen is the only credential check;
    the stored record is just `{sub, email, name, picture, created_ts}`.
    `/api/login/google/callback` creates or updates that record on every
    successful login (so a changed Google display name/photo is picked up
    next login, `created_ts` preserved across the update) and sets
    `session["user_id"]`; `/api/logout` clears it; `/api/me` reflects the
    current session's user (or `{"user": null}` when logged out).
  - **Collections table** (`storage.list_collections()`/
    `storage.save_collection()`/`storage.get_collection_by_icao()`/
    `storage.delete_collection()`): one shared table (not split per user),
    filtered by `user_id` in the `WHERE` clause on read. Each card is
    `{id, user_id, icao24, saved_at, snapshot, location, photo_url,
    photo_link, photo_photographer}` (`snapshot`/`location` stored as JSON
    text columns, decoded back into dicts by `storage._row_to_card()`);
    `id` is a server-generated `uuid.uuid4().hex`. **One `icao24` = one
    card per user** (re-approved 2026-07-18, superseding the original
    "each save is its own card" design) is now a **database-enforced
    invariant**, not just an application-level check-then-write: a unique
    index on `(user_id, icao24)` backs `storage.save_collection()`'s
    `INSERT ... ON CONFLICT (user_id, icao24) DO UPDATE`, whose `UPDATE`
    branch deliberately never touches the `id` column — `api_collection_save()`
    still looks up the existing card first (`storage.get_collection_by_icao()`)
    purely to decide the HTTP status code (200 update vs. 201 create); the
    upsert itself would preserve the right id either way.
  - **Persistence across devices and deploys**: users/collections/identity
    rows are keyed by account (`user_id`, Google's `sub`) or by `icao24`,
    not by device or session — logging in from any device against the
    *same running backend* already sees the same collection, with no
    extra work needed. The actual persistence boundary is the backend
    process's own local disk: `DB_FILE` (like `TRACK_CACHE_FILE`, the one
    other durable store this app has) defaults to a plain relative path
    (`.app.db`) written next to `app.py`. On an ephemeral container
    platform — this app's `Dockerfile` targets Northflank — that path
    lives inside the container's own writable layer, with no volume
    mounted onto it, so a redeploy or even a plain restart wipes it. Fix
    is infrastructure, not code: mount a persistent volume on the
    deployment and point `DB_FILE` (and `TRACK_CACHE_FILE`) at a path
    inside it (e.g. `DB_FILE=/data/app.db`) — both already read their path
    from the environment, so no code change is needed, only the volume +
    env var configuration on the host (plus, for an already-deployed
    volume still holding the old JSONL files, running
    `migrate_jsonl_to_sqlite.py` once against it — see above).
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
  - **Bug fixed 2026-07-20 — every saved card landed in "Unknown / no
    info"**: `saveCurrentAircraftToCollection()` (`auth-collection.js`) sent
    `snapshot: merged.info` verbatim, but `categoryGroup` (like `lat`/`lon`)
    lives as a *sibling* of `info` on the `detailsById` entry (`icons.js`),
    never nested inside it — `buildMergedDetails()` only ever spreads
    `live.info`, so `merged.info.categoryGroup` was always `undefined`, the
    key was dropped by `SNAPSHOT_FIELDS`'s own `is not None` filter before
    it ever reached storage, and the panel's grouping code's `|| 'unknown'`
    fallback fired for every card regardless of the real aircraft. Backend
    and grouping code were already correct — the fix is purely client-side:
    the snapshot sent is now `Object.assign({}, merged.info, {categoryGroup:
    details && details.categoryGroup})`.
    **Cards saved before this fix self-heal, no migration or re-save
    needed**: `categoryDisplay` never had the bug (it was always a real key
    inside `info`, copied through untouched), so an already-stored card has
    a correct `categoryDisplay` but no `categoryGroup` at all — confirmed
    via a real report where categories rendered correctly on every card
    (`renderCollectionCard()`'s own badge, added in the same pass) yet every
    one of them still landed in one "Unknown / no info" bucket.
    `categoryGroupForCard(card)` (`auth-collection.js`, used by
    `renderCollectionPanel()`'s grouping loop) prefers `snapshot.
    categoryGroup` when present, but falls back to deriving it from
    `splitCategoryDisplay(snapshot.categoryDisplay)`'s bare label via
    `CATEGORY_LABEL_TO_GROUP` (both globals from `render-details.js`, the
    same reverse lookup the route card's direction-icon already uses) —
    so a pre-fix card groups correctly the very next time the panel
    renders, without needing anyone to unsave/re-save it by hand.
  - **Where/when it was seen**: `POST /api/collection` also accepts
    top-level `lat`/`lon` (alongside the existing `photo_*` fields — capture
    metadata, not identity data, so it stays out of `SNAPSHOT_FIELDS`/
    `snapshot` the same way `photo_url` does; sourced from the same
    `detailsById` sibling properties route validation already threads
    through). When present, `api_collection_save()` resolves
    `enrichment.airports.nearest_airport(lat, lon)` server-side (never
    trusting a client-computed value) and stores `location: {lat, lon,
    nearest_airport: {name, city, country, iata, icao, distance_km} | null}`
    on the card — `null` only when the airports table itself failed to
    load, not when a genuine nearest airport is merely far away (the lookup
    is a global scan, not a bounded radius, so it always returns *something*
    given valid coordinates). **`enrichment/airports.py`** is a new,
    fourth local static lookup module (sibling to `countries.py`/
    `registration.py`/`callsign.py`/`aircraft_database.py`), loading
    `enrichment/data/airports.json` (7698 entries, generated the same
    "one-off, uncommitted script" way as `opensky_year_built.json` from
    OpenFlights' `data/airports.dat` — same project/license,
    ODbL/DbCL, already used for `callsign.py`'s generated airline tier) and
    doing a plain haversine nearest-neighbor scan — no bounding to this
    app's own coverage area, since a flat Python loop over ~7700 rows costs
    sub-millisecond and a collection save is a rare, click-driven event, not
    a per-poll cost, so keeping the whole world's airports means the lookup
    still works if `AREA_CENTER` ever moves. `undoRemoveCard()`'s re-POST
    forwards the ghost's remembered `location.lat`/`.lon` the same way it
    already forwards `photo_*`, so an undone card's location survives the
    round trip.
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
    `{icao24, snapshot, category_code, lat, lon, photo_url, photo_link,
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
    - **Per-card view** (reworked 2026-07-20 — originally photo +
      registration/ICAO + aircraft type only): registration/ICAO title and
      aircraft-type subtitle stay first, then whichever of the following
      the snapshot/location actually has (each row simply omitted when
      null, same "hide, don't show blank" rule as `detailRow()` — no dedup
      is attempted yet against the subtitle, e.g. manufacturer/model can
      restate what aircraftType already implies, left for a future pass):
      a category badge (`"A3 · Large"`, `splitCategoryDisplay()` +
      `CATEGORY_DESCRIPTIONS` reused verbatim from `render-details.js` —
      both globals it can see by call time despite loading *after* this
      file in index.html's script order, since a card is only ever
      rendered from a later user action, never at page-load time) with its
      one-sentence description as a caption; Operator (with
      `airlineLogoHtml()`) and Operator Country (with `flagHtml()`), also
      reused from `render-details.js`; a combined Manufacturer+Model line;
      and a muted footer with the formatted saved date/time
      (`toLocaleString()`) and the `location` line — nearest airport (`"Near
      Belgrade Nikola Tesla Airport (BEG) · ~12 km"`) when resolved, else
      bare `"lat, lon"`. Every value still goes through
      `appendCardRow()` → `textContent`, never string-concatenated HTML —
      only the small flag/logo fragment is trusted `innerHTML` (both
      `flagHtml()`/`airlineLogoHtml()` validate their input against a
      strict code/callsign regex before building any markup). Every card
      in this view is, by definition, currently saved, so its toggle icon
      (`.collection-card-icon-btn`, the same bookmark glyph/fill rule as
      the sidebar's) always renders filled.
      `.collection-card-photo-wrap` uses the same fixed `aspect-ratio: 16 /
      9` + `object-fit: cover` treatment as the sidebar gallery slider (see
      "Fixed 16:9 slider box" above) — one consistent photo-box shape
      across every place this app shows an aircraft photo — at a wider
      `minmax(320px, 1fr)` grid floor (`.collection-group-grid`, was
      `240px`) so the larger card content above still reads comfortably,
      per an explicit ask for bigger photos.
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
  entry (this route is intentionally uncached). Also covers the two-tier
  `AIRLINE_OPERATORS` merge (`enrichment/callsign.py`): `_CURATED_
  AIRLINE_OPERATORS` stays at its documented ~90+ minimum; the OpenFlights-
  generated tier is asserted at a ~5000+ minimum (guards against the
  generation step's country-name filter silently regressing); the curated
  tier's `"QFA"` → `"Qantas Airways"` wins over the generated tier's plain
  `"Qantas"` end-to-end through `decode_callsign()`; and a real airline the
  curated 96 never covered (`"KAP"`, Cape Air) resolves correctly through
  the generated tier alone. `test_decode_callsign_lowercase_and_unknown`'s
  "definitely not a real designator" placeholder was `"ZZZ"`, which turned
  out to collide with a real one (Zabaykalskii Airlines) once the generated
  tier landed — replaced with `"XQZ"`, checked against the live table
  rather than assumed, so this can't quietly rot again as coverage grows.
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
  async and lands after `selectAircraft()` returns. Also covers the
  category fallback (`enrichment/aircraft_category.py`): a `flywme`-badged
  Category row appears when neither OpenSky nor a radius source reported
  one at all (`aaaaaa`, present in no radius fixture, with a non-meaningful
  OpenSky category), and a real live category (`dddddd`, reported by
  OpenSky and both enabled radius sources) is never overwritten by a
  deliberately contradicting enrichment response, though Flywme's own
  guess still co-displays as the last badge.
- `tests/backend/test_aircraft_category.py` covers
  `enrichment/aircraft_category.py` directly (spot-checks across all five
  codes this table produces, including that A4 is applied only to the
  Boeing 757 and that A7 covers both a light and a heavy helicopter
  regardless of weight) and asserts its `(manufacturer, model)` keys match
  `TYPE_CODE_TABLE`'s own pairs exactly (`==`, not `<=`/`>=` — catches
  either a stale entry left behind after `TYPE_CODE_TABLE` changes, or a
  new `TYPE_CODE_TABLE` entry this table forgot to cover), plus
  `enrich_identity()`'s `category` tier end-to-end through both the
  icao24-record and aircraft-type-code paths, and the `/api/identity`
  route surfacing it.
- `tests/backend/test_adsbdb.py` covers `/api/adsbdb/<icao24>`: the
  combined aircraft+callsign request and its exact upstream `params`,
  aircraft-only (no/unknown callsign, including adsbdb's "200 with just
  aircraft" behavior for a known aircraft + unknown callsign), the 404
  "unknown aircraft" response, indefinite caching (including that a
  different callsign for the same icao24 is a distinct cache entry), and
  that a network error returns 502 *without* caching. `conftest.py`'s
  `reset_caches` gained a `_adsbdb_cache.clear()` entry.
- `tests/backend/test_identity_cache.py` covers the persistent
  aircraft-identity cache: a fresh fetch populates `storage.get_identity()`
  with the four tracked fields; a later fetch (different callsign, so a
  fresh upstream request rather than a cache hit) with a changed field
  both updates the row and appends exactly one entry to
  `storage.identity_history()`; a null field in a later response never
  erases a previously known value (and logs nothing); the row persists
  across a fresh `storage.reset_connection()` (simulating a process
  restart against the same `DB_FILE`, same intent as `test_track.py`'s
  restart test); an unknown (404) aircraft never touches the cache at
  all. `conftest.py`'s `reset_caches` points `storage.DB_FILE` at a fresh
  throwaway SQLite file per test (and resets the thread-local connection),
  same rationale as the existing `TRACK_CACHE_FILE` redirect. Also covers
  `/api/identity/stats`: zero counts on an empty
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
- `test_airline_logo.spec.js` covers `airlineLogoHtml()`: overrides
  `dddddd`'s own callsign (via a `**/api/states` override registered after
  `mockAllSources()`, not by editing the shared `states.json` fixture, so
  no other spec's marker/count assertions are affected) to a known airline
  prefix and asserts `#sidebar-details .airline-logo`'s `src` resolves to
  the tier-1 (soaring-symbols) file; a callsign matching no manifest entry
  renders no `.airline-logo` element at all. Waits on
  `AIRLINE_LOGO_MANIFEST` having entries before selecting, since that
  manifest loads via its own async fetch independent of the poll cycle.
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
- `tests/backend/test_airports.py` also covers the Airports-layer dataset
  (`list_map_airports()`/`airports_in_bbox()`/`/api/airports`), alongside
  its pre-existing `nearest_airport()` tests — a genuinely different
  dataset (OurAirports, not the OpenFlights table `nearest_airport()`
  uses), reusing Belgrade Nikola Tesla (BEG/LYBE) as the same worked
  example since it's a real, stable entry in both tables: `list_map_airports()`
  finds it with the right `type`/`country`/`country_name`/`municipality` and excludes
  `closed` airports by default (proven against the same dataset with
  `include_closed=True`); `airports_in_bbox()` filters correctly by bounds
  and degrades to an empty list (not an exception) for non-numeric or
  degenerate boxes; and the `/api/airports` route is covered end-to-end
  with an explicit `bbox`, no `bbox` at all (falls back to this app's own
  home-region `BBOX`), and a malformed `bbox` (same fallback).
- `test_airports_layer.spec.js` covers the frontend layer: off by default
  with zero fetches; enabling it fetches `/api/airports` with a `bbox` query
  param derived from the current viewport and renders every returned
  airport into `airportsState.clusterGroup`; panning the map re-fetches for
  the new viewport (debounced); disabling removes the cluster layer and
  stops further fetches on subsequent pans; a marker's popup contains the
  name/IATA/ICAO/type text, and a heliport fixture gets the distinct
  `airport-icon-heliport` class while a regular airport gets
  `airport-icon-large-airport`; and the `(?)` popover opens with explanatory
  text and closes on an outside click, the same mechanism the weather
  layers use.
- `tests/backend/test_zones.py` covers the zone-search feature's backend:
  `_apply_zone()` updates `AREA_CENTER`/`BBOX`/`AREA_RADIUS_KM` **and**
  explicitly asserts `RADIUS_SOURCES[*]["center"]`/`FLIGHTAWARE_QUERY`/
  `FLIGHTRADAR24_BOUNDS` change too (the regression this design exists to
  prevent — a test that only checked `AREA_CENTER` wouldn't catch a future
  change that reintroduces the "three frozen values" bug), with
  `_fr24_client.get_bounds` mocked and its failure path (bare exception,
  old bounds kept) covered separately; every location-scoped cache is
  asserted cleared; `POST /api/zones/active` covers the happy path,
  invalid-coordinate 400s, `zone_id` defaulting to `"custom"`, and disk
  persistence; `_maybe_reload_zone_from_disk()` is covered both directly
  (simulating a different worker's write via `os.utime()` to force the
  mtime forward) and through `/api/config`'s own call to it. `search_airports()`
  and `/api/airports/search` are covered in `test_airports.py` alongside
  the pre-existing map-layer dataset tests: empty/short-query guards,
  exact-code-match-first ranking, the word-boundary-prefix tier (asserting
  "London Heathrow Airport" outranks a plain substring match), case
  insensitivity, closed-airport exclusion, and the server-side `limit`
  clamp. `conftest.py`'s `reset_caches` fixture redirects `ZONES_FILE` to a
  throwaway per-test file and restores the pre-test zone via `_apply_zone()`
  itself afterward (not a hand-rolled undo), since `_apply_zone()` mutates
  a wide set of module globals that would otherwise leak between tests.
- `test_zone_search.spec.js` covers the frontend: typing below the 2-char
  minimum fires no request; a valid query (past the debounce) fetches
  `/api/airports/search` and renders results; selecting a result posts to
  `/api/zones/active`, recenters the map, and triggers an immediate
  `/api/states` call rather than waiting for the next poll tick; a failed
  `POST` shows the inline status message and leaves the map's center
  unchanged. `/api/zones/active` is always mocked in this spec, never hit
  for real — the shared Playwright `webServer` is one long-lived process
  reused across the whole parallel test run (`playwright.config.js`'s
  `reuseExistingServer`), so a real POST would mutate the actual
  `config/zones.json` on disk and leak zone state into every other
  concurrently-running spec.
- `tests/backend/test_flightradar24.py` mocks the `FlightRadarAPI` SDK
  directly (`monkeypatch.setattr(app._fr24_client, "get_flights", ...)`) —
  the first backend test file that isn't mocking `app.requests.get`/`.post`,
  since this source never calls `requests` itself. Covers the happy path,
  10s caching, stale-fallback on the SDK's own `CloudflareError`, and —
  since `cached_flightradar24()` deliberately catches bare `Exception`, not
  just the SDK's typed errors — stale-fallback on an arbitrary `ValueError`
  too, plus the cold-start 502 path. `conftest.py`'s `reset_caches` gained a
  `_flightradar24_cache.clear()` entry.
- `test_flightradar24.spec.js` covers: off by default (zero markers, no
  fetch); markers render once toggled on; the toggle itself controls marker
  visibility; an aircraft already claimed by OpenSky (shared ICAO24) is not
  double-marked, proving the priority placement below airplanes.live; and
  the Route card renders a bare IATA code correctly (the `" (CODE)"`
  formatting trick — see the FlightRadar24 section above). Reuses
  `states.json`'s `"aaaaaa"` for the dedup case; picks a hex (`"123456"`)
  confirmed absent from every other fixture for its own-marker cases, after
  an early draft of this test picked `"ffffff"` and got a false failure —
  that hex was already used by `airplaneslive.json`'s own fixture aircraft,
  so the "aircraft already covered" dedup logic was correctly excluding it
  the whole time; the bug was in the test's own fixture data, not the app.
- `test_collection.spec.js` covers the aircraft collection panel, including
  a 2026-07-20 regression test for the categoryGroup save bug: saving
  `dddddd` (OpenSky category 4, a real "large") posts a snapshot whose
  `categoryGroup` is actually `"large"`, not silently absent — the exact
  condition that used to sink every saved card into "Unknown / no info"
  regardless of its true category. Also covers: a save posts the selected
  aircraft's own `lat`/`lon` (fixture position from `states.json`); a card
  renders its category badge + description, Operator (with airline logo),
  Operator Country (with flag), combined Manufacturer/Model, formatted
  saved date, and nearest-airport location line when the snapshot/location
  has them; and a card with no resolved `nearest_airport` falls back to
  bare `lat, lon` text while omitting rows for fields that are absent
  entirely (proving rows are conditionally rendered, not blank-padded).
  Also covers `categoryGroupForCard()`'s self-healing fallback: a card with
  only `categoryDisplay` (`"A5 — Heavy (>300,000 lbs)"`) and no
  `categoryGroup` at all — the exact shape of every card saved before the
  fix above shipped — still groups under "Heavy", not "Unknown / no info".
  `tests/backend/test_collections.py` covers the matching server side:
  `POST /api/collection` with `lat`/`lon` resolves and stores `location`
  (using a real, stable OpenFlights entry — Belgrade Nikola Tesla, `BEG` —
  not a fixture-only value) with `nearest_airport` correctly re-resolving
  on a re-save to different coordinates (London Heathrow, `LHR`), and a
  save with no coordinates stores `location: null`.
  `tests/backend/test_airports.py` covers `enrichment/airports.py`'s
  `nearest_airport()` directly (no HTTP mocking needed, same category as
  `test_enrichment.py`): a close real match, distance ordering between a
  near and far point, and `None` for missing/invalid coordinates.

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

## Favicon

Colored per-environment — the whole point, per the project owner: local
and prod tabs need to be tellable apart at a glance without reading the
URL. `/favicon.png` (`app.py`) is a Flask route, not a static `<link>`
straight at a file, so it can pick which file to serve based on `APP_ENV`
(env var, defaults to `"development"`) — `FAVICON_FILES` maps
`"development"` → `static/favicon-dev.png` (orange) and `"production"` →
`static/favicon-prod.png` (blue); an unrecognized value falls back to the
dev file rather than erroring. `static/index.html`'s `<head>` links it as
`<link rel="icon" type="image/png" href="/favicon.png">`. The Northflank
deployment has `APP_ENV=production` set in its service env vars so its tab
shows blue; nothing needs setting locally, since the code's own default
already is the dev color.

**PNG, not SVG, and why**: the first version served a runtime-templated
inline SVG (recoloring the exact "large"/cat4 glyph `static/js/icons.js`'s
`LARGE_GLYPH` already draws for on-map markers) from `/favicon.svg` — it
worked immediately in Chrome, but never rendered in Safari even after
clearing Safari's own favicon cache (`~/Library/Safari/Favicon Cache/`),
which ruled out simple caching as the cause. Safari's support for colored
`rel="icon"` SVGs (as opposed to monochrome `rel="mask-icon"`, a different,
narrower feature) has a history of being inconsistent across versions, so
rather than chase which exact WebKit quirk was responsible, the fix was to
drop SVG entirely and use PNG — the one favicon format every browser,
including every Safari version, has always supported without caveats.
`app.py` has no SVG-to-PNG conversion of its own and no new dependency for
this (no Pillow/cairosvg). Registering `/favicon.png` as an explicit route
works cleanly alongside Flask's own static route even though
`static_url_path=""` makes every other static file (e.g. `/style.css`)
resolve at the root too — Werkzeug's routing always prefers a literal rule
over the static blueprint's `/<path:filename>` converter rule, regardless
of registration order, so there's no route-ordering pitfall here.

**Artwork, second iteration**: the very first PNGs were just the on-map
marker glyph recolored solid orange/blue on a transparent background — the
project owner then asked for a filled colored background, a white
silhouette, and specifically a *takeoff* pose (plane climbing away from
the ground), not the flat top-down marker glyph. Rebuilt as a rounded
square (~20% corner radius, the standard flat "app icon" look) filled with
the per-environment color, with
[Pictogrammers MDI](https://pictogrammers.com/library/mdi/icon/airplane-takeoff/)'s
`airplane-takeoff` glyph (Apache-2.0, fetched from
`unpkg.com/@mdi/svg/svg/airplane-takeoff.svg` — the same icon family
already vendored in this app for `GROUP_ICONS`, see the sidebar section
above) in solid white — its diagonal climb-away-from-a-ground-line shape
reads clearly even shrunk to an actual 32×32 favicon (checked before
finalizing at every stage), the deciding factor over the project's own
hand-drawn marker glyphs, none of which depict a takeoff pose.

**Artwork, third iteration — rendering pipeline swap, not a design
change**: the second iteration was first rendered via macOS's `qlmanage -t`
(a Quick-Look-thumbnail trick, chosen because it needs no new dependency)
— but `qlmanage` turned out to **flatten the transparent corners to opaque
white** instead of preserving alpha (confirmed by sampling corner pixels:
`(255,255,255,255)`, not `(0,0,0,0)`), which the project owner spotted as a
visible white halo around the icon in the browser tab. `qlmanage` is a
Quick-Look thumbnailer, not a real asset-export tool, and apparently
composites onto a white backdrop regardless of the source SVG's own
transparency — not something any SVG/PNG flag fixes. Separately, the
project owner also asked for a bigger glyph relative to the background.
Both prompted swapping the render step to a **from-scratch Python
rasterizer** (Pillow + `svgelements`, `pip install`ed into `.venv` — the
only two new dependencies this feature has ever needed, and only for
**offline asset generation**, never imported by `app.py` at runtime):
`svgelements.Path` parses the MDI glyph's `d` attribute and flattens its
line/cubic-bezier segments into polygons (`ImageDraw.polygon`, sampled at
24 points per curve — plenty smooth at this size); the rounded-square
background is drawn with `ImageDraw.rounded_rectangle` directly into a
**true RGBA canvas** (`Image.new("RGBA", ..., (0,0,0,0))`) so the corners
outside the rounded rect stay genuinely alpha-0, not merely "look
transparent in one previewer." Everything is rendered at 4× supersampling
(800×800) and downsampled with `Image.LANCZOS` for antialiased edges, then
resized to the final 180×180. The glyph now fills ~74% of the canvas
(`icon_scale_pct=0.74` in the render script, up from the second
iteration's ~66%) per the "plane can be bigger" request — sized against
the smallest real target (a 32×32 favicon) before finalizing, same
discipline as the previous iteration. `static/favicon-dev.png`/
`static/favicon-prod.png` are this script's output, committed as plain
binary assets — the same "vendored, not generated at request time" pattern
already used for `static/ADS-B_Radar_Free_Aircraft_SVG_Icons/`/
`static/flag-icons/`; the render script itself is a scratch tool, not
checked into the repo (consistent with the project's "no build step"
convention — regenerating these two PNGs is a rare, manual, by-hand
operation, not something the running app or its test suite ever needs to
do). Regenerate by hand (recreate the Pillow/svgelements script, or use
any SVG-to-PNG tool that honestly preserves alpha — verify with a corner
pixel sample before trusting it) if the glyph, colors, corner radius, or
scale ever change again.

## Conventions

- All UI text and code comments are in English, regardless of the language
  used in conversation.
- Keep this to a handful of plain files (backend, markup+JS, stylesheet) —
  no framework, no build step. This is an intentional MVP constraint, not
  an oversight. `static/style.css` is a `<link>`ed stylesheet, not a build
  artifact, so it doesn't violate "no build step." Not a hard requirement,
  though — the project isn't attached to staying build-step-free forever.
  If a future need (bundling, minification, TypeScript, whatever) makes a
  build step the better tradeoff, adopt one; this convention just reflects
  that nothing so far has justified it. **Revisit condition**: if active code
  reaches 1MB+ (currently ~935KB), trigger an explicit architectural review
  (TypeScript, minifiers, bundlers, CSS frameworks) — size alone doesn't
  automatically justify tooling overhead, but it should trigger a conscious
  decision point. JSDoc + strict IDE settings can deliver ~80% of TypeScript
  benefits (type hints, refactoring safety in IDE) without a build step.
  See DECISIONS.md 2026-07-21 for full reasoning. **"No database" was the
  same kind of soft convention, and was retired 2026-07-20** for the state
  that actually needed a database's guarantees: `storage.py`'s SQLite file
  (accounts, saved collections, the identity cache/history log) — see the
  Aircraft collection section above for the concrete cross-process
  consistency bug that justified it. Every short-lived request cache
  elsewhere in `app.py` stays a plain in-memory dict; this wasn't a
  wholesale "add a database" decision, just retiring the "no database"
  rule specifically where it was costing correctness.