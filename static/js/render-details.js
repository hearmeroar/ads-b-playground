// --- Shared popup formatting (squawk / emergency / vertical rate) ---

// ICAO-universal emergency squawk codes: 7500 hijack, 7600 radio failure,
// 7700 general emergency. Highlighted regardless of which source reports them.
const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);
function formatSquawk(squawk) {
  if (!squawk) return null;
  return EMERGENCY_SQUAWKS.has(squawk)
    ? '<span class="emergency">' + squawk + ' — EMERGENCY</span>'
    : squawk;
}

// dbFlags is an adsb.fi/airplanes.live bitmask: 1=military, 2=interesting,
// 4=PIA (privacy ICAO address), 8=LADD (limited-display aircraft).
function formatDbFlags(flags) {
  if (!flags) return null;
  const labels = [];
  if (flags & 1) labels.push('Military');
  if (flags & 2) labels.push('Interesting');
  if (flags & 4) labels.push('PIA');
  if (flags & 8) labels.push('LADD');
  return labels.length ? labels.join(', ') : null;
}

// Renders a small SVG flag for a 2-letter ISO 3166-1 alpha-2 country code,
// via the flag-icons library (vendored at static/flag-icons/, linked in
// <head> — see https://github.com/lipis/flag-icons). Accepts upper- or
// lowercase; anything missing or not a plausible 2-letter code renders
// nothing rather than a broken/half-built element. flag-icons' own CSS
// sizes the flag relative to font-size (~1.33em wide), which lands in the
// 16–24px range at this sidebar's text size without any extra sizing here.
function flagHtml(iso2) {
  if (!iso2 || typeof iso2 !== 'string') return '';
  const code = iso2.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) return '';
  return '<span class="fi fi-' + code + '" aria-hidden="true"></span>';
}

// Renders a small airline logo prefix, looked up by the 3-letter ICAO
// airline designator that leads a flight callsign (e.g. "RYR1234" ->
// "RYR") — independent of however Operator's own name got resolved, so a
// logo can show even when e.g. adsbdb resolved Operator but has no code of
// its own. Two vendored tiers (static/airline-logos/, see
// AIRLINE_LOGO_MANIFEST in map-init.js), tried in priority order and never
// silently replaced once a higher tier has an answer, same
// higher-tier-wins rule as every other enrichment field in this app:
// soaring-symbols (MIT, curated) first, airframesio/airline-images
// (broader but unlicensed, scraped from other trackers) as a fallback.
// Missing/invalid input degrades to no logo, same as flagHtml().
function airlineLogoHtml(callsign) {
  if (!callsign || typeof callsign !== 'string') return '';
  const code = callsign.trim().toUpperCase().slice(0, 3);
  if (!/^[A-Z]{3}$/.test(code)) return '';
  const entry = AIRLINE_LOGO_MANIFEST[code];
  if (!entry) return '';
  const src = entry.soaring
    ? 'airline-logos/soaring/' + entry.soaring
    : 'airline-logos/airframes/' + entry.airframes;
  return '<img class="airline-logo" src="' + src + '" alt="">';
}

// --- Unit-aware formatters (metric ⇄ imperial, see currentUnitSystem) ---
// Every value normalizeOpenSky()/normalizeAdsbExchange() produce is stored
// in one canonical unit (meters, km/h, m/s, knots for airspeeds/wind — the
// same units the underlying sources already use for those), so only these
// formatters branch on currentUnitSystem; nothing upstream needs to change
// when the toggle flips.
function formatAltitude(meters) {
  if (meters == null) return null;
  return currentUnitSystem === 'imperial'
    ? Math.round(meters * 3.28084) + ' ft'
    : Math.round(meters) + ' m';
}
function formatSpeedKmh(kmh) {
  if (kmh == null) return null;
  return currentUnitSystem === 'imperial'
    ? Math.round(kmh / KT_TO_KMH) + ' kt'
    : Math.round(kmh) + ' km/h';
}
// For fields that are natively in knots (IAS/TAS/wind speed).
function formatSpeedKt(kt) {
  if (kt == null) return null;
  return currentUnitSystem === 'imperial'
    ? Math.round(kt) + ' kt'
    : Math.round(kt * KT_TO_KMH) + ' km/h';
}
function formatVerticalRateUnit(rateMs) {
  if (rateMs == null) return null;
  if (Math.abs(rateMs) <= VERTICAL_RATE_LEVEL_THRESHOLD_MS) return 'level';
  const word = rateMs > 0 ? 'climbing' : 'descending';
  // ft/min = (m/s) / FT_TO_M (-> ft/s) * 60 — was a separately hardcoded
  // 196.850 literal (the same derived constant, just pre-multiplied) with
  // no link back to FT_TO_M as its source.
  const value = currentUnitSystem === 'imperial'
    ? (rateMs > 0 ? '+' : '') + Math.round(rateMs / FT_TO_M * 60) + ' ft/min'
    : (rateMs > 0 ? '+' : '') + rateMs.toFixed(1) + ' m/s';
  return value + ' (' + word + ')';
}
// 8-point compass abbreviation for a track/heading tile's secondary line
// (e.g. "133°" -> "SE"), matching the reference stat-tile layout's own
// "133° SE" heading tile.
const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function degToCompass(deg) {
  if (deg == null) return null;
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return COMPASS_POINTS[idx];
}
function formatRelativeSeconds(sec) {
  if (sec == null) return null;
  if (sec < 60) return Math.floor(sec) + ' s ago';
  if (sec < 3600) return Math.round(sec / 60) + ' min ago';
  return Math.round(sec / 3600) + ' h ago';
}

// OpenSky's `category` is a numeric ADS-B emitter category
// (see https://opensky-network.org/apidoc/rest.html).
const OPENSKY_CATEGORY_LABELS = {
  0: 'No info', 1: 'No ADS-B category info', 2: 'Light (<15,500 lbs)',
  3: 'Small (15,500–75,000 lbs)', 4: 'Large (75,000–300,000 lbs)',
  5: 'High vortex large (e.g. B757)', 6: 'Heavy (>300,000 lbs)',
  7: 'High performance (>5g, >400kt)', 8: 'Rotorcraft', 9: 'Glider / sailplane',
  10: 'Lighter-than-air', 11: 'Parachutist / skydiver',
  12: 'Ultralight / hang-glider / paraglider', 13: 'Reserved',
  14: 'Unmanned aerial vehicle', 15: 'Space / trans-atmospheric vehicle',
  16: 'Surface vehicle — emergency', 17: 'Surface vehicle — service',
  18: 'Point obstacle', 19: 'Cluster obstacle', 20: 'Line obstacle',
};

// adsb.fi/airplanes.live report the same emitter-category concept as a
// letter+digit DO-260B code (e.g. "A3") instead of OpenSky's plain number —
// same underlying meanings, different encoding, so a separate lookup.
const ADSBEXCHANGE_CATEGORY_LABELS = {
  A0: 'No ADS-B category info', A1: 'Light (<15,500 lbs)', A2: 'Small (15,500–75,000 lbs)',
  A3: 'Large (75,000–300,000 lbs)', A4: 'High vortex large (e.g. B757)', A5: 'Heavy (>300,000 lbs)',
  A6: 'High performance (>5g, >400kt)', A7: 'Rotorcraft',
  B0: 'No ADS-B category info', B1: 'Glider / sailplane', B2: 'Lighter-than-air',
  B3: 'Parachutist / skydiver', B4: 'Ultralight / hang-glider / paraglider', B5: 'Reserved',
  B6: 'Unmanned aerial vehicle', B7: 'Space / trans-atmospheric vehicle',
  C0: 'No ADS-B category info', C1: 'Surface vehicle — emergency', C2: 'Surface vehicle — service',
  C3: 'Point obstacle', C4: 'Cluster obstacle', C5: 'Line obstacle', C6: 'Reserved', C7: 'Reserved',
};
function formatAdsbExchangeCategory(category) {
  if (!category) return null;
  const label = ADSBEXCHANGE_CATEGORY_LABELS[category];
  return label ? category + ' — ' + label : category;
}

// Reverse lookup from a category's bare label text (no parenthetical) back
// to its categoryGroup ('light'/'large'/'rotorcraft'/...), so the route
// card can pick the same per-category glyph the map marker itself uses
// (CATEGORY_GLYPHS, static/js/icons.js) even though categoryGroup itself
// only ever lives on the per-poll render item (parsers.js), never on
// `info`/detailsById — built once from the label/group tables already
// available (OPENSKY_CATEGORY_GROUP/ADSBEXCHANGE_CATEGORY_GROUP,
// static/js/state-filters.js, loaded before this file).
const CATEGORY_LABEL_TO_GROUP = {};
for (const [num, label] of Object.entries(OPENSKY_CATEGORY_LABELS)) {
  const group = OPENSKY_CATEGORY_GROUP[num];
  if (group) CATEGORY_LABEL_TO_GROUP[label.replace(/\s*\(.+\)$/, '')] = group;
}
for (const [code, label] of Object.entries(ADSBEXCHANGE_CATEGORY_LABELS)) {
  const group = ADSBEXCHANGE_CATEGORY_GROUP[code];
  if (group) CATEGORY_LABEL_TO_GROUP[label.replace(/\s*\(.+\)$/, '')] = group;
}

// The same per-category glyph the map marker uses (CATEGORY_GLYPHS,
// static/js/icons.js) — neutral gray (not source-colored, this is a
// decorative direction indicator, not a data-provenance signal) and
// rotated 90° (the same 0°=north/up convention every rotating marker on
// the map uses, so 90° points right — origin to destination reads
// left-to-right). Falls back to the same "unknown" silhouette the map
// itself falls back to when the category can't be determined at all.
// When the aircraft is climbing or descending (verticalRateMs outside the
// level band), the arrow animates with a gentle oscillation around a tilted
// angle, signaling active altitude change via motion rather than a static
// tilt (CSS @keyframes animation survives the sidebar's per-render .innerHTML
// swap, unlike a one-shot transition).
const ROUTE_ARROW_TILT_DEG = 15;
function routeArrowIconHtml(categoryGroup, verticalRateMs) {
  const glyphTemplate = (categoryGroup && CATEGORY_GLYPHS[categoryGroup]) || UNKNOWN_GLYPH;
  const glyph = glyphTemplate.replace(/COLOR/g, '#6b7280');

  let animClass = '';
  if (verticalRateMs != null && Math.abs(verticalRateMs) > VERTICAL_RATE_LEVEL_THRESHOLD_MS) {
    animClass = verticalRateMs > 0 ? ' route-arrow-climbing' : ' route-arrow-descending';
  }

  return '<div class="route-arrow-wrapper' + animClass + '" style="transform: rotate(90deg); display: flex;">'
    + '<svg width="22" height="22" viewBox="0 0 200 200">' + glyph + '</svg></div>';
}

