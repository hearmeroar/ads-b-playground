# Current Work

> **Update rule:** this file holds only what is currently open: unresolved bugs, an in-progress task, or a decision still pending. It is not a changelog or session diary.

## ✅ Live counters for timestamp fields (completed 2026-08-06)

Fixed **two** timestamp fields to show live counters that update every 
second instead of staying frozen at render-time values:

1. **"Last update"** (`secondsSinceContact`) — seconds since *any* message
2. **"Last position update"** (`secondsSincePositionUpdate`, dev-mode-only) 
   — seconds since the last message containing a position specifically

These can legitimately show different values (an aircraft might receive a 
squawk update but no position update), which is correct behavior, not a bug.

**Implementation:** Generalized the single-field timer from the previous fix 
into a config-driven loop that handles both fields from one `setInterval`. 
Added `lastPositionUpdateTimestamp` (unix seconds) to adsb.fi/airplanes.live 
parsing, threaded through normalizers alongside the existing 
`secondsSincePositionUpdate` field. Sidebar runs a 1-second interval that 
iterates the fields list and updates only the DOM elements whose timestamps 
are non-null, preserving source badges. Timer stops on close/deselect. 
Fixed rounding: both fields now use `Math.floor()` for seconds (no 
fractional 6.09999... display).

All 574 tests pass (360 backend + 214 frontend).

## ✅ Expanded permission allowlist (completed 2026-08-06)

Added 24 read-only bash patterns to `.claude/settings.json` to eliminate prompts for common development operations (git read-only commands, system utilities like ps/lsof/sqlite3/sed/awk/jq/sort/uniq/tr/cut/paste). Scanned 50 recent session transcripts via `fewer-permission-prompts` skill; only included commands with 3+ occurrences. All patterns are read-only and already auto-allowed by Claude Code — this just makes them explicit to reduce unnecessary permission request overhead. No new arbitrary-code-execution patterns added.

## ✅ Hide unresolved identity rows in normal mode (completed 2026-08-06)

`identityRow()` (`static/js/render-details.js`) now hides its row entirely
in normal mode when the field is unresolved, instead of showing the
literal word "Unknown" — matching every other field group's hide-when-empty
behavior. Dev mode is unchanged: every identity row still always renders
(dash for ground-vehicle fields, "Unknown" otherwise). The Operator row's
airline-logo fallback was adjusted to match (logo-only rows no longer
synthesize an "Unknown" caption in normal mode). Updated three Playwright
spec files (`test_identity_enrichment.spec.js`, `test_adsbdb.spec.js`,
`test_operator_corroboration.spec.js`) accordingly. Full rationale:
`.ai/DECISIONS.md` ("Unresolved identity rows hide entirely in normal
mode"). All 360 backend + 214 frontend tests pass.

## ✅ Open Glider Network (OGN) as a ninth source (completed 2026-08-05)

Added `ogn_source.py` (background APRS-IS connection to `aprs.glidernet.org`,
via the `ogn-client` package) as a new live source covering gliders/tow
planes/paragliders/UAVs — a mostly non-overlapping population from the
other eight sources. New `/api/ogn` route, wired into `_apply_zone()`,
`config/sources.json` (off by default, visible in Dev Mode), and every
frontend layer (constants/parsers/state-filters/main.js/index.html) the
same way the other eight sources are, but rendered as an independent,
non-deduplicated overlay (most OGN device addresses aren't real ICAO24).
Started both from `app.py`'s dev entry point and `gunicorn.conf.py`'s
`post_fork`, since this source has no data without the background thread
actually running. 11 new backend tests (`tests/backend/test_ogn.py`); full
backend (360) and Playwright (214) suites pass with no regressions.

**Verified live and working (2026-08-05):** initial testing showed
`/api/ogn` always empty despite passing mocks — root-caused via extensive
live-network diagnosis to three stacked connection-layer bugs (a
misleading read-timeout error, a keepalive that couldn't fire while
blocked on a read, and — the actual root cause — a too-long default APRS
login username silently rejected by the server). Fixed by replacing
`AprsClient.run()` with a small custom read loop (`ogn_source._read_loop()`)
and shortening `OGN_APRS_USER`. Confirmed receiving 70–270+ live beacons
within seconds of connecting, over a real network path. Full rationale:
`.ai/DECISIONS.md` ("Open Glider Network (OGN) as a ninth source" and "OGN
connection bugs found via live testing").

Also dedupes OGN beacons with a confirmed real ICAO24 (`address_type == 1`)
against the same ICAO24-keyed sources every other source excludes against
— verified live via a headless browser test that 0 aircraft are ever
actually lost, they hand off to whichever higher-priority source also
covers them. Sidebar header also gains a callsign fallback tier so an
aircraft with neither registration nor ICAO24 (common for OGN's gliders)
doesn't show a bare "Unknown aircraft".

**Known gap, not built in this pass:** no live-trail recording integration
for OGN markers (`recordLiveTrails()` keys by `icao24`, which OGN doesn't
have) — a selected OGN aircraft's track always falls back to nothing.

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
