# Backlog

> **Priority note:** see `.agents/README.md` § "Sources of Truth" for the full precedence order (this file outranks code comments).

> **Completion convention:** Mark completed items with `✅ ` at the start of the line. These are auto-pruned from the file on each `git commit` via a hook. Example: `✅ **Feature Name** — brief description`.

> **Effort/value convention (added 2026-07-21, renamed from "Speed" same
> day — "Speed" read as execution velocity, not effort/size, which is
> what the column actually measures):** every item added to or
> materially edited in this file must carry an Effort × Value estimate,
> recorded as a row in the "At a glance" table immediately below. Effort
> is complexity/size — `XS` (<2h), `S` (0.25–1 day), `M` (1–2 days),
> `L` (2–3 days), `XL` (3+ days, or blocked pending research/a decision).
> Value is expected product impact if shipped today — `Low` / `Medium` /
> `High` — judged against this app's actual current use (single-tenant
> hobby tracker), not hypothetical future scale. Re-score an item (don't
> just re-add a row) whenever its scope or estimate changes materially.
> See `.agents/architect.md` § "BACKLOG.md ownership" for who's expected
> to keep this current.

> **Category/Tag convention (added 2026-07-21):** every item in the "At a
> glance" table must include a `Category` column that briefly identifies
> the area it touches — one of: `Frontend UX`, `Backend`, `DevOps`,
> `Data sources`, `Testing`, `Documentation`, `Prediction`. This tag
> makes it easy to scan by domain and coordinate related work.

Ideas and features not yet scheduled. Grouped loosely by theme.

*(Note: this file went through several rounds of the `backlog-cleanup.sh`
commit hook before it was noticed that the hook only strips a single line
starting with `✅` — for a multi-paragraph item, marking just the title
line left its body orphaned with no heading. Completed multi-paragraph
items are now deleted in full rather than title-only-marked, to avoid
recreating that problem.)*

## At a glance — Effort × Value (as of 2026-07-21)

Sorted best-first (cheap + valuable at the top). Full item detail is in the
sections below; this table is the quick-scan summary the convention above
requires.

| Item | Effort | Value | Category | Read |
|---|---|---|---|---|
| Local track persistence & smoothing (frontend) | S | Med–High | Frontend UX | Quick win — real UX gap: local live-trail isn't kept across reselect, and renders jagged |
| airframes.io as aircraft enrichment source | L | Med–High | Data sources | Aircraft history/lifecycle data (accidents, incidents, operator changes); lazy-fetch tier below adsbdb. Research API access, coverage, and integration into sidebar's new History section. |
| RapidAPI flight data APIs — research | S | Medium | Data sources | Audit RapidAPI collection for gaps vs. current seven sources; identify if any free/no-key APIs offer better coverage for real-time or metadata. |
| Flystack airline logo — research and integration | L | Med–High | Data sources | Specialized airline logo service; research API access model, coverage, licensing, rate limits vs. current two-tier approach. Integration could improve logo hit rate for niche airlines. |
| Planespotters as third data source (metadata enrichment) | L | High | Data sources | Helicopter + rare aircraft coverage gap; requires API research, integration into enrichment chain, dedup/priority |
| Free tier API and user registration system | M–L | High | Backend | Enable multi-user deployments with API keys, rate limiting, quota management. Requires registration endpoint, token generation, SQLite user role/quota schema, middleware. |
| Multi-entity search (icao24/reg/callsign/adsbdb) | M | High | Frontend UX | Highest standalone value in the backlog; worth scheduling deliberately |
| Health check endpoint (`/api/health`) | XS–S | Medium | DevOps | Public unauthenticated endpoint for Northflank/uptime-monitor health checks. Decision made 2026-07-21: public minimal response (DECISIONS.md). |
| Seamless login without page reload | M | Medium | Frontend UX | Real UX papercut (full navigation + reload loses map/sidebar state) but touches the OAuth callback flow, so not trivial |
| Aircraft detail page (`/aircraft/<icao24>`) | M | Medium | Frontend UX | Shareable/deep-linkable view; reusable layout could also serve collection cards |
| Map update frequency & track smoothing (backend polling config + interpolation) | L | Medium | Backend | Broader superset of the frontend-only item above — consider merging scope with it rather than doing both |
| Airline metadata enrichment (alliance/country/website) | L | Medium | Data sources | Needs a source-validation phase before implementation, not just coding time |
| Dark mode | M | Medium | Frontend UX | Visible polish; CSS touches sidebar+HUD, not a single component |
| External links: UTM params / `rel` / variableized host | S | Low | Frontend UX | Mostly hygiene (`noreferrer`) + analytics tagging this app doesn't otherwise use |
| UI/CSS framework evaluation (POC only) | S | Low | Frontend UX | Cheap experiment; no user-facing payoff until a real migration follows (unscoped, separate cost) |
| Register an AirLabs API key | XS | Low | Data sources | Trivial, but a pure prerequisite — does nothing standalone |
| Exercise `.agents/ui.md` on a real task | XS–S | Low | Documentation | Process/meta value only, not user-facing |
| Sidebar search/filter within collection | S | Low | Frontend UX | Only matters once a user's collection is large; defer until it is |
| Metrics export (`/metrics`, Prometheus) | M | Low–Med | DevOps | Ops/observability value, no urgency for a single-tenant app |
| Collection panel bulk operations | M | Low | Frontend UX | Speculative — no evidence the collection is big enough to need bulk actions yet |
| Adaptive polling intervals | M | Low | Backend | Defer until an actual quota-pressure incident, not before |
| Load testing | M | Low | Testing | Only relevant if traffic ever exceeds single-user hobby scale |
| Live network tests (CI-gated) | M | Low | Testing | Low ROI unless upstreams start breaking often (not observed so far) |
| Route prediction from velocity vector (Layer 3 route validation) | L | Low–Med | Prediction | Speculative extension of Layer 2; no user ask driving it yet |
| Additional weather layers (wind/clouds/temp) | XL (blocked) | Low–Med | Data sources | Blocked — no free/no-signup source identified yet |
| Aircraft serial number (MSN) field | XL (blocked) | Low | Data sources | Blocked — no verified data source yet, needs research first |
| Per-category icons for ground vehicles/obstacles (C0-C5) | S | Low | Frontend UX | Purely cosmetic — every C-code already renders correctly (tower glyph, no crash); just one shared icon regardless of which C-code |
| *(Historical track interpolation, listed separately below)* | — | — | Duplicate of the two track-smoothing items above; fold into one of them rather than tracking a third time |

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

