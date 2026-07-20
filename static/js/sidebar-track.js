// --- Sidebar (replaces the old Leaflet popup) ---
// A single persistent panel, not tied to any one marker's DOM — clicking a
// marker opens it and fills it in; clicking empty map area (or the close
// button) closes it. Keeping it as one fixed element rather than a per-marker
// popup also sidesteps the old bug class where a popup's DOM got replaced
// out from under an in-flight photo fetch: the gallery here is never rebuilt
// by a poll, only by an actual new selection.
const sidebarEl = document.getElementById('sidebar');
const sidebarHeaderEl = document.getElementById('sidebar-header');
const sidebarDetailsEl = document.getElementById('sidebar-details');
const sidebarGalleryEl = document.getElementById('sidebar-gallery');
const sidebarRouteEl = document.getElementById('sidebar-route');
const sidebarCloseBtn = document.getElementById('sidebar-close');
const sidebarCenterMapBtn = document.getElementById('sidebar-center-map');

// detailsById holds every currently-visible aircraft's latest details HTML +
// registration (for the photo lookup), refreshed every poll regardless of
// selection — so opening the sidebar (or refreshing it while open) never has
// to wait on anything.
const detailsById = new Map(); // id -> { html, registration }

// Enrichment results persist independently of detailsById because
// syncMarkers() fully replaces each aircraft's detailsById entry every
// poll — merging enrichment directly into that map would be silently
// discarded on the next poll. buildMergedDetails() recombines the two at
// render time instead. Cached per icao24 for the session (like
// galleryCache), so reselecting an aircraft costs no extra request.
const enrichmentById = new Map(); // icao24 -> raw /api/identity response

// Same persistence rationale as enrichmentById above, for adsbdb.com's
// combined aircraft+flightroute lookup. adsbdbEnabled is toggled by the
// dev-mode-only #toggle-adsbdb checkbox (see state-filters.js) — unlike the
// 6 main sourceToggles, this doesn't gate a per-poll fetch/marker set, only
// whether loadAdsbdb() below does anything on the next aircraft selection.
const adsbdbById = new Map(); // icao24 -> raw /api/adsbdb response
let adsbdbEnabled = true;

const ENRICHMENT_FIELD_MAP = {
  country: 'originCountry', operator: 'operator', operator_country: 'operatorCountry',
  registration: 'registration', manufacturer: 'manufacturer', model: 'model',
  year_built: 'manufactureYear',
};