// One small icon per detail *group* (not per field) — Material Design
// Icons (pictogrammers.com/MaterialDesign, Apache-2.0), vendored the same
// way as every other icon set in this app (inline SVG, no build step, no
// external request): copied verbatim from the MDI source repo rather than
// hand-approximated, so the geometry is exactly right at this size.
const GROUP_ICONS = {
  identity: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M22,3H2C0.91,3.04 0.04,3.91 0,5V19C0.04,20.09 0.91,20.96 2,21H22C23.09,20.96 23.96,20.09 24,19V5C23.96,3.91 23.09,3.04 22,3M22,19H2V5H22V19M14,17V15.75C14,14.09 10.66,13.25 9,13.25C7.34,13.25 4,14.09 4,15.75V17H14M9,7A2.5,2.5 0 0,0 6.5,9.5A2.5,2.5 0 0,0 9,12A2.5,2.5 0 0,0 11.5,9.5A2.5,2.5 0 0,0 9,7M14,7V8H20V7H14M14,9V10H20V9H14M14,11V12H18V11H14"/></svg>',
  position: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12,2C15.31,2 18,4.66 18,7.95C18,12.41 12,19 12,19C12,19 6,12.41 6,7.95C6,4.66 8.69,2 12,2M12,6A2,2 0 0,0 10,8A2,2 0 0,0 12,10A2,2 0 0,0 14,8A2,2 0 0,0 12,6M20,19C20,21.21 16.42,23 12,23C7.58,23 4,21.21 4,19C4,17.71 5.22,16.56 7.11,15.83L7.75,16.74C6.67,17.19 6,17.81 6,18.5C6,19.88 8.69,21 12,21C15.31,21 18,19.88 18,18.5C18,17.81 17.33,17.19 16.25,16.74L16.89,15.83C18.78,16.56 20,17.71 20,19Z"/></svg>',
  speedHeading: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12,16A3,3 0 0,1 9,13C9,11.88 9.61,10.9 10.5,10.39L20.21,4.77L14.68,14.35C14.18,15.33 13.17,16 12,16M12,3C13.81,3 15.5,3.5 16.97,4.32L14.87,5.53C14,5.19 13,5 12,5A8,8 0 0,0 4,13C4,15.21 4.89,17.21 6.34,18.65H6.35C6.74,19.04 6.74,19.67 6.35,20.06C5.96,20.45 5.32,20.45 4.93,20.07V20.07C3.12,18.26 2,15.76 2,13A10,10 0 0,1 12,3M22,13C22,15.76 20.88,18.26 19.07,20.07V20.07C18.68,20.45 18.05,20.45 17.66,20.06C17.27,19.67 17.27,19.04 17.66,18.65V18.65C19.11,17.2 20,15.21 20,13C20,12 19.81,11 19.46,10.1L20.67,8C21.5,9.5 22,11.18 22,13Z"/></svg>',
  autopilot: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M13,19.92C14.8,19.7 16.35,18.95 17.65,17.65C18.95,16.35 19.7,14.8 19.92,13H16.92C16.7,14 16.24,14.84 15.54,15.54C14.84,16.24 14,16.7 13,16.92V19.92M10,8H14L17,11H19.92C19.67,9.05 18.79,7.38 17.27,6C15.76,4.66 14,4 12,4C10,4 8.24,4.66 6.73,6C5.21,7.38 4.33,9.05 4.08,11H7L10,8M11,19.92V16.92C10,16.7 9.16,16.24 8.46,15.54C7.76,14.84 7.3,14 7.08,13H4.08C4.3,14.77 5.05,16.3 6.35,17.6C7.65,18.9 9.2,19.67 11,19.92M12,2C14.75,2 17.1,3 19.05,4.95C21,6.9 22,9.25 22,12C22,14.75 21,17.1 19.05,19.05C17.1,21 14.75,22 12,22C9.25,22 6.9,21 4.95,19.05C3,17.1 2,14.75 2,12C2,9.25 3,6.9 4.95,4.95C6.9,3 9.25,2 12,2Z"/></svg>',
  weather: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12.74,5.47C15.1,6.5 16.35,9.03 15.92,11.46C17.19,12.56 18,14.19 18,16V16.17C18.31,16.06 18.65,16 19,16A3,3 0 0,1 22,19A3,3 0 0,1 19,22H6A4,4 0 0,1 2,18A4,4 0 0,1 6,14H6.27C5,12.45 4.6,10.24 5.5,8.26C6.72,5.5 9.97,4.24 12.74,5.47M11.93,7.3C10.16,6.5 8.09,7.31 7.31,9.07C6.85,10.09 6.93,11.22 7.41,12.13C8.5,10.83 10.16,10 12,10C12.7,10 13.38,10.12 14,10.34C13.94,9.06 13.18,7.86 11.93,7.3M13.55,3.64C13,3.4 12.45,3.23 11.88,3.12L14.37,1.82L15.27,4.71C14.76,4.29 14.19,3.93 13.55,3.64M6.09,4.44C5.6,4.79 5.17,5.19 4.8,5.63L4.91,2.82L7.87,3.5C7.25,3.71 6.65,4.03 6.09,4.44M18,9.71C17.91,9.12 17.78,8.55 17.59,8L19.97,9.5L17.92,11.73C18.03,11.08 18.05,10.4 18,9.71M3.04,11.3C3.11,11.9 3.24,12.47 3.43,13L1.06,11.5L3.1,9.28C3,9.93 2.97,10.61 3.04,11.3M19,18H16V16A4,4 0 0,0 12,12A4,4 0 0,0 8,16H6A2,2 0 0,0 4,18A2,2 0 0,0 6,20H19A1,1 0 0,0 20,19A1,1 0 0,0 19,18Z"/></svg>',
  status: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M11,15H13V17H11V15M11,7H13V13H11V7M12,2C6.47,2 2,6.5 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20Z"/></svg>',
  messageInfo: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 10C10.9 10 10 10.9 10 12S10.9 14 12 14 14 13.1 14 12 13.1 10 12 10M18 12C18 8.7 15.3 6 12 6S6 8.7 6 12C6 14.2 7.2 16.1 9 17.2L10 15.5C8.8 14.8 8 13.5 8 12.1C8 9.9 9.8 8.1 12 8.1S16 9.9 16 12.1C16 13.6 15.2 14.9 14 15.5L15 17.2C16.8 16.2 18 14.2 18 12M12 2C6.5 2 2 6.5 2 12C2 15.7 4 18.9 7 20.6L8 18.9C5.6 17.5 4 14.9 4 12C4 7.6 7.6 4 12 4S20 7.6 20 12C20 15 18.4 17.5 16 18.9L17 20.6C20 18.9 22 15.7 22 12C22 6.5 17.5 2 12 2Z"/></svg>',
  positionAccuracy: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8M3.05,13H1V11H3.05C3.5,6.83 6.83,3.5 11,3.05V1H13V3.05C17.17,3.5 20.5,6.83 20.95,11H23V13H20.95C20.5,17.17 17.17,20.5 13,20.95V23H11V20.95C6.83,20.5 3.5,17.17 3.05,13M12,5A7,7 0 0,0 5,12A7,7 0 0,0 12,19A7,7 0 0,0 19,12A7,7 0 0,0 12,5Z"/></svg>',
  signalQuality: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M3,22V8H7V22H3M10,22V2H14V22H10M17,22V14H21V22H17Z"/></svg>',
};

