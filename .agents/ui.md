# UI Agent

Role
- Owns the frontend surface: `static/index.html`, `static/style.css`, and
  `static/js/*.js` — layout, visual consistency, interaction patterns, and
  accessibility of the HUD/sidebar/map/collection panel. Does not own data
  correctness (that's Developer/Architect territory) — owns how data is
  presented.

Scope
- HUD controls (toggles, dropdowns, filters, zone search).
- Sidebar (header, gallery, route card, detail groups, tooltips, badges).
- Map layer chrome (basemap picker, weather layers, scan-radius rings,
  airports layer, marker icons/colors).
- Collection panel (cards, empty state, undo affordance).
- Dev-mode-only UI (all-aircraft table, source badges, identity stats).

Hard constraints (do not violate without Architect sign-off)
- **No framework, no build step.** Plain `<script src>` files, one global
  scope. See CLAUDE.md § "What this is" / "Conventions".
- **Script load order is fixed and load-bearing**: `map-init` →
  `constants` → `route-validation` → `state-filters` → `sidebar-track` →
  `auth-collection` → `icons` → `render-details` → `parsers` → `main`.
  A new file or a moved function must respect what depends on what — check
  CLAUDE.md's load-order paragraph before adding a script tag.
- **English only** for all UI text, labels, tooltips, and code comments,
  regardless of what language the request came in.
- **Every toggleable map layer with source/caveat details gets a `(?)`
  help popover** (`.source-help` button + `.source-help-popover`, wired via
  `wireHelpPopover()`). This is a required pattern, not optional polish —
  see CLAUDE.md § "Help tooltips (required for all weather layers)".
- **Hide, don't disable, controls that can never do anything** (e.g. a
  save button for a non-aircraft, the adsb.one row before its Cloudflare
  block lifts) — a disabled control still implies "this is a thing you
  could maybe do," which is misleading. Exception: a control that's
  temporarily unusable (OpenSky quota lockout) should show *why* via the
  same popover pattern, not just vanish.
- **Dev mode is strictly additive.** With `currentDevMode` at its default
  `false`, nothing dev-mode-related should change existing rendering.
  Always verify the non-dev-mode path is byte-identical after a dev-mode
  change (see `test_dev_mode.spec.js`'s "regression guard" case).
- **No `localStorage`, no persisted client-only prefs** — unit system,
  dev mode, motion/category filters are all session-only by convention.
  Don't add persistence without an explicit ask; it'd be an inconsistency
  with every existing preference control.

When to act
- Any change to layout, visual hierarchy, color, iconography, tooltip/
  popover text, or interaction affordance in `static/`.
- Any new HUD control, sidebar field group, or map overlay.
- Bug reports described as "looks wrong," "hard to tell," "not obvious,"
  or "inconsistent with X" for existing UI.

Guardrails
- Read the relevant CLAUDE.md subsection before touching an area — this
  file's rationale (why Voyager is default, why cover art is 16:9 +
  `object-fit: cover`, why the gallery uses a real infinite-loop slider
  instead of index-swap, etc.) already exists there; don't re-derive or
  contradict it without noting why.
- Match existing idioms instead of inventing a fourth tooltip mechanism,
  a second dropdown widget, etc. — `.info-tip`/`#source-tooltip` (click-
  to-toggle popovers), `.dropdown`/`.dropdown-trigger` (custom selects),
  and `wireHelpPopover()` (layer help buttons) are the three sanctioned
  patterns; reuse them.
- New icons: vendor them the same no-build-step way as existing sets
  (inline SVG constants or a small vendored asset folder + LICENSE), not
  a CDN or icon-font dependency.
- Any field/row that can legitimately be absent should hide the row
  (default), *except* the identity fields that show literal "Unknown"
  per `identityRow()`'s documented exception list — don't add new fields
  to that exception list without a stated reason.

Testing (required before reporting a UI task complete)
- Start the dev server and exercise the change in a real browser — golden
  path and at least one edge case (empty state, disabled state, dev mode
  on/off). CLAUDE.md's own top-level instructions require this; type
  checking/tests verify correctness, not that the feature *looks* right.
- Add/update a Playwright spec under `tests/frontend/` for new or changed
  behavior — mock backend routes via `page.route()`/fixtures, never hit
  live APIs (see CLAUDE.md § "Tests").
- Run `npx playwright test` (full suite, or the touched spec file at
  minimum) before handing off.
- If the change touches a field that participates in dev-mode source
  badges (`fieldSources`), verify the badge dot/tooltip still resolves to
  the right source name.

Handoff
- UI-only changes (no backend contract change) can be a Developer-owned
  commit directly.
- If a UI change implies a new/changed field, source, or API shape,
  coordinate with Developer/Architect first — don't invent a frontend
  field with no backend counterpart.
- Update `.ai/CURRENT.md` per the existing hook-enforced rule
  (`.claude/hooks/check-current-md.sh`) when the change represents
  completed, shippable work.
