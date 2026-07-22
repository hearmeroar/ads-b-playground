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

// The backend's current AREA_CENTER — kept in sync here and by
// selectZoneSearchResult() (state-filters.js) on a runtime zone switch, so
// that a "no nearest airport" collection card (auth-collection.js's
// formatCardLocation()) can still show a humanized "N km from center"
// distance instead of bare coordinates. null until the first /api/config
// resolves; a card save that races that window just shows bare coordinates.
let currentAreaCenter = null;

fetch('/api/config')
  .then((resp) => resp.json())
  .then((cfg) => {
    if (cfg && cfg.center) map.setView([cfg.center.lat, cfg.center.lon], cfg.zoom);
    if (cfg && cfg.center) currentAreaCenter = cfg.center;
    if (cfg && cfg.center && cfg.radius_nm) {
      const wasShown = map.hasLayer(scanRadiusLayer);
      if (wasShown) map.removeLayer(scanRadiusLayer);
      scanRadiusLayer = buildScanRadiusLayer(cfg.center.lat, cfg.center.lon, cfg.radius_nm);
      if (wasShown) scanRadiusLayer.addTo(map);
    }
  })
  .catch(() => {}); // fallback view above already stands if this fails

// Airline logo manifest (ICAO 3-letter designator -> vendored logo file per
// tier, see render-details.js's airlineLogoHtml()): static, not backend-
// generated, so a plain fetch of the vendored JSON is enough — no /api
// round trip needed. Starts as {} so an aircraft selected before this
// resolves just renders no logo, same graceful-degradation as a genuinely
// unrecognized ICAO code; nothing re-renders once it lands, but the async
// window is normally far shorter than the time it takes a user to open a
// sidebar.
let AIRLINE_LOGO_MANIFEST = {};
fetch('airline-logos/manifest.json')
  .then((resp) => resp.json())
  .then((manifest) => { AIRLINE_LOGO_MANIFEST = manifest; })
  .catch(() => {});

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
let currentBaseLayerKey = 'dark';
baseLayers[currentBaseLayerKey].addTo(map);

function setBaseLayer(key) {
  if (key === currentBaseLayerKey || !baseLayers[key]) return;
  map.removeLayer(baseLayers[currentBaseLayerKey]);
  currentBaseLayerKey = key;
  map.addLayer(baseLayers[currentBaseLayerKey]);
}

// --- Weather layers ---------------------------------------------------------
// Four independent, simultaneously-toggleable layers (#weather-filter's own
// checkboxes in state-filters.js — deliberately not a single-select picker
// like the basemap one, since e.g. Precipitation + SIGMET together is a very
// normal combination to want on at once):
//   - Precipitation / Forecast: RainViewer tile composites (see below).
//   - SIGMET: aviation hazard-zone polygons (icing, turbulence, convective
//     activity, ash) from aviationweather.gov, proxied via /api/sigmet since
//     that source sends no CORS header at all (confirmed via curl -I -H
//     "Origin: ..." — unlike RainViewer, this one genuinely needs the same
//     kind of backend proxy OpenSky does).
//   - METAR: airport weather-station observations from the same source, via
//     /api/metar, rendered as small colored dots.
// Each has its own enabled flag + refresh timer, all sharing one
// WEATHER_REFRESH_INTERVAL_MS cadence — independent because a user turning
// off SIGMET shouldn't stop e.g. Precipitation's own timer.
const WEATHER_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// Dedicated pane, not the default tilePane: base layers (map-init.js's
// baseLayers) also live in tilePane, and Leaflet stacks same-pane layers by
// add order — switching basemaps calls map.addLayer() on the newly chosen
// one *after* a weather tile layer was already added, which would silently
// bury it under the new base tiles (looked like the weather layer
// "disappeared" on every basemap switch). A pane between tilePane (200) and
// overlayPane (400, scan-radius rings/SIGMET polygons/METAR markers) fixes
// this regardless of which basemap is active or when it was switched. Only
// the two RainViewer tile layers need this pane — SIGMET/METAR are vector
// layers in the ordinary overlayPane, which was never affected by the
// basemap-swap bug (base layers don't touch overlayPane at all).
map.createPane('weatherPane');
map.getPane('weatherPane').style.zIndex = 350;