// Combines a live-polled aircraft's { info, fieldSources } with cached
// /api/adsbdb and /api/identity lookups for the same icao24, in priority
// order live > adsbdb > Flywme-computed (agreed with the project owner: the
// live feed always wins since it's the freshest read; adsbdb is a real
// external database so it outranks our own locally-computed guesses, which
// only ever fire as a last resort). Each tier only fills a field that's
// still null/empty after the tier above it ran.
function buildMergedDetails(icao24) {
  const live = detailsById.get(icao24) || { info: {}, fieldSources: {} };
  const info = Object.assign({}, live.info);
  const fieldSources = Object.assign({}, live.fieldSources);
  const fieldConfidence = {};
  const fieldComputationBasis = {};

  function fillIfEmpty(feKey, value, source) {
    const already = info[feKey] != null && info[feKey] !== '';
    if (already || value == null || value === '') return false;
    info[feKey] = value;
    fieldSources[feKey] = [source];
    return true;
  }

  // --- Tier 2: adsbdb.com ---
  const adsbdb = adsbdbById.get(icao24);
  const aircraft = adsbdb && adsbdb.aircraft;
  const flightroute = adsbdb && adsbdb.flightroute;
  const airline = flightroute && flightroute.airline;
  if (aircraft) {
    // Deliberately no originCountry/countryIso fill here: adsbdb's
    // registered_owner_country_* fields describe the *owner's* country,
    // not the aircraft's country of registration — that would conflate two
    // different concepts under one "Country" label. That data instead
    // feeds registeredOwnerCountryIso below, its own dedicated field.
    fillIfEmpty('registration', aircraft.registration, 'adsbdb');
    fillIfEmpty('manufacturer', aircraft.manufacturer, 'adsbdb');
    fillIfEmpty('model', aircraft.type, 'adsbdb');
    // Registered Owner is a genuinely new field — no live source and no
    // Flywme tier exist for it (the enrichment/ package has no concept of a
    // private/corporate registrant, only an operating airline), so this is
    // its only tier.
    fillIfEmpty('registeredOwner', aircraft.registered_owner, 'adsbdb');
    if (aircraft.registered_owner_country_iso_name && !info.registeredOwnerCountryIso) {
      info.registeredOwnerCountryIso = aircraft.registered_owner_country_iso_name;
    }
  }
  if (airline) {
    fillIfEmpty('operator', airline.name, 'adsbdb');
    // Operator Country is its own field (not a flag riding on Operator's
    // own row) — same "dedicated row per concept" pattern as Registered
    // Owner. adsbdb gives the country name directly, no reverse lookup
    // needed.
    if (fillIfEmpty('operatorCountry', airline.country, 'adsbdb') && airline.country_iso) {
      info.operatorCountryIso = airline.country_iso;
    }
  }
  let routeValidation = null;
  if (flightroute && flightroute.origin && flightroute.destination) {
    // Same "Name (IATA)" shape parseFlightAware() already builds, so Route
    // reads identically regardless of which source filled it.
    fillIfEmpty('originAirport', `${flightroute.origin.name} (${flightroute.origin.iata_code})`, 'adsbdb');
    fillIfEmpty('destinationAirport', `${flightroute.destination.name} (${flightroute.destination.iata_code})`, 'adsbdb');

    // Layer 2 geometric validation — only for a route this call itself
    // just filled from adsbdb (never for a live/FlightAware-sourced route,
    // which comes from a real live tracking service, not a historical
    // callsign->route guess). Requires the aircraft's current position,
    // which only ever lives on detailsById's lat/lon (see icons.js).
    const isAdsbdbRoute = fieldSources.originAirport && fieldSources.originAirport.length === 1
      && fieldSources.originAirport[0] === 'adsbdb';
    if (isAdsbdbRoute && live.lat != null && live.lon != null) {
      routeValidation = validateAdsbdbRoute({
        curLat: live.lat, curLon: live.lon,
        trackDeg: info.trackDeg, speedKmh: info.speedKmh, altitudeM: info.altitudeM,
        originLat: flightroute.origin.latitude, originLon: flightroute.origin.longitude,
        destLat: flightroute.destination.latitude, destLon: flightroute.destination.longitude,
      });
    }
  }

  // --- Tier 3: Flywme (locally computed) ---
  // Always computed when enrichment data is available, even for a field a
  // higher tier (live or adsbdb) already filled — never overwrites the
  // displayed value, but surfaces what Flywme would have guessed as a
  // secondary badge, so the priority chain itself is visible/debuggable in
  // dev mode rather than the losing tier's guess silently disappearing.
  // Pushed onto fieldSources *after* whatever tier already won, so the
  // winning source's dot renders first and Flywme's second — the badge
  // order itself reflects the priority chain.
  const enrichment = enrichmentById.get(icao24);
  const fieldNeedsCorroboration = {};
  // A genuine cross-border "airline" helicopter flight under a matching
  // ICAO 3LD designator is rare, while a government/EMS/police callsign
  // prefix coincidentally colliding with an unrelated real airline's
  // designator is not (the real bug this closes: a Romanian rescue
  // helicopter's "MAI" callsign — Ministerul Afacerilor Interne — decoding
  // to Mauritania Airlines International). So a callsign-decoded operator/
  // operator_country that conflicts with the aircraft's own ICAO24
  // hex-block country is withheld in normal mode for rotorcraft
  // specifically — see enrich_identity()'s needs_corroboration flag and the
  // matching frontend handling below/in render-details.js. Every other
  // category still displays it normally (cross-border leasing legitimately
  // produces this same kind of mismatch constantly), just with extra detail
  // in the dev-mode tooltip.
  const isRotorcraft = live.categoryGroup === 'rotorcraft';
  if (enrichment) {
    for (const [beKey, feKey] of Object.entries(ENRICHMENT_FIELD_MAP)) {
      const resolved = enrichment[beKey];
      if (beKey === 'country' && resolved && resolved.country_iso && !info.countryIso) {
        info.countryIso = resolved.country_iso;
      }
      // Same rule for operator_country: its own dedicated field/flag,
      // never a decoration on Operator's own row (mirrors "country" above).
      if (beKey === 'operator_country' && resolved && resolved.country_iso && !info.operatorCountryIso) {
        info.operatorCountryIso = resolved.country_iso;
      }
      if (!resolved) continue;
      const already = info[feKey] != null && info[feKey] !== '';

      if ((beKey === 'operator' || beKey === 'operator_country') && resolved.needs_corroboration) {
        fieldNeedsCorroboration[feKey] = true;
        // Not already filled by a higher tier, and this is the specific
        // combination (rotorcraft, normal mode) where the value is
        // withheld entirely rather than shown as fact — "continue" leaves
        // info[feKey] unset, so identityRow renders the ordinary "Unknown"
        // it already would for any other unresolved field. Dev mode still
        // falls through below and fills it normally, tagged, for debugging.
        if (!already && isRotorcraft && !currentDevMode) continue;
      }

      if (already) {
        // Only co-display when enrichment resolved this field via a real
        // locally-computed tier (registration_prefix/icao24_lookup/
        // callsign_decode/aircraft_type_db) — its own "live" tier just
        // echoes back the same known_* hint the caller passed in, which
        // isn't an independent guess worth badging a second time.
        if (resolved.source === 'live') continue;
        if (!fieldSources[feKey]) fieldSources[feKey] = [];
        if (!fieldSources[feKey].includes('flywme')) fieldSources[feKey].push('flywme');
      } else {
        info[feKey] = resolved.value;
        fieldSources[feKey] = ['flywme'];
      }
      fieldConfidence[feKey] = resolved.confidence;
      fieldComputationBasis[feKey] = resolved.source;
    }

    // Category is a special case, not part of ENRICHMENT_FIELD_MAP above:
    // enrichment resolves a raw ADS-B code ("A3"), while `info` stores the
    // already-formatted `categoryDisplay` string every live source also
    // fills — formatAdsbExchangeCategory() (render-details.js) builds the
    // exact same "A3 — Large (...)" shape a real adsb.fi/airplanes.live
    // response would, so the existing splitCategoryDisplay()/
    // CATEGORY_LABEL_TO_GROUP machinery (also render-details.js) needs no
    // changes to render it. The lowest-priority tier in this app's whole
    // category chain — only reached when neither the live feed nor
    // adsb.fi/airplanes.live/OpenSky reported a category for this aircraft
    // at all.
    const resolvedCategory = enrichment.category;
    if (resolvedCategory) {
      const already = info.categoryDisplay != null && info.categoryDisplay !== '';
      if (already) {
        if (!fieldSources.categoryDisplay) fieldSources.categoryDisplay = [];
        if (!fieldSources.categoryDisplay.includes('flywme')) fieldSources.categoryDisplay.push('flywme');
      } else {
        info.categoryDisplay = formatAdsbExchangeCategory(resolvedCategory.value);
        fieldSources.categoryDisplay = ['flywme'];
      }
      fieldConfidence.categoryDisplay = resolvedCategory.confidence;
      fieldComputationBasis.categoryDisplay = resolvedCategory.source;
    }
  }
  return {
    info, fieldSources, fieldConfidence, fieldComputationBasis, routeValidation,
    fieldNeedsCorroboration, categoryGroup: live.categoryGroup,
  };
}

