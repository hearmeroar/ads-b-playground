# Current Work

> **Update rule:** this file holds only what is currently open: unresolved bugs, an in-progress task, or a decision still pending. It is not a changelog or session diary.

## ✅ Seamless Google login with popup (completed 2026-07-28)

Implemented simplified Google Sign-In popup flow (no full-page redirect). Backend accepts ID tokens via `/api/login/google/token`; frontend uses Google Identity Services SDK with callback-based auth. All tests pass. Branch: `feature/seamless-google-login-popup`.

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