// --- Precipitation / Forecast (RainViewer, https://www.rainviewer.com/api.html) ---
// Free, no API key, and (confirmed via curl -I) sends
// Access-Control-Allow-Origin: * on both its discovery JSON and its tile
// images — the first data source in this app callable directly from the
// browser with no backend proxy, since CORS (not licensing) was always the
// actual reason for one elsewhere.
const RAINVIEWER_ATTRIBUTION = 'Weather &copy; <a href="https://www.rainviewer.com">RainViewer</a>';
// RainViewer's radar tiles genuinely stop at native zoom 7 — confirmed by
// fetching actual tile bytes (not just the HTTP status, which is 200
// either way): past zoom 7 the server returns a real, valid, ~1-3KB PNG
// that just reads "Zoom Level Not Supported" in gray text, at both the
// 256 and 512 tileSize options. maxNativeZoom stops Leaflet from ever
// requesting z>7 (it upscales the z=7 tile instead), while maxZoom stays
// 19 so the layer still renders at the map's actual max zoom, just blurry
// past z=7 rather than showing that placeholder image.
const WEATHER_TILE_MODES = {
  precip: { framesKey: 'past' },
  nowcast: { framesKey: 'nowcast' }, // not always published — an empty result is normal, not an error
};
const weatherTileState = {
  precip: { layer: null, enabled: false, timer: null },
  nowcast: { layer: null, enabled: false, timer: null },
};

function refreshWeatherTileLayer(key) {
  const state = weatherTileState[key];
  fetch('https://api.rainviewer.com/public/weather-maps.json')
    .then((resp) => resp.json())
    .then((data) => {
      if (!state.enabled) return; // toggled off while this fetch was in flight
      const frames = data && data.radar && data.radar[WEATHER_TILE_MODES[key].framesKey];
      if (state.layer) { map.removeLayer(state.layer); state.layer = null; }
      if (!frames || !frames.length) return;
      const latest = frames[frames.length - 1];
      const url = 'https://tilecache.rainviewer.com' + latest.path + '/256/{z}/{x}/{y}/2/1_1.png';
      state.layer = L.tileLayer(url, {
        attribution: RAINVIEWER_ATTRIBUTION, opacity: 0.6,
        maxZoom: 19, maxNativeZoom: 7, pane: 'weatherPane',
      });
      state.layer.addTo(map);
    })
    .catch(() => {}); // a failed refresh just leaves the last-good frame showing
}

// RainViewer's own composite updates roughly every 10 minutes; polling every
// 5 keeps the displayed frame from ever being too stale without hammering it.
function setWeatherTileLayerEnabled(key, enabled) {
  const state = weatherTileState[key];
  state.enabled = enabled;
  clearInterval(state.timer);
  state.timer = null;
  if (!enabled) {
    if (state.layer) { map.removeLayer(state.layer); state.layer = null; }
    return;
  }
  refreshWeatherTileLayer(key);
  state.timer = setInterval(() => refreshWeatherTileLayer(key), WEATHER_REFRESH_INTERVAL_MS);
}

// --- SIGMET (significant weather hazards for aviation) ---------------------
// aviationweather.gov's international-SIGMET endpoint ignores bbox/loc query
// params entirely (confirmed live — identical global ~144-record response
// regardless), so /api/sigmet does the "near our area" filtering server-side
// instead; the frontend just renders whatever comes back.
const SIGMET_HAZARD_COLORS = {
  CONVECTIVE: '#dc2626', TS: '#dc2626', TURB: '#f97316', ICE: '#3b82f6',
  ASH: '#78716c', IFR: '#a855f7', MTN_OBSCN: '#a855f7',
};
function sigmetColor(hazard) { return SIGMET_HAZARD_COLORS[hazard] || '#6b7280'; }

