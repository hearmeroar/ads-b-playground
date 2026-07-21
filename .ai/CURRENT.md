# Current Work

*(Updated after each significant session or task completion)*

## Status as of 2026-07-21 (Evening)

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

✅ **Feature Complete: Dynamic zones configuration**
- Commit `b2d49fb` — "feat: load zone configuration from config/zones.json"
- `config/zones.json` now defines named coverage zones (default + region presets)
- Backend `/api/zones` endpoint added (no data destructive changes)
- `/api/config` now includes `active_zone_id` and canonical `radius_nm`/`bbox`
- Frontend zone-picker dropdown wired in HUD; UI-only (no persistence yet)
- Backlog item ✅ COMPLETED

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
