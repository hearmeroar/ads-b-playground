const openskyMarkers = new Map(); // icao24 -> L.Marker
const adsbfiMarkers = new Map(); // hex -> L.Marker
const adsblolMarkers = new Map(); // hex -> L.Marker
const adsboneMarkers = new Map(); // hex -> L.Marker
const airplanesliveMarkers = new Map(); // hex -> L.Marker
const flightawareMarkers = new Map(); // fa_flight_id -> L.Marker
const flightradar24Markers = new Map(); // icao24 -> L.Marker
const markerMapsBySource = {
  opensky: openskyMarkers, adsbfi: adsbfiMarkers, adsblol: adsblolMarkers,
  adsbone: adsboneMarkers, airplaneslive: airplanesliveMarkers, flightaware: flightawareMarkers,
  flightradar24: flightradar24Markers,
};

const sourceToggles = {
  opensky: document.getElementById('toggle-opensky'),
  adsbfi: document.getElementById('toggle-adsbfi'),
  adsblol: document.getElementById('toggle-adsblol'),
  adsbone: document.getElementById('toggle-adsbone'),
  airplaneslive: document.getElementById('toggle-airplaneslive'),
  flightaware: document.getElementById('toggle-flightaware'),
  flightradar24: document.getElementById('toggle-flightradar24'),
};
function isSourceEnabled(name) {
  return sourceToggles[name].checked;
}

// Motion filter ('all' | 'airborne' | 'ground') is a filter, not a data
// source. Unlike source toggles, it doesn't gate any fetch — it's applied
// while each source builds its marker items, using OpenSky's own `on_ground`
// field or adsb.fi/airplanes.live's `alt_baro === 'ground'` convention.
let currentMotionFilter = 'all';
const motionFilterButtons = document.querySelectorAll('#motion-filter .seg-btn');
motionFilterButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('active')) return;
    motionFilterButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentMotionFilter = btn.dataset.value;
    motionFilterButtons.forEach((b) => { b.disabled = true; });
    document.getElementById('motion-filter-spinner').hidden = false;
    poll().finally(() => { // apply right away instead of waiting for the next 12s tick
      motionFilterButtons.forEach((b) => { b.disabled = false; });
      document.getElementById('motion-filter-spinner').hidden = true;
    });
  });
});
function passesMotionFilter(onGround) {
  if (currentMotionFilter === 'airborne') return !onGround;
  if (currentMotionFilter === 'ground') return !!onGround;
  return true;
}

// Unit system ('metric' | 'imperial') only changes how renderDetailsHtml()
// formats already-normalized numbers (meters/km-h internally, always) — it
// doesn't touch fetching or parsing, so toggling re-renders the open
// sidebar immediately rather than waiting for the next poll.
let currentUnitSystem = 'metric';
const unitToggleButtons = document.querySelectorAll('#unit-toggle .seg-btn');
unitToggleButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('active')) return;
    unitToggleButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentUnitSystem = btn.dataset.value;
    if (selectedIcao24 != null) renderSelectedDetails();
  });
});

// Dev mode only changes how renderDetailsHtml() renders an already-
// normalized info/fieldSources pair (shows every field with a dash
// placeholder when missing, plus a colored per-source dot when present) —
// like currentUnitSystem, it doesn't touch fetching or parsing, so toggling
// re-renders the open sidebar immediately rather than waiting for the next poll.
let currentDevMode = false;
const devModeToggle = document.getElementById('toggle-dev-mode');
// adsbdb's own source-row is only relevant once dev mode is on (that's the
// only place its badge dot can ever show), so it stays hidden the rest of
// the time — same style.display show/hide mechanism already used for
// #opensky-help's quota-lockout state, just driven by this toggle instead.
const adsbdbSourceRow = document.getElementById('source-adsbdb');
const adsbdbToggle = document.getElementById('toggle-adsbdb');
devModeToggle.addEventListener('change', () => {
  currentDevMode = devModeToggle.checked;
  adsbdbSourceRow.style.display = currentDevMode ? '' : 'none';
  devAircraftPanel.style.display = currentDevMode ? '' : 'none';
  // The sidebar (higher z-index) would otherwise sit directly on top of
  // the dev-mode aircraft table whenever both are open — dock it to the
  // table's right instead so both stay visible/usable together.
  sidebarEl.classList.toggle('dev-shifted', currentDevMode);
  if (currentDevMode) { renderDevAircraftTable(); refreshIdentityStats(); }
  if (selectedIcao24 != null) renderSelectedDetails();
});
adsbdbToggle.addEventListener('change', () => {
  adsbdbEnabled = adsbdbToggle.checked;
});

let autoCenterOnSelect = true;
const autoCenterToggle = document.getElementById('toggle-auto-center');
autoCenterToggle.addEventListener('change', () => {
  autoCenterOnSelect = autoCenterToggle.checked;
});

// "Hide non-aircraft" filters out ground vehicles, obstacles, and
// reference/test beacons that some feeders report using the same message
// types as real aircraft. Signals used (any one is enough):
// - `category` in the ADS-B "surface vehicle / obstacle" range: numeric
//   16-20 for OpenSky, or C1-C5 for adsb.fi/airplanes.live's letter+digit code.
// - registration/aircraft-type equal to a known non-aircraft marker (so far
//   just "TWR", seen on tower reference/test transponders).
// - callsign matching an airport-ground-vehicle-style pattern: 4 letters
//   (airport code + unit letter) followed by 2 digits, e.g. "TXLU01".
const hideJunkToggle = document.getElementById('toggle-hide-junk');
function hideNonAircraft() {
  return hideJunkToggle.checked;
}