const weatherSigmetState = { layer: null, enabled: false, timer: null };

function refreshSigmet() {
  fetch('/api/sigmet')
    .then((resp) => resp.json())
    .then((data) => {
      if (!weatherSigmetState.enabled) return;
      if (weatherSigmetState.layer) { map.removeLayer(weatherSigmetState.layer); weatherSigmetState.layer = null; }
      if (!Array.isArray(data) || !data.length) return;
      const group = L.layerGroup();
      for (const sigmet of data) {
        // sigmet.coords' shape depends on sigmet.geom: a single-polygon
        // SIGMET ("AREA") is a flat list of {lat,lon} points; a
        // multi-polygon one ("AREAS" — e.g. two separate boxes describing
        // a "west of this line / east of that line" corridor, confirmed
        // against a real FCBB/Brazzaville SIGMET) is a list of *rings*,
        // each itself a list of points. Normalize both into a list of
        // rings (length 1 for "AREA") and draw one polygon per ring.
        const rawRings = sigmet.coords && sigmet.coords.length && Array.isArray(sigmet.coords[0])
          ? sigmet.coords
          : [sigmet.coords || []];
        const label = [sigmet.hazard, sigmet.qualifier].filter(Boolean).join(' ');
        const altRange = sigmet.base != null && sigmet.top != null ? `<br>${sigmet.base}-${sigmet.top} ft` : '';
        for (const ring of rawRings) {
          const coords = ring.filter((c) => c.lat != null && c.lon != null).map((c) => [c.lat, c.lon]);
          if (coords.length < 3) continue; // not a real polygon
          const poly = L.polygon(coords, { color: sigmetColor(sigmet.hazard), weight: 2, fillOpacity: 0.15 });
          poly.bindPopup(`<b>${label}</b><br>${sigmet.firName || ''}${altRange}`);
          group.addLayer(poly);
        }
      }
      group.addTo(map);
      weatherSigmetState.layer = group;
    })
    .catch(() => {});
}

function setSigmetEnabled(enabled) {
  weatherSigmetState.enabled = enabled;
  clearInterval(weatherSigmetState.timer);
  weatherSigmetState.timer = null;
  if (!enabled) {
    if (weatherSigmetState.layer) { map.removeLayer(weatherSigmetState.layer); weatherSigmetState.layer = null; }
    return;
  }
  refreshSigmet();
  weatherSigmetState.timer = setInterval(refreshSigmet, WEATHER_REFRESH_INTERVAL_MS);
}

// --- METAR (airport weather-station observations) --------------------------
// Standard aviation flight-category colors (VFR/MVFR/IFR/LIFR), same
// convention pilots and every aviation weather display already use.
const METAR_CATEGORY_COLORS = { VFR: '#22c55e', MVFR: '#3b82f6', IFR: '#ef4444', LIFR: '#d946ef' };
function metarColor(category) { return METAR_CATEGORY_COLORS[category] || '#6b7280'; }

const weatherMetarState = { layer: null, enabled: false, timer: null };

function refreshMetar() {
  fetch('/api/metar')
    .then((resp) => resp.json())
    .then((data) => {
      if (!weatherMetarState.enabled) return;
      if (weatherMetarState.layer) { map.removeLayer(weatherMetarState.layer); weatherMetarState.layer = null; }
      if (!Array.isArray(data) || !data.length) return;
      const group = L.layerGroup();
      for (const station of data) {
        if (station.lat == null || station.lon == null) continue;
        const marker = L.circleMarker([station.lat, station.lon], {
          radius: 5, color: '#fff', weight: 1, fillColor: metarColor(station.fltCat), fillOpacity: 0.9,
        });
        marker.bindPopup(`<b>${station.name || station.icaoId || ''}</b><br><code>${station.rawOb || ''}</code>`);
        group.addLayer(marker);
      }
      group.addTo(map);
      weatherMetarState.layer = group;
    })
    .catch(() => {});
}