// Single place that (re)renders the sidebar for whichever aircraft is
// currently selected, merging in any enrichment already resolved — used by
// every render path (initial select, poll resync, unit/dev-mode toggles,
// and the enrichment fetch landing) so none of them can drift out of sync
// with each other.
function renderSelectedDetails() {
  if (selectedIcao24 == null || !detailsById.has(selectedIcao24)) return;
  const m = buildMergedDetails(selectedIcao24);
  const rendered = renderDetailsHtml(m.info, m.fieldSources, m.fieldConfidence, m.fieldComputationBasis, m.routeValidation, m.fieldNeedsCorroboration, m.categoryGroup);
  sidebarHeaderEl.innerHTML = rendered.header;
  sidebarRouteEl.innerHTML = rendered.route;
  sidebarDetailsEl.innerHTML = rendered.body;
}

let selectedIcao24 = null;
let trackLayerGroup = null;
let trackFetchToken = 0; // guards against a stale response overwriting a newer selection
let trackUsesLiveFallback = false;

// OpenSky is the only source that provides a full historical track, but its
// track endpoint is quota-limited. Keep a small, in-browser trail from the
// live feeds as a fallback when that endpoint is temporarily unavailable.
const LIVE_TRAIL_MAX_POINTS = 40;
const liveTrailById = new Map(); // icao24 -> [{lat, lon, altitude}]

function recordLiveTrailPoint(icao24, lat, lon, altitude) {
  if (!icao24 || lat == null || lon == null) return;
  const trail = liveTrailById.get(icao24) || [];
  const previous = trail[trail.length - 1];
  // A poll can receive the same aircraft from several feeds. Repeated
  // coordinates do not add information or make a visible track segment.
  if (!previous || previous.lat !== lat || previous.lon !== lon) {
    trail.push({ lat, lon, altitude });
    if (trail.length > LIVE_TRAIL_MAX_POINTS) trail.shift();
    liveTrailById.set(icao24, trail);
  }
}

function recordLiveTrails(parsedStates, parsedRadiusLists) {
  // Both arguments arrive already parsed by poll() — one parse per cycle,
  // shared with radiusRecordsByHex and the update*Markers renderers.
  for (const state of parsedStates || []) {
    recordLiveTrailPoint(state.icao24, state.lat, state.lon, state.baro_altitude);
  }
  for (const list of parsedRadiusLists) {
    for (const aircraft of list || []) {
      recordLiveTrailPoint(aircraft.icao24, aircraft.lat, aircraft.lon, aircraft.altitudeM);
    }
  }
}

// Altitude legend for the track, in the spirit of OpenSky's own web map: grey
// for unknown altitude, green near the ground, up through yellow/orange to
// red at cruise altitude and above. Stops are in meters; colors interpolate
// linearly between them and clamp at the ends.
const ALTITUDE_COLOR_STOPS = [
  { alt: 0, rgb: [46, 204, 113] },    // green
  { alt: 3000, rgb: [241, 196, 15] }, // yellow
  { alt: 6000, rgb: [230, 126, 34] }, // orange
  { alt: 9000, rgb: [231, 76, 60] },  // red
];
function altitudeColor(meters) {
  if (meters == null) return '#9aa1ab'; // unknown altitude
  const stops = ALTITUDE_COLOR_STOPS;
  if (meters <= stops[0].alt) return rgbToHex(stops[0].rgb);
  for (let i = 1; i < stops.length; i++) {
    if (meters <= stops[i].alt) {
      const t = (meters - stops[i - 1].alt) / (stops[i].alt - stops[i - 1].alt);
      return rgbToHex(lerpRgb(stops[i - 1].rgb, stops[i].rgb, t));
    }
  }
  return rgbToHex(stops[stops.length - 1].rgb);
}
function lerpRgb(a, b, t) {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
}
function rgbToHex(rgb) {
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// waypoints: [{lat, lon, altitude}] — drawn as short per-segment polylines
// (rather than one polyline) so each segment can be colored by its own
// altitude, matching OpenSky's own web map convention.
function drawTrack(waypoints) {
  if (trackLayerGroup) {
    map.removeLayer(trackLayerGroup);
    trackLayerGroup = null;
  }
  if (!waypoints || waypoints.length < 2) return;

  const segments = [];
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1];
    const b = waypoints[i];
    const avgAltitude = a.altitude != null && b.altitude != null
      ? (a.altitude + b.altitude) / 2
      : (a.altitude != null ? a.altitude : b.altitude);
    segments.push(L.polyline([[a.lat, a.lon], [b.lat, b.lon]], {
      color: altitudeColor(avgAltitude), weight: 3, opacity: 0.85,
    }));
  }
  trackLayerGroup = L.featureGroup(segments).addTo(map);
}

// Format retry time in human-readable format (hours, minutes, seconds)
function formatRetryTime(seconds) {
  if (seconds == null) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h > 0) parts.push(h + 'h');
  if (m > 0) parts.push(m + 'm');
  if (s > 0 || parts.length === 0) parts.push(s + 's');
  return parts.join(' ');
}

