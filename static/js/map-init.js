// Map center — roughly the center of Serbia. The request areas are defined
// on the backend (app.py: AREA_CENTER, which BBOX and every RADIUS_SOURCES
// entry's own center are derived from) and should all roughly match this
// view. The [44.0, 21.0]/8 below is a hardcoded fallback so the map paints
// immediately without waiting on a round trip; /api/config below then
// corrects the view to the backend's actual AREA_CENTER/AREA_ZOOM if they
// ever drift from this fallback, without changing when `map` itself becomes
// available (every other script here still assumes it's ready synchronously).
// Zoom control moved to bottom-left: the sidebar (see #sidebar) docks to the
// top-left corner and would otherwise sit on top of it.
const map = L.map('map', { zoomControl: false }).setView([44.0, 21.0], 8);
L.control.zoom({ position: 'bottomleft' }).addTo(map);

// Scan-radius range rings: shows where the four radius sources' shared
// query area (app.py's AREA_RADIUS_NM) actually ends — a single circle
// gives no sense of scale, so this draws round-number scale rings (50 nm
// steps, chosen generically below so it still looks right if
// AREA_RADIUS_NM ever changes) plus one visually distinct ring at the true
// coverage edge. Off by default (see #toggle-scan-radius in main.js) — a
// display-only layer, not added to the map until toggled on.
const NM_TO_M = 1852;

// Picks a round ring spacing so the radius divides into a readable ~5 or
// fewer rings, rather than an arbitrary fraction of the radius (e.g. 3
// evenly-spaced rings would label "73 nm" — not a distance anyone reads at
// a glance the way "50 nm" is).
function niceRingStepNm(radiusNm) {
  const candidates = [25, 50, 100, 150, 200, 250];
  for (const step of candidates) if (radiusNm / step <= 5) return step;
  return candidates[candidates.length - 1];
}

function ringLabelMarker(centerLat, centerLon, distanceNm, text, extraClass) {
  const pos = destinationPoint(centerLat, centerLon, 0, distanceNm * 1.852);
  return L.marker([pos.lat, pos.lon], {
    icon: L.divIcon({
      className: 'radius-ring-label' + (extraClass ? ' ' + extraClass : ''),
      html: text,
      iconSize: null,
    }),
    interactive: false,
  });
}

function buildScanRadiusLayer(centerLat, centerLon, radiusNm) {
  const layer = L.layerGroup();
  const step = niceRingStepNm(radiusNm);
  for (let d = step; d < radiusNm; d += step) {
    L.circle([centerLat, centerLon], {
      radius: d * NM_TO_M, color: '#94a3b8', weight: 1, dashArray: '4,5',
      fill: false, interactive: false,
    }).addTo(layer);
    ringLabelMarker(centerLat, centerLon, d, d + ' nm').addTo(layer);
  }
  // The true coverage edge — where the four radius sources' data actually
  // stops — is a different kind of fact than a scale tick, so it gets its
  // own distinct (solid, accent-colored) styling rather than blending into
  // the round-number ticks above.
  L.circle([centerLat, centerLon], {
    radius: radiusNm * NM_TO_M, color: '#2563eb', weight: 1.5, dashArray: '2,4',
    fill: false, interactive: false,
  }).addTo(layer);
  ringLabelMarker(centerLat, centerLon, radiusNm, 'Scan radius (' + radiusNm + ' nm)', 'radius-ring-label-edge').addTo(layer);
  return layer;
}

// Starts as an empty placeholder rather than calling buildScanRadiusLayer
// synchronously here — this script runs before route-validation.js (see
// CLAUDE.md's script-order note), so destinationPoint isn't defined yet at
// this point in the load sequence. The real rings are built once
// /api/config resolves below (genuinely async, so by then every script has
// already loaded); the toggle defaults to off, so there's no visible gap.
let scanRadiusLayer = L.layerGroup();

fetch('/api/config')
  .then((resp) => resp.json())
  .then((cfg) => {
    if (cfg && cfg.center) map.setView([cfg.center.lat, cfg.center.lon], cfg.zoom);
    if (cfg && cfg.center && cfg.radius_nm) {
      const wasShown = map.hasLayer(scanRadiusLayer);
      if (wasShown) map.removeLayer(scanRadiusLayer);
      scanRadiusLayer = buildScanRadiusLayer(cfg.center.lat, cfg.center.lon, cfg.radius_nm);
      if (wasShown) scanRadiusLayer.addTo(map);
    }
  })
  .catch(() => {}); // fallback view above already stands if this fails

// Ground/tower markers render on a lower pane so aircraft always appear above them
map.createPane('groundPane');
map.getPane('groundPane').style.zIndex = 450;

// CARTO's free "Positron" basemap — monochrome/light grey, no API key
// required (unlike Mapbox, which would need a signup + access token).
// Attribution to both CARTO and OSM is required by CARTO's terms of use.
L.tileLayer('https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
    '&copy; <a href="https://carto.com/attributions">CARTO</a>',
  maxZoom: 19,
}).addTo(map);