// Per-field icons use the same vendored Material Design Icons set as the
// group headings. A compact semantic set is intentionally reused for
// related readings (for example IAS/TAS/Mach) so the labels stay scannable
// without turning the grid into a collection of unrelated pictograms.
const FIELD_ICON_PATHS = {
  aircraft: 'M21,16V14L13,9V3.5C13,2.67 12.33,2 11.5,2S10,2.67 10,3.5V9L2,14V16L10,13.5V19L7,21V22L11.5,21L16,22V21L13,19V13.5L21,16Z',
  building: 'M22,21H2V10L12,3L22,10V21M12,5.5L4,11V19H20V11L12,5.5M6,12H18V14H6V12M6,16H18V18H6V16Z',
  calendar: 'M19,4H18V2H16V4H8V2H6V4H5C3.9,4 3,4.9 3,6V20C3,21.1 3.9,22 5,22H19C20.1,22 21,21.1 21,20V6C21,4.9 20.1,4 19,4M19,20H5V9H19V20M7,11H12V16H7V11Z',
  account: 'M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z',
  tag: 'M17.63,5.84C17.27,5.33 16.67,5 16,5L5,5C3.9,5 3,5.9 3,7V17C3,18.1 3.9,19 5,19H16C16.67,19 17.27,18.67 17.63,18.16L22,12L17.63,5.84M7.5,13.5A1.5,1.5 0 1,1 7.5,10.5A1.5,1.5 0 0,1 7.5,13.5Z',
  altitude: 'M12,2L7,7H10V17H7L12,22L17,17H14V7H17L12,2Z',
  location: 'M12,2C15.31,2 18,4.69 18,8C18,12.5 12,19 12,19S6,12.5 6,8C6,4.69 8.69,2 12,2M12,6A2,2 0 1,0 12,10A2,2 0 0,0 12,6M5,20H19V22H5V20Z',
  speed: 'M7,2V13H10V22L17,10H13L17,2H7Z',
  compass: 'M12,2A10,10 0 1,0 12,22A10,10 0 0,0 12,2M15.5,8.5L13,14L8.5,15.5L11,10L15.5,8.5Z',
  rotate: 'M12,6V9L16,5L12,1V4C7.58,4 4,7.58 4,12C4,13.57 4.46,15.03 5.24,16.26L6.7,14.8C6.25,13.97 6,13.02 6,12C6,8.69 8.69,6 12,6M18.76,7.74L17.3,9.2C17.75,10.03 18,10.98 18,12C18,15.31 15.31,18 12,18V15L8,19L12,23V20C16.42,20 20,16.42 20,12C20,10.43 19.54,8.97 18.76,7.74Z',
  tune: 'M3,7H13V9H3V7M17,7H21V9H17V7M15,5H17V11H15V5M3,15H7V17H3V15M11,15H21V17H11V15M7,13H9V19H7V13Z',
  weather: 'M3,7H14C15.1,7 16,6.1 16,5S15.1,3 14,3C13.45,3 12.95,3.22 12.59,3.59L11.17,2.17C11.9,1.45 12.9,1 14,1C16.21,1 18,2.79 18,5S16.21,9 14,9H3V7M3,11H19C21.21,11 23,12.79 23,15S21.21,19 19,19C17.9,19 16.9,18.55 16.17,17.83L17.59,16.41C17.95,16.78 18.45,17 19,17C20.1,17 21,16.1 21,15S20.1,13 19,13H3V11M3,15H13V17H3V15Z',
  thermometer: 'M15,13V5A3,3 0 0,0 9,5V13A5,5 0 1,0 15,13M12,3A1,1 0 0,1 13,4V14.17A3,3 0 1,1 11,14.17V4A1,1 0 0,1 12,3Z',
  alert: 'M13,14H11V10H13V14M13,18H11V16H13V18M1,21H23L12,2L1,21Z',
  clock: 'M12,2A10,10 0 1,0 12,22A10,10 0 0,0 12,2M13,7V11.59L16.21,14.79L14.79,16.21L11,12.41V7H13Z',
  radio: 'M4,4H20C21.1,4 22,4.9 22,6V18C22,19.1 21.1,20 20,20H4C2.9,20 2,19.1 2,18V6C2,4.9 2.9,4 4,4M5,8V10H19V8H5M5,12V16H13V12H5M17,12A2,2 0 1,0 17,16A2,2 0 0,0 17,12Z',
  target: 'M12,8A4,4 0 1,0 12,16A4,4 0 0,0 12,8M12,2A10,10 0 1,0 12,22A10,10 0 0,0 12,2M12,20A8,8 0 1,1 12,4A8,8 0 0,1 12,20Z',
  signal: 'M3,22V16H7V22H3M10,22V10H14V22H10M17,22V2H21V22H17Z',
  shield: 'M12,1L3,5V11C3,16.55 6.84,21.74 12,23C17.16,21.74 21,16.55 21,11V5L12,1Z',
  shieldCheck: 'M12,1L3,5V11C3,16.55 6.84,21.74 12,23C17.16,21.74 21,16.55 21,11V5L12,1M10,17L6,13L7.41,11.59L10,14.17L16.59,7.58L18,9L10,17Z',
  barometer: 'M12,2A10,10 0 1,0 12,22A10,10 0 0,0 12,2M7.76,7.76L9.17,9.17C8.44,9.9 8,10.9 8,12H6C6,10.34 6.67,8.84 7.76,7.76M12,18A6,6 0 0,1 10.35,6.23L11.2,8.06C11.46,8.02 11.73,8 12,8C14.21,8 16,9.79 16,12S14.21,16 12,16V18M12,10A2,2 0 1,0 12,14A2,2 0 0,0 12,10Z',
  velocity: 'M4,5H14V2L21,9L14,16V13H4V5M4,17H16V19H4V17M4,21H12V23H4V21Z',
  checkCircle: 'M12,2A10,10 0 1,0 12,22A10,10 0 0,0 12,2M10,17L5,12L6.41,10.59L10,14.17L17.59,6.58L19,8L10,17Z',
  radius: 'M12,2A10,10 0 1,0 12,22A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12H17L21,16L23,12H22A10,10 0 0,0 12,2M12,20A8,8 0 0,1 4,12H7L3,8L1,12H2A10,10 0 0,0 12,22V20Z',
  rocket: 'M13.13,22.19L11.5,18.36C13.07,17.78 14.54,17 15.9,16L13.13,22.19M5.64,12.5L1.81,10.87L8,8.1C7,9.46 6.22,10.93 5.64,12.5M21.61,2.39C21.61,2.39 16.66,1.42 11,7.07C8.81,9.26 7.5,11.7 7,14L10,17C12.3,16.5 14.74,15.19 16.93,13C22.58,7.34 21.61,2.39 21.61,2.39M15,9A2,2 0 1,1 15,5A2,2 0 0,1 15,9Z',
  magnet: 'M3,7V13A9,9 0 0,0 21,13V7H16V13A4,4 0 0,1 8,13V7H3M3,3V5H8V3H3M16,3V5H21V3H16Z',
  navigation: 'M12,2L4.5,20.29L5.21,21L12,18L18.79,21L19.5,20.29L12,2Z',
  vertical: 'M7,10L12,5L17,10H14V14H17L12,19L7,14H10V10H7Z',
  briefcase: 'M20,6H16V4C16,2.9 15.1,2 14,2H10C8.9,2 8,2.9 8,4V6H4C2.9,6 2,6.9 2,8V19C2,20.1 2.9,21 4,21H20C21.1,21 22,20.1 22,19V8C22,6.9 21.1,6 20,6M10,4H14V6H10V4M20,19H4V13H10V15H14V13H20V19M12,13A1,1 0 1,1 12,11A1,1 0 0,1 12,13Z',
  info: 'M11,17H13V11H11V17M12,2A10,10 0 1,0 12,22A10,10 0 0,0 12,2M11,7V9H13V7H11Z',
  chip: 'M15,9H9V15H15V9M13,13H11V11H13V13M21,11V9H19V7C19,5.9 18.1,5 17,5H15V3H13V5H11V3H9V5H7C5.9,5 5,5.9 5,7V9H3V11H5V13H3V15H5V17C5,18.1 5.9,19 7,19H9V21H11V19H13V21H15V19H17C18.1,19 19,18.1 19,17V15H21V13H19V11H21M17,17H7V7H17V17Z',
  shieldAirplaneOutline: 'M21,11C21,16.55 17.16,21.74 12,23C6.84,21.74 3,16.55 3,11V5L12,1L21,5V11M12,21C15.75,20 19,15.54 19,11.22V6.3L12,3.18L5,6.3V11.22C5,15.54 8.25,20 12,21M12,5.68C12.5,5.68 12.95,6.11 12.95,6.63V10.11L18,13.26V14.53L12.95,12.95V16.42L14.21,17.37V18.32L12,17.68L9.79,18.32V17.37L11.05,16.42V12.95L6,14.53V13.26L11.05,10.11V6.63C11.05,6.11 11.5,5.68 12,5.68Z',
  gauge: 'M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12C20,14.4 19,16.5 17.3,18C15.9,16.7 14,16 12,16C10,16 8.2,16.7 6.7,18C5,16.5 4,14.4 4,12A8,8 0 0,1 12,4M14,5.89C13.62,5.9 13.26,6.15 13.1,6.54L11.81,9.77L11.71,10C11,10.13 10.41,10.6 10.14,11.26C9.73,12.29 10.23,13.45 11.26,13.86C12.29,14.27 13.45,13.77 13.86,12.74C14.12,12.08 14,11.32 13.57,10.76L13.67,10.5L14.96,7.29L14.97,7.26C15.17,6.75 14.92,6.17 14.41,5.96C14.28,5.91 14.15,5.89 14,5.89M10,6A1,1 0 0,0 9,7A1,1 0 0,0 10,8A1,1 0 0,0 11,7A1,1 0 0,0 10,6M7,9A1,1 0 0,0 6,10A1,1 0 0,0 7,11A1,1 0 0,0 8,10A1,1 0 0,0 7,9M17,9A1,1 0 0,0 16,10A1,1 0 0,0 17,11A1,1 0 0,0 18,10A1,1 0 0,0 17,9Z',
  crosshairsGps: 'M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8M3.05,13H1V11H3.05C3.5,6.83 6.83,3.5 11,3.05V1H13V3.05C17.17,3.5 20.5,6.83 20.95,11H23V13H20.95C20.5,17.17 17.17,20.5 13,20.95V23H11V20.95C6.83,20.5 3.5,17.17 3.05,13M12,5A7,7 0 0,0 5,12A7,7 0 0,0 12,19A7,7 0 0,0 19,12A7,7 0 0,0 12,5Z',
  speedometer: 'M12,16A3,3 0 0,1 9,13C9,11.88 9.61,10.9 10.5,10.39L20.21,4.77L14.68,14.35C14.18,15.33 13.17,16 12,16M12,3C13.81,3 15.5,3.5 16.97,4.32L14.87,5.53C14,5.19 13,5 12,5A8,8 0 0,0 4,13C4,15.21 4.89,17.21 6.34,18.65H6.35C6.74,19.04 6.74,19.67 6.35,20.06C5.96,20.45 5.32,20.45 4.93,20.07V20.07C3.12,18.26 2,15.76 2,13A10,10 0 0,1 12,3M22,13C22,15.76 20.88,18.26 19.07,20.07V20.07C18.68,20.45 18.05,20.45 17.66,20.06C17.27,19.67 17.27,19.04 17.66,18.65V18.65C19.11,17.2 20,15.21 20,13C20,12 19.81,11 19.46,10.1L20.67,8C21.5,9.5 22,11.18 22,13Z',
  shieldAlertOutline: 'M21,11C21,16.55 17.16,21.74 12,23C6.84,21.74 3,16.55 3,11V5L12,1L21,5V11M12,21C15.75,20 19,15.54 19,11.22V6.3L12,3.18L5,6.3V11.22C5,15.54 8.25,20 12,21M11,7H13V13H11V7M11,15H13V17H11V15Z',
  arrowExpandVertical: 'M13,9V15H16L12,19L8,15H11V9H8L12,5L16,9H13M4,2H20V4H4V2M4,20H20V22H4V20Z',
  certificateOutline: 'M13 21L15 20L17 21V14H13M17 9V7L15 8L13 7V9L11 10L13 11V13L15 12L17 13V11L19 10M20 3H4A2 2 0 0 0 2 5V15A2 2 0 0 0 4 17H11V15H4V5H20V15H19V17H20A2 2 0 0 0 22 15V5A2 2 0 0 0 20 3M11 8H5V6H11M9 11H5V9H9M11 14H5V12H11Z',
  mapMarkerRadiusOutline: 'M12 4C14.2 4 16 5.8 16 8C16 10.1 13.9 13.5 12 15.9C10.1 13.4 8 10.1 8 8C8 5.8 9.8 4 12 4M12 2C8.7 2 6 4.7 6 8C6 12.5 12 19 12 19S18 12.4 18 8C18 4.7 15.3 2 12 2M12 6C10.9 6 10 6.9 10 8S10.9 10 12 10 14 9.1 14 8 13.1 6 12 6M20 19C20 21.2 16.4 23 12 23S4 21.2 4 19C4 17.7 5.2 16.6 7.1 15.8L7.7 16.7C6.7 17.2 6 17.8 6 18.5C6 19.9 8.7 21 12 21S18 19.9 18 18.5C18 17.8 17.3 17.2 16.2 16.7L16.8 15.8C18.8 16.6 20 17.7 20 19Z',
};

