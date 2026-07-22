# Proposal: Operator-configurable source visibility (`config/sources.json`)

**Date:** 2026-07-22  
**Status:** Design approved, implementation pending  
**Effort:** S (small)  
**Value:** Medium (enables future operator-only customization without code changes)

## Problem

Currently, which data sources are shown to the end user (and what their default enabled state is) is **hardcoded in the frontend markup** and backend route wiring. The pattern is one-off per source — adsb.one's HUD row is hidden via `style="display:none"` in `static/index.html`, with its checkbox unchecked by default, hardcoded specifically for that source.

For an operator to hide, show, or change defaults for a source, they must either:
1. Edit `static/index.html` (risky, touches markup)
2. Edit `app.py` to comment out a route or source in `RADIUS_SOURCES` (risky, requires understanding the code)
3. Deploy a custom branch (expensive, friction for small deployments)

**Current hardcoded state** (all seven sources):

| Source | Row visible? | Checkbox checked by default? |
|--------|---|---|
| OpenSky | yes | yes |
| adsb.fi | yes | yes |
| adsb.lol | yes | yes |
| adsb.one | **no** (hidden) | no |
| airplanes.live | yes | yes |
| FlightAware | yes | no |
| FlightRadar24 | yes | no |

## Solution

Generalize the hardcoded adsb.one pattern into an **operator-editable configuration file** (`config/sources.json`), following the existing `config/zones.json` model: a JSON file that specifies per-source visibility and default enabled state, loaded at startup.

**Design principles:**
- **Two-tier split:** operator-config (file-driven, what an operator can edit without code changes) vs. user-preference (session-only, what the user toggles in the UI). This proposal touches only the operator tier.
- **v1 scope, deliberately narrow:** per-source `visible` + `enabled_by_default` only. No filter/panel visibility, no ordering (user explicitly called ordering "overkill for now").
- **Separate file:** `config/sources.json` (not folded into `config/zones.json`) — different nature of change (UI/source policy vs. geography).
- **No hot-reload for v1:** unlike `zones.json`, this file is hand-edited by the operator, not mutated at runtime via an API, so restart-only is fine.
- **Byte-identical default behavior:** absent file means no change from today's hardcoded defaults, zero risk to existing tests/UX.

## Implementation overview

### 1. New file: `config/sources.json` (committed to repo)

```json
{
  "opensky":       { "visible": true,  "enabled_by_default": true },
  "adsbfi":        { "visible": true,  "enabled_by_default": true },
  "adsblol":       { "visible": true,  "enabled_by_default": true },
  "adsbone":       { "visible": false, "enabled_by_default": false },
  "airplaneslive": { "visible": true,  "enabled_by_default": true },
  "flightaware":   { "visible": true,  "enabled_by_default": false },
  "flightradar24": { "visible": true,  "enabled_by_default": false }
}
```

Content is byte-identical to today's hardcoded defaults. The operator can edit this file directly; no code changes needed.

### 2. Backend: `app.py` (lines ~64–89, mirroring `ZONES_FILE` pattern)

Add a new loader function, exactly parallel to `_load_zone_config()`:

```python
SOURCES_FILE = os.environ.get("SOURCES_FILE", "config/sources.json")

def _load_sources_config():
    default = {
        "opensky":       {"visible": True,  "enabled_by_default": True},
        "adsbfi":        {"visible": True,  "enabled_by_default": True},
        "adsblol":       {"visible": True,  "enabled_by_default": True},
        "adsbone":       {"visible": False, "enabled_by_default": False},
        "airplaneslive": {"visible": True,  "enabled_by_default": True},
        "flightaware":   {"visible": True,  "enabled_by_default": False},
        "flightradar24": {"visible": True,  "enabled_by_default": False},
    }
    try:
        with open(SOURCES_FILE, "r") as f:
            cfg = json.load(f)
        if isinstance(cfg, dict) and all(k in cfg for k in default):
            return cfg
    except (OSError, ValueError):
        pass
    return default

SOURCES_CONFIG = _load_sources_config()
```

Loaded once at import time. No mtime-poll/hot-reload — file is restart-only.

Modify `/api/config` route (line ~745) to include sources:

