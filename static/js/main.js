// --- Dev-mode "all aircraft" table ---
const devAircraftPanel = document.getElementById('dev-aircraft-panel');
const devAircraftTbody = document.getElementById('dev-aircraft-tbody');
const devAircraftCountEl = document.getElementById('dev-aircraft-count');
const devIdentityStatsEl = document.getElementById('dev-identity-stats');

// Dev-mode-only diagnostic for the persistent identity cache (app.py's
// _identity_cache/_identity_history — see CLAUDE.md's "adsbdb.com"
// section): how many aircraft it has ever resolved, and how many field
// changes it has logged, across the process's whole lifetime (not just
// what's currently on screen — unlike the aircraft table above, this
// number can only grow). Refreshed alongside that table (poll end + the
// dev-mode toggle switching on) rather than on its own timer.
function refreshIdentityStats() {
  fetch('/api/identity/stats')
    .then((resp) => resp.json())
    .then((stats) => {
      devIdentityStatsEl.textContent =
        'Identity cache: ' + stats.identity_count + ' aircraft · '
        + stats.history_count + ' changes logged';
    })
    .catch(() => {});
}

// A compact, narrow, vertically-scrolling list of every aircraft currently
// on the map (any enabled source), refreshed alongside the HUD counts each
// poll while dev mode is on — a tall column rather than a short wide bar,
// so many single-line rows are visible at once. Shows the same
// Identity-group fields the sidebar does, including Route, via the same
// buildMergedDetails() merge a click would use — but reads only
// already-cached adsbdb/Flywme data rather than triggering new fetches for
// every visible aircraft (lazy-on-click stays lazy; a row for an aircraft
// never clicked this session just shows its live-only fields, same as the
// sidebar would before that click). Built from each enabled source's own
// marker map (not detailsById directly), since detailsById entries are
// never removed for aircraft that left the map/a disabled source, while
// marker maps are — so this only ever lists what's actually visible now.
// Only the 5 narrowest/most-scannable fields get their own column (ICAO,
// Callsign, Registration, Type, Route); Operator/Country/Category are
// still there, just folded into the row's `title` tooltip rather than
// widening the panel — the point of this view is a quick scan + click to
// drill into the full sidebar, not replacing it.
function renderDevAircraftTable() {
  const rows = [];
  for (const name of Object.keys(sourceToggles)) {
    if (!isSourceEnabled(name)) continue;
    for (const id of markerMapsBySource[name].keys()) {
      rows.push({ id, info: buildMergedDetails(id).info });
    }
  }
  devAircraftCountEl.textContent = rows.length + ' aircraft';
  devAircraftTbody.innerHTML = '';
  for (const { id, info } of rows) {
    const tr = document.createElement('tr');
    const route = info.originAirport && info.destinationAirport
      ? info.originAirport + ' → ' + info.destinationAirport
      : '';
    // FlightAware aircraft carry no icao24 (flight-centric, not
    // transponder-centric) — fall back to their own id (fa_flight_id) so
    // the row still has something identifying in that column.
    const icao = info.icao24 ? info.icao24.toUpperCase() : id;
    const title = [
      info.operator ? 'Operator: ' + info.operator : null,
      info.operatorCountry ? 'Operator Country: ' + info.operatorCountry : null,
      info.originCountry ? 'Registration Country: ' + info.originCountry : null,
      info.categoryDisplay ? 'Category: ' + info.categoryDisplay : null,
    ].filter(Boolean).join(' | ');
    const cells = [icao, info.callsign || '', info.registration || '', info.aircraftType || '', route];
    for (const value of cells) {
      const td = document.createElement('td');
      td.textContent = value;
      if (title) td.title = title;
      tr.appendChild(td);
    }
    tr.addEventListener('click', () => selectAircraft(id));
    devAircraftTbody.appendChild(tr);
  }
}

// --- Polling ---

for (const name of Object.keys(sourceToggles)) {
  sourceToggles[name].addEventListener('change', () => {
    if (!sourceToggles[name].checked) {
      clearAllMarkers(markerMapsBySource[name]);
      if (name === 'opensky') {
        // Quota line and any pending warning describe a source that's no
        // longer being polled — don't leave them frozen on screen.
        document.getElementById('quota').textContent = '';
        openskyStatusMessage = null;
      }
    } else {
      showSourceCountSpinner(name);
    }
    // Disabled for the duration of the poll it triggers, so a second click
    // mid-flight can't fire an overlapping request; updateCounts() (below)
    // is what re-enables it once that poll lands.
    sourceToggles[name].disabled = true;
    poll(); // refresh right away instead of waiting for the next 12s tick
  });
}

