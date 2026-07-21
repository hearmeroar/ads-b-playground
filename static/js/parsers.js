// --- OpenSky (/states/all) ---

// `extra` (a parsed adsb.fi/airplanes.live aircraft, if the same ICAO24 is
// also visible there) enriches the sidebar with fields OpenSky's state vector
// doesn't have at all — registration, aircraft type, and the ADSBExchange-
// style `emergency` flag, plus a batch of fields OpenSky's state vector
// never carries at all — IAS/TAS/Mach, mag/true heading, turn rate, roll,
// autopilot targets, and wind/temperature — pulled straight from `extra`
// since there's no OpenSky equivalent to duplicate. Squawk/vertical
// rate/position-source/last-contact come from OpenSky's own data instead,
// since its state vector already has those and OpenSky is the authoritative
// source for its own markers. Returns a plain data object (unified shape —
// see normalizeAdsbExchange for the other half) rather than HTML;
// renderDetailsHtml() does the rendering, so unit-toggle changes can
// re-render without re-fetching. The photo gallery is rendered separately
// (see loadGallery()), not part of this.
function normalizeOpenSky(s, extra) {
  // Category: OpenSky takes priority, but only if it's a meaningful value —
  // see openskyCategoryIsMeaningful() (state-filters.js), the single source
  // of truth for this check shared with categoryGroupFor().
  const openskyCategoryLabel = openskyCategoryIsMeaningful(s.category) ? OPENSKY_CATEGORY_LABELS[s.category] : null;
  const extraCategoryLabel = extra && extra.category ? formatAdsbExchangeCategory(extra.category) : null;
  const categoryDisplay = openskyCategoryLabel || extraCategoryLabel || null;
  return {
    icao24: s.icao24 || null,
    callsign: (s.callsign || '').trim() || null,
    registration: (extra && extra.registration) || null,
    aircraftType: (extra && extra.aircraftType) || null,
    icaoTypeCode: (extra && extra.icaoTypeCode) || null,
    originCountry: s.origin_country || null,
    categoryDisplay: categoryDisplay,
    altitudeM: s.baro_altitude,
    altGeomM: s.geo_altitude,
    speedKmh: s.velocity != null ? s.velocity * 3.6 : null,
    verticalRateMs: s.vertical_rate,
    trackDeg: s.true_track,
    iasKt: (extra && extra.iasKt != null) ? extra.iasKt : null,
    tasKt: (extra && extra.tasKt != null) ? extra.tasKt : null,
    mach: (extra && extra.mach != null) ? extra.mach : null,
    magHeadingDeg: (extra && extra.magHeadingDeg != null) ? extra.magHeadingDeg : null,
    trueHeadingDeg: (extra && extra.trueHeadingDeg != null) ? extra.trueHeadingDeg : null,
    turnRateDegPerSec: (extra && extra.turnRateDegPerSec != null) ? extra.turnRateDegPerSec : null,
    rollDeg: (extra && extra.rollDeg != null) ? extra.rollDeg : null,
    navAltitudeM: (extra && extra.navAltitudeM != null) ? extra.navAltitudeM : null,
    navHeadingDeg: (extra && extra.navHeadingDeg != null) ? extra.navHeadingDeg : null,
    navQnh: (extra && extra.navQnh != null) ? extra.navQnh : null,
    navModes: (extra && extra.navModes) || null,
    windDirDeg: (extra && extra.windDirDeg != null) ? extra.windDirDeg : null,
    windSpeedKt: (extra && extra.windSpeedKt != null) ? extra.windSpeedKt : null,
    oatC: (extra && extra.oatC != null) ? extra.oatC : null,
    tatC: (extra && extra.tatC != null) ? extra.tatC : null,
    squawk: s.squawk || null,
    emergency: (extra && extra.emergency) || null,
    hasAlert: !!s.spi,
    positionSource: OPENSKY_POSITION_SOURCE_LABELS[s.position_source] || null,
    secondsSinceContact: s.last_contact != null
      ? Math.max(0, Math.floor(Date.now() / 1000) - s.last_contact) : null,
    // No OpenSky equivalent for any of these — extra-derived only, same as
    // ias/tas/mach/etc. above.
    operator: (extra && extra.operator) || null,
    manufactureYear: (extra && extra.manufactureYear) || null,
    dbFlags: (extra && extra.dbFlags != null) ? extra.dbFlags : null,
    messageType: (extra && extra.messageType) || null,
    adsbVersion: (extra && extra.adsbVersion != null) ? extra.adsbVersion : null,
    nic: (extra && extra.nic != null) ? extra.nic : null,
    nicBaro: (extra && extra.nicBaro != null) ? extra.nicBaro : null,
    nacP: (extra && extra.nacP != null) ? extra.nacP : null,
    nacV: (extra && extra.nacV != null) ? extra.nacV : null,
    sil: (extra && extra.sil != null) ? extra.sil : null,
    silType: (extra && extra.silType) || null,
    gva: (extra && extra.gva != null) ? extra.gva : null,
    sda: (extra && extra.sda != null) ? extra.sda : null,
    radiusOfContainmentM: (extra && extra.radiusOfContainmentM != null) ? extra.radiusOfContainmentM : null,
    messageCount: (extra && extra.messageCount != null) ? extra.messageCount : null,
    signalStrengthDbm: (extra && extra.signalStrengthDbm != null) ? extra.signalStrengthDbm : null,
    secondsSincePositionUpdate: (extra && extra.secondsSincePositionUpdate != null) ? extra.secondsSincePositionUpdate : null,
  };
}

