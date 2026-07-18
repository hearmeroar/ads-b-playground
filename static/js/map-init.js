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

// Basemap picker: nine free, no-API-key tile styles (same "no signup, no
// token" constraint that picked CARTO over Mapbox originally) the user can
// switch between via #basemap-filter (wired in state-filters.js). Each
// L.tileLayer is built once up front — cheap, since a tile layer fetches
// nothing until it's actually added to the map — and kept in baseLayers so
// switching back to a previously-viewed style redraws from Leaflet's own
// tile cache instead of refetching, rather than constructing a fresh layer
// on every switch.
const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
  '&copy; <a href="https://carto.com/attributions">CARTO</a>';
const BASE_LAYERS = {
  light: {
    label: 'Light', swatch: '#e3e5e8',
    url: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTRIBUTION, maxZoom: 19,
  },
  dark: {
    label: 'Dark', swatch: '#333744',
    url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTRIBUTION, maxZoom: 19,
  },
  voyager: {
    label: 'Voyager', swatch: '#f5cf8f',
    url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTRIBUTION, maxZoom: 19,
  },
  // Standard OpenStreetMap tiles — the single most recognizable web map
  // look. Note: OSM's tile usage policy discourages embedding this in a
  // high-traffic production app without self-hosting; accepted here since
  // this is a low-traffic personal tracker, not a production service.
  streets: {
    label: 'Streets', swatch: '#a8d0a0',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19, subdomains: 'abc',
  },
  // Esri's free public World Imagery service — note the tile URL order is
  // {z}/{y}/{x}, not {z}/{x}/{y} like every other layer here.
  satellite: {
    label: 'Satellite', swatch: '#3d4a3d',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxZoom: 19,
  },
  // OpenTopoMap — free community topographic tiles, same informal
  // "don't hammer it" courtesy norm as OSM (which its own tiles derive from).
  terrain: {
    label: 'Terrain', swatch: '#c9b78c',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM ' +
      '| Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17, subdomains: 'abc',
  },
  // Three more Esri ArcGIS Online basemaps (same free service/{z}/{y}/{x}
  // order as Satellite above), added to compare elevation-focused styles:
  // Physical is a genuine standalone hypsometric-tint relief map (colored
  // by elevation, green lowlands to tan/white highlands); Terrain Base and
  // Hillshade are both intentionally pale/muted underlay layers (designed
  // to be combined with a labels overlay this app doesn't add), included
  // anyway for comparison since that was asked for directly.
  physical: {
    label: 'Physical', swatch: '#c7d9a3',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri — Source: US National Park Service',
    // World_Physical_Map's own native data tops out around zoom 8;
    // maxNativeZoom upscales its last real tile beyond that instead of
    // Leaflet just showing blank tiles past zoom 8.
    maxZoom: 19, maxNativeZoom: 8,
  },
  terrainbase: {
    label: 'Terrain Base', swatch: '#cde8e6',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri — Source: USGS, Esri, TANA, DeLorme, and NPS',
    maxZoom: 19, maxNativeZoom: 13,
  },
  hillshade: {
    label: 'Hillshade', swatch: '#d9d9d9',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19, maxNativeZoom: 13,
  },
};
const baseLayers = {};
for (const key of Object.keys(BASE_LAYERS)) {
  const cfg = BASE_LAYERS[key];
  baseLayers[key] = L.tileLayer(cfg.url, {
    attribution: cfg.attribution, maxZoom: cfg.maxZoom, subdomains: cfg.subdomains || 'abc',
    maxNativeZoom: cfg.maxNativeZoom,
  });
}
let currentBaseLayerKey = 'voyager';
baseLayers[currentBaseLayerKey].addTo(map);

function setBaseLayer(key) {
  if (key === currentBaseLayerKey || !baseLayers[key]) return;
  map.removeLayer(baseLayers[currentBaseLayerKey]);
  currentBaseLayerKey = key;
  map.addLayer(baseLayers[currentBaseLayerKey]);
}

