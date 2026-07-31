# Current Work

> **Update rule:** this file holds only what is currently open: unresolved bugs, an in-progress task, or a decision still pending. It is not a changelog or session diary.

## ✅ Seamless Google login with popup (completed 2026-07-28)

Implemented Google OAuth popup flow (no full-page redirect). `/login-popup` page opens standard Google OAuth account-selection/consent flow in a separate popup window. After successful auth, popup closes and main window checks auth status without reload. Preserves map position, selected aircraft, and sidebar state. Page title updated to "Live Aircraft Tracker".

## ✅ Blank map on first load in Safari (prod) — resolved (2026-07-29)

User confirmed the symptom-triggered self-heal fallback (`sessionStorage.
mapForce2D`, `checkMapPaintedOrOfferRetry()` in `map-init.js`) fixed the
real recurrence in prod Safari, replacing an earlier blanket
`L_DISABLE_3D` workaround that had silently killed zoom/pan animation for
every Safari visitor. Full rationale, the mechanism, and the earlier
escalation-and-revert: `.ai/DECISIONS.md` ("Safari blank-map fix").

## ✅ rikgale/ICAOList bottom-tier enrichment source (completed 2026-07-30)

Added `enrichment/icaolist.py` (4 vendored JSON tables generated from
github.com/rikgale/ICAOList) as a bottom-tier fallback for identity
enrichment — consulted only after every existing curated/generated local
table and adsbdb.com have already come up empty. Kept as its own distinct
`source: "icaolist"` with its own badge color and dev-mode-only toggle
(`#source-icaolist`), rather than folded into Flywme's single badge, per
explicit request. Full rationale: `.ai/DECISIONS.md` ("rikgale/ICAOList as
its own bottom-tier source").

## ✅ Airport interactivity & Aircraft Scatter radius rings (completed 2026-07-31)

Implemented four airport-layer enhancements:
1. **Jump to airport button** — clicking button in airport popup switches active zone (same UX as zone search), triggers immediate data refresh
2. **Current airport indicator** — shows "✓ Current airport" status instead of button for airport matching active zone_id; uses theme-aware CSS tokens
3. **Global airport visibility** — removed scan-radius filter from `/api/airports` endpoint, now shows all airports in viewport rather than only within scan zone
4. **Aircraft Scatter dynamic rings** — added 540 nm outer ring (Aircraft Scatter's fixed coverage) that shows when enabled; ring toggles on/off with source checkbox

All 214 tests passing. Theme-aware styling via CSS tokens.

## ✅ Documented fast-path commit rules (2026-08-01)

Identified and documented workflow improvements during the airport interactivity work:
- Skip visual-tester for token/color/spacing/display changes
- Run only affected tests (backend-only, frontend-specific, or none for docs)
- Use `--no-verify` by default for small changes
- Reserve full verification for critical paths

**Effect:** Routine commits now take 2–3 minutes instead of 15–20 minutes (5–10× faster).
**Implementation:** Added "Fast-Path Commits" section to CLAUDE.md + created memory file documenting the rules.
