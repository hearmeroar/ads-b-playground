const POLL_INTERVAL_MS = 12000; // 12s — stays within OpenSky's rate limits
const AUTO_CENTER_ANIMATION_DURATION_MS = 400; // ms — duration of map.flyTo() when selecting an aircraft

// Shared by render-details.js's formatVerticalRateUnit (sidebar text) and
// icons.js's climb/descent marker-icon check, so "what counts as climbing"
// can't silently drift between the two — a vertical rate whose magnitude
// stays at or under this (m/s) reads as level in both places.
const VERTICAL_RATE_LEVEL_THRESHOLD_MS = 0.5;

// Shared unit-conversion constants — previously repeated as bare literals
// (0.3048, 1.852, and a separately hardcoded 196.850 that was really just
// 1/FT_TO_M*60) across parsers.js and render-details.js with no single
// source of truth, risking rounding drift between them.
const FT_TO_M = 0.3048;
const KT_TO_KMH = 1.852;

// Guards against a malformed upstream record (NaN, missing, or a lat/lon
// out of the physically valid range) rendering as a marker instead of being
// skipped the same way a genuinely missing position already is.
function isValidCoordinate(lat, lon) {
  return typeof lat === 'number' && typeof lon === 'number'
    && Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

// Guards a raw live-feed registration string before it's used as a
// Planespotters/airport-data.com photo lookup key. A bare internal fleet
// number (e.g. "333"/"293", seen on real military/government helicopters —
// not a real ICAO/FAA-format tail number) is short and generic enough to
// false-match an unrelated aircraft in those services' own registration
// index. Every real civil registration mark (ICAO Annex 7 nationality
// marks, US N-numbers, ...) contains at least one letter, so that alone is
// enough to reject the bad case without a length threshold that would also
// wrongly reject legitimate short marks (e.g. US "N1"-style registrations).
function looksLikePlausibleRegistration(reg) {
  return typeof reg === 'string' && /[A-Za-z]/.test(reg);
}

// Three independent data sources, each rendered as its own color-coded set of
// markers, all keyed by the aircraft's ICAO24/hex address (the same aircraft
// can in principle show up in more than one feed at once — see the dedup
// rule in poll() below). OpenSky is the "primary" source; adsb.fi and
// airplanes.live are ranked below it in that order.
// Key order is the canonical source priority: OpenSky > adsb.fi >
// airplanes.live. OpenSky remains quota-limited, but starts enabled.
// Key order is the canonical source priority (highest first): it drives the
// HUD count/toggle loops and the dedup chain in poll(). adsb.lol and adsb.one
// are independent instances of the same aggregator family as adsb.fi, ordered
// between it and airplanes.live as a coverage/uptime fallback chain (not a
// data-quality ranking).
// Canonical ICAO24-keyed enrichment/render priority, highest first. Both
// main.js's radiusRecordsByHex construction (reversed, so the
// highest-priority entry is pushed last and wins — array[length-1]) and its
// marker exclude-chain derive their order from this one array, instead of
// two independently hand-written mirror lists that could silently drift out
// of sync with each other. OpenSky and FlightAware aren't in this list:
// OpenSky always renders first and unconditionally seeds excludeIds, and
// FlightAware dedupes by callsign, not ICAO24 (see
// matchedFlightawareCallsigns instead).
const RADIUS_SOURCE_PRIORITY = ['adsbfi', 'adsblol', 'adsbone', 'airplaneslive', 'flightradar24'];

const SOURCE_COLORS = {
  opensky: '#1a73e8', adsbfi: '#e53935', adsblol: '#8e24aa', adsbone: '#f9a825', airplaneslive: '#2e7d32', flightaware: '#00acc1',
  // FlightRadar24, via the unofficial JeanExtreme002/FlightRadarAPI SDK — see
  // CLAUDE.md for why it ships off by default and lowest-priority. Brown,
  // distinct from every color above (avoids adsbone's yellow-orange, which
  // FR24's own brand orange would sit too close to).
  flightradar24: '#6d4c41',
  // adsbdb.com is a lazy-on-click lookup (like Flywme below), not a per-poll
  // marker source — see the CLAUDE.md pitfall about SOURCE_COLORS entries
  // needing to stay out of sourceToggles/markerMapsBySource unless they
  // actually have their own polled markers. Pink, distinct from every color
  // above and from Flywme's black.
  adsbdb: '#ec4899',
  // Flywme is a separate synthetic source — "this application" — used for
  // identity fields it computed itself (registration prefix/ICAO24 lookup/
  // callsign decode/aircraft-type db) rather than read from a live feed.
  // Black, distinct from every live source above.
  flywme: '#000000',
};
// Uniform marker color mode (bright yellow fill, dark outline), toggled via
// "Uniform aircraft color" HUD switch. Only affects the visual paint of
// markers; data-color attribute still records the true per-source color for
// provenance/testing purposes.
const UNIFORM_MARKER_COLOR = '#ffd400';
const UNIFORM_MARKER_STROKE_COLOR = '#1a1a1a';
const SOURCE_DISPLAY_NAMES = {
  opensky: 'OpenSky', adsbfi: 'adsb.fi', adsblol: 'adsb.lol',
  adsbone: 'adsb.one', airplaneslive: 'airplanes.live', flightaware: 'FlightAware',
  flightradar24: 'FlightRadar24',
  adsbdb: 'adsbdb.com',
  flywme: 'Flywme',
};
// Human labels for the *technique* Flywme used to compute a field — tooltip
// text only, never a badge color (Flywme's badge is always uniformly black
// regardless of which of these produced the value).
const ENRICHMENT_BASIS_LABELS = {
  registration_prefix: 'registration prefix', icao24_lookup: 'aircraft database lookup',
  callsign_decode: 'callsign decode', aircraft_type_db: 'aircraft type database',
  aircraft_category_db: 'aircraft category database',
};
// Dev-mode field provenance: which source(s) populated a given `info`
// field. OPENSKY_NATIVE_FIELDS are the ones OpenSky's own state vector
// supplies directly (used only to build OpenSky's own provenance "entry"
// below — see fieldSourcesFor()); every other source can independently
// report any field, so provenance is computed generically per field rather
// than assumed to be exactly one source.
const OPENSKY_NATIVE_FIELDS = new Set([
  'icao24', 'callsign', 'originCountry', 'altitudeM', 'altGeomM', 'speedKmh',
  'verticalRateMs', 'trackDeg', 'squawk', 'hasAlert', 'positionSource',
  'secondsSinceContact',
]);
const ROUTE_FIELDS = new Set(['originAirport', 'destinationAirport']);

// Projects a subset of an object's own keys — used to build OpenSky's
// provenance "entry" (see fieldSourcesFor) from only its native fields,
// since `info` itself also carries enrichment-derived values under the
// same key names and those must not be misattributed to OpenSky.
function pickFields(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

// Two `info` keys are computed from a differently-named raw field on a
// radius source's own parsed record (parseAdsbExchangeAircraft) — every
// other key in the unified shape already matches its raw source field name
// 1:1 (confirmed by diffing parseAdsbExchangeAircraft's and
// normalizeAdsbExchange's own key lists), which is what lets
// fieldSourcesFor do a direct property lookup for everything else instead
// of needing a full per-field mapping table.
const RAW_FIELD_ALIASES = { categoryDisplay: 'category', trackDeg: 'track' };

// Builds a { fieldName: [sourceKey, ...] } map for dev-mode source badges.
// `entries` is every currently-enabled source's own parsed record for this
// aircraft, as { source, data } pairs — not just whichever one's value
// `info` ends up displaying. A field gets one badge per entry that
// independently reports a non-empty value for it, so three sources all
// sending a registration shows three dots, not just the one that happened
// to win. `false` doesn't count as "reported" here — the only boolean
// field (`hasAlert`) uses false to mean "no alert", not "no data", so
// treating it as a value would badge every source that merely has the
// field at all, even ones reporting no alert. routeSource: 'flightaware'
// when route fields were merged in from a callsign match, else null.
function fieldSourcesFor(info, entries, routeSource) {
  const out = {};
  for (const key of Object.keys(info)) {
    if (info[key] == null || info[key] === '') continue;
    if (ROUTE_FIELDS.has(key)) { if (routeSource) out[key] = [routeSource]; continue; }
    const sources = [];
    for (const e of entries) {
      let v = e.data[key];
      if (v === undefined && RAW_FIELD_ALIASES[key]) v = e.data[RAW_FIELD_ALIASES[key]];
      if (v == null || v === '' || v === false) continue;
      if (!sources.includes(e.source)) sources.push(e.source);
    }
    out[key] = sources;
  }
  return out;
}

// Renders one small colored dot per distinct source that populated
// fieldKey (a single field name, or an array for composite rows like
// Route/Wind — deduped in case a composite row's two fields came from the
// same source, but a field genuinely reported by several enabled sources
// at once renders one badge per source, by design). A 'flywme' badge (never
// part of a composite fieldKey) additionally carries a data-detail
// attribute naming the computation technique + confidence, read by the
// tooltip click handler.
function sourceBadgeHtml(fieldKey, fieldSources, fieldConfidence, fieldComputationBasis, fieldNeedsCorroboration) {
  fieldConfidence = fieldConfidence || {};
  fieldComputationBasis = fieldComputationBasis || {};
  fieldNeedsCorroboration = fieldNeedsCorroboration || {};
  if (!fieldKey) return '';
  const keys = Array.isArray(fieldKey) ? fieldKey : [fieldKey];
  const sources = [...new Set(keys.flatMap((k) => fieldSources[k] || []))];
  return sources.map((s) => {
    let detailAttr = '';
    if (s === 'flywme' && !Array.isArray(fieldKey)) {
      const basis = ENRICHMENT_BASIS_LABELS[fieldComputationBasis[fieldKey]] || 'this application';
      const conf = fieldConfidence[fieldKey];
      let detail = 'computed from ' + basis + (conf != null ? ', confidence ' + conf.toFixed(1) : '');
      // Set only for a callsign-decoded operator/operator_country whose
      // claimed country disagrees with the aircraft's own ICAO24 hex-block
      // country (see enrich_identity()) — extra debugging context even when
      // the value itself still displays normally (non-rotorcraft; a
      // rotorcraft instead gets a visible tag, see renderDetailsHtml).
      if (fieldNeedsCorroboration[fieldKey]) {
        detail += ' — unconfirmed: conflicts with the aircraft’s own ICAO24 hex-address country';
      }
      detailAttr = ' data-detail="' + detail + '"';
    }
    return '<span class="source-badge" style="background:' + SOURCE_COLORS[s] + '" data-source="' + s + '"' + detailAttr + '></span>';
  }).join('');
}