// Purely presentational (no data to (re)fetch), so — like devModeToggle
// above — this mutates the map directly instead of triggering poll().
// scanRadiusLayer (map-init.js) is reassigned once /api/config resolves,
// and again on every zone-search switch (selectZoneSearchResult() below);
// reading it here (rather than capturing it at listener-registration time)
// picks up whichever value is current automatically.
const scanRadiusToggle = document.getElementById('toggle-scan-radius');
scanRadiusToggle.addEventListener('change', () => {
  if (scanRadiusToggle.checked) scanRadiusLayer.addTo(map);
  else map.removeLayer(scanRadiusLayer);
});

// Four independent checkboxes (any combination can be on at once —
// deliberately not the basemap picker's single-select dropdown, since e.g.
// Precipitation + SIGMET together is a normal thing to want). Each setter
// (map-init.js) owns starting/stopping its own refresh interval and adding/
// removing its own layer — purely presentational, no poll() retrigger, same
// as the scan-radius toggle above.
document.getElementById('toggle-weather-precip').addEventListener('change', (e) => {
  setWeatherTileLayerEnabled('precip', e.target.checked);
});
document.getElementById('toggle-weather-nowcast').addEventListener('change', (e) => {
  setWeatherTileLayerEnabled('nowcast', e.target.checked);
});
document.getElementById('toggle-weather-sigmet').addEventListener('change', (e) => {
  setSigmetEnabled(e.target.checked);
});
document.getElementById('toggle-weather-metar').addEventListener('change', (e) => {
  setMetarEnabled(e.target.checked);
});

// Airports layer — same "purely presentational, own setter owns its own
// state" idiom as the weather toggles above, except setAirportsEnabled
// (map-init.js) also attaches/detaches its own pan/zoom listener instead of
// a fixed-interval timer, since airport positions don't change but the
// map's viewport does.
const airportsTypeListEl = document.getElementById('airports-type-list');
const airportsToggleButton = document.getElementById('toggle-airports');
airportsToggleButton.addEventListener('change', () => {
  const enabled = airportsToggleButton.checked;
  airportsTypeListEl.hidden = !enabled;
  setAirportsEnabled(enabled);
});

// Per-size checklist nested under the toggle above — each checkbox just
// flips its own type in/out of airportsState.enabledTypes and triggers an
// immediate re-fetch (map-init.js's setAirportsTypeEnabled), the same
// "own setter owns its own state" idiom as every other filter here.
document.querySelectorAll('.airport-type-checkbox').forEach((checkbox) => {
  checkbox.addEventListener('change', (e) => {
    setAirportsTypeEnabled(e.target.value, e.target.checked);
  });
});

const GROUND_VEHICLE_MARKERS = new Set(['TWR']);
const GROUND_VEHICLE_CALLSIGN_RE = /^[A-Z]{4}\d{2}$/;
function looksLikeGroundVehicle({ category, registration, aircraftType, callsign }) {
  if (registration && GROUND_VEHICLE_MARKERS.has(registration)) return true;
  if (aircraftType && GROUND_VEHICLE_MARKERS.has(aircraftType)) return true;
  const trimmedCallsign = (callsign || '').trim();
  if (trimmedCallsign && GROUND_VEHICLE_CALLSIGN_RE.test(trimmedCallsign)) return true;
  if (typeof category === 'number' && category >= 16 && category <= 20) return true;
  if (typeof category === 'string' && /^C[0-5]$/.test(category)) return true;
  return false;
}

