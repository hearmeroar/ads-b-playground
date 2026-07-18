// --- Sidebar (replaces the old Leaflet popup) ---
// A single persistent panel, not tied to any one marker's DOM — clicking a
// marker opens it and fills it in; clicking empty map area (or the close
// button) closes it. Keeping it as one fixed element rather than a per-marker
// popup also sidesteps the old bug class where a popup's DOM got replaced
// out from under an in-flight photo fetch: the gallery here is never rebuilt
// by a poll, only by an actual new selection.
const sidebarEl = document.getElementById('sidebar');
const sidebarDetailsEl = document.getElementById('sidebar-details');
const sidebarGalleryEl = document.getElementById('sidebar-gallery');
const sidebarCloseBtn = document.getElementById('sidebar-close');

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
  country: 'originCountry', operator: 'operator', registration: 'registration',
  manufacturer: 'manufacturer', model: 'model', year_built: 'manufactureYear',
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
    // Same "flag can attach regardless of which tier supplied the value"
    // rule as Flywme's country_iso below — adsbdb gives the ISO directly,
    // no reverse name lookup needed.
    if (aircraft.registered_owner_country_iso_name && !info.countryIso) {
      info.countryIso = aircraft.registered_owner_country_iso_name;
    }
    fillIfEmpty('originCountry', aircraft.registered_owner_country_name, 'adsbdb');
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
    if (fillIfEmpty('operator', airline.name, 'adsbdb') && airline.country_iso) {
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
  const enrichment = enrichmentById.get(icao24);
  if (enrichment) {
    for (const [beKey, feKey] of Object.entries(ENRICHMENT_FIELD_MAP)) {
      const resolved = enrichment[beKey];
      if (beKey === 'country' && resolved && resolved.country_iso && !info.countryIso) {
        info.countryIso = resolved.country_iso;
      }
      const already = info[feKey] != null && info[feKey] !== '';
      if (already || !resolved) continue;
      info[feKey] = resolved.value;
      fieldSources[feKey] = ['flywme'];
      fieldConfidence[feKey] = resolved.confidence;
      fieldComputationBasis[feKey] = resolved.source;
    }
  }
  return { info, fieldSources, fieldConfidence, fieldComputationBasis, routeValidation };
}

// Single place that (re)renders the sidebar for whichever aircraft is
// currently selected, merging in any enrichment already resolved — used by
// every render path (initial select, poll resync, unit/dev-mode toggles,
// and the enrichment fetch landing) so none of them can drift out of sync
// with each other.
function renderSelectedDetails() {
  if (selectedIcao24 == null || !detailsById.has(selectedIcao24)) return;
  const m = buildMergedDetails(selectedIcao24);
  sidebarDetailsEl.innerHTML = renderDetailsHtml(m.info, m.fieldSources, m.fieldConfidence, m.fieldComputationBasis, m.routeValidation);
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

let adsbdbFetchToken = 0; // guards against a stale response overwriting a newer selection

// icao24 -> normalized photo candidate from adsbdb's url_photo, or null once
// resolved with no photo. Kept separate from adsbdbById (the raw response)
// so appendAdsbdbPhotoIfReady() below has a simple has()/get() to check
// without re-deriving the candidate shape on every call.
const adsbdbPhotoByIcao = new Map();

// adsbdb's url_photo has no photographer field at all (unlike Planespotters/
// airport-data.com, whose terms this app otherwise always credits) — in
// practice it's almost always the very same airport-data.com photo our own
// /api/photo2 top-up already found (same numeric id in the path), so most
// of the time this never even reaches the gallery. `photoIdFromUrl` mirrors
// app.py's own _AIRPORTDATA_ID_RE so a duplicate is caught regardless of
// which of the (thumbnail vs reconstructed full-size) URL variants either
// side happens to carry.
function photoIdFromUrl(url) {
  if (!url) return null;
  const m = /(\d+)\.jpg(?:\?.*)?$/.exec(url);
  return m ? m[1] : null;
}

function galleryHasPhotoId(photos, id) {
  if (!id) return false;
  return photos.some((p) => [p.thumbnail_large && p.thumbnail_large.src, p.fallback_src, p.link]
    .some((u) => photoIdFromUrl(u) === id));
}

// Appends adsbdb's candidate photo to the *end* of the gallery — the least
// prominent slot, since this is the lowest-confidence candidate of the
// three (no photographer credit, and usually a duplicate already covered by
// a properly-attributed source) — but only when it's genuinely not already
// represented in the gallery.
function appendUniqueAdsbdbPhoto(icao24, photos) {
  const candidate = adsbdbPhotoByIcao.get(icao24);
  if (!candidate) return photos;
  const id = photoIdFromUrl(candidate.thumbnail_large.src) || photoIdFromUrl(candidate.fallback_src);
  if (galleryHasPhotoId(photos, id)) return photos;
  return photos.concat([candidate]);
}

// loadGallery() and loadAdsbdb() are independent, concurrent fetches kicked
// off together from selectAircraft() — whichever of the two finishes last
// is the one that actually performs the dedup+append+re-render, by checking
// whether the other one's cache is already populated.
function appendAdsbdbPhotoIfReady(icao24) {
  if (!adsbdbPhotoByIcao.has(icao24)) return; // adsbdb fetch hasn't landed yet
  if (!galleryCache.has(icao24)) return; // gallery hasn't landed yet either
  const current = galleryCache.get(icao24);
  const merged = appendUniqueAdsbdbPhoto(icao24, current);
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
    const photoUrl = aircraft && (aircraft.url_photo || aircraft.url_photo_thumbnail);
    adsbdbPhotoByIcao.set(icao24, photoUrl ? {
      thumbnail_large: { src: aircraft.url_photo || aircraft.url_photo_thumbnail },
      fallback_src: aircraft.url_photo ? aircraft.url_photo_thumbnail : null,
      link: aircraft.url_photo || aircraft.url_photo_thumbnail,
      photographer: 'via adsbdb.com',
    } : null);
    renderSelectedDetails();
    appendAdsbdbPhotoIfReady(icao24);
  } catch (e) {
    // Best-effort: leave adsbdbById unset so a later reselect retries.
  }
}

