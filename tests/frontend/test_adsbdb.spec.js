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
    let text = '';
    let node = b.nextSibling;
    while (node && !(node.nodeType === 1 && node.tagName === 'BR')) {
      if (node.nodeType === 3) text += node.textContent;
      node = node.nextSibling;
    }
    return text.trim();
  }, label);
}

function badgeSourcesForLabel(page, label) {
  return page.evaluate((lbl) => {
    const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === lbl);
    if (!b) return null;
    const sources = [];
    let node = b.nextSibling;
    while (node && !(node.nodeType === 1 && node.tagName === 'BR')) {
      if (node.nodeType === 1 && node.classList.contains('source-badge')) sources.push(node.dataset.source);
      node = node.nextSibling;
    }
    return sources;
  }, label);
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

test('adsbdb fills Registered Owner, Operator and Route when the live feed has none of them', async ({ page }) => {
  await page.route('**/api/adsbdb/**', (route) => route.fulfill({ json: {
    aircraft: AIRCRAFT_UNIQUE, flightroute: FLIGHTROUTE,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#toggle-dev-mode');
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  expect(await rowText(page, 'Registered Owner:')).toBe('Falcon Landing LLC');
  expect(await rowText(page, 'Operator:')).toBe('Unique Air');
  expect(await rowText(page, 'Route:')).toBe('London Heathrow Airport (LHR) → Hamad International Airport (DOH)');

  expect(await badgeSourcesForLabel(page, 'Registered Owner:')).toEqual(['adsbdb']);
  expect(await badgeSourcesForLabel(page, 'Operator:')).toEqual(['adsbdb']);
  expect(await badgeSourcesForLabel(page, 'Route:')).toEqual(['adsbdb']);

  // Registration is already live (F-UNIQ from adsb.fi) — adsbdb's own
  // registration value for this aircraft must not override it.
  expect(await rowText(page, 'Registration:')).toBe('F-UNIQ');
});

test('a live registration is never overwritten by adsbdb, even a contradicting one', async ({ page }) => {
  await page.route('**/api/adsbdb/**', (route) => route.fulfill({ json: {
    aircraft: Object.assign({}, AIRCRAFT_UNIQUE, { registration: 'X-DECOY' }),
    flightroute: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#toggle-dev-mode');
  await selectAircraft(page, 'dddddd', 'opensky');

  expect(await rowText(page, 'Registration:')).toBe('OO-DUP');
  // "dddddd" is independently reported by adsb.fi and airplanes.live too
  // (see fixtures) — the point of this test is just that 'adsbdb' isn't
  // among them, since the live value must win over adsbdb's contradicting one.
  const sources = await badgeSourcesForLabel(page, 'Registration:');
  expect(sources).not.toContain('adsbdb');
  expect(sources.length).toBeGreaterThan(0);
});

test('Registered Owner shows literal "Unknown" when adsbdb has nothing, like other identity fields', async ({ page }) => {
  // Default all-null adsbdb mock from beforeEach/mockAllSources.
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).toContain('Registered Owner: Unknown');
});

test('a unique adsbdb photo is appended at the end of the gallery', async ({ page }) => {
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

  await page.waitForFunction(() => document.querySelectorAll('#sidebar-gallery .gallery-dot').length === 2);
  // First slide (index 0) must stay Planespotters' photo — adsbdb's unique
  // photo goes to the end, not ahead of an existing, properly-credited one.
  const firstCredit = await page.textContent('#sidebar-gallery .gallery-credit a');
  expect(firstCredit).toBe('Alice');
  await page.click('#sidebar-gallery .gallery-next');
  const secondCredit = await page.textContent('#sidebar-gallery .gallery-credit a');
  expect(secondCredit).toBe('via adsbdb.com');
});

test('an adsbdb photo matching an existing photo id is deduplicated, not appended', async ({ page }) => {
  await page.route('**/api/photo/**', (route) => route.fulfill({ json: { photos: [
    { thumbnail_large: { src: 'https://image.airport-data.com/aircraft/000111222.jpg' }, link: 'https://airport-data.com/x', photographer: 'Bob' },
  ] } }));
  await page.route('**/api/adsbdb/**', (route) => route.fulfill({ json: {
    aircraft: Object.assign({}, AIRCRAFT_UNIQUE, {
      // Same numeric id (000111222) as the photo already in the gallery above.
      url_photo: 'https://airport-data.com/images/aircraft/000/111/000111222.jpg',
      url_photo_thumbnail: 'https://airport-data.com/images/aircraft/thumbnails/000/111/000111222.jpg',
    }),
    flightroute: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, 'eeeeee', 'adsbfi');
  await page.waitForTimeout(300); // let both the gallery and adsbdb fetch settle

  const dotCount = await page.evaluate(() => document.querySelectorAll('#sidebar-gallery .gallery-dot').length);
  expect(dotCount).toBe(0); // still just the one (lone-photo galleries render no dots at all)
  const credit = await page.textContent('#sidebar-gallery .gallery-credit a');
  expect(credit).toBe('Bob');
});