// Category filter: OpenSky's numeric category and adsb.fi/airplanes.live's
// letter+digit code are two encodings of the same underlying ADS-B emitter
// category, so both are mapped to one shared set of group keys (matching the
// <option> values in #category-filter) for a single filter to work across
// all three sources.
const OPENSKY_CATEGORY_GROUP = {
  0: 'unknown', 1: 'unknown', 2: 'light', 3: 'small', 4: 'large',
  5: 'high_vortex_large', 6: 'heavy', 7: 'high_performance', 8: 'rotorcraft',
  9: 'glider', 10: 'lighter_than_air', 11: 'parachutist', 12: 'ultralight',
  13: 'unknown', 14: 'uav', 15: 'space',
  16: 'surface_obstacle', 17: 'surface_obstacle', 18: 'surface_obstacle',
  19: 'surface_obstacle', 20: 'surface_obstacle',
};
const ADSBEXCHANGE_CATEGORY_GROUP = {
  A0: 'unknown', A1: 'light', A2: 'small', A3: 'large', A4: 'high_vortex_large',
  A5: 'heavy', A6: 'high_performance', A7: 'rotorcraft',
  B0: 'unknown', B1: 'glider', B2: 'lighter_than_air', B3: 'parachutist',
  B4: 'ultralight', B5: 'unknown', B6: 'uav', B7: 'space',
  C0: 'unknown', C1: 'surface_obstacle', C2: 'surface_obstacle', C3: 'surface_obstacle',
  C4: 'surface_obstacle', C5: 'surface_obstacle', C6: 'unknown', C7: 'unknown',
};
// Whether OpenSky's own numeric category is meaningful (not 0/1 = "no
// info"/"no ADS-B category info"). Single source of truth shared with
// normalizeOpenSky() (parsers.js), which uses the same check to decide
// whether OpenSky's category label wins over a radius source's — the two
// checks used to be written independently (`category >= 2` there vs.
// `group !== 'unknown'` here) and disagreed on category 13 ("Reserved"):
// it passed the `>= 2` check but OPENSKY_CATEGORY_GROUP maps it to
// 'unknown', so the sidebar could show "Category: Reserved" while the
// marker icon/category filter treated the aircraft as unknown-category.
function openskyCategoryIsMeaningful(category) {
  return typeof category === 'number' && OPENSKY_CATEGORY_GROUP[category] !== undefined
    && OPENSKY_CATEGORY_GROUP[category] !== 'unknown';
}
function categoryGroupFor({ openskyCategory, adsbExchangeCategory }) {
  // OpenSky takes priority when it reported a meaningful category.
  if (openskyCategoryIsMeaningful(openskyCategory)) return OPENSKY_CATEGORY_GROUP[openskyCategory];
  // Otherwise fall back to adsb.fi/airplanes.live's own category.
  const adsbGroup = typeof adsbExchangeCategory === 'string' ? ADSBEXCHANGE_CATEGORY_GROUP[adsbExchangeCategory] : null;
  if (adsbGroup) return adsbGroup;
  return 'unknown';
}
// Category dropdown icons — same glyphs as the marker icon set, scaled for compact display.
// These use the exact same paths as the full aircraft icons but at 16×16 viewBox instead of 200×200.
const CATEGORY_ICON_SVGS = {
  all: { viewBox: '0 0 16 16', inner:
    '<rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor"/><rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor"/>' +
    '<rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor"/>' },
  light: { viewBox: '0 0 200 200', inner:
    '<g id="Thin-L" transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)"><path d="M 137.678 -39.456 C 137.678 -41.883 134.94 -44.391 133.645 -44.391 C 130.326 -44.391 135.025 -44.391 128.237 -44.391 L 109.354 -44.391 C 106.278 -44.391 101.866 -46.186 99.913 -48.286 L 99.913 -91.597 C 98.693 -92.916 94.12 -96.731 90.472 -96.731 C 86.824 -96.731 80.299 -93.16 81.031 -91.597 L 71.59 -44.391 L 62.149 -44.391 L 33.822 -39.639 C 33.825 -40.147 33.825 -57.191 33.825 -63.273 C 33.825 -67.493 21.167 -63.273 21.167 -63.273 C 19.703 -63.273 20.894 -55.345 20.979 -53.858 C 20.894 -53.832 16.125 -41.44 16.143 -34.95 C 16.161 -28.451 21.006 -16.068 21.006 -16.068 C 21.006 -14.506 19.141 -6.626 21.176 -6.6129999999999995 C 20.605 -6.626 33.825 -2.219 33.825 -6.626 C 33.825 -13.832 33.825 -30.235 33.825 -30.235 L 62.149 -25.509 L 71.59 -25.509 L 81.031 21.697 C 80.299 23.21 86.998 25.911 90.472 25.911 C 93.946 25.911 98.693 23.015 99.913 21.697 L 99.913 -20.794 C 101.866 -22.943 106.278 -25.509 109.354 -25.509 L 128.237 -25.509 C 135.418 -25.509 130.239 -25.509 133.62 -25.485 C 135.593 -25.509 137.678 -28.025 137.678 -30.396 C 137.678 -30.396 146.133 -33.618 146.135 -34.95 C 146.137 -36.315 137.678 -39.456 137.678 -39.456 Z" fill="currentColor" stroke="none"/></g>' },
  small: { viewBox: '0 0 200 200', inner:
    '<g id="Thin-L" transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)"><path d="M 147.119 -34.95 C 147.119 -41.542 138.979 -44.391 128.237 -44.391 L 109.354 -44.391 C 106.278 -44.391 101.866 -46.186 99.913 -48.286 L 90.472 -91.597 C 89.252 -92.916 84.679 -97.135 81.031 -97.135 C 77.383 -97.135 70.858 -93.16 71.59 -91.597 L 73.978 -44.391 L 62.149 -44.391 C 62.149 -44.391 64.374 -51.607 62.149 -53.832 C 57.698 -58.283 47.717 -58.283 43.266 -53.832 C 41.041 -51.607 43.266 -44.391 43.266 -44.391 L 34.912 -43.555 L 24.658 -62.158 C 23.828 -63.477 22.9 -64.062 21.094 -64.062 L 18.359 -64.062 C 16.895 -64.062 16.064 -63.281 16.064 -61.768 L 19.737 -34.95 L 16.064 -8.789 C 16.064 -7.227 16.895 -6.494 18.359 -6.494 L 21.094 -6.494 C 22.9 -6.494 23.828 -7.08 24.658 -8.398 L 34.912 -26.953 L 43.451 -26.66 C 43.451 -26.66 40.791 -18.587 43.266 -16.068 C 47.678 -11.579 57.698 -11.617 62.149 -16.068 C 64.374 -18.293 62.149 -25.509 62.149 -25.509 L 73.978 -25.509 L 71.59 21.697 C 70.858 23.21 77.557 26.113 81.031 26.113 C 84.505 26.113 89.252 23.015 90.472 21.697 L 99.913 -20.794 C 101.866 -22.943 106.278 -25.509 109.354 -25.509 L 128.237 -25.509 C 138.979 -25.509 147.119 -28.358 147.119 -35.511 L 147.119 -34.95 Z" fill="currentColor" stroke="none"/></g>' },
  large: { viewBox: '0 0 200 200', inner:
    '<g id="Thin-L" transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)"><path d="M 147.119 -35.254 C 147.119 -41.846000000000004 138.086 -46.68 127.344 -46.68 L 103.125 -46.68 C 100.049 -46.68 98.877 -47.168 96.924 -49.268 L 90.503 -56.217 L 90.503 -66.571 L 81.002 -66.571 L 59.277 -90.478 C 58.057 -91.797 56.592 -92.529 55.029 -92.529 L 48.438 -92.529 C 46.973 -92.529 46.143 -91.211 46.875 -89.648 L 66.26 -46.68 L 34.912 -43.555 L 24.658 -62.158 C 23.828 -63.477 22.9 -64.062 21.094 -64.062 L 18.359 -64.062 C 16.895 -64.062 16.064 -63.281 16.064 -61.768 L 16.064 -8.789 C 16.064 -7.227 16.895 -6.494 18.359 -6.494 L 21.094 -6.494 C 22.9 -6.494 23.828 -7.08 24.658 -8.398 L 34.912 -26.953 L 66.26 -23.877 L 46.875 19.141 C 46.143 20.654 46.973 21.973 48.438 21.973 L 55.029 21.973 C 56.592 21.973 58.057 21.24 59.277 19.922 L 81.069 -3.904 L 90.503 -3.927 L 90.503 -14.345 L 96.924 -21.24 C 98.877 -23.389 100.049 -23.877 103.125 -23.877 L 127.344 -23.877 C 138.086 -23.877 147.119 -28.662 147.119 -35.254 Z" fill="currentColor" stroke="none"/></g>' },
  high_vortex_large: { viewBox: '0 0 200 200', inner:
    '<g id="Thin-L" transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)"><path d="M 147.119 -35.254 C 147.119 -41.846000000000004 138.086 -46.68 127.344 -46.68 L 103.125 -46.68 C 100.049 -46.68 98.877 -47.168 96.924 -49.268 L 90.503 -56.217 L 90.503 -66.571 L 81.002 -66.571 L 59.277 -90.478 C 58.057 -91.797 56.592 -92.529 55.029 -92.529 L 48.438 -92.529 C 46.973 -92.529 46.143 -91.211 46.875 -89.648 L 66.26 -46.68 L 34.912 -43.555 L 24.658 -62.158 C 23.828 -63.477 22.9 -64.062 21.094 -64.062 L 18.359 -64.062 C 16.895 -64.062 16.064 -63.281 16.064 -61.768 L 24.384 -34.95 L 16.064 -8.789 C 16.064 -7.227 16.895 -6.494 18.359 -6.494 L 21.094 -6.494 C 22.9 -6.494 23.828 -7.08 24.658 -8.398 L 34.912 -26.953 L 66.26 -23.877 L 46.875 19.141 C 46.143 20.654 46.973 21.973 48.438 21.973 L 55.029 21.973 C 56.592 21.973 58.057 21.24 59.277 19.922 L 80.805 -3.927 L 90.503 -3.927 L 90.503 -14.345 L 96.924 -21.24 C 98.877 -23.389 100.049 -23.877 103.125 -23.877 L 127.344 -23.877 C 138.086 -23.877 147.119 -28.662 147.119 -35.254 Z" fill="currentColor" stroke="none"/></g>' },
  heavy: { viewBox: '0 0 200 200', inner:
    '<g id="Thin-L" transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)"><path d="M 147.119 -35.254 C 147.119 -41.846000000000004 138.086 -46.68 127.344 -46.68 L 103.125 -46.68 C 100.049 -46.68 98.877 -47.168 96.924 -49.268 L 90.503 -56.217 L 90.503 -66.571 L 81.002 -66.571 L 81.031 -82.156 L 66.863 -82.156 L 59.277 -90.478 C 58.057 -91.797 56.592 -92.529 55.029 -92.529 L 48.438 -92.529 C 46.973 -92.529 46.143 -91.211 46.875 -89.648 L 66.26 -46.68 L 34.912 -43.555 L 24.658 -62.158 C 23.828 -63.477 22.9 -64.062 21.094 -64.062 L 18.359 -64.062 C 16.895 -64.062 16.064 -63.281 16.064 -61.768 L 16.064 -8.789 C 16.064 -7.227 16.895 -6.494 18.359 -6.494 L 21.094 -6.494 C 22.9 -6.494 23.828 -7.08 24.658 -8.398 L 34.912 -26.953 L 66.26 -23.877 L 46.875 19.141 C 46.143 20.654 46.973 21.973 48.438 21.973 L 55.029 21.973 C 56.592 21.973 58.057 21.24 59.277 19.922 L 66.848 12.193 L 81.031 12.256 L 81.002 -3.927 L 90.503 -3.927 L 90.503 -14.345 L 96.924 -21.24 C 98.877 -23.389 100.049 -23.877 103.125 -23.877 L 127.344 -23.877 C 138.086 -23.877 147.119 -28.662 147.119 -35.254 Z" fill="currentColor" stroke="none"/></g>' },
  high_performance: { viewBox: '0 0 200 200', inner:
    '<g id="Thin-L" transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)"><path d="M 17.718 -10.644 L 24.384 -34.95 L 17.718 -59.193 L 22.376 -63.188 L 42.042 -45.053 L 46.445 -45.053 L 42.042 -78.667 L 53.954 -79.462 L 99.913 -44.391 C 99.913 -44.391 119.05 -46.566 128.237 -44.391 C 135.089 -42.769 147.119 -34.918 147.119 -34.918 C 147.119 -34.918 135.081 -27.123 128.237 -25.509 C 119.056 -23.344 99.939 -25.485 99.939 -25.485 L 53.954 9.636 L 42.042 8.831 L 46.445 -24.784 L 42.042 -24.784 L 22.376 -6.638 L 17.718 -10.644 Z" fill="currentColor" stroke="none"/></g>' },
  rotorcraft: { viewBox: '0 0 200 200', inner:
    '<g id="Thin-L" transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)"><path d="M 142.944 -44.391 C 139.538 -52.615 135.405 -50.329 128.237 -53.832 C 116.927 -59.359 102.102 -58.649 90.472 -53.832 C 82.248 -50.426 71.59 -40.893 71.59 -40.893 L 33.825 -40.893 L 24.658 -62.158 C 23.828 -63.477 22.9 -64.062 21.094 -64.062 L 18.359 -64.062 C 16.895 -64.062 16.064 -63.281 16.064 -61.768 L 24.384 -44.391 L 24.384 -25.509 L 16.064 -8.789 C 16.064 -7.227 16.895 -6.494 18.359 -6.494 L 21.094 -6.494 C 22.9 -6.494 23.828 -7.08 24.658 -8.398 L 33.822 -30.006 L 71.59 -29.975 C 71.59 -29.975 82.248 -19.474 90.472 -16.068 C 102.102 -11.25 116.937 -10.521 128.237 -16.068 C 135.379 -19.574 139.429 -17.285 142.835 -25.509 C 145.244 -31.324 145.353 -38.576 142.86 -44.422 L 142.944 -44.391 Z" fill="currentColor" stroke="none"/></g>' +
    '<path d="M 96.385 -25.442 C 96.705 55.448 96.705 113.74 96.607 193.603 C 96.599 200.4 105.318 200.399 105.292 193.603 C 104.981 113.74 104.981 55.448 104.846 -25.442 C 104.835 -32.064 96.359 -32.064 96.385 -25.442 Z" fill="currentColor" transform="matrix(0.642788, -0.766044, 0.766044, 0.642788, -28.43878, 107.304662)"/>' +
    '<path d="M 96.348 -25.479 C 96.668 55.411 96.668 113.703 96.57 193.566 C 96.562 200.363 105.281 200.362 105.255 193.566 C 104.944 113.703 104.944 55.411 104.809 -25.479 C 104.798 -32.101 96.322 -32.101 96.348 -25.479 Z" fill="currentColor" transform="matrix(0.642788, 0.766044, -0.766044, 0.642788, 100.438642, -47.173674)"/>' },
  uav: { viewBox: '0 0 200 200', inner:
    '<path d="M 565 355 m -35.428 0 a 35.428 35.428 0 1 0 70.856 0 a 35.428 35.428 0 1 0 -70.856 0 Z M 565 355 m -21.257 0 a 21.257 21.257 0 0 1 42.514 0 a 21.257 21.257 0 0 1 -42.514 0 Z" fill="currentColor" transform="matrix(-0.724416, 0.689363, -0.689363, -0.724416, 703.93356, -82.23506)"/>' +
    '<path d="M 565 355 m -35.428 0 a 35.428 35.428 0 1 0 70.856 0 a 35.428 35.428 0 1 0 -70.856 0 Z M 565 355 m -21.257 0 a 21.257 21.257 0 0 1 42.514 0 a 21.257 21.257 0 0 1 -42.514 0 Z" fill="currentColor" transform="matrix(-0.724416, 0.689363, -0.689363, -0.724416, 804.108365, -82.23506)"/>' +
    '<path d="M 565 355 m -35.428 0 a 35.428 35.428 0 1 0 70.856 0 a 35.428 35.428 0 1 0 -70.856 0 Z M 565 355 m -21.257 0 a 21.257 21.257 0 0 1 42.514 0 a 21.257 21.257 0 0 1 -42.514 0 Z" fill="currentColor" transform="matrix(-0.724416, 0.689363, -0.689363, -0.724416, 704.106351, 17.864939)"/>' +
    '<path d="M 565 355 m -35.428 0 a 35.428 35.428 0 1 0 70.856 0 a 35.428 35.428 0 1 0 -70.856 0 Z M 565 355 m -21.257 0 a 21.257 21.257 0 0 1 42.514 0 a 21.257 21.257 0 0 1 -42.514 0 Z" fill="currentColor" transform="matrix(-0.724416, 0.689363, -0.689363, -0.724416, 804.108365, 17.7901)"/>' +
    '<path d="M 57.144 42.9 C 74.235 41.207 79.789 71.5 100.002 71.5 C 120.215 71.5 125.769 41.207 142.86 42.9 C 149.565 43.564 156.482 50.495 157.146 57.2 C 158.839 74.298 128.574 79.887 128.574 100.1 C 128.574 120.313 158.839 125.902 157.146 143 C 156.482 149.705 149.565 156.636 142.86 157.3 C 125.769 158.993 120.215 128.7 100.002 128.7 C 79.789 128.7 74.235 158.993 57.144 157.3 C 50.439 156.636 43.522 149.705 42.858 143 C 41.165 125.902 71.43 120.313 71.43 100.1 C 71.43 79.887 41.165 74.298 42.858 57.2 C 43.522 50.495 50.439 43.564 57.144 42.9 Z" fill="currentColor"/>' },
  glider: { viewBox: '0 0 200 200', inner:
    '<g id="Thin-L" transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)"><path d="M 147.119 -35.509 C 147.119 -42.101 128.247 -40.196 128.247 -40.196 C 128.247 -40.196 121.869 -39.494 118.811 -40.229 C 115.479 -41.03 109.637 -44.871 109.637 -44.871 C 109.637 -44.871 109.637 -82.316 109.637 -97.762 C 109.637 -101.182 99.913 -101.038 99.913 -101.038 C 98.849 -102.188 99.913 -59.556 97.974 -44.881 C 96.725 -42.05 90.503 -40.229 90.503 -40.229 L 24.386 -38.787 L 24.658 -62.158 C 23.828 -63.477 22.9 -64.062 21.094 -64.062 L 18.359 -64.062 C 16.895 -64.062 16.064 -63.281 16.064 -61.768 L 14.943 -34.95 L 16.064 -8.789 C 16.064 -7.227 16.895 -6.494 18.359 -6.494 L 21.094 -6.494 C 22.9 -6.494 23.828 -7.08 24.658 -8.398 L 24.386 -32.234 L 90.503 -30.858 C 90.503 -30.858 96.893 -28.325 97.974 -26.14 C 100.715 -9.365 99.913 28.489 99.939 30.016 C 99.181 30.002 109.637 30.048 109.637 26.756 C 109.637 11.297 109.637 -26.148 109.637 -26.148 C 111.59 -28.297 115.471 -30.44 119.008 -30.858 C 122.368 -30.977 128.247 -30.826 128.247 -30.826 C 128.247 -30.826 147.119 -28.917 147.119 -35.509 Z" fill="currentColor"/></g>' },
  lighter_than_air: { viewBox: '0 0 200 200', inner:
    '<ellipse cx="100" cy="100.1" rx="46.209" ry="85.8" fill="currentColor"/>' },
  parachutist: { viewBox: '0 0 200 200', inner:
    '<path d="M 142.86 28.6 L 171.432 57.2 L 185.718 100.1 L 171.432 143 L 142.86 171.6 L 100.002 185.9 L 57.144 171.6 L 28.572 143 L 14.286 100.1 L 28.572 57.2 L 57.144 28.6 L 100.002 14.3 L 142.86 28.6 Z" fill="currentColor" stroke="none"/><circle cx="100" cy="100" r="12.48" fill="white" stroke="none"/>' },
  ultralight: { viewBox: '0 0 200 200', inner:
    '<g id="Thin-L" transform="matrix(0, -1.526083, 1.526083, 0, 154.197083, 253.115128)"><path d="M 147.64 -35.505 C 147.64 -42.097 91.064 -101.03 91.064 -101.03 C 90.511 -101.627 91.418 -78.099 91.418 -78.099 L 82.048 -63.585 C 82.048 -63.585 98.395 -44.866 91.418 -44.866 C 72.677 -44.866 72.677 -44.866 63.306 -44.866 C 60.254 -44.866 72.744 -40.081 72.677 -35.505 C 72.606 -30.724 60.117 -26.143 63.306 -26.143 C 72.677 -26.143 78.924 -26.143 91.418 -26.143 C 100.788 -26.143 82.048 -7.418 82.048 -7.418 L 91.418 7.087 L 91.09 30.024 C 91.09 30.024 147.64 -28.913 147.64 -35.505 Z" fill="currentColor" stroke="none"/></g>' },
  space: { viewBox: '0 0 16 16', inner:
    '<path d="M8 1l4 12H4z"/>' },
  surface_obstacle: { viewBox: '0 0 200 200', inner:
    '<g id="Thin-L" transform="matrix(0, -1.526083, 1.526083, 0, 154.197083, 247.503403)"><path d="M 143.535 -82.319 C 143.535 -82.819 134.164 -82.319 134.164 -82.319 C 134.164 -82.319 136.37 -89.474 134.164 -91.68 C 130.987 -94.857 109.502 -95.129 106.053 -91.68 C 103.847 -89.474 106.053 -82.319 106.053 -82.319 L 87.312 -82.319 C 87.312 -82.319 89.518 -89.474 87.312 -91.68 C 83.747 -95.245 62.262 -94.741 59.201 -91.68 C 56.995 -89.474 59.201 -82.319 59.201 -82.319 L 40.46 -82.319 C 40.367 -82.419 40.46 -54.235 40.46 -54.235 L 96.683 -44.874 L 96.683 -26.151 L 40.46 -16.79 L 40.46 11.294 L 59.201 11.294 C 59.201 11.294 56.995 18.449 59.201 20.655 C 62.344 23.798 83.829 24.138 87.312 20.655 C 89.518 18.449 87.312 11.294 87.312 11.294 C 107.852 11.294 106.053 11.294 106.053 11.294 C 106.053 11.294 103.847 18.449 106.053 20.655 C 109.208 23.81 130.693 24.126 134.164 20.655 C 136.37 18.449 134.164 11.294 134.164 11.294 L 143.535 11.294 L 143.535 -7.429 L 152.905 -7.429 L 152.905 -63.596 L 143.535 -63.596 C 143.535 -63.596 143.535 -81.196 143.535 -82.319 Z" fill="currentColor"/></g>' },
  unknown: { viewBox: '0 0 200 200', inner:
    '<g id="Thin-L" transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)"><path d="M 147.119 -35.2539 C 147.119 -41.8457 138.086 -46.6797 127.344 -46.6797 L 103.125 -46.6797 C 100.049 -46.6797 98.877 -47.168 96.9238 -49.2676 L 59.2773 -90.4785 C 58.0566 -91.7969 56.5918 -92.5293 55.0293 -92.5293 L 48.4375 -92.5293 C 46.9727 -92.5293 46.1426 -91.2109 46.875 -89.6484 L 66.2598 -46.6797 L 34.9121 -43.5547 L 24.6582 -62.1582 C 23.8281 -63.4766 22.9004 -64.0625 21.0938 -64.0625 L 18.3594 -64.0625 C 16.8945 -64.0625 16.0645 -63.2812 16.0645 -61.7676 L 16.0645 -8.78906 C 16.0645 -7.22656 16.8945 -6.49414 18.3594 -6.49414 L 21.0938 -6.49414 C 22.9004 -6.49414 23.8281 -7.08008 24.6582 -8.39844 L 34.9121 -26.9531 L 66.2598 -23.877 L 46.875 19.1406 C 46.1426 20.6543 46.9727 21.9727 48.4375 21.9727 L 55.0293 21.9727 C 56.5918 21.9727 58.0566 21.2402 59.2773 19.9219 L 96.9238 -21.2402 C 98.877 -23.3887 100.049 -23.877 103.125 -23.877 L 127.344 -23.877 C 138.086 -23.877 147.119 -28.6621 147.119 -35.2539 Z" fill="currentColor"/></g>' },
};
function categoryIconHtml(key) {
  const icon = CATEGORY_ICON_SVGS[key] || CATEGORY_ICON_SVGS.unknown;
  return '<div class="dropdown-icon-container">' +
    '<svg class="dropdown-icon" viewBox="' + icon.viewBox + '">' +
    icon.inner +
    '</svg></div>';
}