function handleHideJunkToggleChange() {
  hideJunkToggle.disabled = true;
  document.getElementById('hide-junk-spinner').hidden = false;
  poll().finally(() => {
    hideJunkToggle.disabled = false;
    document.getElementById('hide-junk-spinner').hidden = true;
  });
}
hideJunkToggle.addEventListener('change', handleHideJunkToggleChange);

uniformColorToggle.addEventListener('change', () => {
  syncUniformColorBodyClass();
  poll();
});

// Shown from the moment a source is enabled until the poll it triggers lands.
// No "pending" state is tracked: updateCounts() runs at the end of every poll
// and rewrites the slot, which is what clears the spinner — including when the
// source failed and its real count turns out to be 0.
function showSourceCountSpinner(name) {
  const el = document.getElementById('count-' + name);
  el.textContent = ''; // drops any previous number or spinner
  el.classList.add('loading');
  const spinner = document.createElement('span');
  spinner.className = 'count-spinner';
  el.appendChild(spinner);
}

function updateCounts(counts) {
  let total = 0;
  for (const name of Object.keys(sourceToggles)) {
    const enabled = isSourceEnabled(name);
    const n = enabled ? (counts[name] || 0) : 0;
    total += n;
    const el = document.getElementById('count-' + name);
    el.classList.remove('loading');
    el.textContent = enabled ? String(n) : ''; // also removes the spinner child
    // Re-enable the toggle now that the poll it triggered has landed — except
    // OpenSky while its own quota lockout holds the toggle disabled for an
    // unrelated reason (applyOpenSkyQuotaLockout()); this poll may have been
    // triggered by a completely different control, so it must not clobber that.
    if (name !== 'opensky' || !openskyQuotaLock) sourceToggles[name].disabled = false;
  }
  document.getElementById('count').textContent = total;
}

// Fetches raw data only (no rendering) — rendering is deferred until all
// sources have arrived, since OpenSky's popup enrichment needs adsb.fi/
// airplanes.live's parsed data, and their dedup needs OpenSky's (and each
// other's) rendered marker sets.
// OpenSky's warning states are stashed here rather than written to #status
// directly: poll() owns that line (it must keep ticking with OpenSky off,
// the default) and shows this message instead of "updated" when set.
let openskyStatusMessage = null;

// A single stalled upstream (observed: adsb.lol occasionally hanging for tens
// of seconds) must never block the other sources or leave the app on the
// loading state forever. fetch() has no built-in timeout, so bound every source
// request with an AbortController — a source that doesn't answer in time is
// treated as failed (null), exactly like an error, and the rest render anyway.
const SOURCE_FETCH_TIMEOUT_MS = 8000; // under POLL_INTERVAL_MS so polls never overlap on a hang
async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// --- OpenSky daily-quota lockout ---------------------------------------------
// When OpenSky's daily quota is fully spent it stops being useful (every
// request just 429s and re-serves stale cache), so auto-disable the source:
// uncheck AND disable its toggle so it can't be turned back on while dead,
// clear its markers/quota line, and reveal a "(?)" whose tooltip says why and
// when it returns — mirroring the track endpoint's "available in Xh Ym Zs". A
// 1s ticker keeps the countdown live and auto-restores the source the moment
// the reset time passes (we're not polling OpenSky while locked, so this timer
// is the only thing that can lift the lock).
let openskyQuotaLock = null;   // { resetAt: ms, precise: bool } while locked
let openskyQuotaTimer = null;

function nextUtcMidnight() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
}

function refreshOpenSkyQuotaHelp() {
  if (!openskyQuotaLock) return;
  const secs = Math.max(0, Math.round((openskyQuotaLock.resetAt - Date.now()) / 1000));
  const when = openskyQuotaLock.precise
    ? 'available in ' + formatRetryTime(secs)
    : 'available after the daily quota resets';
  document.getElementById('opensky-help-popover').textContent =
    'OpenSky auto-disabled: daily map-data quota exhausted (' + when + '). '
    + 'The historical-track quota is separate and tracked per aircraft.';
}

