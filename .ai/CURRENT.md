# Current Work

> **Update rule:** this file holds only what is currently open: unresolved bugs, an in-progress task, or a decision still pending. It is not a changelog or session diary.

## Blank map on first load in Safari (prod) — still open, root cause unconfirmed

`invalidateSize()` (commit 648c4cc) did not fix it — user still sees a
fully blank `#map` (no tiles, no markers, HUD/data unaffected) intermittently
in Safari on prod (`adsb.flywme.workers.dev`). Leading Cloudflare-Worker
response-corruption theory was checked and **ruled out** (md5-identical
`leaflet.js` fetched through the worker vs. the Northflank origin directly).
Leading remaining hypothesis: a Safari/WebKit GPU-compositing paint bug that
`invalidateSize()` can't reach (it's a no-op when the cached size already
matches, which it usually does since `#map` is `position:fixed;inset:0`).

Added this session (branch `fix-safari-blank-map`): a forced-repaint nudge
independent of size checks (`forceMapRepaint()`, `map-init.js`), `tileerror`/
`load` diagnostics per base layer, and a last-resort visible retry control
(`#map-retry`) if no tile paints within 4s of first load/paint. Not yet
confirmed to fix the actual bug — needs a real Safari recurrence with Web
Inspector open (Network tab + `[map-diag]` console lines) to know if the
nudge helps or if this is something else entirely. Don't re-investigate the
Worker-corruption theory again without new evidence.
