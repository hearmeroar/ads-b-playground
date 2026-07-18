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

fetch('/api/config')
  .then((resp) => resp.json())
  .then((cfg) => {
    if (cfg && cfg.center) map.setView([cfg.center.lat, cfg.center.lon], cfg.zoom);
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
