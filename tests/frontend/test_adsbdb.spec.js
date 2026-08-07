const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

// "eeeeee" (adsb.fi/airplanes.live only): live registration F-UNIQ, callsign
// UNIQ1, but no live country/operator/route at all — good for "adsbdb fills
// the gap". "dddddd": live registration OO-DUP, callsign DUP123 — good for
// "live wins over adsbdb".
async function selectAircraft(page, hex, markerMapName) {
  await page.evaluate(({ hex, markerMapName }) => {
    const marker = markerMapsBySource[markerMapName].get(hex);
    if (marker && marker._icon) marker._icon.click();
  }, { hex, markerMapName });
  await page.waitForFunction((hex) => adsbdbById.has(hex), hex);
  await page.waitForTimeout(100);
}

function rowText(page, label) {
  return page.evaluate((lbl) => {
    const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === lbl);
    if (!b) return null;
    const row = b.closest('.detail-row');
    return (row?.querySelector('.identity-logo-name') || row?.querySelector('.detail-value'))
      ?.textContent.trim() ?? null;
  }, label);
}

function flagClassForLabel(page, label) {
  return page.evaluate((lbl) => {
    const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === lbl);
    if (!b) return null;
    const row = b.closest('.detail-row');
    const primary = row?.querySelector('.identity-logo-name') || row?.querySelector('.detail-value');
    return primary?.querySelector('.fi')?.className ?? null;
  }, label);
}

function badgeSourcesForLabel(page, label) {
  return page.evaluate((lbl) => {
    const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === lbl);
    if (!b) return null;
    const row = b.closest('.detail-row');
    const primary = row?.querySelector('.identity-logo-name') || row?.querySelector('.detail-value');
    return [...primary.querySelectorAll('.source-badge')]
      .map((badge) => badge.dataset.source);
  }, label);
}

// Operator Country and Registration Country no longer have their own
// identityRow — they're the "Country ..." secondary line inside the
// Operator/Owner tile (see identityTileRow() in
// render-details.js), found by the *primary* label's <b> instead.
function secondaryRowText(page, primaryLabel) {
  return page.evaluate((lbl) => {
    const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === lbl);
    if (!b) return null;
    const row = b.closest('.detail-row');
    return (row?.querySelector('.identity-logo-country') || row?.querySelector('.detail-value-secondary'))
      ?.textContent.trim() ?? null;
  }, primaryLabel);
}

function secondaryFlagClassForLabel(page, primaryLabel) {
  return page.evaluate((lbl) => {
    const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === lbl);
    if (!b) return null;
    const row = b.closest('.detail-row');
    const secondary = row?.querySelector('.identity-logo-country') || row?.querySelector('.detail-value-secondary');
    return secondary?.querySelector('.fi')?.className ?? null;
  }, primaryLabel);
}

function secondaryBadgeSourcesForLabel(page, primaryLabel) {
  return page.evaluate((lbl) => {
    const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === lbl);
    if (!b) return null;
    const row = b.closest('.detail-row');
    const secondary = row?.querySelector('.identity-logo-country') || row?.querySelector('.detail-value-secondary');
    return [...secondary.querySelectorAll('.source-badge')]
      .map((badge) => badge.dataset.source);
  }, primaryLabel);
}

// Registration/Callsign/Aircraft type live in #sidebar-header now (no <b>
// label wrapper — rowText can't see them there). Route is its own visual
// card (#sidebar-route), not a detailRow at all.
function headerText(page) {
  return page.evaluate(() => document.querySelector('#sidebar-header')?.textContent || '');
}
function routeCardText(page) {
  return page.evaluate(() => document.querySelector('#sidebar-route')?.textContent || '');
}
function routeCardDevBadgeSources(page) {
  return page.evaluate(() => [...document.querySelectorAll('#sidebar-route .source-badge')].map((b) => b.dataset.source));
}