```python
@app.route("/api/config")
def api_config():
    _maybe_reload_zone_from_disk()
    return jsonify({
        "center": AREA_CENTER,
        "zoom": AREA_ZOOM,
        "radius_nm": AREA_RADIUS_NM,
        "bbox": BBOX,
        "active_zone_id": _active_zone_id,
        "sources": SOURCES_CONFIG,  # <-- add this line
    })
```

No other route needs to read this.

### 3. Frontend: `static/js/main.js` (lines ~609–618 area)

Insert a config-driven bootstrap step **before** the existing startup sequence (the count-spinner loop + first `poll()` call), so source visibility/defaults are applied before any code reads `isSourceEnabled()`:

```javascript
// Apply source visibility and defaults from backend config.
// This runs before the spinner loop, so isSourceEnabled() always reflects the config.
fetch('/api/config')
  .then(r => r.json())
  .then(cfg => {
    for (const [name, s] of Object.entries(cfg.sources || {})) {
      const checkbox = sourceToggles[name];
      if (!checkbox) continue; // Config lists a source this build doesn't have
      checkbox.checked = s.enabled_by_default;
      const row = checkbox.closest('.source-row');
      if (row) row.style.display = s.visible ? '' : 'none';
    }
  })
  .finally(() => {
    // Existing startup: the count-spinner loop + first poll() + setInterval(...)
    for (const name of Object.keys(sourceToggles)) {
      if (isSourceEnabled(name)) showSourceCountSpinner(name);
    }
    document.getElementById('map-loader').classList.add('hidden');
    poll().finally(() => document.getElementById('map-loader').classList.add('hidden'));
    setInterval(poll, POLL_INTERVAL_MS);
  });
```

**No new markup, no id additions** — reuses existing `sourceToggles[name]` (a live DOM element reference) and `.closest('.source-row')` to find the row.

This is a **second** call to `/api/config` (the existing one in `map-init.js` stays unchanged and is non-blocking). Acceptable because:
- The endpoint is explicitly documented as deliberately uncached ("pure local values, no I/O").
- The `#map-loader` overlay already covers the page until the first poll resolves, so the config bootstrap is absorbed by that overlay — no new visible delay.

### 4. Tests (minimal, informed by the test-suite audit)

**Backend** (`tests/backend/test_sources_config.py`, new or extended):
- `_load_sources_config()` returns the exact hardcoded default when the file is absent/malformed.
- `/api/config` includes a `sources` key with the right shape.
- A custom `sources.json` (via `conftest.py`'s existing `monkeypatch` pattern, same as `ZONES_FILE`) correctly overrides `visible`/`enabled_by_default`.
- **3–4 tests total**, not one per source × field combination.

**Frontend** (extend an existing config spec, or add one new small spec):
- Default (no override): existing tests **unaffected** — byte-identical-default guarantee proves this.
- One test: mocked `/api/config` with `adsbone.visible: true` → the row becomes visible and its checkbox reflects `enabled_by_default`.
- One test: mocked `/api/config` with `opensky.enabled_by_default: false` → checkbox starts unchecked despite the HTML's own `checked` attribute.

**Rationale:** Avoid the C0–C5-style combinatorial mistake from the test audit. Test the *rule* ("config overrides row visibility/checked state") with 2–3 representative cases, not exhaustively for all 7 sources.

## Verification (once implemented)

1. `curl 127.0.0.1:5051/api/config | python3 -m json.tool` — confirm `sources` key with all 7 entries, matching the defaults above when `config/sources.json` is unedited.
2. Edit `config/sources.json` by hand (e.g., `"adsbone": { "visible": true, ... }`), restart the dev server, reload the page — confirm the adsb.one row appears in the HUD.
3. Run tests: `.venv/bin/pytest tests/backend/test_sources_config.py -v` and `npx playwright test tests/frontend/<spec> -v`.
4. Full regression: `pytest tests/backend` + `npx playwright test` — confirm byte-identical-default guarantee holds (no pre-existing test should change).

## Future extensions (not v1)

Once this ships, the pattern is proven and can expand to:
- Per-filter visibility (show/hide category filter, motion filter, etc.) + defaults
- Per-weather-layer visibility (METAR/SIGMET/Precipitation/Forecast toggles)
- Eventually: per-element ordering (if operator wants to reorder source rows or move the basemap picker)

Each is a straightforward extension of the same config-load-and-apply pattern.

## Open questions (none)

User explicitly confirmed all design choices. Ready for implementation when scheduled.