Status (2026-07-21): ✅ COMPLETED — Full implementation in commit edbea92. Backend: 9 new unit tests (77/77 total passing). Frontend: 5 new integration tests verifying parameter passing, suppression behavior, and live data fallback. Feature ready for production.


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

## Backend infrastructure

- **Free tier API and user registration system**

Goal: transition from single-tenant (Google OAuth login only) to multi-tenant with
free and paid tiers, enabling self-service registration, API key management, and
quota/rate-limit enforcement per user.

Motivation: current architecture assumes one user (Google login, unlimited collection
storage). A free-tier signup + API tier system enables:
- External applications to consume aircraft data via a stable, rate-limited API.
- Operators to self-register without Google OAuth dependency.
- Quota enforcement (e.g., free tier: 100 requests/hour, paid: 10k requests/hour).
- Revenue model (if desired in future) without code restructuring.

Acceptance criteria:
- New `/api/register` endpoint (POST `{email, password, username}`) creates a free-tier
  user, hashes password, stores in SQLite `users` table (augment existing schema with
  `tier` enum `['free', 'paid', 'admin']`, `password_hash`, `api_key_hash`,
  `quota_limit_requests_per_hour`, `created_at`, `last_login_at`). Returns `{user_id,
  api_key, tier}` on success, 400 on duplicate email, 409 if registration is disabled.
- Google OAuth still works as today (deprecated once all existing users migrate or
  OAuth credential expires). New Google logins trigger account creation/linkage.
- `/api/auth/login` endpoint (POST `{email, password}`) for password-based login,
  returns session cookie + `{user_id, api_key, tier}`.
- `/api/auth/logout` clears session.
- `/api/user/profile` (GET, authenticated) returns `{user_id, email, username, tier,
  api_key, quota_used_this_hour, quota_limit}`. PATCH `{username, email, password}`
  to update, password change requires old password verification.
- `/api/user/api-keys` (GET, authenticated) lists all active keys + creation date + last
  used. POST generates new key, DELETE revokes by key id.