// Basemap picker — same custom-dropdown pattern as the category filter
// below, reused rather than inventing a second dropdown widget. Purely
// presentational (setBaseLayer(), map-init.js): no poll()/re-render needed,
// unlike the category filter which changes what's rendered.
const basemapDropdown = document.getElementById('basemap-filter');
const basemapTrigger = basemapDropdown.querySelector('.dropdown-trigger');
const basemapValueWrap = basemapDropdown.querySelector('.dropdown-value-wrap');
const basemapOptions = basemapDropdown.querySelectorAll('.dropdown-option');

basemapTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  basemapDropdown.classList.toggle('open');
});
basemapOptions.forEach((opt) => {
  opt.addEventListener('click', () => {
    basemapOptions.forEach((o) => o.classList.remove('active'));
    opt.classList.add('active');
    const key = opt.dataset.value;
    setBaseLayer(key);
    basemapValueWrap.innerHTML =
      '<span class="swatch" style="background:' + BASE_LAYERS[key].swatch + '"></span>'
      + '<span class="dropdown-value">' + BASE_LAYERS[key].label + '</span>';
    basemapDropdown.classList.remove('open');
  });
});
document.addEventListener('click', () => basemapDropdown.classList.remove('open'));

// Zone search — a text input + live-filtered results list (backed by
// /api/airports/search, enrichment/airports.py) that moves the app's whole
// coverage area, not just the Leaflet view: selecting a result posts to
// /api/zones/active (app.py's _apply_zone()/_persist_zone_config()), which
// recomputes AREA_CENTER/BBOX and every value derived from them (the four
// radius sources' own query centers, FlightAware's bbox query, FlightRadar24's
// bounds — see CLAUDE.md/_apply_zone()'s docstring for why all of those have
// to move together), then reuses that response to recenter the map and
// re-poll immediately. This is the one HUD input that isn't a click-only
// .dropdown-trigger button like the basemap/category pickers above — it
// reuses their .dropdown-menu/.dropdown-option markup for the results list,
// but the trigger itself is a real <input>, styled via .zone-search-input.
const ZONE_SEARCH_DEBOUNCE_MS = 250;
const zoneSearchDropdown = document.getElementById('zone-search');
const zoneSearchInput = document.getElementById('zone-search-input');
const zoneSearchResults = document.getElementById('zone-search-results');
const zoneSearchStatusEl = document.getElementById('zone-search-status');
let zoneSearchDebounceTimer = null;