// OpenSky's `position_source`: 0=ADS-B, 1=ASTERIX, 2=MLAT, 3=FLARM.
const OPENSKY_POSITION_SOURCE_LABELS = { 0: 'ADS-B', 1: 'ASTERIX', 2: 'MLAT', 3: 'FLARM' };

// Parses a single "state vector" from the OpenSky /states/all response.
// Field indices are fixed by the protocol (see https://opensky-network.org/apidoc/rest.html):
// 0 icao24, 1 callsign, 2 origin_country, 4 last_contact, 5 longitude,
// 6 latitude, 7 baro_altitude, 8 on_ground, 9 velocity, 10 true_track,
// 11 vertical_rate, 13 geo_altitude, 14 squawk, 15 spi, 16 position_source,
// 17 category. `time_position` (3) and `sensors` (12) are deliberately
// skipped — the former just duplicates last_contact for our purposes, the
// latter is always null without an owned receiver.
function parseOpenSkyState(arr) {
  return {
    icao24: arr[0],
    callsign: arr[1],
    origin_country: arr[2],
    last_contact: arr[4],
    lon: arr[5],
    lat: arr[6],
    baro_altitude: arr[7],
    on_ground: arr[8],
    velocity: arr[9],
    true_track: arr[10],
    vertical_rate: arr[11],
    geo_altitude: arr[13],
    squawk: arr[14],
    spi: arr[15],
    position_source: arr[16],
    category: arr[17],
  };
}

