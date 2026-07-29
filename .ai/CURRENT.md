# Current Work

> **Update rule:** this file holds only what is currently open: unresolved bugs, an in-progress task, or a decision still pending. It is not a changelog or session diary.

## ✅ Seamless Google login with popup (completed 2026-07-28)

Implemented Google OAuth popup flow (no full-page redirect). `/login-popup` page opens standard Google OAuth account-selection/consent flow in a separate popup window. After successful auth, popup closes and main window checks auth status without reload. Preserves map position, selected aircraft, and sidebar state. Page title updated to "Live Aircraft Tracker".

## Blank map on first load in Safari (prod) — still open, root cause unconfirmed

`invalidateSize()` (commit 648c4cc) did not fix it — user still sees a
fully blank `#map` (no tiles, no markers, HUD/data unaffected) intermittently
in Safari on prod (`adsb.flywme.workers.dev`). Leading Cloudflare-Worker
response-corruption theory was checked and **ruled out** (md5-identical
`leaflet.js` fetched through the worker vs. the Northflank origin directly).
Leading remaining hypothesis: a Safari/WebKit GPU-compositing paint bug that
`invalidateSize()` can't reach (it's a no-op when the cached size already
matches, which it usually does since `#map` is `position:fixed;inset:0`).

Added in an earlier pass: a forced-repaint nudge independent of size checks
(`forceMapRepaint()`, `map-init.js`), `tileerror`/`load` diagnostics per base
layer, and a last-resort visible retry control (`#map-retry`) if no tile
paints within 4s of first load/paint.

**Escalation tried and reverted (2026-07-29)**: a later pass (commit
7f280f6, after everything below in this section) escalated further —
set `window.L_DISABLE_3D = true` for Safari before `leaflet.js` loads,
forcing `L.Browser.any3d = false` to rule out a GPU-compositing paint bug
in Leaflet's 3D-transformed panes. Undocumented side effect found and
confirmed live (Playwright + real WebKit) the same day: `any3d` also
gates `map._zoomAnimated` in Leaflet's own source, so this silently killed
*all* zoom/pan animation in Safari — every scroll-wheel/trackpad zoom
became an instant, un-eased `_resetView` jump, and lost the animated
zoom's natural throttling of overlapping zoom requests (measured: an
identical wheel burst moved 11 zoom levels in Safari with animation
disabled vs. 7, smoothly, in Chromium with it enabled). This is exactly
the "smooth zoom" baseline `map_interaction_requirements` (`.ai/proposals/
map-interactions-minimal-requirements-2026-07-22.md`) already calls
non-negotiable, so the trade was rejected — **reverted** (`static/
index.html`, the `L_DISABLE_3D` script block removed; matching WebKit-only
regression test removed from `test_rendering.spec.js`). This re-opens the
blank-map bug (back to "root cause unconfirmed") and adds a second thing
to verify next time it's touched: confirm in real Safari both that (a) the
blank-map bug's actual trigger (fast repeated reloads) still needs a fix,
and (b) zoom/pan are smooth again post-revert. If GPU-compositing is
revisited as a hypothesis, don't reach for the blanket `any3d` switch
again without a plan for the zoom-animation side effect this time.

**Current approach, replacing the reverted escalation (2026-07-29)**: instead
of a blanket UA-based `L_DISABLE_3D` guess paid by every Safari visitor, the
fallback is now **symptom-triggered and tab-scoped**. `index.html`'s inline
script (right before `leaflet.js`) only sets `window.L_DISABLE_3D` when
`sessionStorage.mapForce2D === '1'` — nothing sets that flag until
`checkMapPaintedOrOfferRetry()` (`map-init.js`) has actually observed *this
tab* fail to paint a single tile within the existing 4s grace period. The
first time that happens on a Safari tab, it sets `mapForce2D` +
`mapForce2DAttempted` in sessionStorage and calls `location.reload()` once —
a real reload is required since `L.Browser.any3d` is a Leaflet-module
constant computed once at parse time, not something togglable on an
already-running map. If tiles *still* don't paint after that one retry
(`mapForce2DAttempted` already set), it falls through to the existing manual
`#map-retry` banner instead of reloading again, so a non-compositor cause
(e.g. a genuine network outage) can't loop forever. Net effect: a tab that
never hits the bug keeps full 3D transforms and zoom/pan animation forever;
a tab that does hit it self-heals within ~4s with no user action, at the
cost of one extra reload, instead of either losing animation pre-emptively
or being stuck on a blank map with only a manual button. Verified locally
via Playwright+WebKit with all tile requests forced to fail (simulates the
symptom regardless of its real cause): one reload, `any3d` false afterward,
no second reload loop, manual retry banner still reachable as a last resort.
**Still not verified against the real bug** — this is a mechanism, not a
confirmed fix, since the actual root cause (why Safari's compositor
supposedly leaves the panes blank) has never been reproduced in *any*
Safari, real or automated (55 prior attempts against real prod all failed to
repro). If a real Safari recurrence happens again, check whether
`sessionStorage.mapForce2D` ends up set and whether the map actually
recovers — that's the confirmation this fix still needs.

**New lead, follow-up session**: user reports this reproduces "especially
with fast repeated reloads in Safari." Tried to repro via Playwright+WebKit
against the real prod URL (fresh contexts, then rapid same-tab
`page.reload()` loops) — never got a genuinely blank map or the retry
control to appear across ~55 attempts; one reload did surface a page-level
"Fetch API cannot load ... due to access control checks" error across
several `/api/*` calls simultaneously (a known WebKit quirk: a fetch
aborted by navigation is sometimes reported as a CORS failure instead of
AbortError), but the app's own `fetchJson`-wrapping try/catch in
`fetchOpenSkyStates()`/`fetchRadiusSourceAircraft()`/etc. already swallows
this into `null` per-source, and the app fully recovered by the next poll
— doesn't look like the cause of a *permanent* blank state on its own.

Best remaining theory, grounded in this app's own prior history: Safari
restores fast repeated reloads from its **back-forward cache (bfcache)**
rather than a full load — this codebase already hit exactly this Safari
behavior once before, for the favicon (`index.html`'s `pageshow` listener,
added because `'load'` never fires again on a bfcache restore). Added a
matching `pageshow`/`event.persisted` listener in `map-init.js` that reruns
`invalidateSize()`/`forceMapRepaint()`/the retry check on a bfcache
restore — the one code path that previously had zero coverage (only
`window.load` and `poll()`'s `onFirstPaint` existed before). Could not be
proven end-to-end via headless WebKit (navigating to a non-HTML resource to
force a back-nav didn't reliably trigger a real bfcache restore in the test
harness — `pageshow` fired but no `event.persisted` confirmation was
captured), so this is still **unconfirmed**, not a verified fix. Needs a
real Safari recurrence to know for sure: check Web Inspector for whether
`[map-diag]` lines appear right after a fast reload and whether the map
recovers on its own now.