function setMetarEnabled(enabled) {
  weatherMetarState.enabled = enabled;
  clearInterval(weatherMetarState.timer);
  weatherMetarState.timer = null;
  if (!enabled) {
    if (weatherMetarState.layer) { map.removeLayer(weatherMetarState.layer); weatherMetarState.layer = null; }
    return;
  }
  refreshMetar();
  weatherMetarState.timer = setInterval(refreshMetar, WEATHER_REFRESH_INTERVAL_MS);
}

// --- Airports ----------------------------------------------------------
// Renders airports (OurAirports, see enrichment/airports.py's module
// docstring for source/license/why the dataset is global) as markers.
// Unlike every layer above, this one isn't refreshed on a timer — airport
// positions don't change during a session — it's refreshed by *where the
// map is looking*: /api/airports is called with the current viewport's
// bounds (`bbox`), re-fetched on pan/zoom (debounced), so panning from one
// region to another swaps in that region's airports without ever asking
// the backend for (or holding in the browser) the whole ~85,700-airport
// world at once.
//
// Airport markers render above weather/scan-radius (overlayPane, 400) and
// ground-vehicle markers (groundPane, 450) but below real aircraft
// (markerPane, 600) — an airport pin should never visually compete with an
// aircraft actually sitting over it.
map.createPane('airportPane');
map.getPane('airportPane').style.zIndex = 460;

// Even scoped to one viewport, a zoomed-out view (a whole country/continent)
// can still hold thousands of airports/heliports — Leaflet.markercluster
// (vendored at static/leaflet-markercluster/) keeps that many markers from
// ever being placed on the map unclustered. clusterPane matches the pane
// above so cluster bubbles layer the same way individual airport markers do.
const AIRPORTS_FETCH_DEBOUNCE_MS = 500;

const airportsState = {
  clusterGroup: L.markerClusterGroup({ clusterPane: 'airportPane', maxClusterRadius: 60 }),
  enabled: false,
  debounceTimer: null,
  // Per-size checklist (static/index.html's #airports-type-list) — Large
  // and Medium ship on, matching the HTML's own `checked` attributes;
  // everything else is opt-in. Sent to /api/airports as a `types` param so
  // filtering happens server-side rather than fetching every type and
  // discarding markers client-side.
  enabledTypes: new Set(['large_airport', 'medium_airport']),
};

const AIRPORT_TYPE_LABELS = {
  large_airport: 'Large airport', medium_airport: 'Medium airport', small_airport: 'Small airport',
  heliport: 'Heliport', seaplane_base: 'Seaplane base', balloonport: 'Balloonport',
};

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Small header glyph for the popup card below — the same AIRPORT_GLYPH/
// HELIPORT_GLYPH markup airportIcon() (icons.js) draws on the map itself,
// so the popup and its marker read as the same object rather than two
// independently-styled representations of it.
function airportPopupIconSvg(type) {
  const glyph = (type === 'heliport' ? HELIPORT_GLYPH : AIRPORT_GLYPH).replace(/COLOR/g, AIRPORT_MARKER_COLOR);
  return '<svg width="22" height="22" viewBox="0 0 24 24">' + glyph + '</svg>';
}

