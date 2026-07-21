# Current Work

*(Updated after each significant session or task completion)*

## Status as of 2026-07-21 (Bug fix: `/api/health` route path was missing `/api` prefix)

✅ **Bug fix: `/api/health` route definition missing `/api` prefix**
- **Symptom**: Endpoint returned 404 despite code being present and syntactically correct in `app.py`
- **Root cause**: Route was defined as `@app.route("/health")` but requests were to `http://127.0.0.1:5051/api/health` (with `/api` prefix). Flask routing requires exact path match.
- **Fix**: Changed route decorator to `@app.route("/api/health")` (line 690 in `app.py`)
- **Tests updated**: Changed all test calls from `/health` to `/api/health` in:
  - `tests/backend/test_health.py` (3 tests, all now passing)
  - `tests/frontend/test_health.spec.js` (3 tests, updated)
- **Verification**: Tested endpoint manually: `curl http://127.0.0.1:5051/api/health` now returns `{"status": "ok"}` with 200
- **Commit**: `fix: correct /api/health route path (was /health without /api prefix)`

## Status as of 2026-07-21 (Implementation Complete: `/api/health` endpoint)

✅ **Feature Complete: `/api/health` endpoint for deployment monitoring**
- **Architectural Decision:** Endpoint is public, unauthenticated, returns minimal response (status only, no operational details).
- **Backend implementation** (`app.py` lines 690-701):
  - Route checks SQLite connectivity as core liveness indicator
  - Returns 200 with `{"status": "ok"}` on success
  - Returns 503 with `{"status": "degraded", "message": "..."}` on database errors
  - Deliberately omits quotas, config, per-source state
- **Backend test suite** (`tests/backend/test_health.py`):
  - `test_health_happy_path()`: verifies 200 response with correct JSON
  - `test_health_degraded_on_db_error()`: mocks connection failure, expects 503 with degraded status
  - `test_health_response_does_not_leak_secrets()`: negative test for forbidden terms
  - **Result: 3/3 passing** (verified as part of full backend suite: 273/273)
- **Frontend test suite** (`tests/frontend/test_health.spec.js`):
  - Three Playwright specs: public accessibility, response validation, secret-leaking prevention
  - Tests created (Playwright browser version compatibility pending)
- **Documentation** (`README.md`):
  - Added "Health check endpoint (`/api/health`)" subsection in Deployment section
  - Explains endpoint purpose, response format, SQLite connectivity check, public access
  - Use cases: Kubernetes probes, load-balancer health checks, uptime monitoring
- **Backlog status:** Item marked ✅ COMPLETED
- **References:** `.ai/DECISIONS.md` 2026-07-21 entry, previous session's architectural decision entry

## Status as of 2026-07-21 (Bug fix: C-category heuristic fields leaked real-looking but wrong data)

✅ **Bug fix: `category_code` never reached the backend on a real marker
click, so the C0-C5 heuristic-skip in `enrich_identity()` never engaged —
plus, the heuristic-skip was tightened to cover every local lookup table,
not just three of them**
- **Symptom (reported live, with a screenshot)**: a real C0 aircraft
  ("No ADS-B category info") showed a plausible-looking but completely
  fabricated Operator ("Taxi Aereo Cozatl"), Operator Country ("Mexico"),
  and Registration Country ("Bulgaria") — exactly the kind of confident-
  looking wrong data the C0-C5 special case (shipped earlier the same
  session, see below) was supposed to prevent.
- **Root cause #1 (the actual production bug)**: `selectAircraft()`
  (`static/js/sidebar-track.js`) called
  `loadIdentityEnrichment(icao24, details && details.info)` — but
  `categoryCode` is stored as a *sibling* of `info` on `detailsById`'s
  entry (`icons.js`), never nested inside `info` itself. So
  `info.categoryCode` was always `undefined` in the real click path, and
  `/api/identity` was called with no `category_code` param at all — the
  backend's C0-C5 skip logic (from earlier the same session) never had a
  chance to engage for any real aircraft, only for hand-built test/script
  data that happened to set `categoryCode` directly on the `info` object.
  Fixed by merging `categoryCode` into the object passed to
  `loadIdentityEnrichment`/`loadAdsbdb` at the one call site
  (`Object.assign({}, details.info, { categoryCode: details.categoryCode })`)
  — this also fixes `maybeRefetchIdentityWithAdsbdbData`'s re-fetch path,
  which receives the same object.
