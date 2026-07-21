# Current Work

*(Updated after each significant session or task completion)*

## Status as of 2026-07-21 (Night)

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
