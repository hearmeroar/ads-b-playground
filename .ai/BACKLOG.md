# Backlog

> **Priority note:** BACKLOG.md, PROJECT.md, ARCHITECTURE.md, and DECISIONS.md are the authoritative sources of truth for this project. Code comments are hints only and must be ignored if they conflict with these documents.

Ideas and features not yet scheduled. Grouped loosely by theme.


Goal: make the app's geographic "view zone" easy to change and switch at runtime.

Motivation: currently the coverage area (AREA_CENTER, AREA_RADIUS_NM, BBOX)
is defined and duplicated across multiple places in the codebase (`app.py`,
frontend constants, radius-source center fields). Changing it is error-prone.

Proposal / Acceptance criteria:
	lists named zones. Each zone may be defined as:
	- center: {lat, lon} + radius_nm
	- bbox: {lamin, lomin, lamax, lomax}
	- airport: IATA/ICAO code (resolved server-side to coordinates) + radius_nm
	with the active zone id and list of presets.
	selecting a zone updates map view and re-queries radius sources with the
	new parameters without touching hardcoded constants.
	AREA_CENTER/AREA_RADIUS_NM and serves as the fallback.

Implementation notes / next steps:
1. Add `config/zones.json` with a `default` example + two region presets.
2. Update `app.py` to load zones and add `/api/zones` (no destructive changes).
3. Make `/api/config` include `active_zone_id` and a canonical `radius_nm`/`bbox`.
4. Adjust frontend `map-init.js` and `state-filters.js` to fetch `/api/zones`
	 and wire a simple dropdown. Start with UI only (no persistence), then add
	 session persistence or per-user preference later.
5. Add tests: backend unit test for `/api/zones`, frontend test for dropdown.

Risks / Notes:
- This is a medium touch across both backend and frontend; start backend first
	to expose a stable API the frontend can adopt incrementally.
- Airport resolution (IATA/ICAO → lat/lon) can reuse existing `enrichment/airports.py`.

Estimate: 2–4 dev days (backend + frontend + tests) depending on polishing.


Goal: surface additional airline metadata (alliance, country, website) in the
sidebar and collection views whenever available, sourcing from the existing
`soaring-symbols` assets and falling back to a validated alternate source if
more authoritative data exists.

Motivation: `static/airline-logos/` already vendors logo assets and a manifest
(`airline-logos/manifest.json`) built from soaring-symbols and other tiers; the
upstream `soaring-symbols` project also exposes structured metadata (alliance,
country, website) that should be shown in the UI where applicable for better
identity/attribution.

Acceptance criteria:
- Add `alliance`, `country`, and `website` fields to the airline/logo manifest
  schema and `schema/aircraft.schema.json` where appropriate (new `operator`
  subfields or a small `airline` schema referenced by `operator`).
- Backend serves the enriched manifest via a stable static file or `/api/logos`
  endpoint; frontend displays `alliance`/`country`/`website` in the sidebar when
  the selected aircraft's operator has a matched manifest entry.
- Implement a validation step and decision log: compare coverage/accuracy and
  licensing of soaring-symbols vs alternatives, choose the preferred source,
  and record the decision in `.ai/DECISIONS.md`.

Candidate alternative unified sources to evaluate:
- Wikidata (broad coverage, structured, includes country, official website,
  and often alliance via properties) — strong candidate; CC0/ODbL compatibility
  depends on how data is used (check attribution requirements).
- OpenFlights `airlines.dat` (good IATA/ICAO mapping but sparse on alliance/website).
- AirHex / AirLabs / commercial APIs (paid, often more consistent but require key/licence).
- FlightAware/FR24 internal manifests (not public/clear licence) — lower priority.

Validation checklist:
1. Coverage: fraction of airlines in our manifest resolved by candidate source.
2. Accuracy: spot-check 50 common carriers across regions for correct country/site/alliance.
3. Freshness: how often source updates and ability to re-sync.
4. Licensing: permissible to redistribute/serve assets or derived metadata.
5. Technical access: ease of bulk download or API access for offline bundling.

Implementation plan (phased):
1. Add schema fields and update `airline-logos/manifest.json` format to include
	new fields (backwards compatible). Commit as a schema-only change.
2. Prototype: fetch `soaring-symbols` metadata for the existing manifest entries
	and produce a backend-side merged `airline_manifest_enriched.json` (script).
3. Evaluate candidates: run the validation checklist vs Wikidata and OpenFlights;
	record results in `.ai/DECISIONS.md` and pick preferred source.
4. Wire frontend to show the new fields when present (tooltip or extra row).
5. Tests: backend unit test for manifest endpoint; frontend Playwright test that
	checks sidebar shows `website` link and `alliance` badge for a known airline.