// radiusRecordsByHex: Map<icao24, Array<{ source, data: parsed adsb.fi/
// adsb.lol/adsb.one/airplanes.live aircraft }>>, every enabled radius
// source's own record for this aircraft, in priority order low→high — used
// both to enrich the sidebar (see normalizeOpenSky; the last/highest-
// priority entry is the winner, same choice as the old single-entry map)
// and to feed dev mode's per-field provenance badges, where EVERY entry
// that reports a given field contributes a badge, not just the winner.
// excludeIds: aircraft already shown by the higher-priority sources
// (adsb.fi/airplanes.live) — OpenSky renders last and only contributes what
// they don't cover, since it's the only source that spends a daily quota.
function updateOpenSkyMarkers(states, radiusRecordsByHex, flightawareByCallsign, matchedFlightawareCallsigns) {
  const items = [];
  for (const s of states) { // already parsed by poll() (parseOpenSkyState)
    if (!isValidCoordinate(s.lat, s.lon)) continue; // missing/malformed position — skip this aircraft
    if (!passesMotionFilter(s.on_ground)) continue;
    const radiusEntries = radiusRecordsByHex ? (radiusRecordsByHex.get(s.icao24) || []) : [];
    const winner = radiusEntries.length ? radiusEntries[radiusEntries.length - 1] : null;
    const extra = winner ? winner.data : null;
    const isGroundVehicle = looksLikeGroundVehicle({
      category: s.category,
      registration: extra && extra.registration,
      aircraftType: extra && extra.aircraftType,
      callsign: s.callsign,
    });
    if (hideNonAircraft() && isGroundVehicle) continue;
    const categoryGroup = categoryGroupFor({
      openskyCategory: s.category,
      adsbExchangeCategory: extra && extra.category,
    });
    if (!passesCategoryFilter(categoryGroup)) continue;
    const info = normalizeOpenSky(s, extra);
    if (!passesDataQualityFilter(info)) continue;
    // pickFields() only copies OPENSKY_NATIVE_FIELDS, which deliberately
    // excludes categoryDisplay (it's computed, not native) — so without this,
    // fieldSourcesFor's RAW_FIELD_ALIASES lookup (categoryDisplay -> category)
    // would never find a `category` key on OpenSky's own provenance entry,
    // and its badge would be missing (or misattributed to a radius source
    // that also happens to report one) even when OpenSky's own category won.
    // Only set when meaningful, matching exactly when normalizeOpenSky()
    // above actually used it to produce categoryDisplay.
    const openskyRaw = pickFields(info, OPENSKY_NATIVE_FIELDS);
    if (openskyCategoryIsMeaningful(s.category)) openskyRaw.category = s.category;
    const entries = [{ source: 'opensky', data: openskyRaw }, ...radiusEntries];
    const fieldSources = fieldSourcesFor(info, entries, null);
    // Enrich with FlightAware's route data if callsign matches
    const faKey = normalizeCallsignKey(info.callsign);
    if (faKey && flightawareByCallsign && flightawareByCallsign.has(faKey)) {
      const faMatch = flightawareByCallsign.get(faKey);
      info.originAirport = faMatch.originAirport;
      info.destinationAirport = faMatch.destinationAirport;
      fieldSources.originAirport = ['flightaware'];
      fieldSources.destinationAirport = ['flightaware'];
      matchedFlightawareCallsigns.add(faKey);
    }
    items.push({
      id: s.icao24, lat: s.lat, lon: s.lon, heading: s.true_track,
      info: info, fieldSources: fieldSources, registration: extra && extra.registration,
      isGroundVehicle: isGroundVehicle, categoryGroup: categoryGroup,
      // The ADS-B letter+digit code (e.g. "C0") only ever comes from a radius
      // source's enrichment — OpenSky's own numeric category isn't that code
      // at all, so there's nothing to carry when extra is absent.
      categoryCode: extra && extra.category,
    });
  }
  return syncMarkers(openskyMarkers, items, SOURCE_COLORS.opensky);
}

// --- adsb.fi and airplanes.live ---
// Both (https://github.com/adsbfi/opendata, https://airplanes.live/api-guide/)
// are anonymous, no-quota radius sources returning the same
// ADSBExchange-compatible JSON shape, so they share one parser/details-builder/renderer.

// Normalize a callsign for dedup matching: trim and uppercase. Used to
// match FlightAware flights (callsign-based) against other sources.
function normalizeCallsignKey(callsign) {
  return callsign ? callsign.trim().toUpperCase() : null;
}

// Returns the same unified shape as normalizeOpenSky() — see there for why
// this is a plain data object rather than rendered HTML.
function normalizeAdsbExchange(a) {
  return {
    icao24: a.icao24 || null,
    callsign: (a.callsign || '').trim() || null,
    registration: a.registration || null,
    aircraftType: a.aircraftType || null,
    icaoTypeCode: a.icaoTypeCode || null,
    originCountry: null,
    categoryDisplay: formatAdsbExchangeCategory(a.category),
    altitudeM: a.altitudeM,
    altGeomM: a.altGeomM,
    speedKmh: a.speedKmh,
    verticalRateMs: a.verticalRateMs,
    trackDeg: a.track,
    iasKt: a.iasKt, tasKt: a.tasKt, mach: a.mach,
    magHeadingDeg: a.magHeadingDeg, trueHeadingDeg: a.trueHeadingDeg,
    turnRateDegPerSec: a.turnRateDegPerSec, rollDeg: a.rollDeg,
    navAltitudeM: a.navAltitudeM, navHeadingDeg: a.navHeadingDeg,
    navQnh: a.navQnh, navModes: a.navModes,
    windDirDeg: a.windDirDeg, windSpeedKt: a.windSpeedKt, oatC: a.oatC, tatC: a.tatC,
    squawk: a.squawk || null,
    emergency: a.emergency || null,
    hasAlert: !!a.hasAlert,
    positionSource: a.positionSource || null,
    secondsSinceContact: a.secondsSinceContact,
    operator: a.operator, manufactureYear: a.manufactureYear,
    dbFlags: a.dbFlags, messageType: a.messageType, adsbVersion: a.adsbVersion,
    nic: a.nic, nicBaro: a.nicBaro, nacP: a.nacP, nacV: a.nacV,
    sil: a.sil, silType: a.silType, gva: a.gva, sda: a.sda,
    radiusOfContainmentM: a.radiusOfContainmentM, messageCount: a.messageCount,
    signalStrengthDbm: a.signalStrengthDbm, secondsSincePositionUpdate: a.secondsSincePositionUpdate,
  };
}