// Split into short labeled sections rather than one long paragraph — this
// popover has grown a lot as dev mode gained more sub-features, and a wall
// of run-on text stopped being scannable at a glance.
function refreshDevModeHelp() {
  document.getElementById('dev-mode-help-popover').innerHTML =
    '<b>Sidebar fields:</b> shows every field, even ones normally hidden '
    + 'for being empty (shown as —). A colored dot on a populated field '
    + 'names its source — click the dot to see it.'
    + '<br><br><b>Enrichment order:</b> OpenSky’s own fields (position, speed, '
    + 'squawk, etc.) always win when OpenSky is on; gaps are filled from '
    + 'whichever adsb.fi/adsb.lol/adsb.one/airplanes.live response has that '
    + 'aircraft (highest-priority match wins); FlightAware’s route is merged '
    + 'in separately by matching callsigns, not ICAO24.'
    + '<br><br><b>All aircraft table:</b> a scrollable list of every aircraft '
    + 'currently on the map — click a row to open its sidebar.'
    + '<br><br><b>adsbdb.com toggle:</b> appears only here — a lazy per-click '
    + 'lookup source with no map markers/count of its own.'
    + '<br><br><b>Identity cache:</b> counts in the aircraft-table header show '
    + 'how many aircraft this server has ever resolved via adsbdb, and how '
    + 'many field changes (e.g. a registration change) it has logged — '
    + 'persists across restarts, grows over the process’s whole lifetime.';
}

function refreshWeatherPrecipHelp() {
  document.getElementById('weather-precip-help-popover').textContent =
    'Live precipitation radar composite from RainViewer, updated every ~10 minutes. '
    + 'Shows recent rain patterns. Note: RainViewer\'s native tiles stop at zoom 7; '
    + 'higher zoom levels display an upscaled view.';
}

function refreshWeatherForecastHelp() {
  document.getElementById('weather-forecast-help-popover').textContent =
    'Short-range precipitation forecast (nowcast) from RainViewer, typically valid '
    + 'for 0–2 hours ahead. Not always published by RainViewer; this layer may appear '
    + 'empty on occasion.';
}

function refreshWeatherSigmetHelp() {
  document.getElementById('weather-sigmet-help-popover').textContent =
    'Significant weather hazards for aviation: icing, turbulence, convective activity, '
    + 'volcanic ash, and IFR/mountain obscuration. Polygons are colored by hazard type '
    + '(red = convection, orange = turbulence, blue = icing, purple = IFR/obscuration, '
    + 'gray = ash). Sourced from aviationweather.gov, updated every ~5 minutes.';
}

function refreshWeatherMetarHelp() {
  document.getElementById('weather-metar-help-popover').textContent =
    'Airport weather station observations: wind, visibility, ceiling, and flight category. '
    + 'Circles are colored by category (green = VFR, blue = MVFR, red = IFR, magenta = LIFR). '
    + 'Click a station for the raw METAR text. Sourced from aviationweather.gov, updated hourly.';
}

function refreshAirportsHelp() {
  document.getElementById('airports-help-popover').textContent =
    'Every airport worldwide (large/medium/small airports, heliports, seaplane bases), '
    + 'from OurAirports (public domain, updated nightly). Closed airports are hidden. '
    + 'Only airports in the current map view are loaded — pan or zoom to see a different '
    + 'area\'s airports. Nearby markers cluster into a numbered bubble at low zoom; click '
    + 'a marker for its name, codes, and elevation.';
}

function refreshSignalTypeHelp() {
  document.getElementById('signal-type-help-popover').textContent =
    'ADS-R is a ground-station rebroadcast of ADS-B signals, which includes UAT traffic. '
    + 'Unknown covers aircraft from sources that report neither a signal type nor a recognized position source. '
    + 'Aircraft without a signal type are always shown unless this filter is used.';
}

function refreshDarkModeHelp() {
  document.getElementById('theme-mode-help-popover').textContent =
    'Starts from your system\'s light/dark preference. Switching it also matches the basemap '
    + '(Dark ↔ CARTO Dark tiles, Light ↔ Voyager) and the uniform marker color to whichever '
    + 'contrasts best. Like every other display setting here, your choice only lasts this session.';
}