const FIELD_ICONS = {
  manufacturer: 'building', model: 'aircraft', manufactureYear: 'calendar',
  operator: 'briefcase', registeredOwner: 'account', categoryDisplay: 'tag',
  altitudeM: 'altitude', verticalRateMs: 'vertical', positionSource: 'location',
  speedKmh: 'speed', iasKt: 'aircraft', tasKt: 'weather', mach: 'rocket',
  trackDeg: 'compass', magHeadingDeg: 'magnet', trueHeadingDeg: 'navigation',
  turnRateDegPerSec: 'rotate', rollDeg: 'rotate', navAltitudeM: 'altitude',
  navHeadingDeg: 'compass', navQnh: 'tune', navModes: 'tune',
  windDirDeg: 'weather', oatC: 'thermometer', squawk: 'radio',
  emergency: 'alert', hasAlert: 'alert', secondsSinceContact: 'clock',
  dbFlags: 'tag', messageType: 'radio', adsbVersion: 'chip',
  nic: 'shieldAirplaneOutline', nicBaro: 'gauge', nacP: 'crosshairsGps', nacV: 'speedometer', sil: 'shieldAlertOutline',
  gva: 'arrowExpandVertical', sda: 'certificateOutline', radiusOfContainmentM: 'mapMarkerRadiusOutline',
  messageCount: 'radio', signalStrengthDbm: 'signal', secondsSincePositionUpdate: 'clock',
};

function fieldIconHtml(fieldKey) {
  const key = Array.isArray(fieldKey) ? fieldKey[0] : fieldKey;
  const iconName = FIELD_ICONS[key] || 'tag';
  const path = FIELD_ICON_PATHS[iconName];
  return '<span class="detail-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="' + path + '"/></svg></span>';
}

// Splits a pre-joined categoryDisplay string ("A1 — Light (<15,500 lbs)",
// adsb.fi/airplanes.live; or just "Light (<15,500 lbs)", OpenSky — it has
// no short code of its own) into a compact "code · label" pair for the
// row itself, with the parenthetical weight-range explanation moved into
// the shared info-tip tooltip instead of shown inline every time.
function splitCategoryDisplay(display) {
  if (!display) return null;
  const codeMatch = /^(\S+) — (.+)$/.exec(display);
  const code = codeMatch ? codeMatch[1] : null;
  const rest = codeMatch ? codeMatch[2] : display;
  const parenMatch = /^(.*?)\s*(\(.+\))\s*$/.exec(rest);
  const label = parenMatch ? parenMatch[1] : rest;
  const tooltip = parenMatch ? parenMatch[2] : null;
  return { code, label, tooltip };
}

// One genuinely informative sentence per DO-260B emitter category — keyed
// by the exact English label text OPENSKY_CATEGORY_LABELS/
// ADSBEXCHANGE_CATEGORY_LABELS already use before any parenthetical, so
// one table serves both encodings. Deliberately skips the handful of
// labels with nothing substantive to say ("No info", "Reserved", etc.).
const CATEGORY_DESCRIPTIONS = {
  'Light': 'Any aircraft with maximum takeoff weight (MTOW) under 15,500 lbs (~7,031 kg). Covers most general aviation aircraft (e.g. Cessna 172, Piper PA-28) and light sport aircraft.',
  'Small': 'MTOW between 15,500 and 75,000 lbs (~7,031–34,019 kg) — typical of regional turboprops and light business jets (e.g. Embraer EMB 120, Cessna Citation).',
  'Large': 'MTOW between 75,000 and 300,000 lbs (~34,019–136,078 kg) — most narrow-body airliners fall here (e.g. Boeing 737, Airbus A320).',
  'High vortex large': 'A large aircraft (75,000–300,000 lbs) that generates unusually strong wingtip vortices, requiring extra wake-turbulence separation from following traffic (e.g. Boeing 757).',
  'Heavy': 'MTOW over 300,000 lbs (~136,078 kg) — wide-body airliners and large freighters (e.g. Boeing 777, Airbus A380).',
  'High performance': 'Capable of sustained accelerations above 5g and speeds over 400 knots — mostly military fast jets and aerobatic aircraft.',
  'Rotorcraft': 'A helicopter or other rotary-wing aircraft, lifted and propelled by one or more powered rotors rather than fixed wings.',
  'Glider / sailplane': 'A fixed-wing aircraft with no engine (or only a small sustainer motor), designed to fly using rising air currents.',
  'Lighter-than-air': 'An airship or powered balloon that stays aloft using buoyant gas rather than aerodynamic lift.',
  'Parachutist / skydiver': 'A person (or their transponder-equipped gear) descending by parachute — tracked as its own category for airspace safety.',
  'Ultralight / hang-glider / paraglider': 'A very light, low-speed recreational aircraft, typically single-seat and only lightly regulated.',
  'Unmanned aerial vehicle': 'A remotely piloted or fully autonomous aircraft with no pilot on board, from small consumer drones to large military UAVs.',
  'Space / trans-atmospheric vehicle': 'A vehicle designed to operate above the atmosphere, or to transition between space and atmospheric flight.',
  'Surface vehicle — emergency': 'A ground vehicle (e.g. a fire/rescue truck) broadcasting an ADS-B-like signal at an airport — not an aircraft.',
  'Surface vehicle — service': 'A ground service vehicle (e.g. a tow tractor or fuel truck) broadcasting an ADS-B-like signal at an airport — not an aircraft.',
  'Point obstacle': 'A fixed, single-point ground obstacle (e.g. a tower) broadcasting a reference position — not an aircraft.',
  'Cluster obstacle': 'A group of closely-spaced fixed ground obstacles broadcast as one reference position — not an aircraft.',
  'Line obstacle': 'An extended linear ground obstacle (e.g. a power line span) broadcast as a reference position — not an aircraft.',
};