function setZoneSearchStatus(message, isError) {
  if (!message) {
    zoneSearchStatusEl.hidden = true;
    zoneSearchStatusEl.textContent = '';
    zoneSearchStatusEl.classList.remove('error');
    return;
  }
  zoneSearchStatusEl.hidden = false;
  zoneSearchStatusEl.textContent = message;
  zoneSearchStatusEl.classList.toggle('error', !!isError);
}

function renderZoneSearchResults(airports) {
  zoneSearchResults.innerHTML = '';
  if (!airports.length) {
    zoneSearchDropdown.classList.remove('open');
    return;
  }
  airports.forEach((airport) => {
    const opt = document.createElement('div');
    opt.className = 'dropdown-option zone-search-option';

    const code = airport.iata || airport.icao || '';
    const nameEl = document.createElement('span');
    nameEl.className = 'zone-search-result-name';
    nameEl.textContent = code ? (airport.name + ' (' + code + ')') : airport.name;

    const metaEl = document.createElement('span');
    metaEl.className = 'zone-search-result-meta';
    metaEl.textContent = [airport.municipality, airport.country_name].filter(Boolean).join(', ');

    opt.appendChild(nameEl);
    opt.appendChild(metaEl);
    opt.addEventListener('click', () => selectZoneSearchResult(airport));
    zoneSearchResults.appendChild(opt);
  });
  zoneSearchDropdown.classList.add('open');
}