// alt_baro/alt_geom are feet (alt_baro can also be the string "ground"), gs/
// ias/tas are knots, and vertical rate (baro_rate, falling back to geom_rate)
// and nav_altitude_mcp/fms are feet/feet-per-minute — converted here to
// meters/km-per-hour/meters-per-second to match OpenSky's units (ias/tas/
// wind speed are left in knots — see the unit-aware formatters near
// renderDetailsHtml). `category` is ADSBExchange's letter+digit emitter code
// (e.g. "A3"), left as-is rather than mapped like OpenSky's numeric one —
// see ADSBEXCHANGE_CATEGORY_LABELS. `emergency`/`navModes` are only kept
// when they're an actual non-empty value. `positionSource`/`hasAlert` unify
// with OpenSky's own `position_source`/`spi` fields — see normalizeOpenSky/
// normalizeAdsbExchange, which read these into one shared shape.
function parseAdsbExchangeAircraft(ac) {
  const onGround = ac.alt_baro === 'ground';
  const altFt = typeof ac.alt_baro === 'number' ? ac.alt_baro : null;
  const altGeomFt = typeof ac.alt_geom === 'number' ? ac.alt_geom : null;
  const gsKt = typeof ac.gs === 'number' ? ac.gs : null;
  const vRateFtMin = typeof ac.baro_rate === 'number' ? ac.baro_rate
    : (typeof ac.geom_rate === 'number' ? ac.geom_rate : null);
  const navAltFt = typeof ac.nav_altitude_mcp === 'number' ? ac.nav_altitude_mcp
    : (typeof ac.nav_altitude_fms === 'number' ? ac.nav_altitude_fms : null);
  const positionSource = (Array.isArray(ac.mlat) && ac.mlat.length) ? 'MLAT'
    : (Array.isArray(ac.tisb) && ac.tisb.length) ? 'TIS-B' : 'ADS-B';
  return {
    icao24: ac.hex,
    callsign: ac.flight,
    registration: ac.r,
    aircraftType: ac.desc || ac.t || null,
    // Kept separate from aircraftType above: `t` is the standardized ICAO
    // type designator (e.g. "B38M"), while aircraftType prefers `desc`'s
    // free text (e.g. "BOEING 737 MAX 8") whenever present. /api/identity
    // needs the raw code specifically — it's a reliable exact-match lookup
    // key, unlike desc text, whose exact wording varies across aircraft.
    icaoTypeCode: ac.t || null,
    lat: ac.lat,
    lon: ac.lon,
    onGround: onGround,
    // "ground" is a definite, known signal (the aircraft is on the ground),
    // not missing data — altitudeM used to stay null here, leaving the
    // sidebar's Altitude row blank for a grounded aircraft instead of 0.
    altitudeM: onGround ? 0 : (altFt != null ? altFt * FT_TO_M : null),
    altGeomM: altGeomFt != null ? altGeomFt * FT_TO_M : null,
    speedKmh: gsKt != null ? gsKt * KT_TO_KMH : null,
    verticalRateMs: vRateFtMin != null ? vRateFtMin * FT_TO_M / 60 : null,
    squawk: ac.squawk || null,
    category: ac.category || null,
    emergency: (ac.emergency && ac.emergency !== 'none') ? ac.emergency : null,
    // Some aircraft (observed live on a military UH-60) report no 'track' at
    // all, only 'calc_track' (a computed fallback) — without this, they'd
    // silently lose heading even though a usable value exists upstream.
    track: typeof ac.track === 'number' ? ac.track : (typeof ac.calc_track === 'number' ? ac.calc_track : null),
    iasKt: typeof ac.ias === 'number' ? ac.ias : null,
    tasKt: typeof ac.tas === 'number' ? ac.tas : null,
    mach: typeof ac.mach === 'number' ? ac.mach : null,
    magHeadingDeg: typeof ac.mag_heading === 'number' ? ac.mag_heading : null,
    trueHeadingDeg: typeof ac.true_heading === 'number' ? ac.true_heading : null,
    turnRateDegPerSec: typeof ac.track_rate === 'number' ? ac.track_rate : null,
    rollDeg: typeof ac.roll === 'number' ? ac.roll : null,
    navAltitudeM: navAltFt != null ? navAltFt * FT_TO_M : null,
    navHeadingDeg: typeof ac.nav_heading === 'number' ? ac.nav_heading : null,
    navQnh: typeof ac.nav_qnh === 'number' ? ac.nav_qnh : null,
    navModes: (Array.isArray(ac.nav_modes) && ac.nav_modes.length) ? ac.nav_modes : null,
    windDirDeg: typeof ac.wd === 'number' ? ac.wd : null,
    windSpeedKt: typeof ac.ws === 'number' ? ac.ws : null,
    oatC: typeof ac.oat === 'number' ? ac.oat : null,
    tatC: typeof ac.tat === 'number' ? ac.tat : null,
    hasAlert: !!ac.alert || !!ac.spi,
    positionSource: positionSource,
    secondsSinceContact: typeof ac.seen === 'number' ? ac.seen : null,
    // The fields below have no OpenSky equivalent at all (confirmed against
    // the official 18-field state vector) — enrichment-only, same as ias/
    // tas/mach/etc. above. See schema/aircraft.schema.json for the full
    // per-field rationale (DO-260B accuracy/integrity categories, dbFlags
    // bitmask meaning, etc.).
    operator: ac.ownOp || null,
    manufactureYear: ac.year || null,
    dbFlags: typeof ac.dbFlags === 'number' ? ac.dbFlags : null,
    messageType: ac.type || null,
    adsbVersion: typeof ac.version === 'number' ? ac.version : null,
    nic: typeof ac.nic === 'number' ? ac.nic : null,
    nicBaro: typeof ac.nic_baro === 'number' ? ac.nic_baro : null,
    nacP: typeof ac.nac_p === 'number' ? ac.nac_p : null,
    nacV: typeof ac.nac_v === 'number' ? ac.nac_v : null,
    sil: typeof ac.sil === 'number' ? ac.sil : null,
    silType: ac.sil_type || null,
    gva: typeof ac.gva === 'number' ? ac.gva : null,
    sda: typeof ac.sda === 'number' ? ac.sda : null,
    radiusOfContainmentM: typeof ac.rc === 'number' ? ac.rc : null,
    messageCount: typeof ac.messages === 'number' ? ac.messages : null,
    signalStrengthDbm: typeof ac.rssi === 'number' ? ac.rssi : null,
    secondsSincePositionUpdate: typeof ac.seen_pos === 'number' ? ac.seen_pos : null,
  };
}