// The track status line stays a short label; everything that needs explaining
// (why the path isn't OpenSky's own history, when the quota returns) lives
// behind its "(?)" popover — the same affordance the OpenSky source lockout
// uses, so both quota stories are told the same way. `detail` may be a
// function, which is what lets the rate-limit countdown stay live while open.
let trackHelpDetail = null;
function refreshTrackHelp() {
  const text = typeof trackHelpDetail === 'function' ? trackHelpDetail() : trackHelpDetail;
  document.getElementById('track-help-popover').textContent = text || '';
}
function setTrackStatus(label, detail) {
  const row = document.getElementById('track-status-row');
  const statusEl = document.getElementById('track-status');
  trackHelpDetail = detail || null;
  if (!label) {
    row.style.display = 'none';
    statusEl.textContent = '';
    document.getElementById('track-help-popover').setAttribute('hidden', '');
    return;
  }
  row.style.display = '';
  statusEl.textContent = label;
  document.getElementById('track-help').style.display = trackHelpDetail ? '' : 'none';
  refreshTrackHelp();
}

// The countdown until the (separate, per-aircraft) OpenSky track quota resets
// re-attempts the fetch automatically once it elapses. Only one countdown runs
// at a time; it stops when the selection changes.
let trackRetryTimer = null;
function stopTrackRetryTimer() {
  if (trackRetryTimer) { clearInterval(trackRetryTimer); trackRetryTimer = null; }
}
function renderTrackRateLimited(icao24, resetAt) {
  const detail = () => {
    const secs = resetAt != null ? Math.max(0, Math.round((resetAt - Date.now()) / 1000)) : null;
    const when = secs != null ? ' (available in ' + formatRetryTime(secs) + ')' : '';
    return "OpenSky's historical-track quota is exhausted" + when
      + '. It is a separate bucket from the map-data quota, spent per aircraft'
      + ' whose history you open.';
  };
  const paint = () => {
    if (selectedIcao24 !== icao24) { stopTrackRetryTimer(); return; }
    if (resetAt != null && Date.now() >= resetAt) {
      stopTrackRetryTimer();
      loadTrack(icao24); // the window has passed — try for real history again
      return;
    }
    setTrackStatus('Historical track unavailable', detail, true);
  };
  stopTrackRetryTimer();
  paint();
  if (resetAt != null) trackRetryTimer = setInterval(paint, 1000);
}

async function loadTrack(icao24) {
  const fetchId = ++trackFetchToken;
  stopTrackRetryTimer(); // a fresh load supersedes any running countdown
  try {
    const resp = await fetch('/api/track/' + encodeURIComponent(icao24));
    const data = await resp.json();
    if (fetchId !== trackFetchToken || selectedIcao24 !== icao24) return; // selection changed meanwhile

    // Waypoint format from OpenSky /tracks/all: [time, lat, lon, baro_altitude, true_track, on_ground]
    const waypoints = (data.path || [])
      .filter((wp) => wp[1] != null && wp[2] != null)
      .map((wp) => ({ lat: wp[1], lon: wp[2], altitude: wp[3] }));
    if (waypoints.length >= 2) {
      trackUsesLiveFallback = false;
      drawTrack(waypoints);
      if (data.stale) {
        setTrackStatus('Track: cached data',
          "Showing this aircraft's last known flight history from the local cache:"
          + " OpenSky's track quota is spent, so it can't be refreshed right now.");
      } else {
        setTrackStatus('');
      }
    } else {
      // 404/429 and a flight that OpenSky has not segmented yet all return no
      // drawable path. Fall back to the positions this page has observed.
      trackUsesLiveFallback = true;
      drawTrack(liveTrailById.get(icao24));
      setTrackStatus('Track: live fallback',
        'OpenSky has no recorded flight history for this aircraft — common for'
        + ' rotorcraft and short local flights. The path shown is collected in'
        + ' this browser from map polls (up to 40 points) and is lost on reload.');
    }
    // Check both HTTP status and data.error (backend returns 429 for rate limit)
    // Only show error if there's no usable path (stale data with path already handled above)
    if ((data.error || resp.status === 429) && waypoints.length < 2) {
      const rateLimited = data.error === 'rate_limited' || resp.status === 429;
      if (rateLimited) {
        // Distinct from the map-data quota: this is OpenSky's /tracks/* bucket.
        // Render a live, self-updating countdown (see renderTrackRateLimited).
        const resetAt = data.retry_after_seconds != null
          ? Date.now() + data.retry_after_seconds * 1000
          : null;
        renderTrackRateLimited(icao24, resetAt);
      } else {
        setTrackStatus('Historical track unavailable',
          'OpenSky returned an error for this aircraft: ' + data.error + '.', true);
      }
    }
  } catch (e) {
    if (fetchId === trackFetchToken && selectedIcao24 === icao24) {
      trackUsesLiveFallback = true;
      drawTrack(liveTrailById.get(icao24));
      setTrackStatus('Track: live fallback',
        "The track endpoint could not be reached, so the path shown is collected"
        + ' in this browser from map polls (up to 40 points).');
    }
  }
}

let identityFetchToken = 0; // guards against a stale response overwriting a newer selection

// Lazily fetches /api/identity for the selected aircraft, same lazy-on-click
// pattern as loadTrack/loadGallery (never during the main poll). Passes
// along whatever the live feeds already resolved so the backend's own
// known_* short-circuit can skip its lookup tables for fields that don't
// need them — buildMergedDetails() then applies that same "live wins" rule
// again on the client, since a later poll can supersede what selectAircraft
// saw at click time.
async function loadIdentityEnrichment(icao24, info) {
  if (enrichmentById.has(icao24)) return; // already resolved this session
  const fetchId = ++identityFetchToken;
  const params = new URLSearchParams();
  if (info) {
    if (info.registration) params.set('registration', info.registration);
    if (info.callsign) params.set('callsign', info.callsign);
    if (info.aircraftType) params.set('aircraft_type', info.aircraftType);
    if (info.icaoTypeCode) params.set('icao_type', info.icaoTypeCode);
    if (info.originCountry) params.set('known_country', info.originCountry);
    if (info.operator) params.set('known_operator', info.operator);
    if (info.manufactureYear) params.set('known_manufacture_year', info.manufactureYear);
  }
  try {
    const resp = await fetch('/api/identity/' + encodeURIComponent(icao24) + '?' + params.toString());
    const data = await resp.json();
    if (fetchId !== identityFetchToken || selectedIcao24 !== icao24) return; // selection changed meanwhile
    enrichmentById.set(icao24, data);
    renderSelectedDetails();
  } catch (e) {
    // Best-effort: leave enrichmentById unset so a later reselect retries.
  }
}