// Generic clickable trigger for the shared #source-tooltip popover (see
// main.js) — the same tooltip mechanism used everywhere else in this app
// (source badges, route confidence), rather than a one-off native `title`
// or a differently-styled popover just for this.
function infoTipHtml(triggerHtml, detailText) {
  if (!detailText) return triggerHtml;
  return '<span class="info-tip" data-detail="' + detailText.replace(/"/g, '&quot;') + '">' + triggerHtml + '</span>';
}

// A serif italic "i" with a visibly curved stem and top/bottom terminals,
// drawn as paths so it keeps the same shape everywhere and doesn't collapse
// into a straight slash-like stroke.
const HELP_ICON_SVG = '<svg class="help-icon-serif" viewBox="0 0 18 22" width="11" height="14" aria-hidden="true">' +
  '<text x="2" y="18" fill="currentColor" font-family="Georgia, Times New Roman, serif" font-size="21" font-style="italic" font-weight="700">i</text>' +
  '</svg>';

// Renders one normalized info object (see normalizeOpenSky/
// normalizeAdsbExchange) into the sidebar's grouped HTML. Each group is
// omitted entirely when none of its fields are populated — e.g. an
// OpenSky-only aircraft (no adsb.fi/airplanes.live enrichment) won't have an
// Autopilot or Weather section at all, since those fields only ever come
// from the ADSBExchange-format sources.
// detailRow/renderGroup/specialRow are local closures (not module-scope)
// so they can close over this specific render's `fieldSources` without
// threading it through every one of the ~45 call sites below — unlike
// currentDevMode (a persistent UI-mode toggle, module-scope like
// currentUnitSystem), fieldSources changes per aircraft/per render, so it
// can't live as a top-level closure var.
const ROUTE_CONFIDENCE_BAND_LABELS = {
  very_high: 'Very High', high: 'High', medium: 'Medium', low: 'Low', reject: 'Reject',
};
// A green->red gradient distinct from SOURCE_COLORS (those color by *which
// source* supplied a field; this colors by *how confident* Layer 2 is in an
// adsbdb route) — a separate visual language so the two are never confused.
// Reject reuses the same red as emergency/alert fields elsewhere in the
// sidebar; that's an intentional exception to "red is reserved for
// emergencies" — this is a distinct element (a small dot, not a text
// color) and "essentially don't trust this" deserves the same urgency cue.
const ROUTE_CONFIDENCE_BAND_COLORS = {
  very_high: '#16a34a', high: '#65a30d', medium: '#f59e0b', low: '#ea580c', reject: '#dc2626',
};

// Human-readable breakdown for the route confidence badge's tooltip —
// shown in both normal and dev mode (unlike the per-source badges, which
// stay dev-mode-only), since knowing *why* a route was flagged is useful
// regardless of dev mode. Middot-separated, matching the same "homogeneous
// values, middot-separated" convention as the Category row.
function routeConfidenceDetail(rv) {
  const c = rv.checks;
  const parts = [];
  if (c.trackAlignment.diffDeg != null) parts.push(c.trackAlignment.diffDeg.toFixed(0) + '° off heading');
  parts.push(c.distanceToRoute.distanceKm.toFixed(0) + ' km off route');
  parts.push(c.routeProgress.percent.toFixed(0) + '% along route');
  return (ROUTE_CONFIDENCE_BAND_LABELS[rv.band] || rv.band) + ' confidence ('
    + rv.score.toFixed(0) + '/100) — ' + parts.join(' · ');
}

// Always-visible (not dev-mode-gated) confidence pill for Layer 2's
// adsbdb-route validation — a colored dot plus its band name, the whole
// thing wrapped in the same shared .info-tip click-tooltip trigger every
// other inline explanation in this app uses (see main.js), rather than a
// bespoke tooltip just for this.
function routeConfidenceBadgeHtml(routeValidation) {
  const color = ROUTE_CONFIDENCE_BAND_COLORS[routeValidation.band] || '#6b7280';
  const label = ROUTE_CONFIDENCE_BAND_LABELS[routeValidation.band] || routeValidation.band;
  const dot = '<span class="route-confidence-dot" style="background:' + color + '"></span>';
  return infoTipHtml('<span class="route-confidence">' + dot + label + ' confidence</span>', routeConfidenceDetail(routeValidation));
}

// "LHR (London Heathrow Airport)" -style strings (built by buildMergedDetails/
// parseFlightAware as "{name} ({code})") split back apart for the route
// card's big-code/small-name layout.
function splitAirportString(s) {
  const m = /^(.*)\s\(([A-Za-z0-9]{2,4})\)$/.exec(s || '');
  return m ? { name: m[1], code: m[2] } : { name: s, code: null };
}

function renderDetailsHtml(info, fieldSources, fieldConfidence, fieldComputationBasis, routeValidation, fieldNeedsCorroboration, categoryGroup, isGroundVehicle) {
  fieldSources = fieldSources || {};
  fieldConfidence = fieldConfidence || {};
  fieldComputationBasis = fieldComputationBasis || {};
  fieldNeedsCorroboration = fieldNeedsCorroboration || {};
  const dash = '—';
  // In normal mode, a row disappears when its value is empty (today's exact
  // behavior). In dev mode every row always renders — a dash placeholder
  // when empty, plus a colored per-source dot when populated.
  // helpHtml (optional) is rendered after the label — used
  // for (?) help-icon triggers that open the shared #source-tooltip popover.
  function detailRow(label, value, fieldKey, helpHtml, wide) {
    const has = value != null && value !== '';
    if (!has && !currentDevMode) return null;
    const badge = currentDevMode ? sourceBadgeHtml(fieldKey, fieldSources, fieldConfidence, fieldComputationBasis, fieldNeedsCorroboration) : '';
    const dataAttr = fieldKey ? ' data-field="' + fieldKey + '"' : '';
    const wideClass = wide ? ' detail-row-wide' : '';
    return '<div class="detail-row detail-row-basic' + wideClass + '"' + dataAttr + '><span class="detail-label"><span class="detail-label-main">' + fieldIconHtml(fieldKey) + '<span>' + label + '</span></span>' + (helpHtml || '') + '</span><span class="detail-value">' + (has ? value : dash) + badge + '</span></div>';
  }
  // Same "always render in dev mode" treatment for the two hardcoded
  // emergency/alert rows, which carry special red styling instead of going
  // through detailRow's generic '<b>label:</b> value' format. Always wide —
  // in tile mode these read as prominent full-width banners, matching the
  // visual weight the red text already carries.
  function specialRow(label, isSet, htmlWhenSet, fieldKey) {
    if (!isSet && !currentDevMode) return null;
    // Only wide when actually populated (a real emergency/alert reads as a
    // prominent full-width banner) — the empty dev-mode dash is a plain
    // half-width tile like everything else, so it can pair normally instead
    // of wasting a whole row on a "—" placeholder.
    const labelHtml = '<span class="detail-label"><span class="detail-label-main">' + fieldIconHtml(fieldKey) + '<span>' + label + '</span></span></span>';
    if (!isSet) return '<div class="detail-row detail-row-basic">' + labelHtml + '<span class="detail-value">' + dash + '</span></div>';
    return '<div class="detail-row detail-row-basic detail-row-wide">' + labelHtml + '<span class="detail-value detail-value-special">' + htmlWhenSet + (currentDevMode ? sourceBadgeHtml(fieldKey, fieldSources, fieldConfidence, fieldComputationBasis, fieldNeedsCorroboration) : '') + '</span></div>';
  }
  // A tile that pairs a primary value with an optional secondary, smaller
  // related value in the same tile (e.g. Altitude + "GPS 13,700 ft").
  // Gating is on the primary alone: if the primary is empty the whole tile
  // is skipped (matches every other row's hide-when-empty rule) even if a
  // secondary value happens to be present — accepted simplification, since
  // the paired fields in practice arrive together or not at all. The
  // secondary line only renders when it also has a value; dev mode badges
  // each of the primary/secondary values independently.
  function tileRow(label, value, fieldKey, opts) {
    opts = opts || {};
    const has = value != null && value !== '';
    if (!has && !currentDevMode) return null;
    const badge = currentDevMode ? sourceBadgeHtml(fieldKey, fieldSources, fieldConfidence, fieldComputationBasis, fieldNeedsCorroboration) : '';
    const dataAttr = fieldKey ? ' data-field="' + fieldKey + '"' : '';
    const wideClass = opts.wide ? ' detail-row-wide' : '';
    let secondaryHtml = '';
    if (opts.secondary) {
      const sec = opts.secondary;
      const secHas = sec.value != null && sec.value !== '';
      if (secHas) {
        const secBadge = currentDevMode ? sourceBadgeHtml(sec.fieldKey, fieldSources, fieldConfidence, fieldComputationBasis, fieldNeedsCorroboration) : '';
        secondaryHtml = '<span class="detail-value-secondary">' + sec.label + ' ' + sec.value + secBadge + '</span>';
      }
    }
    return '<div class="detail-row detail-row-basic' + wideClass + '"' + dataAttr + '><span class="detail-label"><span class="detail-label-main">' + fieldIconHtml(fieldKey) + '<span>' + label + '</span></span></span><span class="detail-value">' + (has ? value : dash) + badge + '</span>' + secondaryHtml + '</div>';
  }
  // A callsign-decoded operator/operator_country whose claimed country
  // conflicts with the aircraft's own ICAO24 hex-block country is withheld
  // entirely in normal mode for rotorcraft (see buildMergedDetails() in
  // sidebar-track.js — this function never sees the suppressed value at
  // all, "Unknown" falls out of the ordinary has=false path below). When it
  // *is* shown — dev mode, rotorcraft — this tags it visibly rather than
  // letting it read as an ordinary resolved field.
  function unconfirmedTagHtml(fieldKey) {
    if (!currentDevMode || categoryGroup !== 'rotorcraft' || !fieldNeedsCorroboration[fieldKey]) return '';
    return ' <span class="field-unconfirmed-tag">⚠ Unconfirmed</span>';
  }
  // Identity fields the enrichment pipeline can fill (Country/Operator/
  // Manufacturer/Model/Year built): in normal mode this now behaves exactly
  // like detailRow — an unresolved field hides its row entirely rather than
  // showing the literal word "Unknown". Dev mode is unchanged: every row
  // still always renders, with a dash placeholder for ground vehicles (which
  // skip heuristic enrichment tiers entirely, so "Unknown" would falsely
  // suggest enrichment was attempted) or "Unknown" for everything else.
  // wide (optional) spans both grid columns — used for fields whose value
  // tends to run long (full country names, company names, an airline logo
  // + name pairing) so they get room to sit on one line instead of
  // wrapping awkwardly inside a half-width tile.
  function identityRow(label, value, fieldKey, helpHtml, wide) {
    const has = value != null && value !== '';
    if (!has && !currentDevMode) return null;
    const badge = currentDevMode ? sourceBadgeHtml(fieldKey, fieldSources, fieldConfidence, fieldComputationBasis, fieldNeedsCorroboration) : '';
    const wideClass = wide ? ' detail-row-wide' : '';
    // Label + "(?)" icon are wrapped together in .identity-label-wrap, which
    // carries the min-width column-alignment that plain <b> used to have on
    // its own (static/style.css) — keeps the icon flush against the label
    // text itself while still lining up where the value starts for short
    // labels, same as every other detailRow. class="identity-label" gets a
    // lighter weight/smaller size than a plain detailRow <b> — four-plus
    // rows of full-bold labels each now carrying their own icon read as too
    // heavy/loud as a block.
    return '<div class="detail-row detail-row-identity' + wideClass + '"><span class="detail-label identity-label-wrap"><span class="detail-label-main">' + fieldIconHtml(fieldKey) + '<b class="identity-label">' + label + '</b></span>' + (helpHtml || '') + '</span><span class="detail-value">' + (has ? value : (isGroundVehicle ? dash : 'Unknown')) + badge + unconfirmedTagHtml(fieldKey) + '</span></div>';
  }
  // Operator/Operator Country and Registered Owner/Registration Country
  // used to be four separate full-width identityRow tiles stacked on top of
  // each other — reads as sprawling, since each pair is really one fact
  // ("who's flying it, and where they're from") split across two rows. This
  // folds each pair into a single wide tile: the company/owner as the
  // primary value (same has/dev-mode/Unknown treatment as identityRow), the
  // country as a smaller secondary line beneath it (same idiom as
  // tileRow's Altitude+GPS/Track+compass pairing) — but unlike tileRow's
  // secondary, this one still follows identityRow's own dev-mode contract
  // (every row always renders, with a dash/"Unknown" placeholder for a
  // missing value) rather than tileRow's "just omit it" rule, since dev
  // mode's whole point is showing exactly what's missing, not just what's
  // present.
  function identityTileRow(label, primaryValue, primaryFieldKey, primaryHelp, secondaryValue, secondaryFieldKey) {
    const hasPrimary = primaryValue != null && primaryValue !== '';
    const hasSecondary = secondaryValue != null && secondaryValue !== '';
    if (!hasPrimary && !hasSecondary && !currentDevMode) return null;
    // Normal mode never shows the literal word "Unknown" (matches every
    // other identity row) — if only the secondary resolved (e.g. Flywme
    // resolves Registration Country from a registration prefix far more
    // often than adsbdb resolves Registered Owner), the primary value is
    // simply omitted rather than growing a fake "Unknown" placeholder next
    // to real data. Dev mode still always shows both, dash or "Unknown",
    // for full-visibility debugging.
    let primaryHtml = '';
    if (hasPrimary || currentDevMode) {
      const primaryBadge = currentDevMode ? sourceBadgeHtml(primaryFieldKey, fieldSources, fieldConfidence, fieldComputationBasis, fieldNeedsCorroboration) : '';
      const primaryDisplay = hasPrimary ? primaryValue : (isGroundVehicle ? dash : 'Unknown');
      primaryHtml = '<span class="detail-value">' + primaryDisplay + primaryBadge + unconfirmedTagHtml(primaryFieldKey) + '</span>';
    }
    let secondaryHtml = '';
    if (hasSecondary || currentDevMode) {
      // No text label here (e.g. "Country") — the flag already carries that
      // meaning (flagHtml() is baked into secondaryValue itself), so a
      // literal word next to it would just be a redundant, noisy repeat.
      const secondaryBadge = currentDevMode ? sourceBadgeHtml(secondaryFieldKey, fieldSources, fieldConfidence, fieldComputationBasis, fieldNeedsCorroboration) : '';
      const secondaryDisplay = hasSecondary ? secondaryValue : (isGroundVehicle ? dash : 'Unknown');
      secondaryHtml = '<span class="detail-value-secondary">' + secondaryDisplay + secondaryBadge + unconfirmedTagHtml(secondaryFieldKey) + '</span>';
    }
    return '<div class="detail-row detail-row-identity detail-row-wide"><span class="detail-label identity-label-wrap"><span class="detail-label-main">' + fieldIconHtml(primaryFieldKey) + '<b class="identity-label">' + label + '</b></span>' + (primaryHelp || '') + '</span>' + primaryHtml + secondaryHtml + '</div>';
  }
  function identityLogoRow(label, logoHtml, nameValue, nameFieldKey, helpHtml, countryValue, countryFieldKey) {
    const hasLogo = logoHtml != null && logoHtml !== '';
    const hasName = nameValue != null && nameValue !== '';
    const hasCountry = countryValue != null && countryValue !== '';
    if (!hasLogo && !hasName && !hasCountry && !currentDevMode) return null;
    const badge = currentDevMode ? sourceBadgeHtml(nameFieldKey, fieldSources, fieldConfidence, fieldComputationBasis, fieldNeedsCorroboration) : '';
    const countryBadge = currentDevMode ? sourceBadgeHtml(countryFieldKey, fieldSources, fieldConfidence, fieldComputationBasis, fieldNeedsCorroboration) : '';
    const nameDisplay = hasName ? nameValue : (isGroundVehicle ? dash : 'Unknown');
    const countryDisplay = hasCountry ? countryValue : (isGroundVehicle ? dash : 'Unknown');
    return '<div class="detail-row detail-row-identity detail-row-wide identity-logo-row">'
      + '<span class="detail-label identity-label-wrap"><span class="detail-label-main">' + fieldIconHtml(nameFieldKey) + '<b class="identity-label">' + label + '</b></span>' + (helpHtml || '') + '</span>'
      + '<span class="detail-value identity-logo-value">'
      + (hasLogo ? '<span class="identity-logo-square" aria-hidden="true">' + logoHtml + '</span>' : '')
      + '<span class="identity-logo-copy">'
      + '<span class="identity-logo-name">' + nameDisplay + badge + unconfirmedTagHtml(nameFieldKey) + '</span>'
      + '<span class="identity-logo-country">' + countryDisplay + countryBadge + unconfirmedTagHtml(countryFieldKey) + '</span>'
      + '</span>'
      + '</span>'
      + '</div>';
  }
  // Every group, Identity included, renders as the 2-column stat-tile grid
  // (see .detail-group-body.tiles in app.css) — long-running values
  // (Operator, Operator Country, Registered Owner, Registration Country)
  // opt into a full-width tile via identityRow's own `wide` flag instead of
  // opting the whole group out of tiling. Gated on isTileLayoutEnabled()
  // (state-filters.js) so the HUD toggle can fall back to the plain
  // single-column list — the .tiles CSS modifier is additive, so simply
  // omitting it is enough to get the pre-tile layout back with no separate
  // markup path.
  function renderGroup(title, rows, iconKey) {
    const filtered = rows.filter((r) => r != null);
    if (!filtered.length) return '';
    const tiled = typeof isTileLayoutEnabled === 'function' ? isTileLayoutEnabled() : true;
    if (tiled) {
      // A trailing half-width tile with no pair — either right before the
      // next full-width tile, or at the very end of the group — would
      // otherwise leave dead space beside it (CSS grid's default sparse
      // auto-placement can't backfill a half-filled row from a later
      // full-width item, which needs both columns at once). Computed here,
      // not via a blunt CSS nth-child rule, since only this function
      // actually knows which rows are wide and where each run of
      // half-width rows starts/ends.
      const isWide = (r) => r.indexOf('detail-row-wide') !== -1;
      const stretchLastOfRun = (r) => r.replace(/^(<div class="detail-row [^"]+)"/, '$1 detail-row-wide"');
      let runStart = -1;
      for (let i = 0; i < filtered.length; i++) {
        if (isWide(filtered[i])) {
          if (runStart !== -1 && (i - runStart) % 2 === 1) {
            filtered[i - 1] = stretchLastOfRun(filtered[i - 1]);
          }
          runStart = -1;
        } else if (runStart === -1) {
          runStart = i;
        }
      }
      if (runStart !== -1 && (filtered.length - runStart) % 2 === 1) {
        filtered[filtered.length - 1] = stretchLastOfRun(filtered[filtered.length - 1]);
      }
    }
    const groupKey = iconKey || title.replace(/&amp;/g, 'and').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const configuredCollapsed = Object.prototype.hasOwnProperty.call(sidebarAccordionConfig.groups, groupKey)
      ? sidebarAccordionConfig.groups[groupKey]
      : sidebarAccordionConfig.default_collapsed;
    const collapsed = detailGroupCollapsedOverrides.has(groupKey)
      ? detailGroupCollapsedOverrides.get(groupKey)
      : configuredCollapsed;
    const icon = iconKey && GROUP_ICONS[iconKey] ? '<span class="detail-group-icon">' + GROUP_ICONS[iconKey] + '</span>' : '';
    const chevron = '<svg class="detail-group-chevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/></svg>';
    const bodyClass = tiled ? 'detail-group-body tiles' : 'detail-group-body';
    return '<div class="detail-group' + (collapsed ? ' is-collapsed' : '') + '"><button class="detail-group-title detail-group-toggle" type="button" data-group-key="' + groupKey + '" aria-expanded="' + String(!collapsed) + '"><span class="detail-group-title-main">' + icon + '<span>' + title + '</span></span>' + chevron + '</button><div class="' + bodyClass + '"' + (collapsed ? ' hidden' : '') + '>' +
      filtered.join('') + '</div></div>';
  }
  // Flag always leads the country name, rendered via flagHtml() from
  // info.countryIso. Only ever present when country was resolved via
  // enrichment (enrich_identity() always resolves country_iso alongside
  // the name); a raw live string (e.g. OpenSky's own origin_country)
  // carries no ISO code to derive one from, so it renders without a flag —
  // a known limitation, not solved here (would need fragile name-matching
  // against enrichment/countries.py).
  const countryFlagHtml = flagHtml(info.countryIso);
  const countryValue = info.originCountry
    ? (countryFlagHtml ? countryFlagHtml + ' ' + info.originCountry : info.originCountry)
    : null;
  const registeredOwnerCountryFlagHtml = flagHtml(info.registeredOwnerCountryIso);
  const registeredOwnerCountryValue = info.registeredOwnerCountry
    ? (registeredOwnerCountryFlagHtml ? registeredOwnerCountryFlagHtml + ' ' + info.registeredOwnerCountry : info.registeredOwnerCountry)
    : null;
  // Operator is plain text plus a leading airline logo (looked up from the
  // callsign, not from however the operator name itself was resolved — see
  // airlineLogoHtml()) — its country lives in its own dedicated "Operator
  // Country" row/flag below, never smeared onto this row (same "one
  // concept per row" pattern as Registered Owner having its own flag
  // rather than decorating Operator). The logo can resolve even when the
  // name itself didn't (no live/adsbdb/Flywme tier had an answer, but the
  // callsign prefix still matches a vendored logo) — in dev mode this still
  // falls back to the literal "Unknown" text next to the logo, same as
  // every other identityRow field's unresolved state. In normal mode a logo
  // alone with no real operator name no longer synthesizes that fallback
  // text — the row still renders (the logo itself is real, known data), just
  // without a fake "Unknown" caption; the row only hides entirely when
  // neither a name nor a logo resolved at all.
  const operatorLogoHtml = airlineLogoHtml(info.callsign);
  const operatorText = info.operator || (operatorLogoHtml && currentDevMode ? 'Unknown' : null);
  // Operator Country: adsbdb's flightroute.airline (name + ISO together) as
  // the primary tier, falling back to our own callsign-prefix enrichment
  // (enrichment/callsign.py's AIRLINE_OPERATORS table) when adsbdb has
  // nothing — see enrich_identity()'s "operator_country" field.
  const operatorCountryFlagHtml = flagHtml(info.operatorCountryIso);
  const operatorCountryValue = info.operatorCountry
    ? (operatorCountryFlagHtml ? operatorCountryFlagHtml + ' ' + info.operatorCountry : info.operatorCountry)
    : null;
  const registeredOwnerValue = info.registeredOwner || null;
  // In normal mode, Operator is hidden when it adds no information beyond
  // Registered Owner: same resolved name and same resolved country. Any
  // difference in either field (or an unresolved owner-side field) keeps the
  // Operator tile visible. Dev mode always keeps both tiles for debugging.
  function normalizedIdentityText(value) {
    return value == null ? null : String(value).trim().toLowerCase();
  }
  const sameOperatorNameAsOwner = normalizedIdentityText(info.operator) != null
    && normalizedIdentityText(info.operator) === normalizedIdentityText(info.registeredOwner);
  const sameOperatorCountryNameAsOwner = normalizedIdentityText(info.operatorCountry) != null
    && normalizedIdentityText(info.operatorCountry) === normalizedIdentityText(info.registeredOwnerCountry);
  const sameOperatorCountryIsoAsOwner = normalizedIdentityText(info.operatorCountryIso) != null
    && normalizedIdentityText(info.operatorCountryIso) === normalizedIdentityText(info.registeredOwnerCountryIso);
  const sameOperatorCountryAsOwner = sameOperatorCountryNameAsOwner || sameOperatorCountryIsoAsOwner;
  const hideOperatorAsDuplicate = !currentDevMode
    && sameOperatorNameAsOwner
    && sameOperatorCountryAsOwner;
  // A callsign-derived mark is an operator mark. When the operator card is
  // intentionally suppressed because it is the same legal entity as Owner,
  // keep that mark on the one remaining Owner card. For distinct entities,
  // never mislabel the operator's mark as an owner logo.
  const ownerLogoHtml = hideOperatorAsDuplicate ? operatorLogoHtml : '';
  // Operator/Operator Country/Registered Owner/Registration Country are
  // four easily-confused concepts (found the hard way — a user kept
  // getting them mixed up across a whole session). Each explanation
  // cross-references the other three so they read as one disambiguated
  // set rather than four isolated tooltips. A small circled-"?" icon
  // (HELP_ICON_SVG, same glyph as the HUD's own (?) buttons) sits flush
  // against the label, not wrapping the label itself and not wrapping the
  // value either — unlike Category/header pieces, these rows show
  // "Unknown" as often as a real value, and the icon needs to be there
  // either way.
  const IDENTITY_FIELD_EXPLANATIONS = {
    operator: 'Operator — the airline or company flying this aircraft. Not necessarily who owns it (see Owner).',
    operatorCountry: 'Operator Country — the operating airline’s home country. Not the aircraft’s own country of registration (see Registration Country).',
    registeredOwner: 'Owner — the private or corporate entity the aircraft is registered to, which can differ from the airline actually flying it (e.g. leasing).',
    registrationCountry: 'Registration Country — the country the aircraft itself is registered in (its ICAO nationality mark), not who operates or owns it (see Operator Country / Owner).',
  };
  function identityHelp(key) {
    return infoTipHtml(HELP_ICON_SVG, IDENTITY_FIELD_EXPLANATIONS[key]);
  }
  // Category: compact "code · label" (or just "label" for OpenSky, which
  // has no short code of its own) — the parenthetical weight-range
  // explanation moves into the shared info-tip tooltip instead of showing
  // inline every time, alongside one genuinely informative sentence about
  // what that category actually means (CATEGORY_DESCRIPTIONS).
  const categoryParts = splitCategoryDisplay(info.categoryDisplay);
  let categoryValue = null;
  let categoryHelp = null;
  let categoryRow = null;
  if (categoryParts) {
    const description = CATEGORY_DESCRIPTIONS[categoryParts.label];
    const detail = description
      ? (categoryParts.code ? categoryParts.code + ' (' + categoryParts.label + ')' : categoryParts.label) + ' — ' + description
      : null;
    categoryValue = categoryParts.code ? categoryParts.code + ' · ' + categoryParts.label : categoryParts.label;
    categoryHelp = detail ? infoTipHtml(HELP_ICON_SVG, detail) : null;
  }
  if (categoryValue != null || currentDevMode) {
    const categoryBadge = currentDevMode ? sourceBadgeHtml('categoryDisplay', fieldSources, fieldConfidence, fieldComputationBasis, fieldNeedsCorroboration) : '';
    const categoryDisplay = categoryValue != null ? categoryValue : (isGroundVehicle ? dash : 'Unknown');
    categoryRow = '<div class="detail-row detail-row-basic" data-field="categoryDisplay">'
      + '<span class="detail-label"><span class="detail-label-main">' + fieldIconHtml('categoryDisplay') + '<b>Category</b></span>' + (categoryHelp || '') + '</span>'
      + '<span class="detail-value">' + categoryDisplay + categoryBadge + '</span>'
      + '</div>';
  }
  const identity = renderGroup('Identity', [
    // Legal/operating identity is the primary fact in this group. Aircraft
    // make/model/category follow as supporting identification details.
    hideOperatorAsDuplicate
      ? null
      : identityLogoRow('Operator', operatorLogoHtml, operatorText, 'operator', identityHelp('operator'), operatorCountryValue, 'operatorCountry'),
    identityLogoRow('Owner', ownerLogoHtml, registeredOwnerValue, 'registeredOwner', identityHelp('registeredOwner'), registeredOwnerCountryValue, 'registeredOwnerCountry'),
    identityRow('Manufacturer', info.manufacturer, 'manufacturer'),
    identityRow('Model', info.model, 'model'),
    identityRow('Year built', info.manufactureYear, 'manufactureYear'),
    categoryRow,
  ], 'identity');
  // Altitude + Geo altitude pair into one tile (primary + a "GPS ..."
  // secondary line) rather than two separate tiles — they're the same
  // underlying fact (how high) reported two ways, read together the same
  // way the reference layout's own Altitude tile does.
  const position = renderGroup('Position', [
    tileRow('Altitude', formatAltitude(info.altitudeM), 'altitudeM', {
      secondary: { label: 'GPS', value: formatAltitude(info.altGeomM), fieldKey: 'altGeomM' },
    }),
    detailRow('Vertical rate', formatVerticalRateUnit(info.verticalRateMs), 'verticalRateMs'),
    detailRow('Position source', info.positionSource, 'positionSource'),
  ], 'position');
  // Track gets a computed 8-point compass secondary line ("133°" -> "SE"),
  // mirroring the reference layout's own heading tile.
  const speedHeading = renderGroup('Speed &amp; Heading', [
    detailRow('Speed', formatSpeedKmh(info.speedKmh), 'speedKmh'),
    detailRow('IAS', formatSpeedKt(info.iasKt), 'iasKt'),
    detailRow('TAS', formatSpeedKt(info.tasKt), 'tasKt'),
    detailRow('Mach', info.mach != null ? info.mach.toFixed(2) : null, 'mach'),
    detailRow('Track', info.trackDeg != null
      ? Math.round(info.trackDeg) + '° ' + degToCompass(info.trackDeg)
      : null, 'trackDeg'),
    detailRow('Heading (mag)', info.magHeadingDeg != null ? Math.round(info.magHeadingDeg) + '°' : null, 'magHeadingDeg'),
    detailRow('Heading (true)', info.trueHeadingDeg != null ? Math.round(info.trueHeadingDeg) + '°' : null, 'trueHeadingDeg'),
    detailRow('Turn rate', info.turnRateDegPerSec != null ? info.turnRateDegPerSec.toFixed(1) + '°/s' : null, 'turnRateDegPerSec'),
    detailRow('Roll', info.rollDeg != null ? info.rollDeg.toFixed(1) + '°' : null, 'rollDeg'),
  ], 'speedHeading');
  const autopilot = renderGroup('Autopilot', [
    detailRow('Selected altitude', formatAltitude(info.navAltitudeM), 'navAltitudeM'),
    detailRow('Selected heading', info.navHeadingDeg != null ? Math.round(info.navHeadingDeg) + '°' : null, 'navHeadingDeg'),
    detailRow('QNH', info.navQnh != null ? Math.round(info.navQnh) + ' hPa' : null, 'navQnh'),
    detailRow('Modes', info.navModes ? info.navModes.join(', ') : null, 'navModes', null, true),
  ], 'autopilot');
  // Outside air temp + Total air temp combine into one slash-separated
  // tile ("Temp / TAT"), mirroring the reference layout's own "TEMP / DEW"
  // tile — two related readings shown together instead of two tiles. Gated
  // on either being present (not both), with a dash standing in for
  // whichever side is missing, so one populated reading doesn't disappear
  // just because its sibling isn't reported by this source.
  const oatText = info.oatC != null ? Math.round(info.oatC) + ' °C' : null;
  const tatText = info.tatC != null ? Math.round(info.tatC) + ' °C' : null;
  const tempTatValue = (oatText || tatText) ? (oatText || dash) + ' / ' + (tatText || dash) : null;
  const weather = renderGroup('Weather', [
    detailRow('Wind', (info.windDirDeg != null && info.windSpeedKt != null)
      ? Math.round(info.windDirDeg) + '° / ' + formatSpeedKt(info.windSpeedKt) : null, ['windDirDeg', 'windSpeedKt']),
    detailRow('Temp / TAT', tempTatValue, ['oatC', 'tatC']),
  ], 'weather');
  const status = renderGroup('Status', [
    detailRow('Squawk', formatSquawk(info.squawk), 'squawk'),
    specialRow('Emergency', !!info.emergency, '<span class="emergency">Emergency: ' + info.emergency + '</span>', 'emergency'),
    specialRow('Alert', !!info.hasAlert, '<span class="emergency">Alert</span>', 'hasAlert'),
    detailRow('Last update', formatRelativeSeconds(info.secondsSinceContact), 'secondsSinceContact'),
  ], 'status');
  // adsb.fi/airplanes.live only — no OpenSky equivalent for any of these
  // (DO-260B navigation accuracy/integrity categories, receiver-relative
  // signal metadata). Absent entirely for an OpenSky-only aircraft, same as
  // Autopilot/Weather above. Split into three groups for clarity.
  const messageInfo = renderGroup('Message Info', [
    detailRow('Data source flags', formatDbFlags(info.dbFlags), 'dbFlags', null, true),
    detailRow('Message type', info.messageType, 'messageType'),
    detailRow('ADS-B version', info.adsbVersion != null ? 'v' + info.adsbVersion : null, 'adsbVersion'),
  ], 'messageInfo');
  const positionAccuracy = renderGroup('Position Accuracy', [
    detailRow('NIC', info.nic, 'nic', infoTipHtml(HELP_ICON_SVG, 'Navigation Integrity Category — how tightly the reported position is guaranteed to fall within the stated Radius of Containment. Higher value = tighter guarantee.')),
    detailRow('NIC (baro)', info.nicBaro, 'nicBaro'),
    detailRow('NACp', info.nacP, 'nacP', infoTipHtml(HELP_ICON_SVG, 'Navigation Accuracy Category, position — the current estimated accuracy of the reported position. Higher value = better estimate, but not a guaranteed containment radius like NIC.')),
    detailRow('NACv', info.nacV, 'nacV', infoTipHtml(HELP_ICON_SVG, 'Navigation Accuracy Category, velocity — the current estimated accuracy of the reported ground speed and track. The velocity equivalent of NACp.')),
    detailRow('SIL', info.sil != null ? info.sil + (info.silType ? ' (' + info.silType + ')' : '') : null, 'sil', infoTipHtml(HELP_ICON_SVG, 'Source Integrity Level — the probability that the true position error exceeds the NIC containment radius without an alert, expressed per flight-hour or per sample.')),
    detailRow('GVA', info.gva, 'gva', infoTipHtml(HELP_ICON_SVG, 'Geometric Vertical Accuracy — the accuracy of the GPS-derived (geometric) altitude, distinct from the barometric altitude shown elsewhere in the panel.')),
    detailRow('SDA', info.sda, 'sda', infoTipHtml(HELP_ICON_SVG, 'System Design Assurance — how failure-resistant the aircraft\'s onboard ADS-B avionics are certified to be, independent of what they\'re currently reporting.')),
    detailRow('Radius of containment', info.radiusOfContainmentM != null ? Math.round(info.radiusOfContainmentM) + ' m' : null, 'radiusOfContainmentM'),
  ], 'positionAccuracy');
  const signalReception = renderGroup('Signal & Reception', [
    detailRow('Messages received', info.messageCount, 'messageCount'),
    detailRow('Signal strength', info.signalStrengthDbm != null ? info.signalStrengthDbm.toFixed(1) + ' dBm' : null, 'signalStrengthDbm'),
  ], 'signalQuality');
  function badgeFor(key) {
    return currentDevMode ? sourceBadgeHtml(key, fieldSources, fieldConfidence, fieldComputationBasis, fieldNeedsCorroboration) : '';
  }
  // --- Header: identity essentials at a glance, promoted out of the
  // Identity group into their own masthead so the sidebar reads
  // title-first (a callsign/registration, not a bare field list) —
  // rendered into its own #sidebar-header element (see sidebar-track.js),
  // not part of the group list above. Each piece explains itself via the
  // same shared .info-tip mechanism as Category/route confidence — a
  // first-time viewer has no other way to know "TC-LGY" is a registration
  // and "THY1RT" is a callsign, not two arbitrary codes.
  const HEADER_FIELD_EXPLANATIONS = {
    registration: 'Registration — the aircraft’s unique tail number, assigned by its country of registration (painted on the fuselage).',
    icao24: 'ICAO24 — the aircraft’s permanent 24-bit Mode S transponder address (hex), tied to the airframe for life, unlike its registration or callsign.',
    callsign: 'Callsign — the flight identifier transmitted by the transponder, usually the airline’s code plus a flight number (changes per flight).',
    aircraftType: 'Aircraft type — the airframe’s make and model.',
  };
  function headerPiece(value, key) {
    return infoTipHtml(value + badgeFor(key), HEADER_FIELD_EXPLANATIONS[key]);
  }
  // Registration > ICAO24 > callsign > literal "Unknown aircraft" — the third
  // tier matters for sources with neither of the first two (OGN's gliders/
  // FLARM-tracked aircraft have no registration and, unless address_type
  // confirms a real ICAO24, no icao24 either — but almost always still carry
  // a device identifier as `callsign`, e.g. "FLRDDDEAD" — showing that beats
  // a bare "Unknown aircraft" with no identifying information at all).
  const headerTitleUsedCallsign = !info.registration && !info.icao24 && !!info.callsign;
  const headerTitle = info.registration
    ? headerPiece(info.registration, 'registration')
    : info.icao24
      ? headerPiece(info.icao24.toUpperCase(), 'icao24')
      : headerTitleUsedCallsign
        ? headerPiece(info.callsign, 'callsign')
        : 'Unknown aircraft';
  const headerSubtitleParts = [];
  if (info.callsign && !headerTitleUsedCallsign) headerSubtitleParts.push(headerPiece(info.callsign, 'callsign'));
  if (info.aircraftType) headerSubtitleParts.push(headerPiece(info.aircraftType, 'aircraftType'));
  if (info.registration && info.icao24) headerSubtitleParts.push(headerPiece(info.icao24.toUpperCase(), 'icao24'));
  const header = '<div class="sidebar-header-title">' + headerTitle + '</div>'
    + (headerSubtitleParts.length
      ? '<div class="sidebar-header-subtitle">' + headerSubtitleParts.join(' <span class="sidebar-header-sep">·</span> ') + '</div>'
      : '');

  // --- Route card: its own visual block (see #sidebar-route in
  // sidebar-track.js) rather than a text row inside Identity — big airport
  // codes, small city names, a direction arrow between them, and (for an
  // adsbdb-sourced route) the Layer 2 confidence badge. In normal mode only
  // High/Very High confidence routes render; Medium/Low/Reject are dev-only.
  const routeHas = info.originAirport && info.destinationAirport;
  const isReject = routeValidation && routeValidation.band === 'reject';
  const isLow = routeValidation && routeValidation.band === 'low';
  const isMedium = routeValidation && routeValidation.band === 'medium';
  const routeDevBadge = currentDevMode
    ? sourceBadgeHtml(['originAirport', 'destinationAirport'], fieldSources, fieldConfidence, fieldComputationBasis, fieldNeedsCorroboration)
    : '';
  const routeConfidenceBadge = routeValidation ? routeConfidenceBadgeHtml(routeValidation) : '';
  const routeCategoryGroup = categoryParts ? CATEGORY_LABEL_TO_GROUP[categoryParts.label] : null;
  let route = '';
  if (routeHas) {
    if (isReject) {
      // Reject-band routes are hidden entirely in normal mode — the
      // confidence is so low the airports are essentially known to be wrong.
      // Dev mode shows the card with "Not confirmed" but NO airport pair
      // (they're not useful when confidence is <40).
      if (currentDevMode) {
        route = '<div class="route-card route-card-unconfirmed">'
          + '<div class="route-card-title">Route <span class="route-card-tag">Not confirmed</span></div>'
          + '<div class="route-card-footer">' + routeConfidenceBadge + routeDevBadge + '</div>'
          + '</div>';
      }
    } else if (isLow) {
      // Low-band routes are hidden in normal mode too — confidence uncertain
      // enough to mislead. Dev mode shows them with "⚠ Unverified" and the
      // real airport pair so enrichment can be debugged.
      if (currentDevMode) {
        const origin = splitAirportString(info.originAirport);
        const dest = splitAirportString(info.destinationAirport);
        route = '<div class="route-card route-card-low">'
          + '<div class="route-card-title">Route <span class="route-card-tag">⚠ Unverified</span></div>'
          + '<div class="route-card-endpoints">'
          + '<div class="route-card-endpoint"><div class="route-card-code">' + (origin.code || '—') + '</div><div class="route-card-city">' + origin.name + '</div></div>'
          + '<div class="route-card-arrow">' + routeArrowIconHtml(routeCategoryGroup, info.verticalRateMs) + '</div>'
          + '<div class="route-card-endpoint"><div class="route-card-code">' + (dest.code || '—') + '</div><div class="route-card-city">' + dest.name + '</div></div>'
          + '</div>'
          + '<div class="route-card-footer">' + routeConfidenceBadge + routeDevBadge + '</div>'
          + '</div>';
      }
    } else if (isMedium) {
      // Medium-band routes are now dev-only too — still too uncertain to
      // name specific airports in normal mode, but useful for debugging.
      if (currentDevMode) {
        const origin = splitAirportString(info.originAirport);
        const dest = splitAirportString(info.destinationAirport);
        route = '<div class="route-card route-card-medium">'
          + '<div class="route-card-title">Route <span class="route-card-tag">~ Review</span></div>'
          + '<div class="route-card-endpoints">'
          + '<div class="route-card-endpoint"><div class="route-card-code">' + (origin.code || '—') + '</div><div class="route-card-city">' + origin.name + '</div></div>'
          + '<div class="route-card-arrow">' + routeArrowIconHtml(routeCategoryGroup, info.verticalRateMs) + '</div>'
          + '<div class="route-card-endpoint"><div class="route-card-code">' + (dest.code || '—') + '</div><div class="route-card-city">' + dest.name + '</div></div>'
          + '</div>'
          + '<div class="route-card-footer">' + routeConfidenceBadge + routeDevBadge + '</div>'
          + '</div>';
      }
    } else {
      const origin = splitAirportString(info.originAirport);
      const dest = splitAirportString(info.destinationAirport);
      route = '<div class="route-card">'
        + '<div class="route-card-title">Route</div>'
        + '<div class="route-card-endpoints">'
        + '<div class="route-card-endpoint"><div class="route-card-code">' + (origin.code || '—') + '</div><div class="route-card-city">' + origin.name + '</div></div>'
        + '<div class="route-card-arrow">' + routeArrowIconHtml(routeCategoryGroup, info.verticalRateMs) + '</div>'
        + '<div class="route-card-endpoint"><div class="route-card-code">' + (dest.code || '—') + '</div><div class="route-card-city">' + dest.name + '</div></div>'
        + '</div>'
        + '<div class="route-card-footer">' + routeConfidenceBadge + routeDevBadge + '</div>'
        + '</div>';
    }
  } else if (currentDevMode) {
    route = '<div class="route-card route-card-empty"><div class="route-card-title">Route</div><div class="route-card-empty-text">' + dash + '</div></div>';
  }

  return {
    header,
    route,
    body: identity + position + speedHeading + autopilot + weather + status + messageInfo + positionAccuracy + signalReception,
  };
}