// FlightRadar24, via the unofficial JeanExtreme002/FlightRadarAPI SDK —
// app.py's /api/flightradar24 already serializes each Flight object's
// fields under their own SDK attribute names (icao_24bit, ground_speed,
// aircraft_code, ...). Converts them into this app's own "raw record"
// convention — the same field names parseAdsbExchangeAircraft() produces —
// so this source's data can sit in the same radiusRecordsByHex map as the
// four radius sources and reuse fieldSourcesFor/RAW_FIELD_ALIASES with no
// special-casing. Unlike those four, origin/destination are populated
// directly here (bare IATA codes, no name/city/country) rather than only
// ever arriving via a FlightAware callsign match.
function parseFlightRadar24Aircraft(f) {
  return {
    icao24: (f.icao_24bit || '').toLowerCase() || null,
    callsign: (f.callsign || '').trim() || null,
    registration: f.registration || null,
    aircraftType: f.aircraft_code || null,
    icaoTypeCode: f.aircraft_code || null, // FR24's aircraft_code is already the bare ICAO type code
    lat: f.latitude,
    lon: f.longitude,
    onGround: !!f.on_ground,
    altitudeM: typeof f.altitude === 'number' ? f.altitude * FT_TO_M : null,
    altGeomM: null,
    speedKmh: typeof f.ground_speed === 'number' ? f.ground_speed * KT_TO_KMH : null,
    verticalRateMs: typeof f.vertical_speed === 'number' ? f.vertical_speed * FT_TO_M / 60 : null,
    squawk: f.squawk || null,
    category: null, // FR24's basic feed has no DO-260B emitter category code
    emergency: null,
    track: typeof f.heading === 'number' ? f.heading : null,
    iasKt: null, tasKt: null, mach: null,
    magHeadingDeg: null, trueHeadingDeg: null,
    turnRateDegPerSec: null, rollDeg: null,
    navAltitudeM: null, navHeadingDeg: null, navQnh: null, navModes: null,
    windDirDeg: null, windSpeedKt: null, oatC: null, tatC: null,
    hasAlert: false,
    positionSource: null,
    secondsSinceContact: typeof f.time === 'number'
      ? Math.max(0, Math.floor(Date.now() / 1000) - f.time) : null,
    operator: null, manufactureYear: null,
    dbFlags: null, messageType: null, adsbVersion: null,
    nic: null, nicBaro: null, nacP: null, nacV: null,
    sil: null, silType: null, gva: null, sda: null,
    radiusOfContainmentM: null, messageCount: null,
    signalStrengthDbm: null, secondsSincePositionUpdate: null,
    // render-details.js's Route card (shared with FlightAware/adsbdb) parses
    // "Name (CODE)" via splitAirportString() — FR24's basic feed only ever
    // has the bare IATA code, no airport name, so a leading-space "(CODE)"
    // format matches that regex with an empty name group, which renders as
    // just the big code with a blank city line rather than misreading the
    // code itself as a city name.
    originAirport: f.origin_airport_iata ? ' (' + f.origin_airport_iata + ')' : null,
    destinationAirport: f.destination_airport_iata ? ' (' + f.destination_airport_iata + ')' : null,
  };
}