const AIRCRAFT_UNIQUE = {
  type: 'Boeing 737-800', icao_type: 'B738', manufacturer: 'Boeing',
  mode_s: 'EEEEEE', registration: 'F-UNIQ',
  registered_owner_country_iso_name: 'FR', registered_owner_country_name: 'France',
  registered_owner_operator_flag_code: null, registered_owner: 'Falcon Landing LLC',
  url_photo: null, url_photo_thumbnail: null,
};

const FLIGHTROUTE = {
  callsign: 'UNIQ1', callsign_icao: 'UNIQ1', callsign_iata: 'U1',
  airline: {
    name: 'Unique Air', icao: 'UNQ', iata: 'U1', country: 'France', country_iso: 'FR', callsign: 'UNIQUE',
  },
  origin: {
    country_iso_name: 'GB', country_name: 'United Kingdom', elevation: 83, iata_code: 'LHR',
    icao_code: 'EGLL', latitude: 51.4706, longitude: -0.461941, municipality: 'London', name: 'London Heathrow Airport',
  },
  destination: {
    country_iso_name: 'QA', country_name: 'Qatar', elevation: 13, iata_code: 'DOH',
    icao_code: 'OTHH', latitude: 25.273056, longitude: 51.608056, municipality: 'Doha', name: 'Hamad International Airport',
  },
};

test.beforeEach(async ({ page }) => {
  await mockAllSources(page); // default /api/adsbdb/** -> { aircraft: null, flightroute: null }
  // /api/photo2 has no default mock in helpers.js (pre-existing gap) — mock
  // it here so this spec never touches the real airport-data.com either.
  await page.route('**/api/photo2/**', (route) => route.fulfill({ json: { photos: [] } }));
});

test('dev-mode-only toggle: hidden by default, appears (checked) once dev mode is on', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  expect(await page.isVisible('#source-adsbdb')).toBe(false);
  expect(await page.isChecked('#toggle-adsbdb')).toBe(true);

  await page.click('#toggle-dev-mode');
  expect(await page.isVisible('#source-adsbdb')).toBe(true);
  expect(await page.isChecked('#toggle-adsbdb')).toBe(true);

  await page.click('#toggle-dev-mode');
  expect(await page.isVisible('#source-adsbdb')).toBe(false);
});

