const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

// "eeeeee" (adsb.fi + airplanes.live only, no OpenSky): live registration
// F-UNIQ and aircraftType "BOEING 737-800", but no live country/operator/
// year at all — good for "gaps get filled / Unknown when unresolved".
// "dddddd" (OpenSky dedup winner, live originCountry "Testland", adsb.fi/
// airplanes.live-enriched registration OO-DUP) — good for "live wins".
async function selectAircraft(page, hex, markerMapName) {
  // markerMapsBySource (a page-global, see static/index.html) maps each
  // source name to its Map — bare identifiers like adsbfiMarkers aren't
  // reachable by dynamic string lookup from here, but this lookup table is.
  await page.evaluate(({ hex, markerMapName }) => {
    const marker = markerMapsBySource[markerMapName].get(hex);
    if (marker && marker._icon) marker._icon.click();
  }, { hex, markerMapName });
  await page.waitForFunction((hex) => enrichmentById.has(hex), hex);
  await page.waitForTimeout(100);
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

async function clickBadge(page, label) {
  await page.evaluate((lbl) => {
    const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === lbl);
    let node = b.nextSibling;
    while (node && !(node.nodeType === 1 && node.classList.contains('source-badge'))) node = node.nextSibling;
    node.click();
  }, label);
  await page.waitForTimeout(100);
}

test.beforeEach(async ({ page }) => {
  await mockAllSources(page); // default /api/identity/** -> all-null
});

test('dev mode off: resolved fields render plain, unresolved render "Unknown", no badges', async ({ page }) => {
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null, operator: null, registration: null,
    manufacturer: { value: 'Boeing', source: 'aircraft_type_db', confidence: 1.0 },
    model: { value: '737-800', source: 'aircraft_type_db', confidence: 1.0 },
    year_built: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).toContain('Manufacturer');
  expect(sidebarText).toContain('Boeing');
  expect(sidebarText).toContain('737-800');
  expect(sidebarText).toContain('Operator: Unknown');
  expect(sidebarText).toContain('Country: Unknown');
  expect(sidebarText).toContain('Year built: Unknown');

  const badgeCount = await page.evaluate(() => document.querySelectorAll('#sidebar-details .source-badge').length);
  expect(badgeCount).toBe(0);
});

test('dev mode on: a Flywme badge shows the computation technique and confidence in its tooltip', async ({ page }) => {
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null,
    operator: { value: 'Some Operator', source: 'callsign_decode', confidence: 0.8 },
    registration: null, manufacturer: null, model: null, year_built: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#toggle-dev-mode');
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  expect(await badgeSourcesForLabel(page, 'Operator:')).toEqual(['flywme']);

  await clickBadge(page, 'Operator:');
  expect(await page.textContent('#source-tooltip')).toBe('Flywme — computed from callsign decode, confidence 0.8');
});

test('live values are never overwritten by enrichment, even a contradicting one', async ({ page }) => {
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: { value: 'Decoyland', source: 'registration_prefix', confidence: 1.0 },
    operator: null,
    registration: { value: 'X-DECOY', source: 'icao24_lookup', confidence: 1.0 },
    manufacturer: null, model: null, year_built: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#toggle-dev-mode');
  await selectAircraft(page, 'dddddd', 'opensky');

  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).toContain('Testland');
  expect(sidebarText).toContain('OO-DUP');
  expect(sidebarText).not.toContain('Decoyland');
  expect(sidebarText).not.toContain('X-DECOY');

  // No Flywme badge appended alongside the live source's own badge.
  expect(await badgeSourcesForLabel(page, 'Country:')).toEqual(['opensky']);
});

test('Registration is excluded from the Unknown-treatment: hidden/shown by the normal rule, not forced', async ({ page }) => {
  // Default all-null identity mock from beforeEach/mockAllSources.
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).toContain('Country: Unknown');
  expect(sidebarText).toContain('Operator: Unknown');
  expect(sidebarText).toContain('Manufacturer: Unknown');
  expect(sidebarText).toContain('Model: Unknown');
  expect(sidebarText).toContain('Year built: Unknown');
  // Registration has a live value here, so it renders normally (not "Unknown").
  expect(sidebarText).toContain('F-UNIQ');
  expect(sidebarText).not.toContain('Registration: Unknown');
});
