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
  if (rateMs <= 0.5 && rateMs >= -0.5) return 'level';
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
function renderDetailsHtml(info, fieldSources, fieldConfidence, fieldComputationBasis) {
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
  function identityRow(label, value, fieldKey) {
    const has = value != null && value !== '';
    const badge = currentDevMode ? sourceBadgeHtml(fieldKey, fieldSources, fieldConfidence, fieldComputationBasis) : '';
    return '<b>' + label + ':</b> ' + (has ? value : 'Unknown') + badge;
  }
  function renderGroup(title, rows) {
    const filtered = rows.filter((r) => r != null);
    if (!filtered.length) return '';
    return '<div class="detail-group"><div class="detail-group-title">' + title + '</div>' +
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
  // Only ever present when Operator was filled from adsbdb's flightroute
  // .airline (the only tier that carries a country alongside the airline
  // name) — a live-feed or Flywme-computed operator renders without a flag,
  // same known limitation as Country's own flag above.
  const operatorFlagHtml = flagHtml(info.operatorCountryIso);
  const operatorValue = info.operator
    ? (operatorFlagHtml ? operatorFlagHtml + ' ' + info.operator : info.operator)
    : null;
  // Registered Owner only ever comes from adsbdb (no live/Flywme tier exists
  // for it), which always gives the ISO directly alongside the name, so this
  // one always has a flag when it has a value at all.
  const registeredOwnerFlagHtml = flagHtml(info.registeredOwnerCountryIso);
  const registeredOwnerValue = info.registeredOwner
    ? (registeredOwnerFlagHtml ? registeredOwnerFlagHtml + ' ' + info.registeredOwner : info.registeredOwner)
    : null;
  const identity = renderGroup('Identity', [
    detailRow('ICAO', info.icao24 ? info.icao24.toUpperCase() : null, 'icao24'),
    detailRow('Callsign', info.callsign || '—', 'callsign'),
    detailRow('Registration', info.registration, 'registration'),
    detailRow('Aircraft', info.aircraftType, 'aircraftType'),
    identityRow('Manufacturer', info.manufacturer, 'manufacturer'),
    identityRow('Model', info.model, 'model'),
    identityRow('Operator', operatorValue, 'operator'),
    identityRow('Country', countryValue, 'originCountry'),
    detailRow('Category', info.categoryDisplay, 'categoryDisplay'),
    identityRow('Year built', info.manufactureYear, 'manufactureYear'),
    identityRow('Registered Owner', registeredOwnerValue, 'registeredOwner'),
    detailRow('Route', info.originAirport && info.destinationAirport
      ? info.originAirport + ' → ' + info.destinationAirport
      : null, ['originAirport', 'destinationAirport']),
  ]);
  const position = renderGroup('Position', [
    detailRow('Altitude', formatAltitude(info.altitudeM), 'altitudeM'),
    detailRow('Geo altitude', formatAltitude(info.altGeomM), 'altGeomM'),
    detailRow('Vertical rate', formatVerticalRateUnit(info.verticalRateMs), 'verticalRateMs'),
    detailRow('Position source', info.positionSource, 'positionSource'),
  ]);
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
  ]);
  const autopilot = renderGroup('Autopilot', [
    detailRow('Selected altitude', formatAltitude(info.navAltitudeM), 'navAltitudeM'),
    detailRow('Selected heading', info.navHeadingDeg != null ? Math.round(info.navHeadingDeg) + '°' : null, 'navHeadingDeg'),
    detailRow('QNH', info.navQnh != null ? Math.round(info.navQnh) + ' hPa' : null, 'navQnh'),
    detailRow('Modes', info.navModes ? info.navModes.join(', ') : null, 'navModes'),
  ]);
  const weather = renderGroup('Weather', [
    detailRow('Wind', (info.windDirDeg != null && info.windSpeedKt != null)
      ? Math.round(info.windDirDeg) + '° / ' + formatSpeedKt(info.windSpeedKt) : null, ['windDirDeg', 'windSpeedKt']),
    detailRow('Outside air temp', info.oatC != null ? Math.round(info.oatC) + ' °C' : null, 'oatC'),
    detailRow('Total air temp', info.tatC != null ? Math.round(info.tatC) + ' °C' : null, 'tatC'),
  ]);
  const status = renderGroup('Status', [
    detailRow('Squawk', formatSquawk(info.squawk), 'squawk'),
    specialRow('Emergency', !!info.emergency, '<span class="emergency">Emergency: ' + info.emergency + '</span>', 'emergency'),
    specialRow('Alert', !!info.hasAlert, '<span class="emergency">Alert</span>', 'hasAlert'),
    detailRow('Last update', formatRelativeSeconds(info.secondsSinceContact), 'secondsSinceContact'),
  ]);
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
  ]);
  return identity + position + speedHeading + autopilot + weather + status + signalQuality;
}