// A "(?)" icon is click-to-toggle (works on touch, unlike a hover title): it
// opens a small popover explaining a source/track quota state, and a click
// anywhere else closes it — same pattern as the category dropdown. Both the
// OpenSky lockout and the track status use this, so the two quota stories are
// told identically. `refresh` repaints the text just before opening, which is
// what keeps a countdown correct even if the popover sat closed for minutes.
const helpPopovers = [];
function wireHelpPopover(btnId, popoverId, refresh) {
  const popover = document.getElementById(popoverId);
  helpPopovers.push(popover);
  document.getElementById(btnId).addEventListener('click', (e) => {
    e.stopPropagation();
    const wasHidden = popover.hasAttribute('hidden');
    closeHelpPopovers(); // only ever one open at a time
    if (wasHidden) {
      refresh();
      popover.removeAttribute('hidden');
    }
  });
}
function closeHelpPopovers() {
  for (const p of helpPopovers) p.setAttribute('hidden', '');
}
wireHelpPopover('opensky-help', 'opensky-help-popover', refreshOpenSkyQuotaHelp);
wireHelpPopover('track-help', 'track-help-popover', refreshTrackHelp);
wireHelpPopover('dev-mode-help', 'dev-mode-help-popover', refreshDevModeHelp);
wireHelpPopover('weather-precip-help', 'weather-precip-help-popover', refreshWeatherPrecipHelp);
wireHelpPopover('weather-forecast-help', 'weather-forecast-help-popover', refreshWeatherForecastHelp);
wireHelpPopover('weather-sigmet-help', 'weather-sigmet-help-popover', refreshWeatherSigmetHelp);
wireHelpPopover('weather-metar-help', 'weather-metar-help-popover', refreshWeatherMetarHelp);
wireHelpPopover('airports-help', 'airports-help-popover', refreshAirportsHelp);
wireHelpPopover('signal-type-help', 'signal-type-help-popover', refreshSignalTypeHelp);
wireHelpPopover('theme-mode-help', 'theme-mode-help-popover', refreshDarkModeHelp);
document.addEventListener('click', closeHelpPopovers);

// Dev-mode source badges (.source-badge) are freshly regenerated HTML every
// time sidebarDetailsEl.innerHTML is rewritten (each render), so a
// wireHelpPopover-style listener attached directly to a badge would be
// destroyed on the next render. Event delegation on the stable
// sidebarDetailsEl container, plus a single shared tooltip element
// repositioned per click, avoids that — kept as its own listener rather
// than folded into helpPopovers/closeHelpPopovers, since that mechanism is
// built for a fixed set of statically-known popovers, not one dynamic,
// differently-positioned tooltip.
// One shared click-to-toggle tooltip element for every small inline
// "there's more info here" trigger in the sidebar: dev-mode source badges
// (.source-badge — which source supplied a field) and general explanatory
// triggers (.info-tip — the Category row's category description, the
// route confidence badge's score breakdown). One consistent tooltip
// pattern app-wide rather than a bespoke one per feature. Delegated on
// #sidebar itself (not just #sidebar-details) so it also covers the
// header and route card, which live in their own sibling containers.
const sourceTooltipEl = document.getElementById('source-tooltip');
sidebarEl.addEventListener('click', (e) => {
  const badge = e.target.closest('.source-badge, .info-tip');
  if (!badge) { sourceTooltipEl.setAttribute('hidden', ''); return; }
  e.stopPropagation();
  if (badge.classList.contains('source-badge')) {
    sourceTooltipEl.textContent = SOURCE_DISPLAY_NAMES[badge.dataset.source] || badge.dataset.source;
    if (badge.dataset.detail) sourceTooltipEl.textContent += ' — ' + badge.dataset.detail;
  } else {
    // .info-tip: data-detail is already the complete message, no
    // source-name prefix needed.
    sourceTooltipEl.textContent = badge.dataset.detail;
  }
  const r = badge.getBoundingClientRect();
  sourceTooltipEl.style.left = (r.left + window.scrollX) + 'px';
  sourceTooltipEl.style.top = (r.bottom + window.scrollY + 6) + 'px';
  sourceTooltipEl.removeAttribute('hidden');
});
document.addEventListener('click', () => sourceTooltipEl.setAttribute('hidden', ''));

function tickOpenSkyQuota() {
  if (!openskyQuotaLock) { clearInterval(openskyQuotaTimer); openskyQuotaTimer = null; return; }
  if (Date.now() >= openskyQuotaLock.resetAt) clearOpenSkyQuotaLockout();
  else refreshOpenSkyQuotaHelp();
}

