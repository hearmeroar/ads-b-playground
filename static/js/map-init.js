// Map center — roughly the center of Serbia. The request areas are defined
// on the backend (app.py: BBOX for OpenSky, ADSBFI_CENTER / AIRPLANESLIVE_CENTER
// for the other two) and should all roughly match this view.
// Zoom control moved to bottom-left: the sidebar (see #sidebar) docks to the
// top-left corner and would otherwise sit on top of it.
const map = L.map('map', { zoomControl: false }).setView([44.0, 21.0], 8);
L.control.zoom({ position: 'bottomleft' }).addTo(map);

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
