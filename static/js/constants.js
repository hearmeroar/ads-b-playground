const POLL_INTERVAL_MS = 12000; // 12s — stays within OpenSky's rate limits

// Shared by render-details.js's formatVerticalRateUnit (sidebar text) and
// icons.js's climb/descent marker-icon check, so "what counts as climbing"
// can't silently drift between the two — a vertical rate whose magnitude
// stays at or under this (m/s) reads as level in both places.
const VERTICAL_RATE_LEVEL_THRESHOLD_MS = 0.5;

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
function sourceBadgeHtml(fieldKey, fieldSources, fieldConfidence, fieldComputationBasis) {
  fieldConfidence = fieldConfidence || {};
  fieldComputationBasis = fieldComputationBasis || {};
  if (!fieldKey) return '';
  const keys = Array.isArray(fieldKey) ? fieldKey : [fieldKey];
  const sources = [...new Set(keys.flatMap((k) => fieldSources[k] || []))];
  return sources.map((s) => {
    let detailAttr = '';
    if (s === 'flywme' && !Array.isArray(fieldKey)) {
      const basis = ENRICHMENT_BASIS_LABELS[fieldComputationBasis[fieldKey]] || 'this application';
      const conf = fieldConfidence[fieldKey];
      const detail = 'computed from ' + basis + (conf != null ? ', confidence ' + conf.toFixed(1) : '');
      detailAttr = ' data-detail="' + detail + '"';
    }
    return '<span class="source-badge" style="background:' + SOURCE_COLORS[s] + '" data-source="' + s + '"' + detailAttr + '></span>';
  }).join('');
}