function applyOpenSkyQuotaLockout(retryAfterSeconds) {
  const resetAt = retryAfterSeconds != null
    ? Date.now() + retryAfterSeconds * 1000
    : nextUtcMidnight();
  openskyQuotaLock = { resetAt, precise: retryAfterSeconds != null };

  const toggle = sourceToggles.opensky;
  toggle.checked = false;
  toggle.disabled = true;
  clearAllMarkers(openskyMarkers);
  document.getElementById('quota').textContent = '';
  openskyStatusMessage = null;
  document.getElementById('source-opensky').classList.add('locked');
  document.getElementById('opensky-help').style.display = '';
  refreshOpenSkyQuotaHelp();
  if (!openskyQuotaTimer) openskyQuotaTimer = setInterval(tickOpenSkyQuota, 1000);
}

function clearOpenSkyQuotaLockout() {
  if (!openskyQuotaLock) return;
  openskyQuotaLock = null;
  if (openskyQuotaTimer) { clearInterval(openskyQuotaTimer); openskyQuotaTimer = null; }
  const toggle = sourceToggles.opensky;
  toggle.disabled = false;
  toggle.checked = true;
  document.getElementById('source-opensky').classList.remove('locked');
  document.getElementById('opensky-help').style.display = 'none';
  document.getElementById('opensky-help-popover').setAttribute('hidden', '');
  showSourceCountSpinner('opensky'); // re-enabled, numbers pending — as if toggled on
  poll(); // resume immediately now that the quota window should have reset
}

async function fetchOpenSkyStates() {
  const quotaEl = document.getElementById('quota');
  try {
    const data = await fetchJson('/api/states');

    // Daily quota gone (429 rate-limited, or the last 200 hit zero remaining):
    // lock the source out instead of polling a bucket that only returns stale.
    if (data.error === 'rate_limited' || data.rate_limit_remaining === 0) {
      applyOpenSkyQuotaLockout(data.retry_after_seconds != null ? data.retry_after_seconds : null);
      return null;
    }

    if (data.stale) {
      openskyStatusMessage = 'OpenSky: unreachable, showing stale data';
    } else {
      openskyStatusMessage = null;
    }

    // Remaining daily OpenSky quota (X-Rate-Limit-Remaining header, forwarded
    // by the backend as rate_limit_remaining).
    quotaEl.textContent = data.rate_limit_remaining != null
      ? 'requests left: ' + data.rate_limit_remaining
      : '';

    return data.states || [];
  } catch (e) {
    openskyStatusMessage = 'OpenSky: failed to load data';
    return null; // signals failure — keep whatever markers are already shown
  }
}

async function fetchRadiusSourceAircraft(endpoint) {
  try {
    const data = await fetchJson(endpoint);
    return data.ac || [];
  } catch (e) {
    return null;
  }
}

async function fetchFlightAwareFlights() {
  try {
    const data = await fetchJson('/api/flightaware');
    return data.flights || [];
  } catch (e) {
    return null;
  }
}

async function fetchFlightRadar24Flights() {
  try {
    const data = await fetchJson('/api/flightradar24');
    return data.flights || [];
  } catch (e) {
    return null;
  }
}