// Same unified shape as normalizeAdsbExchange() (reused directly for every
// field it already covers), plus originAirport/destinationAirport — the one
// thing normalizeAdsbExchange() never sets, since for the four radius
// sources those only ever arrive via a FlightAware callsign match, not from
// the source's own data the way FlightRadar24's do.
function normalizeFlightRadar24(a) {
  const info = normalizeAdsbExchange(a);
  info.originAirport = a.originAirport || null;
  info.destinationAirport = a.destinationAirport || null;
  return info;
}

// Same shape as updateRadiusSourceMarkers(), not a parametrized reuse of it
// — kept as its own function, same as updateFlightAwareMarkers() is its own
// function, since this source's route fields need their own fieldSources
// override (FlightRadar24's own data, not a FlightAware callsign match) and
// its normalize call differs. excludeIds/radiusRecordsByHex work exactly
// like the radius sources' own — see CLAUDE.md for why this source sits
// last in that priority chain.
function updateFlightRadar24Markers(aircraftList, excludeIds, radiusRecordsByHex) {
  const items = [];
  for (const a of aircraftList) { // already parsed by poll() (parseFlightRadar24Aircraft)
    if (!isValidCoordinate(a.lat, a.lon)) continue;
    // Unlike the four radius sources, FR24 isn't fundamentally keyed by
    // ICAO24 (it's flight-object-keyed, with icao_24bit as just one
    // attribute) — a flight with no transponder hex can't dedupe or key a
    // marker the way this map (and excludeIds/radiusRecordsByHex) assumes.
    if (!a.icao24) continue;
    if (!passesMotionFilter(a.onGround)) continue;
    const isGroundVehicle = looksLikeGroundVehicle({
      category: a.category, registration: a.registration, aircraftType: a.aircraftType, callsign: a.callsign,
    });
    if (hideNonAircraft() && isGroundVehicle) continue;
    const categoryGroup = categoryGroupFor({ adsbExchangeCategory: a.category });
    if (!passesCategoryFilter(categoryGroup)) continue;
    if (excludeIds && a.icao24 && excludeIds.has(a.icao24)) continue;
    const info = normalizeFlightRadar24(a);
    if (!passesDataQualityFilter(info)) continue;
    const entries = (radiusRecordsByHex && a.icao24 && radiusRecordsByHex.get(a.icao24)) || [{ source: 'flightradar24', data: a }];
    const fieldSources = fieldSourcesFor(info, entries, null);
    if (info.originAirport) fieldSources.originAirport = ['flightradar24'];
    if (info.destinationAirport) fieldSources.destinationAirport = ['flightradar24'];
    items.push({
      id: a.icao24, lat: a.lat, lon: a.lon, heading: a.track,
      info: info, fieldSources: fieldSources, registration: a.registration,
      isGroundVehicle: isGroundVehicle, categoryGroup: categoryGroup,
      categoryCode: a.category,
    });
  }
  return syncMarkers(flightradar24Markers, items, SOURCE_COLORS.flightradar24);
}