function selectZoneSearchResult(airport) {
  zoneSearchInput.value = airport.name;
  zoneSearchDropdown.classList.remove('open');
  zoneSearchResults.innerHTML = '';
  setZoneSearchStatus('Moving to ' + airport.name + '…', false);

  fetch('/api/zones/active', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lat: airport.lat,
      lon: airport.lon,
      zone_id: airport.icao || airport.ident || undefined,
    }),
  })
    .then((res) => {
      if (!res.ok) throw new Error('zone_change_failed');
      return res.json();
    })
    .then((cfg) => {
      map.setView([cfg.center.lat, cfg.center.lon], map.getZoom());
      if (cfg && cfg.center) currentAreaCenter = cfg.center;
      // Scan-radius rings are centered where they were built (initial
      // /api/config load) and don't otherwise track the map view — without
      // rebuilding them here they'd keep circling the old zone's center.
      if (cfg && cfg.center && cfg.radius_nm) {
        const wasShown = map.hasLayer(scanRadiusLayer);
        if (wasShown) map.removeLayer(scanRadiusLayer);
        scanRadiusLayer = buildScanRadiusLayer(cfg.center.lat, cfg.center.lon, cfg.radius_nm);
        if (wasShown) scanRadiusLayer.addTo(map);
      }
      setZoneSearchStatus(null);
      poll(); // re-fetch aircraft immediately instead of waiting for the next tick
      // Airports layer re-fetches on its own: setView() fires Leaflet's
      // moveend, which map-init.js's scheduleAirportsRefresh already
      // listens on. METAR/SIGMET are timer-only (no moveend listener), so
      // they need an explicit nudge when enabled.
      if (weatherMetarState.enabled) refreshMetar();
      if (weatherSigmetState.enabled) refreshSigmet();
    })
    .catch(() => {
      setZoneSearchStatus('Could not switch zone — try again.', true);
    });
}