function selectAircraft(icao24) {
  selectedIcao24 = icao24;
  trackUsesLiveFallback = false;
  drawTrack(null); // never leave the previously selected aircraft's path visible
  loadTrack(icao24);

  const details = detailsById.get(icao24);
  if (details) renderSelectedDetails(); else sidebarDetailsEl.innerHTML = '';
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
// ICAO24 hex.
async function fetchPlanespottersPhotos(icao24, registration) {
  let photos = registration ? await fetchPhotosFrom('/api/photo', 'reg', registration) : [];
  if (!photos.length && icao24) {
    photos = await fetchPhotosFrom('/api/photo', 'hex', icao24);
  }
  return photos;
}

// airport-data.com has no registration-only lookup worth using here — it's
// always queried by ICAO24 hex (`m`), optionally hinted with the
// registration (`r`) for a more precise match per its docs. `needed` is
// "how many more slots this gallery still has", sent as `n`.
async function fetchAirportDataPhotos(icao24, registration, needed) {
  if (!icao24 || needed <= 0) return [];
  let query = '?n=' + needed;
  if (registration) query += '&reg=' + encodeURIComponent(registration);
  return fetchPhotosFrom('/api/photo2', 'hex', icao24, query);
}

function renderGalleryLoading() {
  sidebarGalleryEl.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'gallery-placeholder loading';
  const spinner = document.createElement('div');
  spinner.className = 'gallery-spinner';
  box.appendChild(spinner);
  sidebarGalleryEl.appendChild(box);
}

// Renders via DOM properties (.src/.href/.textContent), not HTML-string
// concatenation, since photographer name/link come from an external API and
// shouldn't be trusted as raw markup. Shows exactly `photos.length` slides —
// no padding to GALLERY_TARGET_COUNT with empty placeholders, and no
// carousel chrome (dots/prev/next) for a single photo, where it's pointless.
function renderGallery(photos) {
  sidebarGalleryEl.innerHTML = '';

  if (!photos.length) {
    const placeholder = document.createElement('div');
    placeholder.className = 'gallery-placeholder';
    placeholder.textContent = 'No photos found';
    sidebarGalleryEl.appendChild(placeholder);
    return;
  }

  const imgWrap = document.createElement('div');
  imgWrap.className = 'gallery-image-wrap stretch';
  const anchor = document.createElement('a');
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  const img = document.createElement('img');
  img.alt = 'Aircraft photo';
  anchor.appendChild(img);
  imgWrap.appendChild(anchor);

  const credit = document.createElement('div');
  credit.className = 'gallery-credit';
  credit.append('Photo: ');
  const creditLink = document.createElement('a');
  creditLink.target = '_blank';
  creditLink.rel = 'noopener noreferrer';
  credit.appendChild(creditLink);

  let dotsWrap = null;
  let dots = [];
  if (photos.length > 1) {
    dotsWrap = document.createElement('div');
    dotsWrap.className = 'gallery-dots';
    dots = photos.map((_, i) => {
      const dot = document.createElement('span');
      dot.className = 'gallery-dot';
      dot.addEventListener('click', () => setIndex(i));
      dotsWrap.appendChild(dot);
      return dot;
    });
  }

  function setIndex(i) {
    const index = (i + photos.length) % photos.length;
    const photo = photos[index];
    dots.forEach((dot, i2) => dot.classList.toggle('active', i2 === index));

    // Reset to "stretch" every time: a previous slide may have degraded to
    // "native" below, and that must not leak into the next real photo.
    imgWrap.classList.remove('native');
    imgWrap.classList.add('stretch');
    img.onerror = () => {
      // Only airport-data.com photos carry fallback_src (their original
      // ~200px thumbnail) — a reconstructed full-size URL that 404s
      // degrades to it, shown at native size rather than stretched (it's
      // too small to stretch without visible blur).
      if (photo.fallback_src && img.src !== photo.fallback_src) {
        imgWrap.classList.remove('stretch');
        imgWrap.classList.add('native');
        img.src = photo.fallback_src;
      }
    };
    const src = (photo.thumbnail_large && photo.thumbnail_large.src) || (photo.thumbnail && photo.thumbnail.src) || '';
    img.src = src;
    anchor.href = photo.link || '';
    creditLink.href = photo.link || '';
    creditLink.textContent = photo.photographer || 'Unknown';
  }

  // Tracks which slide is showing purely by reading back the active dot, so
  // prev/next/dots all share one source of truth without a separate index variable.
  function currentIndex() {
    const active = dots.findIndex((d) => d.classList.contains('active'));
    return active === -1 ? 0 : active;
  }

  if (photos.length > 1) {
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button'; prevBtn.className = 'gallery-nav gallery-prev'; prevBtn.textContent = '‹';
    prevBtn.addEventListener('click', () => setIndex(currentIndex() - 1));
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button'; nextBtn.className = 'gallery-nav gallery-next'; nextBtn.textContent = '›';
    nextBtn.addEventListener('click', () => setIndex(currentIndex() + 1));
    imgWrap.appendChild(prevBtn);
    imgWrap.appendChild(nextBtn);
  }

  setIndex(0);
  sidebarGalleryEl.appendChild(imgWrap);
  if (dotsWrap) sidebarGalleryEl.appendChild(dotsWrap);
  sidebarGalleryEl.appendChild(credit);
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
