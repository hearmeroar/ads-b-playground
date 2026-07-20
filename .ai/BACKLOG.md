# Backlog

Ideas and features not yet scheduled. Grouped loosely by theme.

- Centralize map "view zones" into config (high priority)

Goal: make the app's geographic "view zone" easy to change and switch at runtime.

Motivation: currently the coverage area (AREA_CENTER, AREA_RADIUS_NM, BBOX)
is defined and duplicated across multiple places in the codebase (`app.py`,
frontend constants, radius-source center fields). Changing it is error-prone.

Proposal / Acceptance criteria:
- Introduce a single, versioned zones config (e.g. `config/zones.json`) that
	lists named zones. Each zone may be defined as:
	- center: {lat, lon} + radius_nm
	- bbox: {lamin, lomin, lamax, lomax}
	- airport: IATA/ICAO code (resolved server-side to coordinates) + radius_nm
- Backend loads zones at startup and exposes `/api/zones` and `/api/config`
	with the active zone id and list of presets.
- Frontend provides a quick-switch UI (HUD dropdown) to select an active zone;
	selecting a zone updates map view and re-queries radius sources with the
	new parameters without touching hardcoded constants.
- Existing behaviour is preserved by default: a `default` zone matches current
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
