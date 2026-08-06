# Architecture Decision Records (ADR)

Append-only log of architecturally-significant decisions. Newest entries at bottom.

---

## 2026-07-20 — SQLite migration for cross-process consistency

**Problem:** Cross-process data loss under gunicorn's 2 worker processes, each holding its own in-memory copy of users/collections/identity loaded from JSONL. Full mechanism: CLAUDE.md § "Aircraft collection" → "Durable storage is SQLite...".

**Decision:** Migrated users/collections/identity caching from per-process JSONL dicts to a **single SQLite database** (`.app.db`) in WAL mode, shared across all gunicorn worker processes.

**Reason:** SQLite's WAL mode ensures correct concurrent reads/writes across multiple processes with zero coordination overhead. No separate database server needed (sqlite3 is Python stdlib). Atomicity and durability for user-facing state (saved aircraft, account info).

**Tradeoffs:**
- SQLite doesn't scale to millions of rows, but this app's persistence is light (hundreds of users, thousands of saved aircraft) — acceptable fit.
- Per-thread connection pooling added (`threading.local`), matching gunicorn's `--threads 8` model. Minimal complexity.
- Short-lived request caches (states, tracks, photos) still live in-process-memory, not SQLite — not critical, can diverge, 10-300s TTL anyway.

**References:** CLAUDE.md § "Aircraft collection" → "Durable storage is SQLite...", § "Identity enrichment" → "Persistent aircraft-identity cache"

---

## 2026-07-20 — Route validation (Layer 2 geometric check) on adsbdb routes only

**Problem:** adsbdb's flightroute lookup is historical/opportunistic (callsign→route via past observation database), not live flight-plan data. Real aircraft can legitimately have mismatched position/track/speed vs. the claimed route (schedule variance, diverts, wrong callsign, expired codeshare). False positives (claiming a route that's provably wrong) need surfacing to the user, but "probably not this route" shouldn't suppress the data.

**Decision:** Built a **Layer 2 validation** (geometric checks on current position/track/speed/altitude against origin/destination) that scores adsbdb routes 0–100 confidence (Reject/Low/Medium/High/Very High bands). Reject and Low routes hide specific airport names in normal mode; Medium+ show plainly. FlightAware routes bypass this (live/paid, assumed correct).

**Reason:** adsbdb doesn't warrant the user's trust the way a live flight-tracking API does. The geometric tests (track alignment, cross-track distance, progress along route, speed/altitude phase-of-flight heuristics) are standard aviation diagnostics; a rejected route that's provably off deserves hiding rather than misdirecting.

**Tradeoffs:**
- Five independent checks (track, distance, progress, terminal-speed, terminal-altitude) each with their own piecewise-linear scoring band — tuned by hand against real data, not rigorous. Could be improved with ML, but overkill for this use case.
- Recomputed on every poll (cheap, no caching), not just on click — updates live as the aircraft moves.
- Route card (in sidebar) is now a visual design piece (IATA codes + direction glyph + confidence dot), not just a text line.

**References:** CLAUDE.md § "Route validation (Layer 2..."

---

## 2026-07-19 — adsb.one hidden, not disabled — Cloudflare anti-bot block

