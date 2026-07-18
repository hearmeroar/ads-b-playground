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
    ? Math.round(kmh / 1.852) + ' kt'
    : Math.round(kmh) + ' km/h';
}
// For fields that are natively in knots (IAS/TAS/wind speed).
function formatSpeedKt(kt) {
  if (kt == null) return null;
  return currentUnitSystem === 'imperial'
    ? Math.round(kt) + ' kt'
    : Math.round(kt * 1.852) + ' km/h';
}
function formatVerticalRateUnit(rateMs) {
  if (rateMs == null) return null;
  if (Math.abs(rateMs) <= VERTICAL_RATE_LEVEL_THRESHOLD_MS) return 'level';
  const word = rateMs > 0 ? 'climbing' : 'descending';
  const value = currentUnitSystem === 'imperial'
    ? (rateMs > 0 ? '+' : '') + Math.round(rateMs * 196.850) + ' ft/min'
    : (rateMs > 0 ? '+' : '') + rateMs.toFixed(1) + ' m/s';
  return value + ' (' + word + ')';
}
function formatRelativeSeconds(sec) {
  if (sec == null) return null;
  if (sec < 60) return Math.round(sec) + ' s ago';
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
function routeArrowIconHtml(categoryGroup) {
  const glyphTemplate = (categoryGroup && CATEGORY_GLYPHS[categoryGroup]) || UNKNOWN_GLYPH;
  const glyph = glyphTemplate.replace(/COLOR/g, '#6b7280');
  return '<div style="transform: rotate(90deg); display: flex;">'
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
  signalQuality: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M4,6V4H4.1C12.9,4 20,11.1 20,19.9V20H18V19.9C18,12.2 11.8,6 4,6M4,10V8A12,12 0 0,1 16,20H14A10,10 0 0,0 4,10M4,14V12A8,8 0 0,1 12,20H10A6,6 0 0,0 4,14M4,16A4,4 0 0,1 8,20H4V16Z"/></svg>',
};

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

// Same circled-"?" glyph as the HUD's own (?) help buttons (static/index.html,
// #opensky-help/#track-help/#dev-mode-help — see the .source-help SVG there),
// reused inline here so the identity rows' tooltip trigger reads as the same
// "there's more info here" affordance rather than a differently-styled one.
const HELP_ICON_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
  '<circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4"></circle>' +
  '<text x="8" y="11.6" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor">?</text>' +
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

function renderDetailsHtml(info, fieldSources, fieldConfidence, fieldComputationBasis, routeValidation) {
  fieldSources = fieldSources || {};
  fieldConfidence = fieldConfidence || {};
  fieldComputationBasis = fieldComputationBasis || {};
  const dash = '—';
  // In normal mode, a row disappears when its value is empty (today's exact
  // behavior). In dev mode every row always renders — a dash placeholder
  // when empty, plus a colored per-source dot when populated.
  function detailRow(label, value, fieldKey) {
    const has = value != null && value !== '';
    if (!has && !currentDevMode) return null;
    const badge = currentDevMode ? sourceBadgeHtml(fieldKey, fieldSources, fieldConfidence, fieldComputationBasis) : '';
    return '<b>' + label + ':</b> ' + (has ? value : dash) + badge;
  }
  // Same "always render in dev mode" treatment for the two hardcoded
  // emergency/alert rows, which carry special red styling instead of going
  // through detailRow's generic '<b>label:</b> value' format.
  function specialRow(label, isSet, htmlWhenSet, fieldKey) {
    if (!isSet && !currentDevMode) return null;
    if (!isSet) return '<b>' + label + ':</b> ' + dash;
    return htmlWhenSet + (currentDevMode ? sourceBadgeHtml(fieldKey, fieldSources, fieldConfidence, fieldComputationBasis) : '');
  }
  // Identity fields the enrichment pipeline can fill (Country/Operator/
  // Manufacturer/Model/Year built): unlike detailRow, always renders — a
  // missing value shows the literal word "Unknown" rather than hiding the
  // row or falling back to dev-mode's dash, since these fields are
  // specifically meant to always resolve to *something* meaningful.
  function identityRow(label, value, fieldKey, helpHtml) {
    const has = value != null && value !== '';
    const badge = currentDevMode ? sourceBadgeHtml(fieldKey, fieldSources, fieldConfidence, fieldComputationBasis) : '';
    // Label + "(?)" icon are wrapped together in .identity-label-wrap, which
    // carries the min-width column-alignment that plain <b> used to have on
    // its own (static/style.css) — keeps the icon flush against the label
    // text itself while still lining up where the value starts for short
    // labels, same as every other detailRow. class="identity-label" gets a
    // lighter weight/smaller size than a plain detailRow <b> — four-plus
    // rows of full-bold labels each now carrying their own icon read as too
    // heavy/loud as a block.
    return '<span class="identity-label-wrap"><b class="identity-label">' + label + '</b>' + (helpHtml || '') + '</span> ' + (has ? value : 'Unknown') + badge;
  }
  function renderGroup(title, rows, iconKey) {
    const filtered = rows.filter((r) => r != null);
    if (!filtered.length) return '';
    const icon = iconKey && GROUP_ICONS[iconKey] ? '<span class="detail-group-icon">' + GROUP_ICONS[iconKey] + '</span>' : '';
    return '<div class="detail-group"><div class="detail-group-title">' + icon + title + '</div>' +
      filtered.join('<br>') + '</div>';
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
  // Operator is plain text — its country lives in its own dedicated
  // "Operator Country" row/flag below, never smeared onto this row (same
  // "one concept per row" pattern as Registered Owner having its own flag
  // rather than decorating Operator).
  const operatorValue = info.operator || null;
  // Operator Country: adsbdb's flightroute.airline (name + ISO together) as
  // the primary tier, falling back to our own callsign-prefix enrichment
  // (enrichment/callsign.py's AIRLINE_OPERATORS table) when adsbdb has
  // nothing — see enrich_identity()'s "operator_country" field.
  const operatorCountryFlagHtml = flagHtml(info.operatorCountryIso);
  const operatorCountryValue = info.operatorCountry
    ? (operatorCountryFlagHtml ? operatorCountryFlagHtml + ' ' + info.operatorCountry : info.operatorCountry)
    : null;
  // Registered Owner only ever comes from adsbdb (no live/Flywme tier exists
  // for it), which always gives the ISO directly alongside the name, so this
  // one always has a flag when it has a value at all.
  const registeredOwnerFlagHtml = flagHtml(info.registeredOwnerCountryIso);
  const registeredOwnerValue = info.registeredOwner
    ? (registeredOwnerFlagHtml ? registeredOwnerFlagHtml + ' ' + info.registeredOwner : info.registeredOwner)
    : null;
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
    operator: 'Operator — the airline or company flying this aircraft. Not necessarily who owns it (see Registered Owner).',
    operatorCountry: 'Operator Country — the operating airline’s home country. Not the aircraft’s own country of registration (see Registration Country).',
    registeredOwner: 'Registered Owner — the private or corporate entity the aircraft is registered to, which can differ from the airline actually flying it (e.g. leasing).',
    registrationCountry: 'Registration Country — the country the aircraft itself is registered in (its ICAO nationality mark), not who operates or owns it (see Operator Country / Registered Owner).',
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
  if (categoryParts) {
    const trigger = categoryParts.code ? categoryParts.code + ' · ' + categoryParts.label : categoryParts.label;
    const description = CATEGORY_DESCRIPTIONS[categoryParts.label];
    const detail = description
      ? (categoryParts.code ? categoryParts.code + ' (' + categoryParts.label + ')' : categoryParts.label) + ' — ' + description
      : null;
    categoryValue = infoTipHtml(trigger, detail);
  }
  const identity = renderGroup('Identity', [
    identityRow('Manufacturer', info.manufacturer, 'manufacturer'),
    identityRow('Model', info.model, 'model'),
    identityRow('Year built', info.manufactureYear, 'manufactureYear'),
    identityRow('Operator', operatorValue, 'operator', identityHelp('operator')),
    identityRow('Operator Country', operatorCountryValue, 'operatorCountry', identityHelp('operatorCountry')),
    identityRow('Registered Owner', registeredOwnerValue, 'registeredOwner', identityHelp('registeredOwner')),
    identityRow('Registration Country', countryValue, 'originCountry', identityHelp('registrationCountry')),
    detailRow('Category', categoryValue, 'categoryDisplay'),
  ], 'identity');
  const position = renderGroup('Position', [
    detailRow('Altitude', formatAltitude(info.altitudeM), 'altitudeM'),
    detailRow('Geo altitude', formatAltitude(info.altGeomM), 'altGeomM'),
    detailRow('Vertical rate', formatVerticalRateUnit(info.verticalRateMs), 'verticalRateMs'),
    detailRow('Position source', info.positionSource, 'positionSource'),
  ], 'position');
  const speedHeading = renderGroup('Speed &amp; Heading', [
    detailRow('Speed', formatSpeedKmh(info.speedKmh), 'speedKmh'),
    detailRow('IAS', formatSpeedKt(info.iasKt), 'iasKt'),
    detailRow('TAS', formatSpeedKt(info.tasKt), 'tasKt'),
    detailRow('Mach', info.mach != null ? info.mach.toFixed(2) : null, 'mach'),
    detailRow('Track', info.trackDeg != null ? Math.round(info.trackDeg) + '°' : null, 'trackDeg'),
    detailRow('Heading (mag)', info.magHeadingDeg != null ? Math.round(info.magHeadingDeg) + '°' : null, 'magHeadingDeg'),
    detailRow('Heading (true)', info.trueHeadingDeg != null ? Math.round(info.trueHeadingDeg) + '°' : null, 'trueHeadingDeg'),
    detailRow('Turn rate', info.turnRateDegPerSec != null ? info.turnRateDegPerSec.toFixed(1) + '°/s' : null, 'turnRateDegPerSec'),
    detailRow('Roll', info.rollDeg != null ? info.rollDeg.toFixed(1) + '°' : null, 'rollDeg'),
  ], 'speedHeading');
  const autopilot = renderGroup('Autopilot', [
    detailRow('Selected altitude', formatAltitude(info.navAltitudeM), 'navAltitudeM'),
    detailRow('Selected heading', info.navHeadingDeg != null ? Math.round(info.navHeadingDeg) + '°' : null, 'navHeadingDeg'),
    detailRow('QNH', info.navQnh != null ? Math.round(info.navQnh) + ' hPa' : null, 'navQnh'),
    detailRow('Modes', info.navModes ? info.navModes.join(', ') : null, 'navModes'),
  ], 'autopilot');
  const weather = renderGroup('Weather', [
    detailRow('Wind', (info.windDirDeg != null && info.windSpeedKt != null)
      ? Math.round(info.windDirDeg) + '° / ' + formatSpeedKt(info.windSpeedKt) : null, ['windDirDeg', 'windSpeedKt']),
    detailRow('Outside air temp', info.oatC != null ? Math.round(info.oatC) + ' °C' : null, 'oatC'),
    detailRow('Total air temp', info.tatC != null ? Math.round(info.tatC) + ' °C' : null, 'tatC'),
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
  // Autopilot/Weather above.
  const signalQuality = renderGroup('Signal & Data Quality', [
    detailRow('Data source flags', formatDbFlags(info.dbFlags), 'dbFlags'),
    detailRow('Message type', info.messageType, 'messageType'),
    detailRow('ADS-B version', info.adsbVersion != null ? 'v' + info.adsbVersion : null, 'adsbVersion'),
    detailRow('NIC', info.nic, 'nic'),
    detailRow('NIC (baro)', info.nicBaro, 'nicBaro'),
    detailRow('NACp', info.nacP, 'nacP'),
    detailRow('NACv', info.nacV, 'nacV'),
    detailRow('SIL', info.sil != null ? info.sil + (info.silType ? ' (' + info.silType + ')' : '') : null, 'sil'),
    detailRow('GVA', info.gva, 'gva'),
    detailRow('SDA', info.sda, 'sda'),
    detailRow('Radius of containment', info.radiusOfContainmentM != null ? Math.round(info.radiusOfContainmentM) + ' m' : null, 'radiusOfContainmentM'),
    detailRow('Messages received', info.messageCount, 'messageCount'),
    detailRow('Signal strength', info.signalStrengthDbm != null ? info.signalStrengthDbm.toFixed(1) + ' dBm' : null, 'signalStrengthDbm'),
    detailRow('Last position update', formatRelativeSeconds(info.secondsSincePositionUpdate), 'secondsSincePositionUpdate'),
  ], 'signalQuality');
  function badgeFor(key) {
    return currentDevMode ? sourceBadgeHtml(key, fieldSources, fieldConfidence, fieldComputationBasis) : '';
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
  const headerTitle = info.registration
    ? headerPiece(info.registration, 'registration')
    : (info.icao24 ? headerPiece(info.icao24.toUpperCase(), 'icao24') : 'Unknown aircraft');
  const headerSubtitleParts = [];
  if (info.callsign) headerSubtitleParts.push(headerPiece(info.callsign, 'callsign'));
  if (info.aircraftType) headerSubtitleParts.push(headerPiece(info.aircraftType, 'aircraftType'));
  if (info.registration && info.icao24) headerSubtitleParts.push(headerPiece(info.icao24.toUpperCase(), 'icao24'));
  const header = '<div class="sidebar-header-title">' + headerTitle + '</div>'
    + (headerSubtitleParts.length
      ? '<div class="sidebar-header-subtitle">' + headerSubtitleParts.join(' <span class="sidebar-header-sep">·</span> ') + '</div>'
      : '');

  // --- Route card: its own visual block (see #sidebar-route in
  // sidebar-track.js) rather than a text row inside Identity — big airport
  // codes, small city names, a direction arrow between them, and (for an
  // adsbdb-sourced route) the Layer 2 confidence badge. Reject-band routes
  // (~a quarter of adsbdb's routes on live research — a wrong historical
  // callsign match, not just a slightly-off one) don't name specific,
  // likely-wrong airports at all; "Low" still shows the real airports with
  // a warning tag, since it's plausibly right, just imperfect.
  const routeHas = info.originAirport && info.destinationAirport;
  const isReject = routeValidation && routeValidation.band === 'reject';
  const isLow = routeValidation && routeValidation.band === 'low';
  const routeDevBadge = currentDevMode
    ? sourceBadgeHtml(['originAirport', 'destinationAirport'], fieldSources, fieldConfidence, fieldComputationBasis)
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
          + '<div class="route-card-arrow">' + routeArrowIconHtml(routeCategoryGroup) + '</div>'
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
        + '<div class="route-card-arrow">' + routeArrowIconHtml(routeCategoryGroup) + '</div>'
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
    body: identity + position + speedHeading + autopilot + weather + status + signalQuality,
  };
}