zoneSearchInput.addEventListener('input', () => {
  const query = zoneSearchInput.value.trim();
  clearTimeout(zoneSearchDebounceTimer);
  if (query.length < 2) {
    zoneSearchResults.innerHTML = '';
    zoneSearchDropdown.classList.remove('open');
    return;
  }
  zoneSearchDebounceTimer = setTimeout(() => {
    fetch('/api/airports/search?q=' + encodeURIComponent(query) + '&limit=8')
      .then((res) => res.json())
      .then((data) => renderZoneSearchResults(data.airports || []))
      .catch(() => {});
  }, ZONE_SEARCH_DEBOUNCE_MS);
});
zoneSearchInput.addEventListener('click', (e) => e.stopPropagation());
zoneSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    zoneSearchDropdown.classList.remove('open');
    zoneSearchInput.blur();
  }
});
document.addEventListener('click', () => zoneSearchDropdown.classList.remove('open'));

// Custom dropdown (a styled <div>, not a native <select> — see #category-filter
// markup) for the category filter. Its selected value is tracked here rather
// than read from a form-element `.value`, since it's built from plain divs.
const categoryDropdown = document.getElementById('category-filter');
const categoryTrigger = categoryDropdown.querySelector('.dropdown-trigger');
const categoryValueWrap = categoryDropdown.querySelector('.dropdown-value-wrap');
const categoryOptions = categoryDropdown.querySelectorAll('.dropdown-option');
let currentCategoryFilter = 'all';