- New `/api/data/*` endpoints (or extend existing) to require API-key auth (Bearer token
  in `Authorization` header) when accessed externally, with rate-limit headers
  (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`). Session auth
  (current Google login) remains unrestricted for the web frontend.
- Rate-limit middleware in Flask (`app.py`): check `Authorization` header or session
  cookie, look up user + tier in SQLite, enforce `quota_limit` per hour via a
  `rate_limit_requests` table (user_id, hour_bucket, request_count). On 429, return
  `{error: "rate_limit_exceeded", retry_after_seconds: X}`.
- `/api/admin/tier-override` (admin-only) to manually upgrade a user to paid (or
  downgrade) — useful for testing + future billing integration.
- SQLite schema changes: extend `users` table; new `rate_limit_requests` table
  (user_id, hour_bucket, request_count); new `api_key_usage` table for audit
  (user_id, api_key, accessed_endpoint, timestamp, status_code) — optional, for
  future analytics.
- Tests: backend unit tests for registration/login/API-key flow, password hashing
  (use `werkzeug.security.generate_password_hash`), rate-limit enforcement, tier
  upgrades. Playwright tests for registration UI (if new form added) or curl tests
  for API-only registration.
- Frontend: optional — if this is API-only, no frontend change needed (existing Google
  login continues to work). If self-service registration UI is desired, add a
  `/register` route + form in `static/index.html`.

Implementation notes:
1. Password security: use `werkzeug.security.generate_password_hash(..., method='pbkdf2:sha256')`,
   store hash only (never plaintext), verify with `check_password_hash()`.
2. API key generation: `secrets.token_urlsafe(32)` for user display, hash the same way
   for storage (never store keys plaintext). Prefix with `flywme_` for easy identification.
3. Rate limiting: hour-bucket approach (store `datetime.now().replace(minute=0, second=0, microsecond=0)`
   as key, not per-second) scales better than per-request checks; clean up expired buckets
   once per hour or on startup.
4. Session vs. API key auth:
   - Frontend: continue using Flask session cookie (from Google OAuth or `/api/auth/login`).
   - External API consumers: Bearer token in `Authorization: Bearer <api_key>`. Middleware
     checks which auth method is present and validates accordingly.
5. Migration path: existing Google OAuth users keep their collections; on first Google
   login after this feature ships, a new free-tier account is auto-created and linked
   to the Google `sub` (add `oauth_provider` + `oauth_id` columns to `users` table to
   support future multi-OAuth linking).
6. Rate limit tiers (configurable via env vars):
   - Free: 100 requests/hour (equivalent to 1 poll + enrichment calls = ~10 req/poll × 10
     polls/hour = manageable).
   - Paid: 10,000 requests/hour (or unlimited, TBD).
   - Admin: unlimited.
7. Documentation: update CLAUDE.md § "Aircraft collection" with new auth/API section.
   Add `/api/register`, `/api/auth/*`, `/api/user/*` to schema/openapi if applicable.

Estimate: 2–3 dev days (backend routes + SQLite schema + middleware + tests + migration logic).

## Data sources & enrichment

- **airframes.io as aircraft enrichment source** — Integrate airframes.io (https://airframes.io) as a lazy-fetch enrichment tier for aircraft history, airframe metadata, accidents, incidents, and maintenance records. Unlike adsbdb.com (which provides registration + type + operator + route), airframes.io complements with historical/lifecycle data about the specific airframe. Requires: (1) **API feasibility audit** — determine access model (free/paid/API key), rate limits, coverage (global vs. regional), data freshness, response format, and whether bulk-download or per-ICAO24 queries are supported; (2) **Coverage audit** — test against 50–100 real aircraft, compare to adsbdb's own coverage and identify what airframes.io uniquely provides (e.g., accident history, operator changes, write-offs); (3) **Priority placement** — decide where in enrichment chain it sits vs. adsbdb/Planespotters/Flywme (likely below adsbdb, since adsbdb is already live/current, airframes.io is historical/reference); (4) if approved, implement `/api/airframes/<icao24>` lazy-fetch route (click-only, not polled), cache indefinitely like adsbdb, and surface new fields in sidebar under a new History group or within Aircraft Identity; (5) tests covering the lazy fetch, cache hit/miss, and multi-source badge rendering. Acceptance criteria: feasibility decision in `.ai/DECISIONS.md` with API terms and coverage findings; if adopted, new sidebar group or expanded Identity section shows airframe history (first registered, operator changes, incidents) with adsbdb/adsbdb source badges. Estimate: 2–3 dev days (API research + integration + testing), pending feasibility phase.
  - **AeroDataBox API** — popular developer tool; flight schedules, aircraft status, airport info; free tier with monthly request limit.
  - **Flight Data (Travelpayouts)** — from tourism network; cached historical flight price data, routes, trends; free tier.
  - **Aviation Edge / Aviationstack** — large data aggregators; real-time aircraft tracking, IATA/ICAO databases; limited free tier (hundreds of requests/month).
  - **Lufthansa Open API** — airline's own developer program; basic schedules for Lufthansa carriers; free access.
  
  Requires: (1) scan the collection for additional APIs beyond these four, (2) for each shortlisted API, document: signup requirement, free tier availability, monthly request limit, rate-limit structure, data freshness, coverage (global vs. regional), licensing, and required auth headers, (3) compare to existing seven sources (OpenSky/adsb.fi/adsb.lol/adsb.one/airplanes.live/adsbdb/FlightAware/FlightRadar24) to identify actual gaps this could fill (e.g., real-time crew/catering data, historical scheduling, airline-specific feeds), (4) record findings + "adopt/investigate further/skip" recommendation in `.ai/DECISIONS.md` with reasoning. Acceptance criteria: research summary in DECISIONS.md with table of findings (API name, access model, coverage, monthly quota, pros/cons vs. existing sources), at least one API flagged as worth deeper evaluation if promising; decision on whether to pursue integration of any API. Estimate: 0.5–1 dev day (audit + documentation, no implementation).

- **Register and configure an AirLabs API key** — Sign up at
  https://airlabs.co/ and obtain an API key for potential use as a data
  source/enrichment tier (already listed as a candidate under "Additional
  airline metadata enrichment" above). Requires evaluating pricing/rate
  limits against this project's "no signup, no token" default posture
  (see CLAUDE.md's Architecture section) before actually wiring it in —
  this item is just the account/key setup step, not integration.

- **Adaptive polling intervals** — Currently fixed 10s/12s for all sources. Could reduce traffic/quota by polling only enabled sources, or reduce frequency for sources known to update slowly (METAR/SIGMET at 300s vs. aircraft at 10s). Aeris project (`kewonit/aeris`) has a reference implementation for similar idea. Worth reviewing if quota ever becomes tight.

- **Additional weather layers** — RainViewer (precipitation) is implemented. Candidate additions: wind (Windy.com-style), clouds, temperature. None are free/no-signup yet; would need researching.

- **Historical track interpolation** — Currently shows discrete waypoints from OpenSky `/api/track`. Could smooth/interpolate between points for a less-jerky playback. Nice-to-have, lower priority.

## Prediction & forecasting

- **Route prediction based on vector** — Extrapolate aircraft's future position/trajectory from current velocity vector (heading + speed). Use cases: (1) predict convergence/collision risk between aircraft, (2) anticipate which airports lie on the aircraft's natural path, (3) validate adsbdb routes more precisely by comparing predicted vs. claimed destination. Requires integrating haversine-based forward projection into the route-validation geometry chain. Layer 3 validation, lower priority than current Layer 2 (geometric-consistency check). Would reuse `destinationPoint()` helper from route-validation.js.

## UI/UX

- **Configure the UI agent (`.agents/ui.md`)** — role file was created
  2026-07-21 (scope, hard constraints, guardrails, testing checklist) but
  hasn't been exercised/tuned on a real task yet. Follow-up: run it through
  one or two actual UI backlog items (e.g. the loader-on-filter-change item
  below), see whether the guardrails/testing checklist hold up in practice,
  and adjust wording/scope based on friction found. Also verify `.agents/README.md`'s
  role list and Quick SOP still read correctly with the fourth role added.

- **Seamless login without page reload** — Currently, clicking "Sign in with Google" does `window.location.href = '/api/login/google'` (full-page navigation to OAuth callback). After successful login, page reloads. Improve UX by: (1) opening Google consent in a popup/modal instead of full navigation, (2) handling OAuth callback in-session (via `postMessage` or polling `/api/me`), (3) updating auth status live without hard reload. Keeps selected aircraft/sidebar/map state intact. Requires rearchitecting Authlib callback flow. Nice-to-have, moderate complexity.

- **Collection panel bulk operations** — Currently can save/unsave one aircraft at a time. Backlog idea: bulk export (JSON), bulk delete, filtering within collection. No firm priority.


- **Dark mode** — Basemap picker already supports dark styles (CARTO Dark, Esri Dark), but sidebar/HUD don't adapt. CSS `prefers-color-scheme` media query support would help. Low priority.

- **Per-category icons for ground vehicles/obstacles (C0-C5)** — `iconFor()`
  (`static/js/icons.js`) currently draws the exact same neutral-grey
  `towerIcon()` glyph for *every* item flagged `isGroundVehicle: true` or
  `categoryGroup === 'surface_obstacle'`, regardless of which DO-260B
  C-code it actually is. But the codes mean genuinely different things
  (`ADSBEXCHANGE_CATEGORY_LABELS`, `render-details.js`): C1 "Surface
  vehicle — emergency", C2 "Surface vehicle — service", C3 "Point
  obstacle", C4 "Cluster obstacle", C5 "Line obstacle" — an emergency
  vehicle and a fixed obstacle are not the same kind of thing to spot on
  the map at a glance, the same reasoning that already gives real aircraft
  category groups their own distinct glyphs. Separately, **objects with no
  category info at all** (C0, or a ground vehicle flagged purely by the
  registration/callsign heuristics in `looksLikeGroundVehicle()` with no
  `category` field at all) need an explicit "unknown ground object" glyph
  distinct from both the categorized ones and the real-aircraft "unknown"
  silhouette (`UNKNOWN_GLYPH`) — right now they silently fall into the same
  bucket as every other ground vehicle via the tower icon, which reads as
  "we know what this is" when the app in fact doesn't. Low priority: purely
  cosmetic, nothing is broken or misleading today beyond a slightly
  under-differentiated icon set — the C0-C5 identity-field-hiding and
  heuristic-suppression behavior (see `.ai/DECISIONS.md` 2026-07-21 entries)
  already handles the *data* side correctly regardless of which icon
  renders.
  - Acceptance criteria: distinct icon/color per C1 (emergency vehicle),
    C2 (service vehicle), C3/C4/C5 (obstacle — could share one "obstacle"
    glyph family or get three, TBD during implementation), and a separate
    "unknown ground object" glyph for C0/no-category. Category dropdown
    filter and dev-mode "all aircraft" table are out of scope unless
    trivial to extend alongside.
  - Implementation notes: extend `CATEGORY_GLYPHS`/`ICON_BUILDERS`
    (`icons.js`) with new entries keyed by the existing `surface_obstacle`
    group isn't granular enough — `categoryGroupFor()` already collapses
    C1-C5 into one `surface_obstacle` bucket, so this needs either a new,
    more granular grouping just for icon selection (reusing the raw
    `categoryCode`/`item.category` string directly, the same field
    `looksLikeGroundVehicle()` already reads) or a small `groundVehicleIcon
    (categoryCode)` helper consulted before falling back to `towerIcon()`.
    Source new SVG glyphs from the same vendored ADS-B Radar icon set if a
    fitting one exists there, otherwise a small MDI glyph (Apache-2.0, same
    vendoring convention as `GROUP_ICONS`/the airport-layer icons).
  - Estimate: 0.25–0.5 dev day (a few new small SVGs + one dispatch
    function + Playwright coverage extending `test_filters.spec.js`'s
    existing ground-vehicle fixture).

- **Sidebar search/filter** — Once collection grows large, searching within saved aircraft by callsign/type/operator would help. Not urgent for current use case.

## DevOps / deployment

- **Health check endpoint** — `/api/health` returning status of all seven data sources + database. Useful for monitoring deployments. Blocked on: deciding whether to make this admin-only or public.

- **Metrics export** — Prometheus-compatible `/metrics` endpoint for poll latency, cache hit rates, source availability. Would help debug why a particular fetch was slow. Infrastructure concern, not app-core.

## Testing

- **Load testing** — Current test suite is all unit/integration. No load test against the full stack (8+ concurrent users polling simultaneously, testing gunicorn capacity). Relevant only if traffic ever grows beyond single-user hobby project.

- **Live network tests (optional, CI-gated)** — Current backend tests mock all HTTP. Optional separate suite that hits real OpenSky/adsb.fi (read-only, no write) to catch upstream API changes. Would need Playwright setup similar to frontend tests. Low ROI unless upstreams start breaking often.

## Documentation


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