// loadIdentityEnrichment() and loadAdsbdb() are independent, concurrent
// fetches kicked off together from selectAircraft() (same pattern as
// loadGallery()/loadAdsbdb() above) — neither sees the other's result.
// That means our own local tables (registration_prefix/callsign_decode,
// see enrichment/) are blind to a registration/callsign that only adsbdb
// resolved: loadIdentityEnrichment() already ran (and cached its result)
// before adsbdb's response ever arrived. Re-running it with whatever new
// registration/callsign adsbdb found gives those tables a fair shot —
// found via a real aircraft (4X-ABS, no live registration, only adsbdb
// knew it) whose Registration Country stayed "Unknown" even though our
// own registration_prefix table could have resolved it from that tail
// number alone.
function maybeRefetchIdentityWithAdsbdbData(icao24, liveInfo, adsbdbData) {
  const aircraft = adsbdbData && adsbdbData.aircraft;
  if (!aircraft) return;
  const liveReg = liveInfo && liveInfo.registration;
  const liveCallsign = liveInfo && liveInfo.callsign;
  const newReg = !liveReg && aircraft.registration ? aircraft.registration : null;
  const flightroute = adsbdbData.flightroute;
  const newCallsign = !liveCallsign && flightroute && flightroute.callsign ? flightroute.callsign : null;
  if (!newReg && !newCallsign) return; // nothing our own tables didn't already see
  enrichmentById.delete(icao24); // bypasses loadIdentityEnrichment()'s "already resolved" guard
  loadIdentityEnrichment(icao24, Object.assign({}, liveInfo, {
    registration: newReg || liveReg,
    callsign: newCallsign || liveCallsign,
  }));
}

let adsbdbFetchToken = 0; // guards against a stale response overwriting a newer selection

// icao24 -> normalized photo candidate from adsbdb's url_photo, or null once
// resolved with no photo. Kept separate from adsbdbById (the raw response)
// so appendAdsbdbPhotoIfReady() below has a simple has()/get() to check
// without re-deriving the candidate shape on every call.
const adsbdbPhotoByIcao = new Map();

// adsbdb's photo is a last-resort-only candidate, not a top-up: live
// checks against api.adsbdb.com (4+ real aircraft) found its `url_photo`
// field — the one that would in theory be a full-size image — always
// 404s, and the same is true of the full-size URL our own
// _airportdata_fullsize_url() logic would reconstruct from it. Only
// `url_photo_thumbnail` (a genuinely tiny ~2-4KB image) ever actually
// resolves, and adsbdb supplies no photographer credit at all (unlike
// Planespotters/airport-data.com, whose terms this app otherwise always
// honors). Given that, it's not worth showing *alongside* a real,
// properly-credited photo just because it happens to be a different one —
// only worth showing when Planespotters + airport-data.com together found
// nothing at all.
function appendAdsbdbPhotoAsLastResort(icao24, photos) {
  if (photos.length > 0) return photos;
  const candidate = adsbdbPhotoByIcao.get(icao24);
  return candidate ? photos.concat([candidate]) : photos;
}

// loadGallery() and loadAdsbdb() are independent, concurrent fetches kicked
// off together from selectAircraft() — whichever of the two finishes last
// is the one that actually performs the append+re-render, by checking
// whether the other one's cache is already populated.
function appendAdsbdbPhotoIfReady(icao24) {
  if (!adsbdbPhotoByIcao.has(icao24)) return; // adsbdb fetch hasn't landed yet
  if (!galleryCache.has(icao24)) return; // gallery hasn't landed yet either
  const current = galleryCache.get(icao24);
  const merged = appendAdsbdbPhotoAsLastResort(icao24, current);
  if (merged !== current) {
    galleryCache.set(icao24, merged);
    if (selectedIcao24 === icao24) renderGallery(merged);
  }
}

// Lazily fetches /api/adsbdb for the selected aircraft — same lazy-on-click
// pattern as loadTrack/loadGallery/loadIdentityEnrichment. Passes the
// currently-known callsign so the backend can use adsbdb's combined
// aircraft+flightroute endpoint in one request instead of two.
async function loadAdsbdb(icao24, info) {
  if (!adsbdbEnabled) return;
  if (adsbdbById.has(icao24)) return; // already resolved this session
  const fetchId = ++adsbdbFetchToken;
  let url = '/api/adsbdb/' + encodeURIComponent(icao24);
  if (info && info.callsign) url += '?callsign=' + encodeURIComponent(info.callsign.trim());
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (fetchId !== adsbdbFetchToken || selectedIcao24 !== icao24) return; // selection changed meanwhile
    adsbdbById.set(icao24, data);
    const aircraft = data.aircraft;
    // aircraft.url_photo (the field that would in theory be full-size)
    // reliably 404s in practice — only the thumbnail ever resolves, so
    // that's the only field used here at all (see appendAdsbdbPhotoAsLastResort
    // above). forceNative renders it at native size from the start
    // instead of stretched-then-blurry (it's genuinely too small to
    // stretch cleanly).
    const photoThumb = aircraft && aircraft.url_photo_thumbnail;
    adsbdbPhotoByIcao.set(icao24, photoThumb ? {
      thumbnail_large: { src: photoThumb },
      fallback_src: null,
      forceNative: true,
      link: photoThumb,
      photographer: 'via adsbdb.com',
    } : null);
    renderSelectedDetails();
    appendAdsbdbPhotoIfReady(icao24);
    maybeRefetchIdentityWithAdsbdbData(icao24, info, data);
  } catch (e) {
    // Best-effort: leave adsbdbById unset so a later reselect retries.
  }
}