// FlightAware AeroAPI shape: position/altitude/speed/heading live under
// last_position (not top-level like other sources); altitude is in hundreds
// of feet (e.g. 8 = 800 ft); origin/destination are objects with code_iata/name.
// No on_ground boolean exists — approximate it as altitude === 0, a best-effort
// heuristic since this is flight-centric data.
function parseFlightAware(f) {
  const lp = f.last_position || {};
  const altHundredsFt = typeof lp.altitude === 'number' ? lp.altitude : null;
  const altFt = altHundredsFt != null ? altHundredsFt * 100 : null;
  const gsKt = typeof lp.groundspeed === 'number' ? lp.groundspeed : null;
  const originAirport = f.origin
    ? `${f.origin.name} (${f.origin.code_iata || f.origin.code})`
    : null;
  const destinationAirport = f.destination
    ? `${f.destination.name} (${f.destination.code_iata || f.destination.code})`
    : null;
  return {
    fa_flight_id: f.fa_flight_id,
    callsign: f.ident || null,
    aircraftType: f.aircraft_type || null,
    icaoTypeCode: f.aircraft_type || null, // FlightAware's aircraft_type is already the bare ICAO type code
    lat: typeof lp.latitude === 'number' ? lp.latitude : null,
    lon: typeof lp.longitude === 'number' ? lp.longitude : null,
    onGround: altFt === 0,
    altitudeM: altFt != null ? altFt * FT_TO_M : null,
    speedKmh: gsKt != null ? gsKt * KT_TO_KMH : null,
    track: typeof lp.heading === 'number' ? lp.heading : null,
    originAirport: originAirport,
    destinationAirport: destinationAirport,
    secondsSinceContact: typeof lp.timestamp === 'string'
      ? Math.floor((Date.now() - new Date(lp.timestamp).getTime()) / 1000)
      : null,
  };
}

function normalizeFlightAware(f) {
  return {
    icao24: null, // FlightAware is flight-centric, not transponder-centric — no ICAO24/hex field exists
    callsign: f.callsign || null,
    registration: null,
    aircraftType: f.aircraftType || null,
    icaoTypeCode: f.icaoTypeCode || null,
    originCountry: null,
    categoryDisplay: null,
    altitudeM: f.altitudeM,
    altGeomM: null,
    speedKmh: f.speedKmh,
    verticalRateMs: null,
    trackDeg: f.track,
    iasKt: null, tasKt: null, mach: null,
    magHeadingDeg: null, trueHeadingDeg: null,
    turnRateDegPerSec: null, rollDeg: null,
    navAltitudeM: null, navHeadingDeg: null,
    navQnh: null, navModes: null,
    windDirDeg: null, windSpeedKt: null, oatC: null, tatC: null,
    squawk: null,
    emergency: null,
    hasAlert: false,
    positionSource: null,
    secondsSinceContact: f.secondsSinceContact,
    operator: null, manufactureYear: null,
    dbFlags: null, messageType: null, adsbVersion: null,
    nic: null, nicBaro: null, nacP: null, nacV: null,
    sil: null, silType: null, gva: null, sda: null,
    radiusOfContainmentM: null, messageCount: null,
    signalStrengthDbm: null, secondsSincePositionUpdate: null,
    originAirport: f.originAirport,
    destinationAirport: f.destinationAirport,
  };
}