**Problem:** `api.adsb.one` blocks all scripted access via Cloudflare anti-bot (JA3/JA4 TLS fingerprinting) — deliberate upstream policy, not a bug. Full confirmation details (two-network test, header-spoofing attempts, ADSB-One's stated feeder policy): CLAUDE.md § "adsb.one's HUD row is hidden...".

**Decision:** Removed the adsb.one row from the HUD entirely (`display: none` in CSS, not DOM removal). Checkbox and backend route left untouched for future restoration.

**Reason:** A disabled toggle that never works is worse UX than no control at all. If the Cloudflare block lifts in the future (either adsb.one policy changes or they add an authenticated path), reverting is a one-line CSS change, not re-wiring the whole HUD.

**Tradeoffs:**
- User loses that data source entirely (but the four other radius sources + OpenSky cover the same area, so not a regression).
- Backend route (`/api/adsbone`) still exists and would work if Cloudflare block lifted — zero wasted logic, just silently unused.
- Code smell: `#toggle-adsbone`, `sourceToggles['adsbone']`, and marker map keys still reference a user-invisible source. Intentional — recoveability is worth the one-line override.

**References:** CLAUDE.md § "adsb.one's HUD row is hidden...", § "adsb.lol shipped off..."

---

## 2026-07-18 — Basemap picker default = Voyager (CARTO colorful), not Light

**Problem:** The original hardcoded basemap was CARTO Positron (Light — monochrome, minimalist). User asked for options and explicitly re-approved switching the default to Voyager (colorful labeled streets).

**Decision:** Added a basemap picker dropdown (nine free styles: three CARTO, one OSM, five Esri) with Voyager as the default (no longer Light).

**Reason:** Voyager is more visually engaging and helps users orient themselves faster on unfamiliar areas. The reachability of the same data didn't change — toggle still refreshes markers live — just the background layer.

**Tradeoffs:**
- Voyager has slightly more visual noise than Light (more labels = potential marker occlusion at low zoom). Accepted trade.
- Basemap choice is session-only (no localStorage persistence) — users pick again on reload. Intentional, matching the app's "no persistence except login" philosophy.

**References:** CLAUDE.md § "Basemap picker"

---

## 2026-07-17 — FlightAware AeroAPI off by default (metered/paid)

**Problem:** FlightAware is the only live, flight-plan-backed flight tracking source available (6th source). But it's metered access with per-request cost. Even at 10s poll intervals, enabling it 24/7 racks up charges. User needs control over whether to burn that budget.

**Decision:** Ship FlightAware off by default (visible checkbox, unchecked). Same structure as other sources, but default is opt-in, not opt-out.

**Reason:** Respects the user's cost consciousness while keeping the feature available. On/off toggle is trivial and visible in the HUD.

**Tradeoffs:**
- Two "paid/risky" sources now ship off (FlightAware + FlightRadar24). Users who want them enabled have to remember to toggle. Acceptable — the conscious choice is the point.

**References:** CLAUDE.md § "FlightAware AeroAPI"

---

## 2026-07-20 — ICAO24 block corroboration for callsign-decoded operator (rotorcraft suppression)

**Problem:** Callsign-decoded operator can collide with an unrelated airline's ICAO designator (real example found and detailed in CLAUDE.md § "Identity enrichment" → "icao24_allocation.py"), with no independent way to catch it.

**Decision:** Added ICAO24 block allocation table as an independent signal (every aircraft's hex address is permanently assigned to a state by ICAO). When callsign-decoded operator disagrees with ICAO24's state, flag the match as unconfirmed. For rotorcraft (where cross-border leasing is rare), suppress the mismatched value entirely in normal mode; for fixed-wing (where it's routine), show it plainly. Dev mode shows the suppressed value with `⚠ Unconfirmed` tag.

**Reason:** Rotorcraft are predominantly domestic ops (EMS, police, military); a mismatch is a real red flag there. Fixed-wing regularly crosses borders and leases internationally, so a mismatch isn't inherently wrong.

**Tradeoffs:**
- Adds one more lookup (icao24_allocation.py, 184 ICAO blocks, ~0.1ms scan). Negligible.
- Increases complexity of the "which source to display" logic for Operator Country. Mitigated by documenting the rule clearly in dev-mode tooltips.

**References:** CLAUDE.md § "Identity enrichment" → "icao24_allocation.py", § "Registered Owner is a brand new field" (context on three-way country confusion that prompted this)

---

## 2026-07-21 — Runtime zone switching: file persistence + mtime-poll cross-worker sync

**Problem:** `config/zones.json` (loaded 2026-07-20, commit `b2d49fb`) only ever loaded once at import time — there was no way to change the app's coverage area without editing the file by hand and restarting. Building a search-driven "jump to this airport" feature meant deciding how a runtime zone change should behave under this app's actual deployment shape: 2 gunicorn worker processes, each with its own copy of `AREA_CENTER`/`BBOX`/etc. as plain module globals (the same structural issue `storage.py`'s SQLite migration, 2026-07-20, already solved for collections/identity).

**Decision:** Zone changes persist to `config/zones.json` (survive a restart, matching the file's existing role as the single source of truth for the coverage area) rather than staying session-only in memory. Cross-worker propagation uses a cheap `os.path.getmtime()` poll (`_maybe_reload_zone_from_disk()`, called at the top of every route that reads a zone-derived value) rather than a second SQLite table — a zone change is a rare, low-frequency event, so a stat-call-per-request is negligible next to the outbound HTTP calls those routes already make, and it reuses the existing file rather than adding new schema.

**Reason:** File persistence was chosen over session-only because this is a single-tenant app where the zone is a shared, backend-authoritative setting (unlike per-user preferences such as basemap/units, which stay in frontend-only state) — losing it on every restart would make the feature feel broken. Mtime-polling was chosen over a SQLite-backed active-zone table because the access pattern (rare writes, cheap reads, no relational query need) doesn't justify a second persistence mechanism when `storage.py` already exists for state that actually needs it — this stays consistent with `config/zones.json`'s pre-existing role rather than duplicating it.

**A second, related finding drove most of the actual implementation work:** three more values were frozen at import time and never revisited before this (full enumeration and the "seven values" list: CLAUDE.md § "Area coupling"). `_apply_zone()` is the one function that now recomputes all of them together, so this class of bug can't recur even if a future change touches only one by mistake.

**Tradeoffs:**
- A worker can serve up to one request with a stale zone before its own `_maybe_reload_zone_from_disk()` check fires — acceptable for a rare, human-triggered event, not treated as a hard real-time guarantee.
- Radius/zoom are deliberately left untouched by a zone change (center-only) — a v1 scope decision; extending the search UI to also offer a radius override is a possible follow-up, not built here.
- `_persist_zone_config()`'s disk write is best-effort (an unwritable `config/zones.json` doesn't fail the request) — matches this app's existing pattern of treating disk persistence as an optimization (e.g. the track cache), not a hard requirement, for state that isn't the source of truth for anything else running in the same request.

**References:** CLAUDE.md § "Zone search", `app.py`'s `_apply_zone()`/`_persist_zone_config()`/`_maybe_reload_zone_from_disk()` docstrings, `.ai/BACKLOG.md`'s superseded "make the app's geographic view zone easy to change" item

---

## 2026-07-27 — Zone config stores only the latest active zone

**Problem:** Runtime airport selections were appended to the `zones` dictionary
in `config/zones.json`, but the UI never lists or selects those stored presets.
Only the entry named by `active_zone_id` is loaded, so the file accumulated
historical coordinates that looked configurable but had no product behavior.

**Decision:** Keep the existing server-side persistence semantics, but replace
the preset dictionary with one `active_zone` object plus `active_zone_id`.
Every airport selection overwrites those values, so the last selection still
survives reopening/restarting the app. `_load_zone_config()` accepts the old
dictionary format for upgrade compatibility; the next selection writes the
compact format.

**Reason:** The application is single-tenant and the selected coverage area is
shared backend state, so persisting the last choice is useful. Retaining every
past selection is not: airport search and popular-airport suggestions come from
the separate OurAirports dataset, not from this config file.

**Tradeoffs:**
- Previously stored zone presets are discarded from the tracked config because
  they were not reachable through the UI.
- Switching back to an earlier airport goes through the existing airport search
  rather than editing `active_zone_id` by hand.
- Persistence remains global to the deployment, not per user.

**References:** CLAUDE.md § "Zone search", `config/zones.json`,
`tests/backend/test_zones.py`

---

## 2026-07-21 — `/api/health` endpoint: public with minimal response (not admin-only)

**Problem:** Deployment monitoring requires a health check endpoint (Northflank health checks, external uptime monitoring, CI/CD orchestration). Should it require authentication (admin-only) or be public?

**Decision:** Public endpoint with intentionally minimal response.

**Reason:** 
- Single-tenant, non-SaaS deployment — operator controls and owns all infrastructure; no multi-user confidentiality boundary to protect.
- Cloud platform norms — Northflank expects unauthenticated `/health` for native orchestration; admin-only complicates platform integration without adding real security (app already protected by OAuth).
- Operational state ≠ user data — quota numbers and upstream source status can be withheld from the response while still exposing "is app alive?"
- Operational simplicity — admin-only requires token management and CI/CD configuration overhead, not justified for personal deployment.

**Tradeoffs:**
- Public endpoint exposes that the app exists and is running (minimal risk for personal tracker).
- Response intentionally omits quota numbers, zone config, per-source reachability, and other operational details operator already sees in HUD.
- Unauthenticated monitoring is standard cloud practice; trust placed in network boundary (Northflank controls access to deployment).

**Implementation checklist:**
- Add `/api/health` route returning `{"status": "ok"}` (200) on success.
- Check: Flask alive, SQLite connection succeeds, no I/O startup errors.
- Return `{"status": "degraded", "message": "..."}` (503) if core dependencies fail.
- Do NOT include: OpenSky quota, per-source health, zone config, cache state.
- Document in README as monitoring/orchestration endpoint, not external API.
- Add test coverage: happy path (200), degraded path (503).

**References:** BACKLOG.md "Health check endpoint" (now unblocked)

---

## 2026-07-21 — Disable local-heuristic enrichment entirely for C0-C5 ground vehicles/obstacles

**Problem:** `enrichment/aircraft_enrichment.py`'s heuristic tiers (registration-prefix, ICAO24 block, callsign decode, and the icao24/type-code database) assume registration/callsign strings follow real ICAO conventions. Ground vehicles and obstacles (DO-260B categories C0–C5) often carry malformed or coincidental strings that happen to match a real prefix/designator, producing confident-looking but entirely fabricated data — a real C0 object with no ADS-B category info showed a fabricated "Taxi Aereo Cozatl" operator and "Bulgaria"/"Mexico" countries, sourced purely from these heuristics matching junk registration/callsign strings.

**Decision:** For any object whose ADS-B category code is C0–C5, `enrich_identity()` short-circuits to the live tier only — no local lookup table is ever consulted (not even the exact-match icao24/type-code database, which earlier drafts still allowed). Only a live feed value, or separately adsbdb's own returned fields, can fill these objects' identity fields. The frontend also hides (rather than showing "Unknown" for) empty identity rows on C0–C5 objects in normal mode.

**Reason:** Explicit project-owner direction after the fabricated-data incident above — for non-aircraft, a heuristic match is more likely coincidental than correct, and presenting it confidently (badges, "Unknown" placeholders, flags) misleads more than an honest absence of data would.

**Tradeoffs:**
- A rare, genuine case where a C0–C5 object's registration/callsign would have resolved correctly via one of these tables now shows nothing — accepted, since the false-positive risk across the whole category outweighs the lost true positives.
- Needed two follow-up bug fixes to actually take effect: `categoryCode` wasn't reaching `/api/identity` on a real click (stored as a sibling of `info`, not inside it), and `looksLikeGroundVehicle()`'s regex excluded C0 itself (`/^C[1-5]$/` instead of `/^C[0-5]$/`), so the frontend's hide-when-empty behavior never engaged for C0 specifically.

**References:** `enrichment/aircraft_enrichment.py`'s "Special case: C0 aircraft" docstring section, `tests/backend/test_enrichment.py`'s C0/C1-C5 test groups.

---

## 2026-07-22 — Dark mode: a CSS token system, coupled to basemap and marker color, decoupled from everything else

**Problem:** The app's own UI chrome (`#hud`, `#sidebar`, dropdowns, panels) never adapted to dark map basemaps — only 4 CSS custom properties existed anywhere (`--ink`/`--muted`/`--border`/`--card-bg`), everything else was hardcoded literal colors. There was also no way to express "dark mode" as one coherent product concept — basemap, marker color, and UI chrome were three independent settings a user had to tune separately to get a consistent dark experience.

**Decision:** Introduced a ~16-token CSS custom-property system (`style.css` `:root`), switched via a two-layer mechanism — `@media (prefers-color-scheme: dark)` as a pure-CSS fallback, `:root[data-theme]` as what a new HUD "Theme" toggle actually sets at runtime (an explicit `data-theme="light"` always overrides a dark OS preference, via `:root:not([data-theme="light"])` in the media block). The toggle is a genuine two-way mode selector (`.segmented`/`.seg-btn`, same widget family as the Units toggle) with exactly two segments — Light/Dark, no "Auto" — but its *initial* value is still seeded once from `prefers-color-scheme`. Explicitly coupled to the toggle: (1) the uniform-marker-color pair (`UNIFORM_MARKER_COLORS` in `constants.js` — bright yellow on dark, dark-ink fill + light stroke on light, for contrast), and (2) the basemap (`THEME_BASEMAP = {dark: 'dark', light: 'voyager'}`) — but only from an **explicit toggle click**, never applied on page load, since `map-init.js`'s own basemap default is an independently-tested product choice that must not be silently overridden for a visitor who never touches the toggle. (3) The app's root background (`#map`'s own `background`, the only visible root-background layer in the app) is also driven by the same token set.

**Reason:** A user picking "dark" wants one coherent experience, not three separate settings to hunt down and match by hand — the whole point of calling this a "theme," not a CSS tweak. The basemap/marker-color coupling only firing on click (not on load) is what keeps this from silently overriding `map-init.js`'s own tested default for users who never interact with the new toggle at all — an OS dark preference re-themes the chrome for free, but does not reach into unrelated, already-decided app defaults.

**Tradeoffs:**
- The uniform-marker stroke color required a second, JS-side fix beyond the new CSS tokens: a plain CSS rule always outranks an SVG's own inline `stroke=` attribute, so `--marker-stroke-color` has to be set via `document.body.style.setProperty(...)` (an inline style, which outranks any class rule) rather than purely through the cascade like every other token.
- Toggling uniform-color has never forced an immediate marker redraw (`isUniformColorEnabled()` is only re-read on the next poll cycle) — the theme toggle's `applyThemeMode()` now calls `poll()` once immediately specifically to avoid a stale, un-recolored map for up to `POLL_INTERVAL_MS` (12s) after a click.
- Several `rgba(15,23,42,0.0X)` "ink-tint" overlays across the file collapsed into 4 tokens by *visual role* (hover/fill/badge/strong), not by mirroring each literal alpha number — the same alpha reads very differently against a light vs. dark substrate, so a 1:1 token-per-literal mapping wouldn't have looked right in dark mode regardless.
- Permanent, explicit exceptions carved out rather than left ambiguous: `.google-signin-btn` (Google's own branding guidelines), status/brand colors (`#1a73e8`/`#dc2626`/`#22c55e`/`#b45309` — saturated enough for both themes), per-source `--row-color` swatches (data-source identity, not theme), and anything keyed to map tiles rather than chrome (`.plane-icon svg`'s non-uniform stroke, `.radius-ring-label`, Leaflet's `.leaflet-control-attribution`).
- The initial-default resolution (`resolveInitialThemeMode()`) is deliberately isolated in its own function as an extension point for a possible future backend-configured default (e.g. a `/api/config` field) — explicitly requested but not built in this pass.

**References:** CLAUDE.md § "Theme toggle", `tests/frontend/test_dark_mode.spec.js`, `.ai/BACKLOG.md` "Dark mode" (marked done).

---

## 2026-07-27 — Aircraft Scatter: a sixth radius source, paid/metered, off by default

**Problem:** The four free ADSBExchange-compatible radius sources (adsb.fi/adsb.lol/adsb.one/airplanes.live) plus OpenSky cover the configured area, but a paid ADSBexchange feed (via RapidAPI's Aircraft Scatter product) was proposed as an additional, higher-coverage option — same JSON shape as the free sources, but with two structural differences from every existing `RADIUS_SOURCES` entry: it requires an `X-RapidAPI-Key` auth header, and its endpoint has a **fixed ~1,000km query radius** (lat/lon only, no distance parameter), unlike every free source which takes an explicit radius.

**Decision:** Added it as a sixth `RADIUS_SOURCES` entry (`aircraftscatter`) rather than a bespoke standalone route. `radius_source_response()` special-cases it to attach RapidAPI auth headers (from `RAPIDAPI_KEY`, optional env var) and short-circuit to `{"ac": [], "error": "not_configured"}` when the key is absent — the same graceful-degradation shape FlightAware already uses for its own optional key. Since it has no `dist_param`, every place that builds a `RADIUS_SOURCES` entry's `center` dict (initial setup and `_apply_zone()`'s per-zone rebuild) now guards with `if _cfg.get("dist_param")` instead of assuming every entry has one. Ships **off by default**, cached for 60s (6× the free sources' 10s) since a fixed-radius query can't be narrowed to cut cost, and sits in enrichment/render priority **below airplanes.live** — a newer, paid, unproven-at-scale source never outranks the established free ones, the same reasoning FlightAware/FlightRadar24 already ship off-by-default and low-priority for.

**Reason:** Reuses the entire existing `RADIUS_SOURCES`/`cached_radius_source()`/`parseAdsbExchangeAircraft()` pipeline with two small, well-contained exceptions, rather than duplicating the whole radius-source machinery for one more feed — consistent with how FlightAware/FlightRadar24 were each folded in as the smallest diff that captured their one or two genuine structural differences from the free sources.

**Tradeoffs:**
- The fixed 1,000km radius means it draws from a much larger area than the app's own `AREA_RADIUS_NM` (220nm) scan zone — most of what it returns is likely well outside the area every other source/layer (Airports, scan-radius rings) is scoped to. Accepted: those aircraft still get correctly deduped/rendered, they just aren't specially clipped to the smaller zone the way `airports_in_bbox()` clips the Airports layer.
- Metered/paid, so a real API key is a prerequisite — without one, the source is silently inert (`not_configured`), same UX as FlightAware without a key.
- This was implemented across an earlier, uncommitted work-in-progress in the working tree before being reviewed/completed and committed in this session (commit `be44da4`) — documentation (this entry, the CLAUDE.md section, an `.ai/ARCHITECTURE.md` numbering fix) was added retroactively to bring it in line with every other source's documentation depth, and a stray raw draft note containing a live RapidAPI key in `.ai/BACKLOG.md` was removed (confirmed via full git history search that the key itself was never actually committed/pushed).

**References:** CLAUDE.md § "Aircraft Scatter", `.ai/ARCHITECTURE.md`, `tests/backend/test_radius_sources.py`, `tests/frontend/test_rendering.spec.js`.

---

## 2026-07-27 — Fast first paint and revised ICAO24 source priority

**Problem:** A complete poll waited for its slowest enabled upstream before
showing any aircraft, so an intermittent adsb.lol delay made the initial map
look empty despite faster sources already having responded. The former marker
priority also gave OpenSky first claim even where established ADS-B feeds
already supplied the same aircraft, spending a quota-limited source without
adding coverage.

**Decision:** `poll()` renders the same pipeline twice: an opportunistic pass
when the first real enabled fetch settles, followed by a final authoritative
pass once all fetches settle. The single canonical ICAO24 order is now
`airplanes.live > adsb.fi > adsb.lol > adsb.one > Aircraft Scatter > OpenSky
> FlightRadar24`; FlightAware remains callsign-keyed and follows this chain.
Aircraft Scatter ships enabled when configured, is included in the one-shot
per-process cache warm-up, and remains safely empty without `RAPIDAPI_KEY`.

**Reason:** The early pass makes the map useful at the latency of the fastest
source while the final pass remains the sole complete view. Prioritizing the
free/cheap radius feeds preserves OpenSky for aircraft they do not cover and
keeps the priority definition in one place (`ICAO24_DEDUP_PRIORITY`) for both
marker ownership and enrichment precedence.

**Tradeoffs:**
- A marker may briefly belong to a lower-priority source before a slower,
  higher-priority response arrives; the final pass corrects it.
- Every gunicorn worker warms five default-enabled routes on startup, which
  can add upstream traffic, but runs in a daemon thread and uses each route's
  existing cache/error behavior.
- Aircraft Scatter can consume paid quota when a key is configured; its 60s
  cache bounds that rate and its toggle remains available.

**References:** `static/js/main.js`, `static/js/constants.js`, `app.py`,
`gunicorn.conf.py`, `tests/frontend/test_rendering.spec.js`,
`tests/backend/test_warmup.py`.

---

## 2026-07-27 — Operator-configurable source visibility (`config/sources.json`)

**Problem:** Which of the app's eight data sources show a HUD row, and
whether their checkbox starts checked, was hardcoded purely in
`static/index.html`'s markup — adsb.one's hidden-row pattern
(`style="display:none"`, unchecked by default) was a one-off written
directly into the HTML for that specific source, with no general
mechanism. Changing a source's default meant editing markup.

**Decision:** Generalize the pattern into an operator-editable, committed
`config/sources.json` file — `{name: {visible, enabled_by_default}}` for
all eight sources — following `config/zones.json`'s established
"env-var-overridable path, loaded once at import" convention
(`SOURCES_FILE`/`_load_sources_config()`/`SOURCES_CONFIG` in `app.py`,
mirroring `ZONES_FILE`/`_load_zone_config()`). Surfaced via a new
`sources` key on `/api/config`; `static/js/main.js` fetches it a second,
independent time (the existing `map-init.js` fetch stays fire-and-forget
for the map view) and gates its own startup sequence on the result, so
`isSourceEnabled()` reflects the config before the first poll. v1 scope is
strictly these two flags — no ordering, no per-filter/per-weather-layer
visibility.

**Revised mid-implementation, same day:** the whole per-source toggle list
was moved behind **Dev Mode** — with Dev Mode off, none of the eight rows
show at all, regardless of any individual source's own `visible` value.
`visible` only takes effect once Dev Mode is already on, where it then
decides which specific rows actually appear (a `visible: false` source,
adsb.one by default, stays hidden even in Dev Mode — editing the config
file is still the only way to expose it). This moved the list's markup
out of its original standalone spot near the top of the HUD into the same
group as the Dev Mode toggle and the existing `#source-adsbdb` row, since
both are the same kind of thing. `enabled_by_default` stays completely
independent of both `visible` and Dev Mode — it only ever gates the
checkbox's own `.checked` state, which `isSourceEnabled()`/`poll()` read
directly regardless of visibility.

**Reason:** Values are byte-identical to the prior hardcoded HTML
defaults, so an absent or malformed file changes nothing — zero risk to
existing behavior/tests. An operator can now hide/show a source or flip
its default without touching code. Kept as a **separate** file from
`zones.json` (different nature of change — source/UI policy, not
geography) and deliberately **without** hot-reload or cross-worker
mtime-poll sync: unlike a zone change (a live, API-driven runtime action),
this file is hand-edited only, so a plain import-time load is sufficient
and avoids adding sync machinery nothing needs yet.

**Tradeoffs:**
- Changing a source's visibility/default requires an app restart, not a
  live toggle — accepted, since this is meant for occasional operator
  configuration, not a runtime feature.
- The two flags remain a purely frontend concern — a source's backend
  route still serves data to any caller regardless of `visible`/
  `enabled_by_default`; this feature doesn't add server-side gating.
- `visible: false` + `enabled_by_default: true` is a valid, intentional
  combination (hidden from the HUD but still polled/contributing data in
  the background), not disallowed or treated as a conflict.
- Gating the whole list behind Dev Mode broke 13 previously-passing
  Playwright tests across 6 files that clicked a source checkbox directly
  without opening Dev Mode first — fixed by adding one
  `page.click('#toggle-dev-mode')` before the checkbox interaction in
  each, not a wider test rewrite.

**References:** CLAUDE.md § "Operator-configurable source visibility",
`config/sources.json`, `app.py`, `static/js/main.js`,
`tests/backend/test_sources_config.py`,
`tests/frontend/test_sources_config.spec.js`,
`.ai/proposals/source-visibility-config-2026-07-22.md`.

---

## 2026-07-29 — Safari blank-map fix: symptom-triggered self-heal, not a blanket 3D-disable

**Problem:** An intermittent, never-reliably-reproduced bug (not even across ~55 scripted attempts against real prod) left `#map` fully blank (no tiles, no markers, HUD/data unaffected) for some Safari users in prod, correlated with fast repeated reloads. A same-day escalation (commit 7f280f6) set `window.L_DISABLE_3D = true` for every Safari visitor via UA sniffing, to rule out a WebKit GPU-compositing paint bug in Leaflet's transform-positioned panes. This "worked" (unconfirmed) but had an undocumented side effect: `L.Browser.any3d` also gates `map._zoomAnimated` in Leaflet's own source, so it silently killed *all* zoom/pan animation for every Safari visitor, bug or not — measured live (Playwright+WebKit): an identical wheel burst moved 11 zoom levels un-animated in Safari vs. 7, smoothly, in Chromium. This violated this project's own non-negotiable smooth-zoom baseline (`.ai/proposals/map-interactions-minimal-requirements-2026-07-22.md`), a trade nobody had actually signed off on when 7f280f6 shipped.

**Decision:** Reverted the blanket `L_DISABLE_3D` UA guess. Replaced it with a **symptom-triggered, tab-scoped self-heal**: `index.html`'s inline script only sets `window.L_DISABLE_3D` when `sessionStorage.mapForce2D === '1'`; nothing sets that flag until `checkMapPaintedOrOfferRetry()` (`map-init.js`, already run 4s after first paint and after a bfcache `pageshow` restore) observes *this specific tab* fail to paint a single tile. The first time that happens on Safari, it sets `mapForce2D` + `mapForce2DAttempted` in `sessionStorage` and calls `location.reload()` once (required — `L.Browser.any3d` is a Leaflet-module constant computed once at parse time, not togglable on an already-running map). If tiles still don't paint after that one retry, it falls through to the pre-existing manual `#map-retry` banner rather than reloading again.

**Reason:** Pays the animation cost only for the (apparently rare) tab that actually hits the bug, not for every Safari visitor on a pure guess. User confirmed in real prod Safari that the self-heal fixed the actual recurrence.

**Tradeoffs:**
- Root cause (why Safari's compositor allegedly leaves the panes blank) is still not confirmed via direct reproduction — this is empirically effective, not mechanistically proven. If a future recurrence resists this fallback, that's real signal the theory is wrong, not just bad luck.
- Costs one extra full page reload for the affected tab (vs. an instant fix) — accepted since it's automatic and one-time per tab session, not a recurring cost.
- If the underlying cause is ever something *other* than 3D-transform compositing, this mechanism does nothing and correctly falls through to the manual retry button instead of masking the real issue or looping.

**References:** CLAUDE.md is not yet updated with this section (predates the fix); `.ai/CURRENT.md` § "Blank map on first load in Safari"; `static/index.html`, `static/js/map-init.js`'s `checkMapPaintedOrOfferRetry()`.

---

## 2026-07-30 — rikgale/ICAOList as its own bottom-tier source, not folded into Flywme

**Problem:** `aircraft_database.py`'s hand-curated `TYPE_CODE_TABLE` covers only ~150 common types, and `registration.py`/`icao24_allocation.py`/`callsign.py` each have real, if small, coverage gaps (e.g. Taiwan has no ICAO24 block in the official Annex 10 table `icao24_allocation.py` uses, since Taiwan isn't an ICAO member state). [rikgale/ICAOList](https://github.com/rikgale/ICAOList) is a community-maintained dataset covering all four of these lookups far more broadly (2764 type designators, 219 reg prefixes, 185 hex ranges, 1890 airline codes not already in `callsign.py`'s own ~5700-entry table) — but it's less vetted than this project's existing curated/generated tables (ALL-CAPS source data, includes obscure homebuilt aircraft and military flight units alongside real carriers, no LICENSE file in the source repo).

**Decision:** Vendored as 4 generated JSON files (`enrichment/data/icaolist_*.json`, same one-off-script convention as `opensky_year_built.json`), wired into `enrich_identity()` as a **bottom-tier fallback** for each of the four existing tables — consulted only when the tier above already came up empty. Unlike every other local-lookup technique (`registration_prefix`/`icao24_lookup`/`callsign_decode`/`aircraft_type_db`, all folded into one "Flywme" badge), a field resolved via ICAOList keeps its own distinct `source: "icaolist"`, its own badge color (indigo), and its own dev-mode-only toggle (`#source-icaolist`/`#toggle-icaolist`), mirroring adsbdb.com's row rather than Flywme's always-on black badge.

**Reason:** Explicit product decision (2026-07-30, in response to the user's own request) — this dataset's broader-but-less-vetted coverage should stay visible and independently toggleable, not silently mixed into Flywme's already-trusted local computations. An operator/QA reviewer should be able to tell "this came from ICAOList" apart from "this came from our own curated table" at a glance in dev mode.

**Tradeoffs:**
- Confidence values for every ICAOList tier sit below the equivalent existing-tier constant it backs up (e.g. 0.8 vs. `aircraft_type_db`'s 1.0) — a deliberate signal that this data is less trustworthy, even though the priority chain already guarantees it's never reached when a more curated tier has an answer.
- `icaolist.country_for_registration_prefix()` has to duplicate `registration.py`'s short-military-serial guard rather than import it (a real regression was caught in testing: without the guard, a `"ZM337"`-style military serial's 1-char fallback falsely resolved a country via this table).
- ~30 of the source repo's country names are UK/French/Dutch overseas territories or Crown dependencies with no distinct entry in this project's own `countries.py` (scoped to ICAO member states) — dropped at generation time, not force-mapped to an unrelated parent state; accepted as a "not exhaustive" limitation, same posture `countries.py`'s own docstring already takes for very small territories.
- No LICENSE file in the source repo — used the same way as `airframesio/airline-images` elsewhere in this project: a small attributed extract, bottom-tier fallback only, not a redistribution.

**References:** CLAUDE.md § "ICAOList", `enrichment/icaolist.py`, `enrichment/aircraft_enrichment.py`, `static/js/constants.js`, `static/js/sidebar-track.js`, `static/js/state-filters.js`, `tests/backend/test_icaolist.py`, `tests/frontend/test_icaolist.spec.js`.

---

## 2026-08-05 — Open Glider Network (OGN) as a ninth source, over a persistent APRS-IS connection

**Problem:** User asked to integrate the Open Glider Network (per wiki.glidernet.org/dev-python) as a new data source, exposed the same way as the other eight (config/sources.json + Dev Mode). OGN has no plain HTTP GET API to proxy — its data travels over APRS-IS (`aprs.glidernet.org:14580`), the same protocol amateur radio packet networks use: a persistent TCP connection, logged in with a callsign-shaped (but unregistered — still no signup/API key) identifier, optionally narrowed with a server-side range filter, streaming beacon lines forever. Every other source in this app is request/response with a short TTL cache; this is architecturally different from all of them.

**Decision:** New module `ogn_source.py` owns one background daemon thread holding the persistent APRS-IS connection (via the `ogn-client` PyPI package, the reference client the wiki page documents) and an in-memory "most recent beacon per aircraft address" snapshot; `/api/ogn` just reads that snapshot — no fetch/cache/TTL logic of its own, since there's nothing to rate-limit. The thread is started both from `app.py`'s dev-mode entry point and from `gunicorn.conf.py`'s `post_fork` (unlike the identity-backfill thread, which currently only runs in local dev) — OGN has literally no data at all without it running, unlike identity backfill's nice-to-have enrichment. `set_range()`/`clear()` hook into `_apply_zone()` alongside every other location-scoped source, so an airport-search zone change moves OGN's filter too. On the frontend, OGN is wired exactly like the other eight (`config/sources.json` entry, `sourceToggles`/`markerMapsBySource`, a HUD row gated behind Dev Mode like the rest of that list) but renders as its own **independent, non-deduplicated overlay** — same treatment as FlightAware — since most OGN device addresses are FLARM/OGN-assigned, not real ICAO24 Mode-S addresses, so joining the ICAO24 dedup chain would risk a coincidental collision with an unrelated aircraft elsewhere. OGN's own 4-bit `aircraft_type` taxonomy (glider/tow plane/helicopter/paraglider/UAV/etc.) is mapped to this app's existing `categoryGroup` keys (`OGN_AIRCRAFT_TYPE_GROUP`, state-filters.js) so it reuses the existing marker-icon/category-filter machinery with no new icon assets.

**Reason:** OGN mostly covers gliders, tow planes, paragliders/hang-gliders, and small UAVs — a largely non-overlapping population from the transponder-equipped aircraft every other source here covers, so a genuinely new category of aircraft becomes visible, not just another feed of the same traffic. Ships off by default (`enabled_by_default: false`, same posture as FlightAware/FlightRadar24) since it's new/unproven in this app and, unlike the free HTTP radius sources, holds an open connection for as long as the process runs.

**Tradeoffs:**
- No per-request rate limiting exists for this source the way `cached_radius_source()` gives the HTTP ones — mitigated by there being nothing to rate-limit (no outbound request per poll, just periodic reads of an already-warm in-memory dict).
- Each of the Dockerfile's 2 gunicorn workers opens its own independent APRS-IS connection (2 total) — OGN's public network has no documented per-client limit this would violate, but this wasn't verified against a live upstream deployment beyond local testing.
- A zone change (`set_range()`) reconnects the APRS-IS session rather than sending a live in-band filter update — simpler, and zone changes are a rare, human-triggered event, so the brief reconnect gap is accepted.
- No live-trail recording integration (unlike the ICAO24-keyed sources) — an OGN marker's click-to-select track always falls back to nothing rather than a locally-collected trail, since `recordLiveTrails()` keys positions by `icao24`, which OGN doesn't have. Left as a known gap, not built in this pass.

**References:** `ogn_source.py`, `app.py` (`/api/ogn`, `_apply_zone()`, `_start_ogn_thread()`), `gunicorn.conf.py`, `config/sources.json`, `static/js/constants.js`/`state-filters.js`/`parsers.js`/`main.js`, `static/index.html`, `tests/backend/test_ogn.py`.

---

## 2026-08-05 — OGN connection bugs found via live testing (same day, same feature)

**Problem:** The OGN feature above initially shipped with `/api/ogn` always returning an empty snapshot in real use, despite passing all mocked unit tests. Diagnosed via live testing (no mock could have caught this — it required actually talking to the real APRS-IS server), isolating three independent, stacked bugs:

1. **`AprsClient.connect()`'s `socket_timeout` also governs every later `readline()`, not just the TCP handshake.** The library's 5s default is fine for connecting but far too aggressive as a *read* timeout for a range-filtered regional feed, which (unlike the unfiltered global firehose) can legitimately go quiet for more than 5s between lines. Every connection was actually succeeding — then immediately hit a read timeout on the very next line, misleadingly logged by the library itself as `"Connect error: timed out"`, which looked identical to a real connection failure.
2. **`AprsClient.run()`'s own keepalive send only fires *between* `readline()` calls, never *during* one it's blocked on** — so raising the read timeout to ride out quiet spells didn't help either: an idle connection got silently closed by the network path (`"Read returns zero length string"`, a clean FIN) after ~30s, and the library's keepalive-interval setting couldn't prevent it because the send code path was never reached while blocked on a long read.
3. **The real root cause, found last:** the default APRS-IS login username (`"ADSBPLYGRND"`, 11 characters) exceeded the conventional 9-character APRS callsign length limit. The server accepted the TCP connection and sent its banner, replied `"# Invalid username format"`, then dropped the connection after a delay — but a failed *login* doesn't fail the underlying `connect()` call itself, so every earlier diagnostic test that only checked whether `connect()` raised (never actually reading the server's response) reported success while the real client was silently being rejected the whole time.

**Decision:** Stopped using `AprsClient.run()` for reading entirely — `ogn_source._read_loop()` is a from-scratch ~25-line reimplementation that reads raw bytes via `socket.recv()` directly (not `socket.makefile()`, whose buffered wrapper raises a plain, indistinguishable `OSError("cannot read from timed out object")` on a timed-out read instead of a catchable `TimeoutError`/`socket.timeout` the way a raw socket read does) with a short `IDLE_READ_TIMEOUT` (10s) so the loop regularly regains control to check whether a keepalive is due, sending one manually via `client.sock.send()` at a much shorter interval (`_OGN_KEEPALIVE_SECONDS = 15`, via a custom `settings` namespace overriding the library's default of 240s) — both fixing bug 1 (a routine idle timeout is now correctly treated as non-fatal) and bug 2 (a keepalive genuinely gets sent every ~15s instead of only between blocking reads). `OGN_APRS_USER`'s default was shortened to `"ADSBPLGRD"` (9 characters) for bug 3.

**Reason:** Each fix was necessary but not sufficient on its own — the connection appeared to "work" (no exception, clean logs) at every intermediate stage while still delivering zero data, which is what made this take extensive live-network diagnosis rather than a quick fix. Confirmed working end-to-end: 71–273 live beacons received within seconds of connecting, over a real network path.

**Tradeoffs:**
- `_read_loop()` duplicates a small amount of what `AprsClient.run()` already does (line-buffering, keepalive timing) — accepted, since the library's version cannot be worked around from the outside for either bug it has.
- The idle-connection-drop behavior (bug 2) was observed on one specific network path during development and may be specific to that path's NAT/firewall, not a universal APRS-IS characteristic — the fix (frequent keepalives) is cheap, harmless overhead on a network that didn't need it, so it was kept unconditionally rather than made conditional on detecting the specific network condition.
- No test in `tests/backend/test_ogn.py` exercises `_read_loop()`/`_worker()` directly against a real or mocked socket (they test `_process_line()` and the route in isolation) — the bugs here were all in the connection-management layer *below* `_process_line()`, which is why full mock coverage didn't catch them; live testing remains the only way to verify this layer.

**References:** `ogn_source.py` (`_read_loop()`, `_worker()`, `_ogn_settings`, `OGN_APRS_USER`), the "Open Glider Network (OGN) as a ninth source" decision above.

## 2026-08-06 — Unresolved identity rows hide entirely in normal mode (dev mode unchanged)

**Problem:** `identityRow()` (`static/js/render-details.js`, used for Country/Operator/Operator Country/Registered Owner/Manufacturer/Model/Year built) originally always rendered its row, showing the literal word "Unknown" when nothing resolved — a deliberate 2026-07 decision at the time, since these fields were "meant to always resolve to something meaningful." In practice this meant a sidebar in normal mode could show a wall of "Unknown" rows for an aircraft with sparse enrichment, unlike every other field (`detailRow`), which simply hides when empty.

**Decision:** In normal mode, `identityRow()` now behaves exactly like `detailRow()` — an unresolved field's row is omitted entirely rather than showing "Unknown". Dev mode is explicitly unchanged: every identity row still always renders, with a dash for ground-vehicle fields (which skip heuristic enrichment on purpose) or "Unknown" otherwise, exactly as before. The Operator row's airline-logo special case (a logo can resolve from the callsign even with no operator name) was adjusted to match: in normal mode a logo-only row now renders with just the logo and no synthesized "Unknown" caption, hiding entirely only when neither a name nor a logo resolved; dev mode keeps the old logo+"Unknown" fallback text unchanged.

**Reason:** Explicit user request (2026-08-06) — normal mode should hide fields with no value or an unknown value, consistent with every other field group in the sidebar; dev mode should stay exactly as-is (always show every field, dev-only source badges).

**Tradeoffs:**
- The four identity-row labels' click-to-toggle `.info-tip` tooltips (`IDENTITY_FIELD_EXPLANATIONS`) are no longer reachable in normal mode for an unresolved field, since the row (and its label) no longer renders at all — previously documented as "always visible regardless of dev mode." This is an accepted consequence, not a separate bug: there's no label to attach a tooltip to once the row is gone.
- Several Playwright tests that asserted literal "Unknown" text in normal mode (`test_identity_enrichment.spec.js`, `test_adsbdb.spec.js`, `test_operator_corroboration.spec.js`) were rewritten to assert the row is absent instead, or moved into dev mode where the concept-explanation tooltip test still needs every row to render regardless of resolution state.

**References:** CLAUDE.md § "New Identity rows" / "Registered Owner is a brand new field" / "Airline logos", `static/js/render-details.js`'s `identityRow()`, `tests/frontend/test_identity_enrichment.spec.js`, `tests/frontend/test_adsbdb.spec.js`, `tests/frontend/test_operator_corroboration.spec.js`.