function selectAircraft(icao24) {
  selectedIcao24 = icao24;
  updateSaveButtonState(); // auth-collection.js — reflects saved/C0-disabled state for this aircraft
  trackUsesLiveFallback = false;
  drawTrack(null); // never leave the previously selected aircraft's path visible
  loadTrack(icao24);

  const details = detailsById.get(icao24);
  if (details) {
    renderSelectedDetails();
  } else {
    sidebarHeaderEl.innerHTML = '';
    sidebarRouteEl.innerHTML = '';
    sidebarDetailsEl.innerHTML = '';
  }
  sidebarEl.classList.add('open');
  loadGallery(icao24, details && details.registration);
  loadIdentityEnrichment(icao24, details && details.info);
  loadAdsbdb(icao24, details && details.info);
}

function deselectAircraft() {
  selectedIcao24 = null;
  trackUsesLiveFallback = false;
  stopTrackRetryTimer();
  drawTrack(null);
  sidebarEl.classList.remove('open');
  setTrackStatus('');
}

// Deselect when clicking empty map area (marker clicks don't bubble to the
// map — see the CLAUDE.md note on L.Marker's bubblingMouseEvents default).
map.on('click', deselectAircraft);
sidebarCloseBtn.addEventListener('click', deselectAircraft);

// Centers on the selected aircraft's *current* position (detailsById's
// lat/lon, kept fresh every poll — see icons.js — not wherever it was when
// the sidebar first opened), keeping the current zoom level rather than
// forcing one, so this doubles as "re-center without losing my zoom" for
// an aircraft that's drifted off-screen while its sidebar stayed open.
sidebarCenterMapBtn.addEventListener('click', () => {
  if (selectedIcao24 == null) return;
  const details = detailsById.get(selectedIcao24);
  if (!details || details.lat == null || details.lon == null) return;
  map.setView([details.lat, details.lon], map.getZoom());
});

// --- Aircraft photo gallery ---
// Two sources, merged rather than strict either/or:
// - /api/photo (Planespotters) — authoritative and renders first, alone,
//   with its *entire* photo array (not just photos[0]) as soon as it
//   arrives, without waiting on the second source at all.
// - /api/photo2 (airport-data.com) — only queried afterwards, asynchronously,
//   and only to top up whatever's still short of GALLERY_TARGET_COUNT. Its
//   `n` query param is an upper bound, not a guarantee (their own docs say
//   so, confirmed in practice — e.g. G-STBC with n=5 returned only 2), so
//   the actual array length is however many came back — the gallery then
//   simply shows however many real photos were found in total, never padded
//   with placeholders up to the target (a 2-photo aircraft shows 2 slides,
//   not 4), and skips the dots/prev-next chrome entirely for a lone photo.
// Both are normalized server-side to the same {thumbnail_large, link,
// photographer} shape (see app.py); airport-data.com's entry also carries
// `fallback_src`, its original ~200px thumbnail, used client-side only if
// the reconstructed full-size image.airport-data.com URL 404s (not every
// id resolves) — see the img.onerror handler in renderGallery().
// Loaded only from selectAircraft() below — i.e. only on an explicit marker
// click, never from poll()/pan/zoom. That's what satisfies "don't hit the
// photo APIs on map movement" without any extra debounce logic.
const GALLERY_TARGET_COUNT = 4;
const photoCache = new Map(); // "<endpoint>:<kind>:<value>[:<query>]" -> photo array (possibly empty)
const galleryCache = new Map(); // icao24 -> finished gallery photo array (Planespotters + any top-up)
let galleryToken = 0; // guards against a stale response overwriting a newer selection

async function fetchPhotosFrom(endpoint, kind, value, query) {
  const key = endpoint + ':' + kind + ':' + value + (query || '');
  if (photoCache.has(key)) return photoCache.get(key);
  try {
    const resp = await fetch(endpoint + '/' + kind + '/' + encodeURIComponent(value) + (query || ''));
    const data = await resp.json();
    const photos = data.photos || [];
    photoCache.set(key, photos);
    return photos;
  } catch (e) {
    return []; // treated the same as "no photo found" — no error surfaced to the user
  }
}

// Tries registration first (more specific/reliable), falling back to the
// ICAO24 hex — but only when the registration actually looks like a real
// tail number (see looksLikePlausibleRegistration()). A bare internal fleet
// number (observed on real military/government helicopters, e.g. "333")
// skips straight to the hex-based lookup instead of risking a false match
// in Planespotters' own registration index.
async function fetchPlanespottersPhotos(icao24, registration) {
  let photos = looksLikePlausibleRegistration(registration)
    ? await fetchPhotosFrom('/api/photo', 'reg', registration) : [];
  if (!photos.length && icao24) {
    photos = await fetchPhotosFrom('/api/photo', 'hex', icao24);
  }
  return photos;
}

// airport-data.com has no registration-only lookup worth using here — it's
// always queried by ICAO24 hex (`m`), optionally hinted with the
// registration (`r`) for a more precise match per its docs — only added
// when plausible, same rationale as fetchPlanespottersPhotos() above.
// `needed` is "how many more slots this gallery still has", sent as `n`.
async function fetchAirportDataPhotos(icao24, registration, needed) {
  if (!icao24 || needed <= 0) return [];
  let query = '?n=' + needed;
  if (looksLikePlausibleRegistration(registration)) query += '&reg=' + encodeURIComponent(registration);
  return fetchPhotosFrom('/api/photo2', 'hex', icao24, query);
}

