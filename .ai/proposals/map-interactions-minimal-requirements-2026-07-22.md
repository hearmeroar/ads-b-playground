---
name: map-interactions-minimal-requirements-2026-07-22
description: Minimal interaction requirements for Leaflet map module (smooth zoom, max-zoom stability)
metadata:
  type: proposal
---

# Map Interactions — Minimal Requirements

**Date:** 2026-07-22  
**Status:** Requirements specification (no implementation yet)  
**Scope:** Leaflet map module (`static/js/map-init.js` + map lifecycle in `main.js`)

## Current State

Map works correctly with Leaflet 1.9.4 vendored locally:
- All layers render without errors
- Basemap switching works
- Zoom/pan mechanics are native Leaflet defaults
- No performance issues observed at normal zoom levels

## Minimal Requirements (When Map Work Resumes)

These are **non-negotiable** baselines, observed from competitive analysis (FlightRadar24, FlightAware, ADS-B Exchange):

### 1. Smooth Zoom Interpolation
**Requirement:** Zoom transitions should be animated smoothly (not instant).

**Current behavior:** Zoom in/out is instant (default Leaflet `zoomAnimation: true` at 250ms).

**Expected behavior:** Smooth easing curve over 300–500ms, matching competitor polish. Makes the map feel responsive and less jarring.

**Implementation note:** Leaflet's native `zoomAnimation` should suffice; tune duration if needed. No custom interpolation required unless Leaflet's default doesn't match the target feel.

### 2. No Hangs at Maximum Zoom
**Requirement:** Map must remain responsive and not freeze when user zooms to maximum level.

**Current behavior:** Unknown at this time (no live testing at max zoom performed during this session).

**Expected behavior:** 
- User can zoom to max (`maxZoom: 19`) without any delay or visual freeze
- Markers, tiles, and interactions remain responsive
- No CPU spike or memory leak when holding at max zoom
- Dragging/panning works smoothly even at max zoom

**Implementation note:** May require:
- Tile rendering optimization (stop loading beyond `maxNativeZoom` for heavy layers)
- Marker clustering behavior at high zoom (ClusterGroup should decompose into individual markers)
- Layer culling (off-screen/invisible layers don't render)
- Monitor performance in DevTools (CPU/memory profile at max zoom)

### 3. Smooth Pan Animation (Bonus)
**Not required, but noted from competitors:** Pan transitions (e.g., when user clicks "Center on aircraft" or searches a zone) should also animate smoothly rather than jump instantly.

**Current status:** Known not to animate (direct `.setView()` call is instant).

**Expected when revisited:** 300ms easing animation for pan, coordinated with zoom if both change.

## Success Criteria (When Implementation Resumes)

- [ ] Zoom in/out feels smooth and responsive (not instant, not sluggish)
- [ ] Map remains responsive at max zoom (`maxZoom: 19`) — no freezes, no CPU spikes
- [ ] No visual artifacts or tile-loading hangs at any zoom level
- [ ] Performance profile clean in DevTools (CPU < 10% idle at max zoom, memory stable)
- [ ] Competitors' interactions match or exceed these baselines (FlightRadar24, FlightAware spot-check)

## Non-Requirements (Explicitly Out of Scope for Now)

- WebGL tile layers or custom rendering (Leaflet's Canvas/SVG is sufficient)
- 3D tilt/rotate (single-plane 2D tracking is the app's scope)
- Vector tile optimization (current raster tiles work fine)
- Gesture support (pinch-zoom on mobile — may be a later UX+Frontend task)

## Why This Matters

Smooth interactions are foundational to responsiveness perception. Users notice instantly if a map feels "janky" (instant zoom, freeze at max zoom). These are low-effort, high-polish wins that differentiate a polished tracker from a clunky one.

## Related Files

- `static/js/map-init.js` — Leaflet initialization, layer setup, basemap picker
- `tests/frontend/test_basemap.spec.js` — basemap switching tests (no zoom animation tests yet)
- CLAUDE.md § "Leaflet setup" — current documented map behavior

## Next Steps

When map work resumes:
1. Verify current Leaflet zoom animation is enabled and tuned
2. Performance-test at max zoom; identify any freezes/hangs
3. Add browser DevTools profiling (CPU/memory at max zoom)
4. Optional: add Playwright test for "zoom to max without freeze" UX interaction
