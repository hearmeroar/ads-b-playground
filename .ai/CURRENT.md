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