// excludeIds lets the caller hide aircraft already shown by a higher-priority
// source, so this source only renders what it uniquely contributes.
// radiusRecordsByHex (see updateOpenSkyMarkers) supplies every enabled
// radius source's own record for this aircraft — sourceName won the marker,
// but another radius source may independently report the same field, and
// dev mode should show a badge for each of them, not just the winner.
function updateRadiusSourceMarkers(markerMap, aircraftList, excludeIds, color, sourceName, flightawareByCallsign, matchedFlightawareCallsigns, radiusRecordsByHex) {
  const items = [];
  for (const a of aircraftList) { // already parsed by poll() (parseAdsbExchangeAircraft)
    if (!isValidCoordinate(a.lat, a.lon)) continue;
    if (!passesMotionFilter(a.onGround)) continue;
    const isGroundVehicle = looksLikeGroundVehicle({
      category: a.category, registration: a.registration, aircraftType: a.aircraftType, callsign: a.callsign,
    });
    if (hideNonAircraft() && isGroundVehicle) continue;
    const categoryGroup = categoryGroupFor({ adsbExchangeCategory: a.category });
    if (!passesCategoryFilter(categoryGroup)) continue;
    if (excludeIds && excludeIds.has(a.icao24)) continue;
    const info = normalizeAdsbExchange(a);
    if (!passesDataQualityFilter(info)) continue;
    const entries = (radiusRecordsByHex && radiusRecordsByHex.get(a.icao24)) || [{ source: sourceName, data: a }];
    const fieldSources = fieldSourcesFor(info, entries, null);
    // Enrich with FlightAware's route data if callsign matches
    const faKey = normalizeCallsignKey(info.callsign);
    if (faKey && flightawareByCallsign && flightawareByCallsign.has(faKey)) {
      const faMatch = flightawareByCallsign.get(faKey);
      info.originAirport = faMatch.originAirport;
      info.destinationAirport = faMatch.destinationAirport;
      fieldSources.originAirport = ['flightaware'];
      fieldSources.destinationAirport = ['flightaware'];
      matchedFlightawareCallsigns.add(faKey);
    }
    items.push({
      id: a.icao24, lat: a.lat, lon: a.lon, heading: a.track,
      info: info, fieldSources: fieldSources, registration: a.registration,
      isGroundVehicle: isGroundVehicle, categoryGroup: categoryGroup,
      categoryCode: a.category,
    });
  }
  return syncMarkers(markerMap, items, color);
}

// FlightAware dedup by callsign: if a flight's normalized callsign matches
// an aircraft from another source, it was already enriched there and should
// not render its own marker. No looksLikeGroundVehicle check (AeroAPI only
// returns real flights), but category filter still applies (unknown category
// flows through passesCategoryFilter() like any other).
function updateFlightAwareMarkers(flights, excludedCallsigns) {
  const items = [];
  for (const f of flights) { // already parsed by poll() (parseFlightAware)
    if (!isValidCoordinate(f.lat, f.lon)) continue;
    const faKey = normalizeCallsignKey(f.callsign);
    if (excludedCallsigns && faKey && excludedCallsigns.has(faKey)) continue;
    if (!passesMotionFilter(f.onGround)) continue;
    if (!passesCategoryFilter('unknown')) continue;
    const info = normalizeFlightAware(f);
    if (!passesDataQualityFilter(info)) continue;
    const fieldSources = fieldSourcesFor(info, [{ source: 'flightaware', data: info }], null);
    items.push({
      id: f.fa_flight_id, lat: f.lat, lon: f.lon, heading: f.track,
      info: info, fieldSources: fieldSources, registration: null,
      isGroundVehicle: false, categoryGroup: 'unknown',
    });
  }
  return syncMarkers(flightawareMarkers, items, SOURCE_COLORS.flightaware);
}
