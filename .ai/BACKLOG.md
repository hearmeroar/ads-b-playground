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

- Enrich airline/company metadata from soaring-symbols and validate sources (high)

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
