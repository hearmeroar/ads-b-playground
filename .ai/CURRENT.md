# Current Work

*(Updated after each significant session or task completion)*

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