// Reworked into the app's own glass-card look (see .airport-popup* in
// style.css) instead of Leaflet's plain default popup text — a title +
// type badge header, monospace code chips for IATA/ICAO, then place/
// elevation as their own rows, rather than one long <b>/<br> string.
function airportPopupHtml(airport) {
  const typeLabel = AIRPORT_TYPE_LABELS[airport.type] || 'Airport';
  const codes = [airport.iata, airport.icao].filter(Boolean);
  const flag = airport.country && typeof flagHtml === 'function' ? flagHtml(airport.country) : '';
  // country_name (a display name, e.g. "Serbia") is resolved backend-side
  // from the raw ISO code via country_by_iso() — falls back to the bare
  // code itself if that lookup has no entry for it, rather than showing
  // nothing next to the flag.
  const countryText = airport.country_name || airport.country;
  const place = [airport.municipality ? escapeHtml(airport.municipality) : '', escapeHtml(countryText || '')]
    .filter(Boolean).join(', ');
  const elevation = airport.elevation_ft != null ? Math.round(airport.elevation_ft * FT_TO_M) + ' m' : null;

  let html = '<div class="airport-popup-card">';
  html += '<div class="airport-popup-header">';
  html += '<span class="airport-popup-icon">' + airportPopupIconSvg(airport.type) + '</span>';
  html += '<div><div class="airport-popup-name">' + escapeHtml(airport.name) + '</div>';
  html += '<div class="airport-popup-type">' + escapeHtml(typeLabel) + '</div></div>';
  html += '</div>';
  if (codes.length) {
    html += '<div class="airport-popup-codes">' +
      codes.map((c) => '<span class="airport-popup-code-chip">' + escapeHtml(c) + '</span>').join('') +
      '</div>';
  }
  if (place) {
    html += '<div class="airport-popup-row">' + (flag ? flag + ' ' : '') + place + '</div>';
  }
  if (elevation) {
    html += '<div class="airport-popup-row airport-popup-row-muted">Elevation: ' + elevation + '</div>';
  }
  html += '</div>';
  return html;
}

function refreshAirportsInView() {
  if (!airportsState.enabled) return;
  // An empty checklist means "show nothing" — not "no types param", which
  // the backend would instead read as "no filter, show every type".
  if (airportsState.enabledTypes.size === 0) {
    airportsState.clusterGroup.clearLayers();
    return;
  }
  const b = map.getBounds();
  const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].join(',');
  const types = Array.from(airportsState.enabledTypes).join(',');
  fetch('/api/airports?bbox=' + encodeURIComponent(bbox) + '&types=' + encodeURIComponent(types))
    .then((resp) => resp.json())
    .then((data) => {
      if (!airportsState.enabled) return; // toggled off while this fetch was in flight
      airportsState.clusterGroup.clearLayers();
      const airports = (data && data.airports) || [];
      for (const airport of airports) {
        if (airport.lat == null || airport.lon == null) continue;
        const marker = L.marker([airport.lat, airport.lon], { icon: airportIcon(airport.type), pane: 'airportPane' });
        marker.bindPopup(airportPopupHtml(airport), { className: 'airport-popup', minWidth: 170, maxWidth: 260 });
        airportsState.clusterGroup.addLayer(marker);
      }
    })
    .catch(() => {}); // a failed refresh just leaves the last-good markers showing
}

function scheduleAirportsRefresh() {
  clearTimeout(airportsState.debounceTimer);
  airportsState.debounceTimer = setTimeout(refreshAirportsInView, AIRPORTS_FETCH_DEBOUNCE_MS);
}

function setAirportsEnabled(enabled) {
  airportsState.enabled = enabled;
  if (!enabled) {
    clearTimeout(airportsState.debounceTimer);
    map.off('moveend', scheduleAirportsRefresh);
    airportsState.clusterGroup.clearLayers();
    if (map.hasLayer(airportsState.clusterGroup)) map.removeLayer(airportsState.clusterGroup);
    return;
  }
  airportsState.clusterGroup.addTo(map);
  refreshAirportsInView();
  map.on('moveend', scheduleAirportsRefresh);
}

// Called from the per-size checklist (state-filters.js) — an explicit user
// choice, so it re-fetches immediately rather than waiting for the pan
// debounce above (which exists to smooth a drag/zoom gesture, not a
// deliberate checkbox click).
function setAirportsTypeEnabled(type, enabled) {
  if (enabled) airportsState.enabledTypes.add(type);
  else airportsState.enabledTypes.delete(type);
  refreshAirportsInView();
}