test('adsbdb fills Owner, Operator and Route when the live feed has none of them', async ({ page }) => {
  await page.route('**/api/adsbdb/**', (route) => route.fulfill({ json: {
    aircraft: AIRCRAFT_UNIQUE, flightroute: FLIGHTROUTE,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#toggle-dev-mode');
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  expect(await rowText(page, 'Owner')).toBe('Falcon Landing LLC');
  expect(await rowText(page, 'Operator')).toBe('Unique Air');
  // Operator Country is adsbdb's flightroute.airline.country/country_iso —
  // now the flag+name secondary line inside the Operator tile (no "Country"
  // text label, redundant with the flag itself — see identityTileRow() in
  // render-details.js), not its own dedicated row.
  expect(await secondaryRowText(page, 'Operator')).toBe('France');
  expect(await secondaryFlagClassForLabel(page, 'Operator')).toBe('fi fi-fr');
  expect(await flagClassForLabel(page, 'Operator')).toBe(null);
  // Route is its own visual card now: big codes + small city names, not a
  // single combined "Name (CODE) → Name (CODE)" string.
  const routeText = await routeCardText(page);
  expect(routeText).toContain('LHR');
  expect(routeText).toContain('London Heathrow Airport');
  expect(routeText).toContain('DOH');
  expect(routeText).toContain('Hamad International Airport');

  expect(await badgeSourcesForLabel(page, 'Owner')).toEqual(['adsbdb']);
  expect(await badgeSourcesForLabel(page, 'Operator')).toEqual(['adsbdb']);
  expect(await secondaryBadgeSourcesForLabel(page, 'Operator')).toEqual(['adsbdb']);
  expect(await routeCardDevBadgeSources(page)).toEqual(['adsbdb']);

  expect(await secondaryRowText(page, 'Owner')).toBe('France');
  expect(await secondaryFlagClassForLabel(page, 'Owner')).toBe('fi fi-fr');
  expect(await secondaryBadgeSourcesForLabel(page, 'Owner')).toEqual(['adsbdb']);

  // Registration is already live (F-UNIQ from adsb.fi) — adsbdb's own
  // registration value for this aircraft must not override it. It's in
  // #sidebar-header now, with no <b>Registration:</b> label wrapper.
  expect(await headerText(page)).toContain('F-UNIQ');
});

test('Flywme\'s own guess co-displays alongside adsbdb when both resolve the same field', async ({ page }) => {
  await page.route('**/api/adsbdb/**', (route) => route.fulfill({ json: {
    aircraft: AIRCRAFT_UNIQUE, flightroute: FLIGHTROUTE,
  } }));
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null,
    operator: { value: 'Flywme Guessed Air', source: 'callsign_decode', confidence: 0.8 },
    registration: null, manufacturer: null, model: null, year_built: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#toggle-dev-mode');
  await selectAircraft(page, 'eeeeee', 'adsbfi');
  await page.waitForFunction(() => enrichmentById.has('eeeeee'));
  await page.waitForTimeout(100);

  // adsbdb's value is still what's displayed (higher priority)...
  expect(await rowText(page, 'Operator')).toBe('Unique Air');
  // ...but Flywme's own guess co-displays as a second badge, reflecting
  // the priority chain rather than silently disappearing.
  expect(await badgeSourcesForLabel(page, 'Operator')).toEqual(['adsbdb', 'flywme']);
});

test('a live registration is never overwritten by adsbdb, even a contradicting one', async ({ page }) => {
  await page.route('**/api/adsbdb/**', (route) => route.fulfill({ json: {
    aircraft: Object.assign({}, AIRCRAFT_UNIQUE, { registration: 'X-DECOY' }),
    flightroute: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#toggle-dev-mode');
  await selectAircraft(page, 'dddddd', 'airplaneslive');

  // Registration is the header's title now (dddddd has one), no <b> label.
  expect(await headerText(page)).toContain('OO-DUP');
  // airplanes.live owns dddddd under the current priority; adsbdb must never
  // overwrite that live value.
  const sources = await page.evaluate(() => [...document.querySelectorAll('#sidebar-header .sidebar-header-title .source-badge')].map((b) => b.dataset.source));
  expect(sources).not.toContain('adsbdb');
  expect(sources.length).toBeGreaterThan(0);
});

test('Owner hides its row entirely when adsbdb has nothing, like other identity fields in normal mode', async ({ page }) => {
  // Default all-null adsbdb mock from beforeEach/mockAllSources.
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  expect(await rowText(page, 'Owner')).toBe(null);
});

// adsbdb's url_photo consistently 404s in practice (verified live against
// api.adsbdb.com) — only url_photo_thumbnail (a genuinely tiny image, no
// photographer credit) ever resolves, so it's now shown only as an
// absolute last resort: when Planespotters + airport-data.com together
// found nothing at all, never alongside a real photo.
test('adsbdb\'s photo is never shown when a real photo already exists', async ({ page }) => {
  await page.route('**/api/photo/**', (route) => route.fulfill({ json: { photos: [
    { thumbnail_large: { src: 'https://cdn.planespotters.net/photo/1.jpg' }, link: 'https://planespotters.net/1', photographer: 'Alice' },
  ] } }));
  await page.route('**/api/adsbdb/**', (route) => route.fulfill({ json: {
    aircraft: Object.assign({}, AIRCRAFT_UNIQUE, {
      url_photo: 'https://airport-data.com/images/aircraft/000/111/000111222.jpg',
      url_photo_thumbnail: 'https://airport-data.com/images/aircraft/thumbnails/000/111/000111222.jpg',
    }),
    flightroute: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, 'eeeeee', 'adsbfi');
  await page.waitForFunction(() => adsbdbById.has('eeeeee'));
  await page.waitForTimeout(200);

  // Still just Alice's photo — no second slide, no dots (lone-photo
  // galleries render no carousel chrome at all).
  const dotCount = await page.evaluate(() => document.querySelectorAll('#sidebar-gallery .gallery-dot').length);
  expect(dotCount).toBe(0);
  const credit = await page.textContent('#sidebar-gallery .gallery-credit a');
  expect(credit).toBe('Alice');
});

test('adsbdb\'s thumbnail is shown, at native size, only when no other photo exists', async ({ page }) => {
  await page.route('**/api/photo/**', (route) => route.fulfill({ json: { photos: [] } }));
  await page.route('**/api/photo2/**', (route) => route.fulfill({ json: { photos: [] } }));
  await page.route('**/api/adsbdb/**', (route) => route.fulfill({ json: {
    aircraft: Object.assign({}, AIRCRAFT_UNIQUE, {
      url_photo: 'https://airport-data.com/images/aircraft/000/111/000111222.jpg',
      url_photo_thumbnail: 'https://airport-data.com/images/aircraft/thumbnails/000/111/000111222.jpg',
    }),
    flightroute: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, 'eeeeee', 'adsbfi');
  await page.waitForFunction(() => adsbdbById.has('eeeeee'));
  await page.waitForTimeout(200);

  const credit = await page.textContent('#sidebar-gallery .gallery-credit a');
  expect(credit).toBe('via adsbdb.com');
  const src = await page.getAttribute('#sidebar-gallery img', 'src');
  expect(src).toBe('https://airport-data.com/images/aircraft/thumbnails/000/111/000111222.jpg');
  // Rendered at native size from the start, not stretched-then-degraded.
  // The 'native'/'stretch' class lives on the per-photo .gallery-slide now
  // (the slider-track rework), not the outer .gallery-image-wrap.
  const slideClass = await page.getAttribute('#sidebar-gallery .gallery-slide', 'class');
  expect(slideClass).toContain('native');
});

// Found via a real aircraft (4X-ABS, Israir) with no live registration —
// loadIdentityEnrichment() and loadAdsbdb() are independent concurrent
// fetches, so our own registration_prefix table never saw the tail number
// adsbdb went on to resolve, and Registration Country stayed "Unknown"
// even though "4X" -> Israel was resolvable all along. See
// maybeRefetchIdentityWithAdsbdbData() in sidebar-track.js.
test('a registration adsbdb resolves (but the live feed never had) triggers a second /api/identity lookup', async ({ page }) => {
  await page.route('**/api/adsblol', (route) => route.fulfill({ json: { ac: [{
    hex: 'ab1234',
    // Deliberately no `r` (registration) and no `flight` (callsign) — the
    // live feed has nothing to identify this aircraft by.
    t: 'A320', desc: 'AIRBUS A-320', alt_baro: 9000, gs: 100, track: 90,
    category: 'A3', squawk: '5000', lat: 44.1, lon: 21.1,
  }] } }));
  await page.route('**/api/adsbdb/**', (route) => route.fulfill({ json: {
    aircraft: {
      type: 'A320 232', icao_type: 'A320', manufacturer: 'Airbus', mode_s: 'AB1234',
      registration: '4X-ABS', registered_owner_country_iso_name: null,
      registered_owner_country_name: null, registered_owner_operator_flag_code: null,
      registered_owner: null, url_photo: null, url_photo_thumbnail: null,
    },
    flightroute: null,
  } }));

  // Override the default all-null /api/identity mock with a passthrough to
  // the real backend (this app's Flask server, running enrich_identity()
  // for real, including its registration_prefix table) while recording
  // every request's query string.
  const identityRequests = [];
  await page.route('**/api/identity/**', (route) => {
    identityRequests.push(new URL(route.request().url()).search);
    route.continue();
  });

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, 'ab1234', 'adsblol');

  await page.waitForFunction(() => enrichmentById.get('ab1234')?.country?.value === 'Israel');

  expect(identityRequests.length).toBe(2);
  expect(identityRequests[0]).not.toContain('registration=');
  expect(identityRequests[1]).toContain('registration=4X-ABS');
  // Registration Country is aircraft metadata, not the registered owner's
  // country, so it must not be repurposed as Owner's secondary line.
  expect(await secondaryRowText(page, 'Owner')).toBe(null);
  expect(await secondaryFlagClassForLabel(page, 'Owner')).toBe(null);
});