Estimate: 2–3 dev days for schema + prototype + validation; extra time if an
automated sync pipeline is required for the chosen source.

 Find and integrate a UI component / CSS framework

 Goal: evaluate and adopt a lightweight, accessible UI component or CSS
 framework that fits the project's no-build, static-asset constraints, to
 standardize component styling, reduce ad-hoc CSS, and speed future UI work.

 Motivation: the codebase has accumulated many small, bespoke UI styles and a
 light framework would provide consistent utilities (spacing, grids, buttons),
 accessible components (modals, tooltips), and theming tokens without forcing
 a full frontend build step.

 Acceptance criteria:
 - Candidate list with pros/cons (size, license, accessibility, no-build path).
 - Pick one framework that can be integrated by adding static CSS/JS files
	 (CDN or vendored assets) without a build step, and demonstrate a small
	 proof-of-concept in `static/index.html` (e.g. upgrade a button + HUD pill).
 - Ensure chosen solution is permissively licensed for redistribution (MIT,
	 Apache-2.0, or similarly permissive) or document any constraints in
	 `.ai/DECISIONS.md`.
 - Add a short migration checklist: replace color/spacing tokens, update
	 `static/style.css` to reuse tokens where appropriate, and mark components to
	 migrate (buttons, badges, dropdowns, modals, forms).

 Candidate frameworks to evaluate (no-build-friendly):
 - Bulma (pure CSS, MIT) — good grid/utility set, no JS required.
 - Bootstrap (CSS + optional JS, MIT) — comprehensive components, larger size.
 - Spectre.css / Milligram / Picnic CSS (small, pure CSS) — lightweight choices.
 - Shoelace (Web Components, MIT) — ready-made components, works without build
	 where web components are acceptable; polyfills for older browsers.
 - Tailwind CSS (utility-first) — excellent, but ideal usage requires a build
	 step; CDN usage possible with caveats (larger payload, runtime classes).
 - Primer CSS (GitHub's CSS, MIT) — solid tokens and components, also no-build.
 - edbnme/ui (https://github.com/edbnme/ui) — candidate to evaluate for
	 lightweight components and CSS utilities; check license, bundle size,
	 component coverage, and whether it fits the project's no-build static
	 asset constraint.

 Implementation notes:
 1. Run a light evaluation: pick 2–3 candidates (Bulma, Bootstrap, Shoelace)
		and implement a tiny POC replacing one HUD element (e.g., `#hud .source-row`
		toggle or sidebar save button) to see integration friction.
 2. Prefer a pure-CSS solution (Bulma/Spectre) if avoiding JS polyfills; choose
		Shoelace if web-component-based API fits the project's direction and browser
		support is acceptable.
 3. Document the decision and migration checklist in `.ai/DECISIONS.md`.

 Estimate: 0.5–1 developer day for evaluation + POC; migration effort depends on
 scope and can be broken into smaller PRs.
- Show a loader when applying filters (frontend UX)

Goal: surface an unobtrusive, fast-loading spinner/loader whenever the user
applies or toggles filters that trigger a re-poll or re-render (e.g. hide/show
ground vehicles, category filters, source toggles), so the UI clearly indicates
that the map and HUD are updating.

Motivation: some filters trigger networked fetches or expensive sync work and
the current UI can look static/unchanged during that time, leading users to
click repeatedly or be uncertain whether the filter applied.

Acceptance criteria:
- A small loader/spinner appears next to the HUD filter controls (or inside
	the source-count slots) immediately when a filter change is made and remains
	visible until the poll/render completes.
- The loader does not block interaction with unrelated controls, but disables
	the specific control being applied to avoid duplicate requests.
- No regressions: existing spinner used for source-counts remains compatible
	and the new loader is consistent with the project's visual style.

Implementation notes:
1. Reuse the existing `.count-spinner` CSS and JS wiring where possible; add a
	 generic `showFilterLoader(key)` / `hideFilterLoader(key)` API that maps a
	 named control to its spinner element.
2. On filter change handlers, call `showFilterLoader(filterKey)` before
	 triggering the fetch, and `hideFilterLoader(filterKey)` in `poll().finally()`
	 or after render completion for that specific control.
3. For filters that trigger no-network-only client-side work, ensure the
	 loader is shown for the duration of the UI update cycle (microtask) to
	 provide a consistent UX.

Tests:
- Add a Playwright spec that toggles a filter and asserts the loader becomes
	visible and then disappears when the HUD updates.

Estimate: 0.5–1 developer day (mostly frontend wiring + one E2E test).

- Make 'Undo' buttons in Collection more prominent (UX)

Goal: when a user removes a saved collection card, the in-UI undo affordance
should be highly visible and actionable (not a disabled control), reducing
friction for accidental deletes.

Motivation: current UX dims the removed card and shows an undo button that is
easy to miss or appears disabled; users may not notice the ability to undo or
are uncertain whether the action succeeded.

Acceptance criteria:
- The removed card is visually dimmed but retains a clearly visible, contrasty
  Undo button (primary-style, not disabled) and an inline "Removed · Undo"
  affordance that stands out from the muted card background.
- Clicking Undo restores the card immediately and removes the ghost state.
- If the user navigates away or refreshes, the action is final (the "undo"
  state is session-scoped), consistent with current behaviour, but the UI must
  make this clear (small hint text: "Undo available this session").

Implementation notes:
1. Update `static/style.css` with a `.collection-card-undo` primary variant
	(color, padding, pointer cursor) and ensure `[hidden]` rules don't hide it.
2. Change `auth-collection.js`'s `removeCardWithUndo()` to add a visible undo
	button (not `disabled`) and start a short timer to visually expire the undo
	affordance if desired; keep the existing backend `DELETE` behaviour (it is
	already immediate). The undo handler should re-POST the saved snapshot.
3. Add a Playwright test that removes a card, asserts the Undo button is visible
	(not disabled), clicks it, and verifies the card reappears.

Estimate: 0.25–0.5 dev days (CSS + small JS change + E2E test).

- Special-case enrichment rules for `C0` (surface/ground) category

Goal: avoid inferring identity fields (country, operator, registration-derived
country) from heuristics for items tagged `C0` (ground vehicles, obstacles,
surface markers). These records often have non-standard codes and should not
contribute noisy enrichment results.

Motivation: adsb/ground objects frequently carry malformed registration/label
codes. Current enrichment tiers (registration prefix, icao24 block, callsign
decoding, adsbdb) can produce misleading country/operator values for such
items. For `C0` we should preferentially trust explicit live-source values
and avoid filling fields from heuristic tiers unless the live source already
provided them.

Acceptance criteria:
- When an aircraft/item has category `C0`, `enrich_identity()` must not fill
	`country`, `operator`, or `registration_country` from heuristic tiers
	(registration-prefix, icao24_block, callsign decoding) unless the live
	source itself supplied the value (i.e. `resolved.source === 'live'`).
- AdsBdb results may still be considered, but only if adsbdb explicitly
	returns those fields; otherwise adsbdb-derived guesses are suppressed for
	`C0` items.
- Dev mode still shows suppressed values and the reason ("suppressed due to
	C0 category — needs corroboration") for debugging.

Implementation notes:
1. Backend: update `enrichment/aircraft_enrichment.py`'s `enrich_identity()` to
	 accept a `category_code` param and short-circuit heuristic tiers when
	 `category_code === 'C0'`. AdsBdb tier remains allowed only for explicit
	 returned fields (not guessed). Add unit tests covering example C0 records.
2. Frontend: `buildMergedDetails()` should continue to show dev-mode badges
	 for suppressed fields and the tooltip text explaining suppression.
3. Tests: backend tests for `enrich_identity()` with a `C0` fixture; frontend
	 dev-mode test asserts suppressed value tooltip appears.

Estimate: 0.5–1 developer day (backend change + unit tests + minor frontend dev-mode message).

- Gallery arrow hit-zone: make arrow click area full container height

Goal: expand the clickable/touch target for the gallery's previous/next
arrow controls so they occupy the full vertical height of the gallery
container. This reduces misclicks when users tap near the image top/bottom
edge on mobile or small screens.

Acceptance criteria:
- Clicking/tapping anywhere vertically within the gallery container on the
  left/right edge triggers the previous/next action respectively.
- No visible layout changes besides the arrows remaining visually centered.
- Playwright/E2E test covers top/middle/bottom click positions inside the
  container for both arrows and asserts slide changes.

Implementation notes:
1. CSS: set `.gallery-nav`/`.gallery-prev`/`.gallery-next` to `height: 100%`
	and use `display:flex; align-items:center; justify-content:center;` so the
	visual arrow stays centered while the hit area spans the container.
2. Ensure the nav elements are placed above the image (z-index) without
	blocking any required pointer events on other controls (dots, credits).
3. JS: no change expected to gallery logic; event handlers already attached to
	the arrow buttons. If handlers rely on click-target sizing, adapt to
	prevent race conditions with drag gestures.
4. Tests: add `tests/frontend/test_photo.spec.js` checks for clicks near the
	top and bottom of the left/right halves of the gallery container.

Estimate: 0.25–0.5 dev days (CSS tweak + one E2E test).

- Map update frequency and track smoothing (polling & interpolation)

Goal: reduce jitter and improve perceived smoothness of moving aircraft on the
map while keeping network usage and rate-limit safety acceptable. Provide a
configurable polling cadence per-source and optional client-side track
interpolation/smoothing for rendering.

Motivation: raw poll intervals (10s/12s) and discrete OpenSky track points can
produce visibly jerky map movement, especially at lower poll rates or for
fast-moving aircraft. A combination of smarter polling and lightweight
interpolation yields smoother visuals without extra backend load.

Acceptance criteria:
- Configurable per-source poll intervals exposed from the backend (`/api/config`
	includes `poll_intervals` per source) and adjustable via env or `zones`/config.
- On the frontend, a new smoothing layer optionally interpolates positions
	between received waypoints so markers animate smoothly while remaining
	anchored to real data (no hallucinated long-term tracks).
- Default behaviour unchanged: if smoothing is off, existing discrete updates
	remain. Smoothing is opt-in in the HUD (toggle) and off by default.
- No additional network calls are made for smoothing; it uses the existing
	poll/cached data only. Polling frequency respects upstream rate limits
	(OpenSky tokens/quota) and backend-exposed `min_interval` hints.
- Tests: unit test for per-source poll interval config; Playwright test that
	toggles smoothing on and asserts marker movement appears continuous across
	successive poll intervals (visual smoke test), and that toggling it off
	returns to discrete jumps.

Implementation notes:
1. Backend: include `poll_intervals` in `/api/config` (read from existing
	 source `min_interval` settings or explicit env config). Document limits to
	 avoid user-configured intervals that violate upstream quotas.
2. Frontend: implement a `smoothing` module in `static/js/` that provides
	 `interpolatePositions(waypoints, now)` → position and `animateMarker()` that
	 runs per-frame via `requestAnimationFrame` while target data updates arrive.
	 Keep an option to cap interpolation time window (e.g. 2× poll interval) to
	 avoid visually drifting from reality when upstream data is stale.
3. Consider a hybrid adaptive polling mode: when a selected aircraft is open
	 in the sidebar, poll its `/api/track/<icao24>` more frequently (respecting
	 track quota TTL) while leaving general map polling at a lower cadence.
4. Add `SMOOTHING_ENABLED` feature flag defaults to `false` (opt-in) and a
	 HUD toggle `#toggle-smoothing` wired in `state-filters.js` along with the
	 other filters. Persist in sessionStorage only.

Estimate: 1–3 dev days (backend config + frontend interpolation + tests).
## Aircraft metadata

- **Aircraft serial number (MSN)** — Add aircraft manufacturer serial number field. No verified source yet (adsbdb has `msn` field for some aircraft; needs validation against real data). Research required before prioritizing. (See personal memory for fuller context.)

## Data sources & enrichment

- **Adaptive polling intervals** — Currently fixed 10s/12s for all sources. Could reduce traffic/quota by polling only enabled sources, or reduce frequency for sources known to update slowly (METAR/SIGMET at 300s vs. aircraft at 10s). Aeris project (`kewonit/aeris`) has a reference implementation for similar idea. Worth reviewing if quota ever becomes tight.

- **Additional weather layers** — RainViewer (precipitation) is implemented. Candidate additions: wind (Windy.com-style), clouds, temperature. None are free/no-signup yet; would need researching.

- **Historical track interpolation** — Currently shows discrete waypoints from OpenSky `/api/track`. Could smooth/interpolate between points for a less-jerky playback. Nice-to-have, lower priority.

## Prediction & forecasting

- **Route prediction based on vector** — Extrapolate aircraft's future position/trajectory from current velocity vector (heading + speed). Use cases: (1) predict convergence/collision risk between aircraft, (2) anticipate which airports lie on the aircraft's natural path, (3) validate adsbdb routes more precisely by comparing predicted vs. claimed destination. Requires integrating haversine-based forward projection into the route-validation geometry chain. Layer 3 validation, lower priority than current Layer 2 (geometric-consistency check). Would reuse `destinationPoint()` helper from route-validation.js.

## UI/UX

- **Seamless login without page reload** — Currently, clicking "Sign in with Google" does `window.location.href = '/api/login/google'` (full-page navigation to OAuth callback). After successful login, page reloads. Improve UX by: (1) opening Google consent in a popup/modal instead of full navigation, (2) handling OAuth callback in-session (via `postMessage` or polling `/api/me`), (3) updating auth status live without hard reload. Keeps selected aircraft/sidebar/map state intact. Requires rearchitecting Authlib callback flow. Nice-to-have, moderate complexity.

- **Collection panel bulk operations** — Currently can save/unsave one aircraft at a time. Backlog idea: bulk export (JSON), bulk delete, filtering within collection. No firm priority.

Collections: remove category description from card; improve "where spotted"

Goal: simplify the per-card snapshot shown in the Collections panel by removing the opaque category description and replacing it with a clear, actionable "Where spotted" area that tells the user exactly where and when the airframe was seen in this session or when the snapshot was taken.

Motivation: the current category description on saved cards (e.g. "A3 — Large (...)") is redundant and not the most useful snippet for a saved aircraft. Users asked for clearer location/context: nearest airport, distance, coordinates and time of the observed position — information that helps recall why the aircraft was saved.

Acceptance criteria:
 - The saved card UI no longer displays the long category description string. Instead, it shows a concise category badge (e.g. "A3 · Large") with no long parenthetical weight range.
 - Each card shows a `Where spotted` line with the best-available capture context in this precedence order:
	 1. `nearest_airport` (name + IATA/ICAO) + distance in km (when `location.nearest_airport` is available in the snapshot), e.g. "Near Belgrade Nikola Tesla (BEG) · ~12 km";
	 2. Else: coordinates as `lat, lon` plus a humanized distance from the project's `AREA_CENTER` (e.g. "44.7866, 20.4489 · 12 km from center"); include the observed `ts`/`saved_at` timestamp formatted in local time if present.
	 3. Also show the data source that provided the observed position (OpenSky / adsb.fi / adsbdb / local trail) as a small badge.
 - Backend `POST /api/collection` continues to accept `location` as before, but the server must ensure the stored snapshot contains `location.nearest_airport` when valid (resolve server-side on save if `lat`/`lon` provided). If nearest airport cannot be resolved, store `location:{lat,lon}` only.
 - Existing saved cards without `nearest_airport` self-heal in the UI: when the Collections panel opens, client-side logic derives and displays the best fallback (coordinates + distance) if `nearest_airport` is missing; no data loss.

Implementation notes / next steps:
1. Backend: modify `api_collection_save()` (`app.py`) to call `enrichment/airports.nearest_airport(lat, lon)` on save when `lat`/`lon` are present and augment the persisted `location` field with `nearest_airport` (name, iata, icao, distance_km). Keep `location` nullable when coordinates are absent.
2. Frontend: update `auth-collection.js`'s `renderCollectionCard()` so it no longer prints the full `categoryDisplay` parenthetical text; instead render a compact badge plus a `Where spotted` row assembled from `card.location.nearest_airport` or `card.location.lat/lon` + `card.saved_at` and a small source badge.
3. Ensure `SNAPSHOT_FIELDS`/`storage.save_collection()` allow `location.nearest_airport` through; when saving from the sidebar, include `lat`/`lon` (the sidebar already has them) so the backend can resolve the airport server-side rather than trusting client computation.
4. Backfill: no mandatory migration — a saved card without `nearest_airport` displays fallback coordinates; optionally add a one-off background migration script later to enrich existing rows if desired.
5. Tests: add backend unit test for `POST /api/collection` that supplies `lat`/`lon` and asserts `location.nearest_airport` is stored; add Playwright test verifying the Collections panel card shows the new `Where spotted` text for a saved card with `nearest_airport`, and falls back to coordinates when absent.

Estimate: 0.25–0.5 dev days (backend augmentation + small frontend render change + tests).


- **Dark mode** — Basemap picker already supports dark styles (CARTO Dark, Esri Dark), but sidebar/HUD don't adapt. CSS `prefers-color-scheme` media query support would help. Low priority.

- **Sidebar search/filter** — Once collection grows large, searching within saved aircraft by callsign/type/operator would help. Not urgent for current use case.

## DevOps / deployment

- **Health check endpoint** — `/api/health` returning status of all seven data sources + database. Useful for monitoring deployments. Blocked on: deciding whether to make this admin-only or public.

- **Metrics export** — Prometheus-compatible `/metrics` endpoint for poll latency, cache hit rates, source availability. Would help debug why a particular fetch was slow. Infrastructure concern, not app-core.

## Testing

- **Load testing** — Current test suite is all unit/integration. No load test against the full stack (8+ concurrent users polling simultaneously, testing gunicorn capacity). Relevant only if traffic ever grows beyond single-user hobby project.

- **Live network tests (optional, CI-gated)** — Current backend tests mock all HTTP. Optional separate suite that hits real OpenSky/adsb.fi (read-only, no write) to catch upstream API changes. Would need Playwright setup similar to frontend tests. Low ROI unless upstreams start breaking often.

## Documentation

- **Contributor guide** — CLAUDE.md is comprehensive but dense. A shorter "getting started for contributors" could help. Blocked on: whether this project will ever have contributors.

---

*(Items not yet researched or prioritized are not listed. See DECISIONS.md for completed architectural choices, not backlog.*

--

Local track persistence & smoothing (frontend)

Problem: the browser-side local track (the small live trail collected from map
polls when an aircraft has no OpenSky historical `/track`) is not reliably
remembered when the same aircraft is re-selected during the same browser
session. Additionally, the rendered local track is visually jagged — we need
to both persist it for the session and provide a lightweight smoothing
interpolation so the marker animation appears continuous.

Acceptance criteria:
- When a selected aircraft has no OpenSky historical track, the frontend
	collects its recent positions (from polls) into a per-session cache
	(`sessionStorage` or in-memory `Map` keyed by `icao24`) and re-uses it on
	subsequent selections within the same browser session.
- The saved local track must survive sidebar close/open and map panning but
	reset on full page reload (session-scoped persistence only).
- Add a HUD toggle `#toggle-smoothing` (off by default) that enables client-
	side interpolation between waypoints (uses `requestAnimationFrame` and
	interpolates position + heading). When smoothing is off the existing
	discrete updates remain unchanged.
- Existing behaviour is preserved for OpenSky `/api/track` results (server
	tracks still take precedence); smoothing only affects locally-collected
	fallback trails and real-time marker movement rendering, not persisted
	server-side tracks.

Implementation notes:
1. Frontend: add `localTrailCache` (`Map<icao24, Array<{lat,lon,ts}>>`) kept in
	 module scope and mirrored into `sessionStorage` on change (serialization
	 capped e.g. latest 200 points to avoid unbounded growth). `selectAircraft()`
	 should check `localTrailCache` when no server `track` is available and draw
	 it into the `trackLayerGroup` as a polyline colored per altitude like the
	 server track.
2. Smoothing module: implement `smoothing.interpolate(waypoints, t)` and
	 `smoothing.animateMarker(marker, waypoints)` that runs until new waypoints
	 arrive or selection changes. Keep max interpolation window (e.g. 2× poll
	 interval) so markers don't drift far from reality if upstream stalls.
3. HUD toggle wiring: small toggle in `state-filters.js` persisted to
	 `sessionStorage['smoothingEnabled']`; UI text tooltip explaining tradeoffs
	 (smoother visuals vs. potential small latency in following exact polled
	 position). Off by default.
4. Tests: add a Playwright smoke test that (a) selects an aircraft without a
	 server track, (b) simulates multiple poll positions arriving, (c) closes
	 the sidebar and re-opens it, asserting the same trail is redrawn, and (d)
	 toggles smoothing on and verifies marker movement looks continuous (basic
	 frame-sampling assertion rather than pixel-perfect). Backend unit tests
	 not required for this change.

Estimate: 0.5–1 dev days (frontend work + one Playwright smoke test).

Bug: локальный трек иногда не рисуется (intermittent local-track draw failure)

Симптомы:
- Иногда при выборе самолёта исторический трек не рисуется даже если в сессии
	были собраны локальные точки (live trail) — ничего в `trackLayerGroup` не
	появляется, либо виден только пустой контейнер без линий.

Шаги воспроизведения (приближённо):
1. Открой страницу с несколькими самолётами в зоне (стандартный fixture).
2. Выберите самолёт, у которого `/api/track/<icao24>` возвращает 404 (нет
	 серверного трека). Наблюдайте, как фронтенд собирает локальную историю из
	 опросов (polls) в память во время нескольких итераций опроса.
3. Закройте сайдбар и снова откройте тот же самолёт.
4. Иногда трек не рисуется — поведение нестабильно, воспроизводится не всегда.

Ожидаемое поведение:
- Локальный трек (последние N точек из poll) всегда рисуется при открытии
	сайдбара для самолёта, если серверный `/api/track` отсутствует.

Критерии приёма / минимальный фикс:
- Исправить причину пропуска отрисовки и добавить регрессионный тест
	(Playwright): симулировать последовательные poll-обновления, закрыть/открыть
	сайдбар и убедиться, что трек отрисован.
- При невозможности восстановить полную причину — добавить защитный
	fallback: если `trackLayerGroup` пуст и `localTrailCache[icao24]` не пуст,
	форсированно построить polyline из кеша и логировать причину в консоль.

Возможные причины (предварительная диагностика):
- Гонка по состояниям: `localTrailCache` обновляется асинхронно и
	`selectAircraft()` вызывается до того, как кеш сериализовался/популярен.
- Капы/тримы: кеш обрезается/очищается при закрытии сайдбара из-за гонки
	lifecycle handlers (debounce/clear). 
- Редкая ошибка рендеринга Leaflet: polyline создаётся но сразу очищается
	другим кодом (clear/re-sync) в той же итерации event loop.

Отладочные шаги / быстрый план фикса:
1. Добавить подробные временные логи (dev-mode) в `selectAircraft()` и в
	 код, который читает `localTrailCache` при отрисовке трека; логировать
	 количество точек и источник (local vs server).
2. В `selectAircraft()` добавить синхронную проверку: если server track
	 отсутствует и `localTrailCache[icao24]` есть — немедленно нарисовать
	 полилинию как fallback (atomic path) перед любыми `clearStaleMarkers`/
	 `syncMarkers()` вызовами, чтобы избежать гонок.
3. Написать Playwright-спек: мокать `/api/track/<icao24>` → 404, мокать
	 последовательные `/api/states` ответы с точками, затем закрыть/открыть
	 сайдбар и assert на наличие `trackLayerGroup.getLayers().length > 0`.

Оценка: 0.25–0.75 dev days (логирование + форсированный fallback + E2E тест).

--

Улучшение поиска: поиск по нескольким сущностям

Проблема: текущий поиск в интерфейсе ограничен одним типом сущности за раз
(например: только по `registration` или только по `callsign`), что затрудняет
быстрый поиск при неполных данных (нет регистрации, есть только callsign,
или найдено по adsbdb только в одном источнике). Нужно научить поиск
одновременному поиску по нескольким полям/сущностям и аккуратно сортировать
результаты по релевантности.

Критерии приёма:
- UI: единый поисковый ввод в HUD/sidebar, который выполняет одновременно
  поиски по `icao24`, `registration`, `callsign`, `operator`, `flight_id` и
  по идентификатору adsbdb; показывает сгруппированные результаты по
  типу (Aircraft, Registration, Flight, AdsBDB) с подсчётом и иконкой
  источника.
- Релевантность: результаты, совпадающие по точному `icao24` или
  `registration`, ранжируются выше; частичные совпадения в `callsign` или
  `operator` отображаются ниже. Предусмотреть fuzzy-матчинг (case-insensitive,
  trimmed whitespace) и simple substring match; опционально позже — fuzzy
  distance (Levenshtein) для опечаток.
- Операция должна быть быстрым клиентским фильтром для уже загруженных
  данных и отправлять параллельные запросы к бэкенду только когда есть
  подозрение на недостающие локальные данные (например, при коротком
  вводе не делать ненужных сетевых вызовов).
- API: добавить `/api/search?q=...` (backend) который выполняет серверную
  агрегацию по источникам (OpenSky cache, radius sources' caches, adsbdb,
  storage.collections) и возвращает normalized list с `type`, `id`,
  `display`, `source`, `score`. Фронтенд использует этот API при длинных
  или не локально-результативных запросах.

Реализация / заметки:
1. Frontend: обновить `static/js/main.js`/`sidebar-track.js` чтобы единый
	`searchInput` запускал сначала a) local search по `detailsById` и поставил
	бы результаты мгновенно, затем при отсутствии совпадений или по таймауту
	(e.g. 300ms debounce) выполнить b) networkSearch() вызов `/api/search`.
2. Backend: добавить `/api/search` endpoint в `app.py` который объединяет
	быстрые локальные поиски по кешам (OpenSky `_cache`, `RADIUS_SOURCES[*].cache`,
	`_adsbdb_cache` и `storage.collections`) в одном запросе. Каждый найденный
	результат снабжать `score` (integer) и `source` поле. Никаких внешних
	запросов в цепочке — только локальные caches & storage — чтобы API
	оставался быстрым.
3. Normalization: ответ `/api/search` должен использовать тот же display
	shape, что `buildMergedDetails()` возвращает для боковой панели, чтобы
	клик по результату сразу открывал `selectAircraft()` или провёл
	навигацию к найденному типу (например, коллекция → карточка, рейс →
	окно трека).
4. Pagination/limits: возвращать максимум N (e.g. 50) результатов и
	provide total_estimate flag. Implement simple deduping by `icao24` or
	`registration` so the same aircraft doesn't show multiple times.
5. Tests: backend unit tests for `/api/search` with mock caches; frontend
	Playwright spec to type a query and assert grouped results and opening
	of the selected result.

Estimate: 1–2 dev days (backend endpoint + frontend wiring + 1 E2E smoke test).

--

Design: Aircraft detail page

Goal: design a standalone aircraft detail page (route `/aircraft/<icao24>`)
and corresponding richer sidebar layout for the current single-aircraft view.
This page is a canonical, linkable representation of a tracked aircraft that
combines live telemetry, enrichment, gallery, historical track, and actions
(save/unsave, share, center/map follow). The same layout can be used to
power a larger read-only view for saved collection cards.

Motivation: the current sidebar is a transient UI; a dedicated page improves
shareability, deep-linking, accessibility, and gives room for additional UX
elements (larger gallery, track playback controls, richer enrichment details).

Acceptance criteria:
- Route `/aircraft/<icao24>` renders server-side a minimal HTML shell that the
  frontend hydrates; opening the URL selects and displays the given aircraft
  (falls back to an informative 404-like view if unknown).
- Layout sections: header (registration/icao24/callsign/type + source badges),
  gallery (carousel with photographer credit), route card (origin/destination
  with confidence dot), details groups (Identity, Position, Speed & Heading,
  Autopilot, Weather, Signal & Data Quality), historical track viewer with
  altitude-colored segments and playback controls, action bar (save, share,
  center/follow), and a collapsible enrichment panel showing adsbdb/planespotters
  /flywme computed fields and source badges.
- All rows must support dev-mode badges (sources) and `(?)` info popovers as
  the sidebar does today; same grouping, but optimized for vertical reading.
- Responsive behavior: two-column desktop (gallery + details), single-column
  mobile with sticky action bar; gallery fills top region on mobile.
- Accessibility: semantic headings, keyboard navigation for gallery/carousel,
  accessible labels for action buttons, and `aria-live` region for track
  playback status updates.
- Tests: Playwright spec that opens `/aircraft/<icao24>` for a known fixture,
  asserts header data, gallery loads, track draws, and the Save action works.

Implementation notes:
1. Backend: add a simple route in `app.py` that serves `static/index.html` with
	an injected `window.__INITIAL_SELECTED_ICAO24 = 'xxxxxx'` variable when the
	path matches `/aircraft/<icao24>`; no server-rendered details required — the
	frontend hydrates from existing caches/APIs (same pattern as SPA deep-links).
2. Frontend: extract `renderSelectedDetails()` into a reusable `aircraftPage
	renderer` module so the same render logic powers both the sidebar and the
	full page. `selectAircraft()` should read `window.__INITIAL_SELECTED_ICAO24`
	on load and call the same hydrate path used by sidebar selection.
3. Gallery: reuse `loadGallery()` logic but present a larger slider with
	keyboard arrows and an accessible caption/credit area; infinite-loop
	behavior same as existing carousel.
4. Track viewer: expose playback controls (play/pause, speed 0.5x/1x/2x, scrub
	timeline) that animate the marker along historical track points using the
	`trackLayerGroup` and `requestAnimationFrame`. Playback uses cached OpenSky
	`/api/track` data where available, otherwise local `localTrailCache` fallback.
5. Share: implement a small `navigator.clipboard.writeText(window.location.href)`
	action and a copy-success toast; no external sharing APIs.
6. Save/unsave: reuse `auth-collection.js` save endpoint; when saved, update
	the HUD accent and collection panel. Provide a confirmation toast.
7. Tests: add `tests/frontend/test_aircraft_page.spec.js` covering deep-link,
	gallery presence, play/pause of track (basic), and save/unsave flow.

Estimate: 1–2 dev days (frontend extraction + small backend route + E2E test).

--

External links: UTM params, rel attributes, and variableized host

Goal: ensure every external link emitted by the app includes standardized
UTM/query parameters, is wrapped with appropriate `rel` attributes when
licence/policy allows, and whose base is built from a single configurable
variable (so the domain/hosting can change without touching many templates).

Motivation: analytics consistency (UTM tagging), security/privacy (noreferrer
for cross-origin), and operational flexibility (the external link base is not
hardcoded while deployment/domain is not yet stable).

Acceptance criteria:
- All externally-rendered links (gallery credits, airline website links,
  photographer links, adsbdb/planespotters outbound references, README or
  footer external anchors) must be generated via a single helper that:
  - appends configured UTM parameters (configurable via `app.py` env or
	 `constants.js`) to the URL without breaking existing query params;
  - adds `rel="noreferrer noopener nofollow"` when the audit permits;
  - generates the host via a variable (e.g. `EXTERNAL_LINK_BASE`) so the
	 domain can be switched centrally.
- A license/audit document is produced listing third-party resources whose
  licenses require or forbid `rel` wrapping or attribution; this doc lives in
  `/.ai/DECISIONS.md` or `/.ai/BACKLOG.md` as the license-check summary.
- Tests: unit tests for the link builder function (proper UTM merge,
  rel attribute inclusion), and a Playwright test asserting external gallery
  credit links contain UTM and `rel` attributes.

Implementation notes:
1. Config: add `EXTERNAL_LINK_BASE` and `EXTERNAL_LINK_UTM` to `app.py`'s
	`/api/config` payload and to `static/js/constants.js` as fallback. Read
	them from environment variables (`EXTERNAL_LINK_BASE`, `EXTERNAL_LINK_UTM`)
	for easy deploy-time change.
2. Frontend helper: add `utils/externalLink.js` exporting `buildExternalHref(href)`
	(merges UTM params), and `externalLinkAttrs()` returning `{target: '_blank',
	rel: 'noreferrer noopener nofollow'}` when allowed. Replace inline `href`
	construction in `renderGallery()`, `renderDetailsHtml()`, `airlineLogoHtml()`,
	and any other place external links are injected with `createElement('a')`
	to use these helpers.
3. Backend: where server-side templates or endpoints render links (e.g. any
	server-side emails, static pages), use a shared `external_link(href)` helper
	to perform the same UTM/rel transformation when generating HTML.
4. Licence audit: scan `static/airline-logos/`, vendored assets, and external
	API terms (Planespotters, airport-data.com, adsbdb) for requirements about
	link wrapping or mandatory attribution. Record findings in
	`/.ai/DECISIONS.md` with recommended `rel` policy. If a license forbids
	wrapping links with `noreferrer` (rare), the helper must allow per-host
	overrides via `EXTERNAL_LINK_POLICY` mapping.
5. Variableization: ensure `EXTERNAL_LINK_BASE` is used when building any
	upstream-only proxied link (e.g., when rewriting image URLs or building a
	short redirect path). Keep default `EXTERNAL_LINK_BASE` empty so absolute
	hrefs continue to be respected when desired.

Estimate: 0.5–1 dev days (helper + replacements + license audit note + tests).

UI: Replace airports layer checkboxes with toggles

Motivation:
 - HUD's airports layer currently uses checkboxes styled as rows; accessible toggles (on/off switches) provide clearer affordance, match other UI controls, and convey immediate state.

Acceptance criteria:
 - Replace the HUD `#toggle-airports` checkbox with a semantic toggle control (button role="switch" or input type="checkbox" with .toggle class) visually styled as a switch.
 - Behavior unchanged: toggling on fetches `/api/airports` for current bbox; toggling off clears the cluster layer immediately and stops further fetches.
 - Keyboard focusable, accessible ARIA states (`aria-checked`) and label.
 - Playwright test: toggling shows/hides airports and preserves debounced fetch behavior.

Implementation notes:
1. Reused the existing `<label class="switch"><input type="checkbox">` pattern from other source/layer toggles in `static/index.html` — no new `.toggle` class or `button.role-switch` needed.
2. Added per-size airport type checklist (`#airports-type-list`) with checkboxes for `large_airport`, `medium_airport`, `small_airport`, `heliport`, `seaplane_base`, `balloonport` — hidden until the layer is enabled.
3. Wired `#toggle-airports` in `state-filters.js` to fetch `/api/airports?bbox=...&types=...` on enable, clear the cluster layer on disable, and re-fetch on pan (debounced) or type-checklist change.
4. Added `#airports-help` popover with explanation of the layer.
5. Tests live in `tests/frontend/test_airports_layer.spec.js` (8 tests): default-off, enable renders airports, pan re-fetches, disable stops fetches, popup content + heliport icon class, type checklist visibility and defaults, type checkbox toggling re-fetches with updated types param, help popover open/close.
Estimate: 0.25 dev days (markup + CSS + wiring + E2E tests).