// Weather radar overlay — RainViewer (https://www.rainviewer.com/api.html),
// free, no API key, and (confirmed via curl -I) sends
// Access-Control-Allow-Origin: * on both its discovery JSON and its tile
// images. That's the actual reason every other source in this app goes
// through a backend proxy (OpenSky sends no CORS headers at all) — since
// RainViewer already sends an open one, calling it straight from the
// browser follows the same rule as everywhere else, not an exception to it.
// Off by default (#weather-filter in state-filters.js, same supplementary-
// display-toggle convention as scan-radius rings).
//
// Dedicated pane, not the default tilePane: base layers (map-init.js's
// baseLayers) also live in tilePane, and Leaflet stacks same-pane layers
// by add order — switching basemaps calls map.addLayer() on the newly
// chosen one *after* the weather layer was already added, which silently
// buried the radar under the new base tiles (looked like the weather
// layer "disappeared" on every basemap switch). A pane between tilePane
// (200) and overlayPane (400, scan-radius rings) fixes this regardless of
// which basemap is active or when it was switched.
map.createPane('weatherPane');
map.getPane('weatherPane').style.zIndex = 350;

const RAINVIEWER_ATTRIBUTION = 'Weather &copy; <a href="https://www.rainviewer.com">RainViewer</a>';
// RainViewer's radar tiles genuinely stop at native zoom 7 — confirmed by
// fetching actual tile bytes (not just the HTTP status, which is 200
// either way): past zoom 7 the server returns a real, valid, ~1-3KB PNG
// that just reads "Zoom Level Not Supported" in gray text, at both the
// 256 and 512 tileSize options. maxNativeZoom stops Leaflet from ever
// requesting z>7 (it upscales the z=7 tile instead), while maxZoom stays
// 19 so the layer still renders at the map's actual max zoom, just blurry
// past z=7 rather than showing that placeholder image.
const WEATHER_MODES = {
  radar: { label: 'Precipitation', framesKey: 'past' },
  nowcast: { label: 'Forecast', framesKey: 'nowcast' },
};
let weatherLayer = null;
let currentWeatherMode = 'off'; // 'off' | 'radar' | 'nowcast'
let weatherRefreshTimer = null;

function refreshWeatherRadar() {
  fetch('https://api.rainviewer.com/public/weather-maps.json')
    .then((resp) => resp.json())
    .then((data) => {
      if (currentWeatherMode === 'off') return; // switched off while this fetch was in flight
      const modeCfg = WEATHER_MODES[currentWeatherMode];
      const frames = data && data.radar && data.radar[modeCfg.framesKey];
      if (weatherLayer) { map.removeLayer(weatherLayer); weatherLayer = null; }
      if (!frames || !frames.length) return; // e.g. nowcast frames aren't always published
      const latest = frames[frames.length - 1];
      const url = 'https://tilecache.rainviewer.com' + latest.path + '/256/{z}/{x}/{y}/2/1_1.png';
      weatherLayer = L.tileLayer(url, {
        attribution: RAINVIEWER_ATTRIBUTION, opacity: 0.6,
        maxZoom: 19, maxNativeZoom: 7, pane: 'weatherPane',
      });
      weatherLayer.addTo(map);
    })
    .catch(() => {}); // a failed refresh just leaves the last-good frame showing
}

// RainViewer's own composite updates roughly every 10 minutes; polling
// every 5 keeps the displayed frame from ever being too stale without
// hammering it. Only runs while a mode other than 'off' is selected.
function setWeatherMode(mode) {
  currentWeatherMode = mode;
  clearInterval(weatherRefreshTimer);
  weatherRefreshTimer = null;
  if (mode === 'off') {
    if (weatherLayer) { map.removeLayer(weatherLayer); weatherLayer = null; }
    return;
  }
  refreshWeatherRadar();
  weatherRefreshTimer = setInterval(refreshWeatherRadar, 5 * 60 * 1000);
}