async function poll() {
  const [openskyStates, adsbfiAircraft, adsblolAircraft, adsboneAircraft, airplanesliveAircraft, flightawareFlights, flightradar24Flights] =
    await Promise.all([
      isSourceEnabled('opensky') ? fetchOpenSkyStates() : Promise.resolve(null),
      isSourceEnabled('adsbfi') ? fetchRadiusSourceAircraft('/api/adsbfi') : Promise.resolve(null),
      isSourceEnabled('adsblol') ? fetchRadiusSourceAircraft('/api/adsblol') : Promise.resolve(null),
      isSourceEnabled('adsbone') ? fetchRadiusSourceAircraft('/api/adsbone') : Promise.resolve(null),
      isSourceEnabled('airplaneslive') ? fetchRadiusSourceAircraft('/api/airplaneslive') : Promise.resolve(null),
      isSourceEnabled('flightaware') ? fetchFlightAwareFlights() : Promise.resolve(null),
      isSourceEnabled('flightradar24') ? fetchFlightRadar24Flights() : Promise.resolve(null),
    ]);

  // Each source fetches independently: fetchRadiusSourceAircraft swallows its
  // own failure into null, so one source erroring out (e.g. adsb.one's
  // Cloudflare block) never blocks the others from rendering this cycle.
  // Parse every source exactly once here; everything below (live trails,
  // radiusRecordsByHex, the update*Markers renderers) works on these parsed
  // lists. null (source disabled or failed) stays null — distinct from an
  // empty list, which means "polled fine, zero aircraft".
  const parsedStates = openskyStates && openskyStates.map(parseOpenSkyState);
  const parsedAdsbfi = adsbfiAircraft && adsbfiAircraft.map(parseAdsbExchangeAircraft);
  const parsedAdsblol = adsblolAircraft && adsblolAircraft.map(parseAdsbExchangeAircraft);
  const parsedAdsbone = adsboneAircraft && adsboneAircraft.map(parseAdsbExchangeAircraft);
  const parsedAirplaneslive = airplanesliveAircraft && airplanesliveAircraft.map(parseAdsbExchangeAircraft);
  const parsedFlights = flightawareFlights && flightawareFlights.map(parseFlightAware);
  const parsedFlightradar24 = flightradar24Flights && flightradar24Flights.map(parseFlightRadar24Aircraft);
  const radiusLists = [parsedAdsbfi, parsedAdsblol, parsedAdsbone, parsedAirplaneslive, parsedFlightradar24];
  recordLiveTrails(parsedStates, radiusLists);

  // The generic "updated" timestamp lives here, not in fetchOpenSkyStates()
  // — an OpenSky warning (rate limit/stale/unreachable) takes its place for
  // that cycle when the source is enabled and struggling.
  if (isSourceEnabled('opensky') && openskyStatusMessage) {
    document.getElementById('status').textContent = openskyStatusMessage;
  } else if (parsedStates || radiusLists.some((l) => l)) {
    document.getElementById('status').textContent =
      'updated ' + new Date().toLocaleTimeString('en-GB');
  }

  // FlightAware enrichment lookup: callsign → {originAirport, destinationAirport}.
  // Used to enrich matching aircraft from other sources and to suppress
  // FlightAware's own marker when a match is found.
  const flightawareByCallsign = new Map();
  const matchedFlightawareCallsigns = new Set();
  if (parsedFlights) {
    for (const f of parsedFlights) {
      const key = normalizeCallsignKey(f.callsign);
      if (key) flightawareByCallsign.set(key, f);
    }
  }

  // Enrichment lookup for OpenSky's sidebar, and dev mode's per-field
  // provenance: when several radius sources have the same aircraft, the
  // higher-priority one's value wins for display (iterating lowest→highest
  // priority, so the highest is pushed last — array[length-1] is that
  // winner, consistent with the marker dedup order below), but EVERY
  // source that reported the aircraft is kept, not just the winner, so dev
  // mode can show a badge per source that independently supplied a field.
  // Both this loop's order and the exclude-chain's order below are derived
  // from the single RADIUS_SOURCE_PRIORITY array (constants.js) rather than
  // two separately hand-written, mirrored lists.
  const parsedByRadiusSource = {
    adsbfi: parsedAdsbfi, adsblol: parsedAdsblol, adsbone: parsedAdsbone,
    airplaneslive: parsedAirplaneslive, flightradar24: parsedFlightradar24,
  };
  const radiusRecordsByHex = new Map(); // icao24 -> Array<{ source, data }>
  for (const name of [...RADIUS_SOURCE_PRIORITY].reverse()) {
    const list = parsedByRadiusSource[name];
    if (!list) continue;
    for (const a of list) {
      if (!a.icao24) continue;
      const arr = radiusRecordsByHex.get(a.icao24) || [];
      arr.push({ source: name, data: a });
      radiusRecordsByHex.set(a.icao24, arr);
    }
  }

  // Render priority: OpenSky > adsb.fi > adsb.lol > adsb.one > airplanes.live.
  // Each later source only contributes aircraft no earlier source covers — its
  // exclude set is the union of every higher-priority source's rendered keys.
  let openskyCount = openskyMarkers.size;
  if (isSourceEnabled('opensky') && parsedStates) {
    openskyCount = updateOpenSkyMarkers(parsedStates, radiusRecordsByHex, flightawareByCallsign, matchedFlightawareCallsigns);
  }

  const counts = { opensky: openskyCount };
  // Order derived from RADIUS_SOURCE_PRIORITY (minus flightradar24, which
  // uses its own update function below rather than this generic loop) —
  // see the radiusRecordsByHex comment above for why both share one list.
  const radiusMarkerMaps = {
    adsbfi: adsbfiMarkers, adsblol: adsblolMarkers,
    adsbone: adsboneMarkers, airplaneslive: airplanesliveMarkers,
  };
  const radiusSources = RADIUS_SOURCE_PRIORITY
    .filter((name) => name !== 'flightradar24')
    .map((name) => [name, radiusMarkerMaps[name], parsedByRadiusSource[name]]);
  const excludeIds = new Set(openskyMarkers.keys());
  for (const [name, markerMap, aircraft] of radiusSources) {
    if (isSourceEnabled(name) && aircraft) {
      counts[name] = updateRadiusSourceMarkers(markerMap, aircraft, excludeIds, SOURCE_COLORS[name], name, flightawareByCallsign, matchedFlightawareCallsigns, radiusRecordsByHex);
    } else {
      counts[name] = markerMap.size;
    }
    // Later sources must not re-render what this one just claimed.
    for (const key of markerMap.keys()) excludeIds.add(key);
  }

  // FlightRadar24 renders last among the ICAO24-keyed sources — only what
  // OpenSky/adsb.fi/adsb.lol/adsb.one/airplanes.live don't already cover.
  // This is its own code block rather than folded into the radiusSources
  // loop above (it uses a different update function), but its position here
  // must stay last, matching RADIUS_SOURCE_PRIORITY's own last entry.
  // See CLAUDE.md for why this unofficial, best-effort source never outranks
  // any of the established free ones.
  if (isSourceEnabled('flightradar24') && parsedFlightradar24) {
    counts.flightradar24 = updateFlightRadar24Markers(parsedFlightradar24, excludeIds, radiusRecordsByHex);
  } else {
    counts.flightradar24 = flightradar24Markers.size;
  }
  for (const key of flightradar24Markers.keys()) excludeIds.add(key);

  // FlightAware: after OpenSky/radius sources, render only those flights that
  // weren't matched to another source's callsign (matched ones had their data
  // merged into the other source's sidebar).
  if (isSourceEnabled('flightaware') && parsedFlights) {
    counts.flightaware = updateFlightAwareMarkers(parsedFlights, matchedFlightawareCallsigns);
  } else {
    counts.flightaware = flightawareMarkers.size;
  }

  updateCounts(counts);
  if (currentDevMode) { renderDevAircraftTable(); refreshIdentityStats(); }

  // Deselect only if the aircraft genuinely disappeared from every source this
  // poll. Don't deselect if a single source's own stale-marker sweep removed it
  // — that's a cross-source handoff (e.g. OpenSky now claims it instead of
  // adsb.fi), not a real disappearance. Must happen after all seven sources
  // have rendered so we can check the union of all marker maps.
  if (selectedIcao24 && !Object.values(markerMapsBySource).some((m) => m.has(selectedIcao24))) {
    deselectAircraft();
  } else if (selectedIcao24 && trackUsesLiveFallback) {
    // Do not spend OpenSky track credits every 12 seconds for an already-open
    // sidebar. When its historical endpoint is unavailable, keep the local
    // fallback path live from the positions collected by this poll instead.
    drawTrack(liveTrailById.get(selectedIcao24));
  }
}

// Aircraft search: find by ICAO24 (hex), center map, and select.
document.getElementById('aircraft-search').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const hex = e.target.value.toLowerCase().trim();
  if (!hex) return;

  for (const [source, markerMap] of Object.entries(markerMapsBySource)) {
    if (markerMap.has(hex)) {
      selectAircraft(hex);
      e.target.value = '';
      return;
    }
  }
});

// The first poll is the same "enabled, no numbers yet" state as a toggle-on,
// so the sources that ship enabled get the same spinner rather than an empty
// slot (the #map-loader overlay covers the map, not the HUD).
for (const name of Object.keys(sourceToggles)) {
  if (isSourceEnabled(name)) showSourceCountSpinner(name);
}

// Hide the initial-load overlay once the first poll resolves (data in, or all
// sources failed — either way there's nothing more to wait for).
poll().finally(() => document.getElementById('map-loader').classList.add('hidden'));
setInterval(poll, POLL_INTERVAL_MS);