// Both the loading spinner and the final "no photos found" text sit in the
// same fixed-aspect-ratio .gallery-placeholder box the real gallery uses
// (.gallery-slider-container, see style.css), and are followed by this same
// empty .gallery-dots row — so #sidebar-gallery's total height is identical
// across every state (loading -> N photos, or loading -> 0 photos) and never
// pushes the route card/details below it up or down as photos resolve.
function emptyDotsRow() {
  const row = document.createElement('div');
  row.className = 'gallery-dots';
  return row;
}

function renderGalleryLoading() {
  sidebarGalleryEl.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'gallery-placeholder loading';
  const spinner = document.createElement('div');
  spinner.className = 'gallery-spinner';
  box.appendChild(spinner);
  sidebarGalleryEl.appendChild(box);
  sidebarGalleryEl.appendChild(emptyDotsRow());
}

// Renders via DOM properties (.src/.href/.textContent), not HTML-string
// concatenation, since photographer name/link come from an external API and
// shouldn't be trusted as raw markup. Shows exactly `photos.length` slides —
// no padding to GALLERY_TARGET_COUNT with empty placeholders, and no
// prev/next nav or clickable dots for a single photo, where they'd be
// pointless — but the (empty) .gallery-dots row itself still renders, so the
// sidebar doesn't jump in height the moment a 1-photo gallery tops up to 2+.
function renderGallery(photos) {
  sidebarGalleryEl.innerHTML = '';

  if (!photos.length) {
    const placeholder = document.createElement('div');
    placeholder.className = 'gallery-placeholder';
    placeholder.textContent = 'No photos found';
    sidebarGalleryEl.appendChild(placeholder);
    sidebarGalleryEl.appendChild(emptyDotsRow());
    return;
  }

  const N = photos.length;

  // Always rendered, even for a single photo (which gets zero actual .gallery-dot
  // children) — this row's padding + min-height (CSS) is what keeps the gap
  // below the photo constant. It used to be omitted entirely for N === 1,
  // which read fine in isolation, but caused a visible layout jump when a
  // Planespotters-only gallery (1 photo, no dots row) topped up from
  // airport-data.com moments later and suddenly grew a dots row: the route
  // card (or #sidebar-details) shifted down as that row appeared/changed
  // height. Reserving the same space up front, populated or not, removes
  // the jump instead of just resizing it.
  const dotsWrap = emptyDotsRow();
  const dots = N > 1 ? photos.map((_, i) => {
    const dot = document.createElement('span');
    dot.className = 'gallery-dot';
    dot.addEventListener('click', () => goTo(i));
    dotsWrap.appendChild(dot);
    return dot;
  }) : [];

  const imgWrap = document.createElement('div');
  imgWrap.className = 'gallery-image-wrap';

  const credit = document.createElement('div');
  credit.className = 'gallery-credit';
  credit.append('© ');
  const creditLink = document.createElement('a');
  creditLink.target = '_blank';
  creditLink.rel = 'noopener noreferrer';
  credit.appendChild(creditLink);

  // Shared slide builder — used for the N real slides plus one clone each
  // of the first/last (for the infinite-loop illusion below). Built via
  // this same function rather than cloneNode() so the clones keep a
  // correctly-wired img.onerror fallback too (a JS property, not an HTML
  // attribute — cloneNode() would silently drop it).
  function buildSlide(photo) {
    const slide = document.createElement('div');
    slide.className = 'gallery-slide ' + (photo.forceNative ? 'native' : 'stretch');
    const anchor = document.createElement('a');
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    const img = document.createElement('img');
    img.alt = 'Aircraft photo';
    img.onerror = () => {
      if (photo.fallback_src && img.src !== photo.fallback_src) {
        slide.className = 'gallery-slide native';
        img.src = photo.fallback_src;
      }
    };
    const src = (photo.thumbnail_large && photo.thumbnail_large.src) || (photo.thumbnail && photo.thumbnail.src) || '';
    img.src = src;
    anchor.href = photo.link || '';
    anchor.appendChild(img);
    slide.appendChild(anchor);
    return slide;
  }

  // DOM order: [clone-of-last, real[0], real[1], ..., real[N-1], clone-of-first]
  // — but the two clones only exist at all when N > 1 (a lone photo has no
  // "next"/"prev" to loop through in the first place). domIdx (physical
  // track position) is logicalIdx + CLONE_OFFSET for a real slide, where
  // CLONE_OFFSET is 1 when clones are present and 0 when there's only ever
  // the one real slide at position 0 — using a hardcoded +1 unconditionally
  // here was a real bug: for a single-photo gallery it shifted the track
  // one full slide-width past the only slide that actually exists in the
  // DOM, rendering nothing but blank space. With clones present, this is
  // what lets next()/prev() always animate strictly forward/backward
  // respectively, even across the last->first / first->last boundary,
  // instead of rewinding back across the whole strip.
  const CLONE_OFFSET = N > 1 ? 1 : 0;
  let currentIdx = 0;
  let domIdx = CLONE_OFFSET;
  const sliderTrack = document.createElement('div');
  sliderTrack.className = 'gallery-slider-track';
  if (N > 1) sliderTrack.appendChild(buildSlide(photos[N - 1]));
  photos.forEach((photo) => sliderTrack.appendChild(buildSlide(photo)));
  if (N > 1) sliderTrack.appendChild(buildSlide(photos[0]));

  function applyTransform(idx, animate) {
    sliderTrack.style.transition = animate ? 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none';
    sliderTrack.style.transform = `translate3d(${-idx * 100}%, 0, 0)`;
  }

  function updateChrome() {
    const photo = photos[currentIdx];
    if (dots.length > 0) {
      dots.forEach((d, i2) => d.classList.toggle('active', i2 === currentIdx));
    }
    creditLink.href = photo.link || '';
    creditLink.textContent = photo.photographer || 'Unknown';
  }

  // Direct jump (dot click, initial render) — no wraparound trick needed,
  // since it's not a "keep sliding past the edge" case.
  function goTo(i, animate = true) {
    currentIdx = (i + N) % N;
    domIdx = currentIdx + CLONE_OFFSET;
    applyTransform(domIdx, animate);
    updateChrome();
  }

  function next() {
    const wrapped = currentIdx === N - 1;
    currentIdx = (currentIdx + 1) % N;
    domIdx += 1;
    applyTransform(domIdx, true);
    if (wrapped) {
      sliderTrack.addEventListener('transitionend', function handler() {
        sliderTrack.removeEventListener('transitionend', handler);
        domIdx = CLONE_OFFSET;
        applyTransform(domIdx, false);
      }, { once: true });
    }
    updateChrome();
  }

  function prev() {
    const wrapped = currentIdx === 0;
    currentIdx = (currentIdx - 1 + N) % N;
    domIdx -= 1;
    applyTransform(domIdx, true);
    if (wrapped) {
      sliderTrack.addEventListener('transitionend', function handler() {
        sliderTrack.removeEventListener('transitionend', handler);
        domIdx = N - 1 + CLONE_OFFSET;
        applyTransform(domIdx, false);
      }, { once: true });
    }
    updateChrome();
  }

  // Prev/next overlay the image itself, vertically centered — but with no
  // background shape behind them at all (just the bare chevron glyph plus
  // a subtle drop-shadow for legibility over any photo). Two earlier
  // versions had a filled circle background (first dark, then a light
  // glass pill) that read as sitting "on top of" the photo; a separate row
  // below the image (flanking the dots) was tried too but looked wrong in
  // this layout. A shape-less glyph avoids the "sits on top of the photo"
  // feel while staying in the natural, expected carousel position.
  const sliderContainer = document.createElement('div');
  sliderContainer.className = 'gallery-slider-container';
  sliderContainer.appendChild(sliderTrack);
  sliderContainer.appendChild(credit);

  if (N > 1) {
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button'; prevBtn.className = 'gallery-nav gallery-prev'; prevBtn.textContent = '‹';
    prevBtn.addEventListener('click', prev);
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button'; nextBtn.className = 'gallery-nav gallery-next'; nextBtn.textContent = '›';
    nextBtn.addEventListener('click', next);
    sliderContainer.appendChild(prevBtn);
    sliderContainer.appendChild(nextBtn);

    // Fotorama-style swipe: drag to preview next/prev, release to snap.
    // Anchored on domIdx (not currentIdx) so dragging past either edge
    // already previews the correct neighboring clone content for free.
    let startX = 0, currentX = 0, isDragging = false;
    sliderTrack.addEventListener('touchstart', (e) => {
      isDragging = true;
      startX = e.touches[0].clientX;
      sliderTrack.style.transition = 'none';
    }, { passive: true });
    sliderTrack.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      currentX = e.touches[0].clientX;
      const offset = currentX - startX;
      const percent = (offset / sliderContainer.clientWidth) * 100;
      sliderTrack.style.transform = `translate3d(calc(${-domIdx * 100}% + ${percent}%), 0, 0)`;
    }, { passive: true });
    sliderTrack.addEventListener('touchend', () => {
      if (!isDragging) return;
      isDragging = false;
      const dragDist = currentX - startX;
      const threshold = sliderContainer.clientWidth * 0.15;
      if (dragDist > threshold) {
        prev();
      } else if (dragDist < -threshold) {
        next();
      } else {
        applyTransform(domIdx, true);
      }
    }, { passive: true });
  }

  goTo(0, false);
  imgWrap.appendChild(sliderContainer);
  sidebarGalleryEl.appendChild(imgWrap);
  sidebarGalleryEl.appendChild(dotsWrap);
}