categoryOptions.forEach((opt) => {
  opt.innerHTML = categoryIconHtml(opt.dataset.value) + '<span>' + opt.textContent + '</span>';
});
categoryValueWrap.innerHTML = categoryIconHtml('all') + '<span class="dropdown-value">All categories</span>';

categoryTrigger.addEventListener('click', (e) => {
  // Stop this click from reaching the document-level listener below, which
  // would otherwise immediately close the menu this click just opened.
  e.stopPropagation();
  categoryDropdown.classList.toggle('open');
});
categoryOptions.forEach((opt) => {
  opt.addEventListener('click', () => {
    categoryOptions.forEach((o) => o.classList.remove('active'));
    opt.classList.add('active');
    currentCategoryFilter = opt.dataset.value;
    categoryValueWrap.innerHTML = categoryIconHtml(currentCategoryFilter) +
      '<span class="dropdown-value">' + opt.textContent + '</span>';
    categoryDropdown.classList.remove('open');
    categoryTrigger.disabled = true;
    document.getElementById('category-filter-spinner').hidden = false;
    poll().finally(() => { // apply right away instead of waiting for the next 12s tick
      categoryTrigger.disabled = false;
      document.getElementById('category-filter-spinner').hidden = true;
    });
  });
});
document.addEventListener('click', () => categoryDropdown.classList.remove('open'));

function passesCategoryFilter(group) {
  return currentCategoryFilter === 'all' || currentCategoryFilter === group;
}

// --- Data Quality Filter (Status flags + Signal type) ---

// Status flags group: decode dbFlags bitmask
function decodeDbFlags(dbFlags) {
  if (dbFlags == null) return { military: false, interesting: false, pia: false, ladd: false };
  return {
    military: !!(dbFlags & 1),
    interesting: !!(dbFlags & 2),
    pia: !!(dbFlags & 4),
    ladd: !!(dbFlags & 8),
  };
}

// Opt-in: empty set = no filtering. Multiple checked flags use OR logic.
let currentStatusFlagsFilter = new Set(); // subset of 'military'|'interesting'|'pia'|'ladd'

function passesStatusFlagsFilter(dbFlags) {
  if (currentStatusFlagsFilter.size === 0) return true;
  const decoded = decodeDbFlags(dbFlags);
  for (const flag of currentStatusFlagsFilter) {
    if (decoded[flag]) return true;
  }
  return false;
}

// Signal type group: derive bucket from messageType or fallback to positionSource
const SIGNAL_TYPE_BUCKETS = ['adsb', 'adsr', 'tisb', 'mlat', 'mode_s', 'adsc', 'asterix', 'flarm', 'unknown'];

function signalTypeBucketFor(info) {
  const mt = info.messageType;
  if (mt) {
    if (mt.startsWith('adsb')) return 'adsb';
    if (mt.startsWith('adsr')) return 'adsr';  // includes UAT, rebroadcast by the ground station
    if (mt.startsWith('tisb')) return 'tisb';
    if (mt === 'mlat') return 'mlat';
    if (mt === 'mode_s') return 'mode_s';
    if (mt === 'adsc') return 'adsc';
    return 'unknown'; // readsb's own 'other'
  }
  // No messageType — pure-OpenSky aircraft (use OpenSky's own position_source code) or FlightAware/FlightRadar24 (always unknown)
  if (info.positionSource === 'ADS-B') return 'adsb';
  if (info.positionSource === 'MLAT') return 'mlat';
  if (info.positionSource === 'ASTERIX') return 'asterix';
  if (info.positionSource === 'FLARM') return 'flarm';
  return 'unknown';
}

// All checked by default = no filtering. Set membership is OR by construction.
let currentSignalTypeFilter = new Set(SIGNAL_TYPE_BUCKETS);

function passesSignalTypeFilter(info) {
  return currentSignalTypeFilter.has(signalTypeBucketFor(info));
}

// Combined: AND between facets
function passesDataQualityFilter(info) {
  return passesStatusFlagsFilter(info.dbFlags) && passesSignalTypeFilter(info);
}

// Wiring: Event listeners for both filter groups
function reapplyDataQualityFilter() {
  const allCheckboxes = document.querySelectorAll('.status-flag-checkbox, .signal-type-checkbox');
  allCheckboxes.forEach((c) => { c.disabled = true; });
  document.getElementById('data-quality-filter-spinner').hidden = false;
  poll().finally(() => { // apply right away instead of waiting for the next 12s tick
    allCheckboxes.forEach((c) => { c.disabled = false; });
    document.getElementById('data-quality-filter-spinner').hidden = true;
  });
}

document.querySelectorAll('.status-flag-checkbox').forEach((checkbox) => {
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) currentStatusFlagsFilter.add(checkbox.value);
    else currentStatusFlagsFilter.delete(checkbox.value);
    reapplyDataQualityFilter();
  });
});
document.querySelectorAll('.signal-type-checkbox').forEach((checkbox) => {
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) currentSignalTypeFilter.add(checkbox.value);
    else currentSignalTypeFilter.delete(checkbox.value);
    reapplyDataQualityFilter();
  });
});