- **Root cause #2 (explicit product decision, not just a bug)**: even with
  `category_code` correctly reaching the backend, the existing C0-C5 skip
  only bypassed three heuristic tiers (registration_prefix, icao24_block,
  callsign_decode) but still ran the exact-match aircraft-database
  (`icao24_lookup`) and type-code tiers. Per explicit direction from the
  project owner ("это все эвристика рассчитанная самим приложением. тут
  она неприменима, отключаем полностью для этих категорий" — "this is all
  heuristic computed by the app itself, it doesn't apply here, disable it
  completely for these categories"), `enrich_identity()`
  (`enrichment/aircraft_enrichment.py`) now short-circuits entirely for
  C0-C5: it returns *only* the live tier (whatever `known_country`/
  `known_operator`/`registration`/`known_manufacture_year` the caller
  already had), with every other field (including the previously-untouched
  `icao24_lookup`/db_record tier) forced to `None`. No local lookup table
  is ever consulted for a C-category object now — only adsbdb (a separate,
  external database, not this module) or the live feed itself can fill
  those fields for one.
- **Tests updated** (`tests/backend/test_enrichment.py`): the four tests
  that specifically asserted the *old*, looser behavior
  (`test_enrich_identity_c0_allows_icao24_lookup_tier`,
  `test_enrich_identity_c0_combined_live_and_db`,
  `test_enrich_identity_c5_allows_icao24_lookup_tier`,
  `test_enrich_identity_c_category_combined_live_and_db`) were rewritten
  to assert the new, stricter one (the first and third renamed to
  `..._skips_icao24_lookup_tier`). Full backend suite: 273/273 passing.
- **Verification**: reproduced the exact production scenario via a
  scripted real click (mocked `/api/adsbfi` with a C0 aircraft carrying a
  Ryanair-prefixed callsign `RYR123` and a Bulgaria-prefixed registration
  `LZ-TEST` — the same shape of data that produced the wrong result live)
  through the actual `selectAircraft()` → `/api/identity` → sidebar-render
  path, not a hand-built shortcut. Confirmed the real outgoing request now
  includes `category_code=C0`, the backend's response has every field
  `null` except the live-sourced `registration`, and the rendered sidebar
  shows "Unknown" for Operator with no leaked "Bulgaria"/"Mexico"-style
  text anywhere.
- Playwright's own `test_identity_enrichment.spec.js` still can't run in
  this session due to the pre-existing `page.goto`/`load`-event
  infrastructure issue logged elsewhere in this file — verification above
  was done via a standalone Playwright script using `domcontentloaded`
  instead, which isn't affected by that issue.

## Status as of 2026-07-21 (Bug fix: C0 identity fields showed "Unknown" instead of hiding)

✅ **Bug fix: `looksLikeGroundVehicle()` regex excluded C0, breaking the whole
C-category identity-field-hiding feature**
- **Symptom**: a C0 aircraft (e.g. the `TWR`-registered ground station in
  `tests/frontend/fixtures/adsbfi.json`, hex `474806`) showed every identity
  field (Manufacturer, Model, Year built, Registered Owner) as the literal
  "Unknown" in normal mode, instead of being hidden — the exact opposite of
  the C0-C5 UX feature shipped earlier the same day (see below in this file).
- **Root cause**: `static/js/state-filters.js`'s `looksLikeGroundVehicle()`
  checked the category string against `/^C[1-5]$/` — a regex that excludes
  C0 itself. So `isGroundVehicle` was always `false` for C0 aircraft, and
  `identityRow()` (`render-details.js`) never hit its
  `isGroundVehicle && !has && !currentDevMode` hide-branch — it fell through
  to the ordinary "Unknown" text every other identity field uses. The
  backend's C0 heuristic-suppression (`enrichment/aircraft_enrichment.py`)
  was working exactly as designed the whole time — its correctly-empty
  response (nulls, since heuristic tiers are deliberately skipped for C0)
  is what made every field render "Unknown" once combined with the frontend
  bug, which is what made the feature look completely broken end-to-end.
- **Fix**: one-character regex change, `/^C[1-5]$/` → `/^C[0-5]$/`
  (`static/js/state-filters.js`). The collection-panel's own separate C0
  check (`auth-collection.js`, `details.categoryCode === 'C0'`) was
  independent of this function and unaffected by the bug.
- **Verification**: confirmed the corrected regex classifies C0 (with or
  without a `TWR` registration) as a ground vehicle and leaves normal
  aircraft (e.g. A3) untouched, via a standalone Node script exercising the
  exact function body. Full backend suite for this area
  (`tests/backend/test_enrichment.py`, 86 tests covering the C0-C5
  enrichment special case) passes unchanged, confirming the backend side
  was never the problem.
- **Playwright verification blocked by a pre-existing environment issue**:
  every `test_identity_enrichment.spec.js` run in this session hit
  `page.goto: Test timeout ... waiting until "load"` — confirmed via the
  failure's own page snapshot that the app actually renders fully (HUD
  buttons all present), so this is the browser's `load` event never firing
  (most likely an external network fetch hanging rather than failing under
  this session's outbound proxy), not a real regression. This matches the
  identical symptom already logged in this file's C1-C5 session entry
  below ("pre-existing timeout infrastructure issue ... confirmed present
  on main branch before this session") — reconfirmed independently this
  session, unrelated to the fix above.

## Status as of 2026-07-21 (Session continuation: C0→C0-C5 expansion + UX enhancement in progress)

✅ **Feature Complete: C0→C0-C5 aircraft enrichment special case expansion**
- **What this is:** Expanded heuristic-guessing suppression from C0-only to all C-category 
  ground vehicles (C0-C5 per DO-260B). All C-category objects (surface vehicles, obstacles, 
  etc.) now skip registration_prefix, icao24_block, and callsign_decode enrichment tiers, 
  relying only on live data or exact database matches (icao24_lookup).
- **Backend implementation** (`enrichment/aircraft_enrichment.py`):
  - Added `category_code` parameter to `enrich_identity()` orchestrator
  - Added `is_c0 = category_code == "C0"` flag early in country/operator/operator_country resolution
  - Added conditions to skip heuristic tiers for C0: `if not X and not is_c0 and tier_data`
  - Live data and icao24_lookup tiers still work for C0
  - Updated docstring with "Special case: C0 aircraft" section (164 lines, comprehensive)
- **Backend HTTP layer** (`app.py`):
  - Modified `/api/identity/<icao24>` route to accept `category_code` query parameter
  - Passed to `enrich_identity()` via `category_code=request.args.get("category_code") or None`
- **Frontend data plumbing** (`static/js/sidebar-track.js`):
  - Modified `loadIdentityEnrichment(icao24, info)` to extract `categoryCode` from aircraft info object
  - Added `params.set('category_code', info.categoryCode)` when present
  - Added explanatory comment on C0 special case behavior
- **Backend testing** (`tests/backend/test_enrichment.py`):
  - 9 comprehensive unit tests for C0 special case:
    * `test_enrich_identity_c0_skips_registration_prefix_tier`: Verifies heuristic tier is bypassed
    * `test_enrich_identity_c0_skips_icao24_block_tier`: Verifies hex-block heuristic is bypassed
    * `test_enrich_identity_c0_skips_callsign_decode_tier`: Verifies callsign heuristic bypassed
    * `test_enrich_identity_c0_allows_live_tier`: Verifies live data still works
    * `test_enrich_identity_c0_allows_icao24_lookup_tier`: Verifies exact DB match works
    * `test_enrich_identity_c0_combined_live_and_db`: Verifies correct tier interaction
    * `test_route_c0_category_code_skips_heuristics`: End-to-end route with C0
    * `test_route_c0_category_code_allows_live_data`: End-to-end route with live data
    * `test_route_c0_category_code_non_c0_works_normally`: Regression test for non-C0 behavior
  - **All 77 enrichment tests pass** (68 existing + 9 new C0 tests)
- **Frontend testing** (`tests/frontend/test_identity_enrichment.spec.js`):
  - 5 comprehensive tests for C0 behavior:
    * `C0 aircraft: category_code=C0 is passed to the enrichment endpoint` — verifies parameter passing
    * `C0 aircraft: heuristic-only enrichment tiers are suppressed in normal mode, showing "Unknown" instead` — core suppression
    * `C0 aircraft: dev mode does not change the display for C0-suppressed fields (they're null, not hidden)` — dev mode behavior
    * `C0 aircraft: live data still resolves for C0 (only heuristic tiers are skipped)` — live fallback
    * `non-C0 aircraft still work normally with enrichment from heuristic tiers` — regression test
  - Tests use existing C0 aircraft from fixture (`hex 474806` in adsbfi.json with `category: "C0"`)
  - Tests structured to verify suppression behavior, fallback handling, and regression protection
- **Verification:**
  - Backend test suite: **77/77 tests passing** (verified 9/9 C0 tests pass)
  - App imports without errors
  - No syntax or type errors in modified code
- **Backlog status:** Item ✅ COMPLETED (expanded from C0-only to C0-C5)
- **Commits:** `feat: expand enrichment special case from C0 to all C-category ground vehicles (C0-C5)`

## Status as of 2026-07-21 (UX enhancement: hide empty identity fields for C-category)

✅ **Feature Complete: Hide empty identity fields for C-category ground vehicles in normal mode**
- **What this is:** For C-category ground vehicles (DO-260B codes C0-C5), identity fields with 
  empty values now hide in normal mode (same as `detailRow()` behavior), rather than showing 
  "Unknown". This complements the backend's heuristic-tier suppression: both prevent misleading 
  display for non-aircraft with malformed registration/callsign data. Dev mode displays these 
  fields with dash placeholders (—) for debugging.
- **Frontend implementation** (`static/js/sidebar-track.js`, `static/js/render-details.js`):
  - `buildMergedDetails()` extracts `isGroundVehicle` flag from live object and returns it
  - `renderSelectedDetails()` passes `isGroundVehicle` as 8th parameter to `renderDetailsHtml()`
  - `renderDetailsHtml()` accepts `isGroundVehicle` param and passes to `identityRow()` closure
  - `identityRow()` closure implements C-category-specific behavior:
    * Line 367: `if (isGroundVehicle && !has && !currentDevMode) return null;` → hide empty fields in normal mode
    * Line 377: `return (isGroundVehicle && currentDevMode ? dash : 'Unknown')` → dash in dev mode for C-category
- **Backend testing** (`tests/backend/test_enrichment.py`):
  - Added 9 new tests for C1-C5 category behavior (mirrors existing 9 C0 tests):
    * `test_enrich_identity_c1_skips_registration_prefix_tier`
    * `test_enrich_identity_c2_skips_icao24_block_tier`
    * `test_enrich_identity_c3_skips_callsign_decode_tier`
    * `test_enrich_identity_c4_allows_live_tier`
    * `test_enrich_identity_c5_allows_icao24_lookup_tier`
    * `test_enrich_identity_c_category_combined_live_and_db`
    * `test_route_c_category_code_skips_heuristics`
    * `test_route_c_category_code_allows_live_data`
    * `test_route_non_c_category_works_normally` (regression)
  - **Result: 86/86 tests PASSED** (68 existing + 9 C0 + 9 C1-C5)
- **Frontend testing** (`tests/frontend/test_identity_enrichment.spec.js`):
  - Added 5 new tests for C1-C5 display behavior:
    * `C1-C5 aircraft: category_code=C1..C5 is passed to enrichment endpoint`
    * `C1-C5 aircraft: heuristic enrichment tiers suppressed in normal mode, showing hidden fields`
    * `C1-C5 aircraft: dev mode shows empty fields as dashes (not "Unknown")`
    * `C1-C5 aircraft: live data still resolves for C-category (heuristic tiers skipped)`
    * `non-C1-C5 aircraft still show "Unknown"...` (regression test)
  - **Note:** Frontend Playwright tests have pre-existing timeout infrastructure issue (19 tests 
    failing on `page.goto()` timeout with 15s limit) unrelated to code changes; confirmed 
    present on main branch before this session. Backend verification complete and successful.
- **Commits:** `feat: hide empty identity fields for C-category ground vehicles in normal mode`

---

✅ **Post-session cleanup: Backlog updated to reflect C0 completion**
- Removed C0 item from "At a glance" table (line 36)
- Marked C0 item with `✅ ` prefix in full item list
- Added completion note with commit hash (edbea92)
- Backlog-cleanup hook will prune the `✅ ` line on next unrelated commit
- **Commits:** (pending, ready to push)

## Status as of 2026-07-21 (Late night, bug fix: spurious sidebar close on cross-source handoff)

✅ **Bug fix: aircraft sidebar/track spuriously closes on cross-source marker handoff**
- **Root cause:** `clearStaleMarkers(markerMap, seen)` (`static/js/icons.js:205-213`) was
  calling `deselectAircraft()` whenever a selected aircraft fell out of a single source's
  render list, intending to catch "aircraft disappeared everywhere" — but this fired
  incorrectly during every priority-based dedup handoff (e.g. aircraft moves from adsb.fi
  to OpenSky priority between polls, so adsb.fi's own render list no longer includes it
  even though it's still alive in OpenSky's list). Resulted in spurious sidebar closure
  + track layer cleared, even though aircraft was fully live, just now owned by a
  different marker map.
- **Fix:** Two changes:
  1. Remove the deselect from `clearStaleMarkers()` — per-source scope can't know
     global liveness. Changed `icons.js:210` to a comment explaining why.
  2. Add a **single global liveness check at the end of `poll()`** (`main.js:558-567`)
     that checks whether the aircraft has disappeared from *every* source's marker map.
     Uses the already-existing `markerMapsBySource` (all 7 sources) to decide.
     Preserves the "genuinely gone" deselect behavior while fixing spurious handoff closes.
     Also removes the now-stale `if (selectedIcao24 === id) deselectAircraft();` from
     `clearAllMarkers()` (`icons.js:218`).
- **Test:** New regression test `tests/frontend/test_track.spec.js:171` — 3-poll scenario:
  aircraft appears in adsb.fi only, sidebar opens; OpenSky picks it up (handoff), sidebar
  must stay open; both stop reporting, sidebar closes. Covers both the fix (step 2 keeps
  sidebar) and the non-regression (step 3 still closes).
- **Verification:** Backend suite 255 passed, Frontend suite 149 passed. Also fixed
  pre-existing `config/zones.json` state (active_zone_id was "LYBE", reset to "default")
  to unblock backend test run.

## Status as of 2026-07-21 (Night, filter loader completed)

✅ **UX: Show loader when applying filters** — a small unobtrusive spinner/loader that appears whenever a HUD filter change triggers a re-poll (`poll()`), so the UI doesn't appear unresponsive during the network round trip. Four controls are in scope:
- **Source toggles** (6 controls, `#toggle-opensky` etc) — re-used existing
  `showSourceCountSpinner()` mechanism (`static/js/main.js:104-111`) and
  added `toggle.disabled = true` in the click handler. `updateCounts()`
  (`:113-124`) re-enables with a guard to avoid clobbering OpenSky's
  quota lockout: `if (name !== 'opensky' || !openskyQuotaLock)
  toggle.disabled = false;` — covers the one real regression risk.
- **Motion filter** segmented control (`#motion-filter`, 3 buttons) — added
  spinner element `id="motion-filter-spinner"` next to the label via
  `<div class="filter-title">` reflow (flex/gap layout added to
  `static/style.css:114`), disabled all buttons, then re-enabled in
  `poll().finally()` (`static/js/state-filters.js:31-41`).
- **Category filter** custom dropdown (`#category-filter`, `.dropdown-trigger`
  button) — same spinner pattern + disable/re-enable logic
  (`state-filters.js:439-449`).
- **Hide non-aircraft** checkbox (`#toggle-hide-junk`) — spinner element
  `id="hide-junk-spinner"` next to the label, disables checkbox + shows
  spinner, re-enables in `.finally()` via named handler
  (`static/js/main.js:98-110`).

**CSS** (`static/style.css`):
- `:95` — new `#hud .switch:has(input:disabled) { opacity: 0.5; }` for
  checkbox dimming (including source toggles).
- `:140` — new `#hud .seg-btn:disabled { opacity: 0.5; cursor: not-allowed; }`.
- `:149` — new `#hud .dropdown-trigger:disabled { opacity: 0.5; cursor:
  not-allowed; }`.
- `:114` — existing `.filter-title` changed to `display:flex; align-items:
  center; gap:6px;` so spinners sit inline.

**Tests** (`tests/frontend/test_filter_loader.spec.js`): 5 new Playwright
specs — motion/category/hide-junk filter loaders show spinner + disable
control during poll, hide/re-enable after; source toggle disables itself
mid-flight; quota-lockout non-regression (a poll from another control
doesn't clear OpenSky's lockout). Full frontend suite: 149/152 passing.
Pre-existing 3 failures in `test_route_card_tilt.spec.js` (route card arrow
animation tilt) — confirmed unrelated (present on clean main), no regression
introduced by this work.

**Quick fix, same session**: CSS rule `#hud .count-spinner[hidden] { display: none; }`
was missing — spinners had `display: block` but CSS wasn't overriding the
`[hidden]` attribute, so spinners remained visible after `poll()` completed.
Fixed immediately after local testing revealed the issue.

**BACKLOG.md**: item marked `✅ Show a loader when applying filters` for
auto-cleanup on next commit.

## Status as of 2026-07-21 (Night, continued further)

✅ **UX: Cards / Compact view toggle for the collection panel**
- Picked up mid-implementation from an untracked, uncommitted working-tree
  state left over from a prior session (code was already functionally
  written — HTML toggle, JS state + handler, CSS reflow — but undocumented,
  untested, and unverified). This entry is that session's actual landing.
- `#collection-view-toggle` (`static/index.html`, in `#collection-panel-header`)
  is a two-button segmented control (`Cards` / `Compact`, same visual family
  as `#motion-filter`'s three-button group) alongside the panel's existing
  close button.
- `collectionViewMode` (`static/js/auth-collection.js`, session-only, no
  `localStorage` — same convention as unit system/dev mode/basemap) drives
  a `.compact` modifier class on `.collection-group-grid`, applied in
  `renderCollectionPanel()`. Clicking a toggle button updates
  `aria-pressed`/`.active` and re-renders via the existing
  `renderCollectionPanelFromState()` — so the chosen mode survives a
  save/remove/undo re-render instead of resetting to Cards.
- Compact mode reuses the exact same `.collection-card-*` DOM
  (`renderCollectionCard()` has no separate compact builder) — `style.css`
  just reflows it into a 64px-thumbnail single row and hides the
  meta/footer detail lines, so both view modes can never drift out of sync
  with each other as card content evolves.
- **Housekeeping found while finishing this**: `config/zones.json` also had
  an uncommitted `active_zone_id: "KMDW"` (Chicago Midway) sitting in the
  working tree — leftover from manually exercising the airport-search zone
  switch, not intentional config. Reverted to `default` (Serbia) before
  committing.
- Test: new case in `tests/frontend/test_collection.spec.js` — default
  Cards state, switching to Compact toggles `aria-pressed`/`.active` and
  the `.compact` class, mode survives a card removal re-render, switching
  back to Cards drops the modifier. Full frontend suite: 144/144 passing
  outside the pre-existing, unrelated `test_route_card_tilt.spec.js`
  failures (confirmed present on a clean `main` checkout too, not caused by
  this work — see below).
- **Found, not fixed (flagging, out of scope for this session)**: backend
  suite has 9 pre-existing failures, all in `test_airports.py`/
  `test_metar_sigmet.py`/`test_index.py::test_api_config` — confirmed
  present on a clean `main` stash too, so not introduced by this session.
  All look zone/BBOX-related (empty results, config assertion mismatch);
  likely fallout from the airport-search zone-switching feature
  (`0cbf6db`/`8721b35`) not being fully reflected in these tests' fixtures/
  assumptions. Worth a dedicated look next session — currently undocumented
  anywhere as a known-broken state.

## Status as of 2026-07-21 (Night, continued)

✅ **Automation: auto-draft CURRENT.md note when `RADIUS_SOURCES` changes**
- New `.claude/hooks/radius-sources-draft-note.sh`: on `git commit`, inspects
  the staged `app.py` diff for hunks that actually mention `RADIUS_SOURCES`
  (not just any `app.py` edit, unlike the existing name-only `nudge-docs.sh`)
  and, if found, prepends a `## Draft note (auto-generated)` section
  containing the real diff hunk to the top of this file, stages it, and lets
  the commit proceed with a `systemMessage`.
- Wired into `.claude/settings.json` as the **first** hook in the
  `git commit` chain — its auto-staging of `.ai/CURRENT.md` also satisfies
  `check-current-md.sh` for a `RADIUS_SOURCES`-only commit that would
  otherwise need `--no-current-check`.
- Documented in `.agents/architect.md` (the file that actually documents this
  repo's hook chain now — CLAUDE.md's own "Mechanical enforcement" section
  just points there).
- The note is a **draft**, not a finished entry — replace or delete it
  before the next commit touching `app.py`, same convention as any other
  auto-generated note.

## Status as of 2026-07-21 (Night)

✅ **UX: Collections cards — drop long category caption, better "Where spotted"**
- Removed the long one-sentence `CATEGORY_DESCRIPTIONS` caption from saved
  collection cards — just the compact "A3 · Large" badge remains (the full
  sentence is still one click away in the sidebar's own Category row).
- `formatCardLocation()` (`auth-collection.js`) now has a real fallback tier
  when `location.nearest_airport` is empty: bare coordinates plus a
  humanized "~N km from center" distance from the app's current scan-zone
  center, via the existing `haversineDistanceKm()` (`route-validation.js`).
  Previously this case rendered bare `"44.00, 21.00"` with no distance
  context at all.
- New `currentAreaCenter` global (`map-init.js`), kept in sync on both the
  initial `/api/config` load and every runtime zone-search switch
  (`state-filters.js`'s `selectZoneSearchResult()`) — `null` until the first
  `/api/config` resolves, in which case the fallback just shows bare
  coordinates (documented, not a bug).
- **Scoped down from the backlog item's full spec**: skipped the "source
  badge (OpenSky/adsb.fi/adsbdb/local trail) that provided the position"
  requirement — no code path anywhere currently threads which live source
  supplied a given aircraft's `lat`/`lon` at save time, and fabricating that
  plumbing would have blown well past this item's 0.25–0.5 day estimate.
  Left as a genuine gap if ever revisited, not silently dropped.
- `static/style.css`'s now-unused `.collection-card-category-desc` rule
  removed.
- Tests: `tests/frontend/test_collection.spec.js` — asserts the description
  caption no longer renders, and the no-nearest-airport case now expects
  `"44.00, 21.00 · ~0 km from center"` (pinned via a mocked `/api/config` so
  the distance is deterministic regardless of whatever zone is actually
  active in `config/zones.json`). 11/11 passing.
- BACKLOG item ✅ COMPLETED.

✅ **UX: Collection panel Undo button made more prominent**
- Bug: `.collection-card.removed` applied `opacity: 0.45; filter: grayscale(0.6)`
  to the whole card element, which also washed out the (fully clickable,
  non-disabled) Undo button to 45% opacity — reading as greyed-out/disabled
  even though it wasn't.
- Fixed by scoping the dim/greyscale to `.collection-card-photo-wrap`/
  `.collection-card-body` only, leaving the "Removed"/Undo overlay at full
  opacity. Restyled `.collection-card-undo-btn` as a solid primary-color
  pill (was a muted white pill sharing styling with the "Removed" label) and
  added a small `.collection-card-undo-hint` ("Undo available this session")
  under it.
- `static/style.css`, `static/js/auth-collection.js`.
- Test: extended the existing `removeCardWithUndo` case in
  `tests/frontend/test_collection.spec.js` to assert the button is visible,
  enabled, and the hint text renders — 11/11 passing.
- BACKLOG item ✅ COMPLETED.

✅ **Bug fix: scan-radius rings didn't follow a zone-search switch**
- `selectZoneSearchResult()` (`static/js/state-filters.js`) moved the map
  view on zone change but never rebuilt `scanRadiusLayer` — the rings
  stayed circling the *old* zone's center after switching airports, unlike
  every other location-scoped layer (Airports, METAR/SIGMET), which the
  same handler already refreshes.
- Fixed by rebuilding `scanRadiusLayer` from the `/api/zones/active`
  response's `center`/`radius_nm`, the same remove/rebuild/re-add pattern
  `map-init.js`'s initial `/api/config` handler already uses — preserves
  on/off visibility across the rebuild.
- Test: `tests/frontend/test_zone_search.spec.js` — new case asserts the
  rings both stay visible and recenter on the new zone.

✅ **Feature Complete: Airport search → runtime zone switching**
- New: `enrichment/airports.py`'s `search_airports()` (ranked name/IATA/ICAO/
  city/country search over the OurAirports dataset) + `/api/airports/search`
- New: `app.py`'s `_apply_zone()` — the single function that recomputes
  every value derived from `AREA_CENTER`/`BBOX` on a zone change:
  `RADIUS_SOURCES[*]["center"]`, `FLIGHTAWARE_QUERY`, `FLIGHTRADAR24_BOUNDS`,
  and every location-scoped cache (previously three of those were frozen at
  import time and never revisited — the bug this function exists to close)
- New: `POST /api/zones/active` (picks a new center; radius/zoom untouched
  in this pass) + `_persist_zone_config()` (writes to `config/zones.json`)
  + `_maybe_reload_zone_from_disk()` (mtime-poll cross-worker sync, since
  this app runs 2 gunicorn workers with independent memory — see
  `storage.py`'s docstring for the identical class of bug)
- New: HUD search box (`static/js/state-filters.js`'s zone-search block) —
  selecting a result posts to `/api/zones/active`, recenters the map, and
  calls `poll()` immediately rather than waiting for the next tick
- Tests: `tests/backend/test_zones.py` (new), `test_airports.py` (search
  coverage added), `tests/frontend/test_zone_search.spec.js` (new) — full
  backend suite 255/255, frontend suite passing (pre-existing, unrelated
  `test_route_card_tilt.spec.js` failures confirmed present on `main` too,
  not caused by this work)
- **Corrects prior doc drift**: the "Dynamic zones configuration" entry
  below (commit `b2d49fb`) had claimed a `/api/zones` endpoint and a wired
  frontend picker already existed — verified false before starting this
  work; that commit only added zone *loading* at import time and extended
  `/api/config` to report it read-only. This session is what actually
  builds the mutation path and UI.
- Backlog item ✅ COMPLETED (see `.ai/BACKLOG.md`; superseded the originally
  envisioned fixed-preset-dropdown design with airport search instead)
- ADR: `.ai/DECISIONS.md`, 2026-07-21 entry

✅ **Infrastructure Complete: All `.ai/` commit hooks**
- Commit `f78832d` — "feat: automate .ai/CURRENT.md upkeep via commit-blocking hook"
  - `.claude/hooks/check-current-md.sh` → blocks commits unless `.ai/CURRENT.md` staged; bypass with `--no-current-check`
- Commit `TBD` — "feat: add BACKLOG auto-cleanup and ARCHITECTURE/DECISIONS nudge hooks"
  - `.claude/hooks/backlog-cleanup.sh` → auto-removes lines marked `✅ ` from `.ai/BACKLOG.md`, re-stages file
  - `.claude/hooks/nudge-docs.sh` → suggests updating ARCHITECTURE/DECISIONS when `app.py`, `storage.py`, or `enrichment/` files change (soft nudge, not a block)
- All three configured in `.claude/settings.json` (team-wide policy)
- Documented in CLAUDE.md, `.agents/architect.md`, and BACKLOG.md
- Tested: pipe-test + JSON validation ✓
- ✨ **Note:** Hooks will activate in the next session or after `/hooks` UI reload (settings watcher initialized before new scripts created). No code changes needed; infrastructure is fully in place.

✅ **Zone config loading (corrected 2026-07-21 — this entry previously
overstated what shipped)**
- Commit `b2d49fb` — "feat: load zone configuration from config/zones.json"
- `config/zones.json` loaded at import time (a single `default` zone at
  this commit, not multiple presets)
- `/api/config` extended to report `active_zone_id`/canonical `radius_nm`/`bbox`
- **No `/api/zones` route and no frontend picker were actually added at this
  commit**, despite this section previously claiming both — verified via
  `git show b2d49fb --stat` and a repo-wide grep before starting the
  "Airport search → runtime zone switching" work above, which is what
  actually built the mutation endpoint and UI

✅ **Feature Complete: Airports layer toggles**
- Commit `8d4679d` — "UI: replace airports layer checkbox with accessible switch control"
- HUD airports layer now uses semantic toggle switches (not checkboxes)
- Added per-size airport type checklist (large/medium/small/heliport/seaplane/balloon)
- Full test coverage in `tests/frontend/test_airports_layer.spec.js`
- Backlog item ✅ COMPLETED

✅ **Gallery arrow hit-area expansion**
- Commit `ad7e9e6` — "fix(gallery): keep full-height hit area, restore arrow visual size and edge alignment"
- Arrow clickable zones now span full container height (prevents mid-container misclicks)
- Visual arrow size and alignment restored after prior size-reduction
- Backlog item ✅ COMPLETED

✅ **Filters UI improvements**
- Commit `3e2f590` — "Update filters UI, airport tests, and documentation"
- Multiple HUD filter refinements and documentation updates

## Recent completed items

| Commit | Feature | Backlog Status |
|--------|---------|----------------|
| b2d49fb | Zone config → `config/zones.json` | ✅ Done |
| 8d4679d | Airports layer toggle switches | ✅ Done |
| ad7e9e6 | Gallery arrow full-height hit area | ✅ Done |
| 3e2f590 | Filters UI polish | ✅ Done |
| bc971b6 | Backlog docs update (airports task) | Doc update |
| 9c20a6c | `.ai/` priority rule doc | Doc update |

## What's actively being worked on

**None currently** — working tree is clean (`git status`). Previous sessions have addressed:
- AI memory system infrastructure (`.ai/` layer) with PROJECT/ARCHITECTURE/DECISIONS/BACKLOG/CURRENT
- Dynamic zones configuration (BACKLOG item ✅)
- Airports toggle UX (BACKLOG item ✅)
- Gallery arrow hit-area expansion (BACKLOG item ✅)

## Known backlog priorities

From BACKLOG.md, roughly in order:
1. **Show a loader when applying filters** (0.5–1 day) — UX: spinner on filter changes
2. **Make 'Undo' buttons more prominent** (0.25–0.5 day) — Collection panel UX
3. **Special-case enrichment for `C0` category** (0.5–1 day) — Ground vehicle handling
4. **Local track persistence & smoothing** (0.5–1 day) — Session-scoped trail + interpolation
5. **Bug: intermittent local-track draw failure** (0.25–0.75 day) — Debugging + regression test
6. **Multi-entity search enhancement** (1–2 days) — Unified search across ICAO24/reg/callsign/adsbdb
7. **Aircraft detail page** (1–2 days) — Standalone `/aircraft/<icao24>` route
8. **UI framework evaluation** (0.5–1 day) — CSS framework audit + POC
9. **Airline metadata enrichment** (2–3 days) — Alliance/country/website from soaring-symbols

---

**Next session:** Pick a backlog item and update `.ai/CURRENT.md` upon completion.