async function loadGallery(icao24, registration) {
  const token = ++galleryToken;

  // Reselecting an aircraft already resolved this session (including any
  // airport-data.com top-up and its reconstructed full-size URLs) costs no
  // network call at all.
  const cached = galleryCache.get(icao24);
  if (cached) {
    renderGallery(cached);
    return;
  }
  renderGalleryLoading();

  const planespottersPhotos = await fetchPlanespottersPhotos(icao24, registration);
  if (token !== galleryToken || selectedIcao24 !== icao24) return; // selection moved on meanwhile

  if (planespottersPhotos.length >= GALLERY_TARGET_COUNT) {
    renderGallery(planespottersPhotos);
    galleryCache.set(icao24, planespottersPhotos);
    appendAdsbdbPhotoIfReady(icao24); // in case adsbdb's fetch already landed
    return;
  }
  // Render Planespotters' (short) result immediately; airport-data.com fills
  // in below without blocking this first paint.
  renderGallery(planespottersPhotos);

  const needed = GALLERY_TARGET_COUNT - planespottersPhotos.length;
  const topUpPhotos = await fetchAirportDataPhotos(icao24, registration, needed);
  if (token !== galleryToken || selectedIcao24 !== icao24) return; // selection moved on meanwhile

  const finalPhotos = planespottersPhotos.concat(topUpPhotos);
  renderGallery(finalPhotos);
  galleryCache.set(icao24, finalPhotos);
  appendAdsbdbPhotoIfReady(icao24); // in case adsbdb's fetch already landed
}
