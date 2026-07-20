# Backlog

Ideas and features not yet scheduled. Grouped loosely by theme.

## Aircraft metadata

- **Aircraft serial number (MSN)** — Add aircraft manufacturer serial number field. No verified source yet (adsbdb has `msn` field for some aircraft; needs validation against real data). Research required before prioritizing. (See personal memory for fuller context.)

## Data sources & enrichment

- **Adaptive polling intervals** — Currently fixed 10s/12s for all sources. Could reduce traffic/quota by polling only enabled sources, or reduce frequency for sources known to update slowly (METAR/SIGMET at 300s vs. aircraft at 10s). Aeris project (`kewonit/aeris`) has a reference implementation for similar idea. Worth reviewing if quota ever becomes tight.

- **Additional weather layers** — RainViewer (precipitation) is implemented. Candidate additions: wind (Windy.com-style), clouds, temperature. None are free/no-signup yet; would need researching.

- **Historical track interpolation** — Currently shows discrete waypoints from OpenSky `/api/track`. Could smooth/interpolate between points for a less-jerky playback. Nice-to-have, lower priority.

## UI/UX

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
