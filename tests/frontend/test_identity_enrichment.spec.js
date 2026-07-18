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

async function clickBadge(page, label, index = 0) {
  await page.evaluate(({ lbl, index }) => {
    const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === lbl);
    let node = b.nextSibling;
    const badges = [];
    while (node && !(node.nodeType === 1 && node.tagName === 'BR')) {
      if (node.nodeType === 1 && node.classList.contains('source-badge')) badges.push(node);
      node = node.nextSibling;
    }
    badges[index].click();
  }, { lbl: label, index });
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

test('live values are never overwritten by enrichment, even a contradicting one — but Flywme\'s own guess still co-displays for transparency', async ({ page }) => {
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

  // Registration is #sidebar-header's title now; Country stays in #sidebar-details.
  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar').textContent);
  expect(sidebarText).toContain('Testland');
  expect(sidebarText).toContain('OO-DUP');
  expect(sidebarText).not.toContain('Decoyland');
  expect(sidebarText).not.toContain('X-DECOY');

  // The displayed value is still OpenSky's own — but since Flywme did
  // resolve a real (if contradicting) guess of its own, its badge
  // co-displays second, after the winning source's, reflecting the
  // priority chain rather than making the losing tier's guess disappear.
  expect(await badgeSourcesForLabel(page, 'Country:')).toEqual(['opensky', 'flywme']);
  // "dddddd"'s registration is independently reported by adsb.fi and
  // airplanes.live too (see fixtures) — the point here is just that
  // 'flywme' is appended last, after whichever live sources already won.
  // Registration's badges are on #sidebar-header's title now (no <b> label).
  const regSources = await page.evaluate(() =>
    [...document.querySelectorAll('#sidebar-header .sidebar-header-title .source-badge')].map((b) => b.dataset.source));
  expect(regSources[regSources.length - 1]).toBe('flywme');
  expect(regSources.length).toBeGreaterThan(1);

  await clickBadge(page, 'Country:', 1);
  expect(await page.textContent('#source-tooltip')).toBe('Flywme — computed from registration prefix, confidence 1.0');
});

test('a live-sourced country still gets a flag when the backend recognizes its name, without becoming a Flywme field', async ({ page }) => {
  // "dddddd"'s live country is fixture-only ("Testland", not a real
  // country), so this simulates what the real backend computes when a
  // live country's name *does* match countries.py: country_iso present
  // alongside source "live" — see enrich_identity()'s country_iso_for_name.
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: { value: 'Testland', source: 'live', confidence: 1.0, country_iso: 'CZ' },
    operator: null, registration: null, manufacturer: null, model: null, year_built: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#toggle-dev-mode');
  await selectAircraft(page, 'dddddd', 'opensky');

  const flagPresent = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === 'Country:');
    let node = b.nextSibling;
    while (node) {
      if (node.nodeType === 1 && node.classList.contains('fi')) return node.className;
      if (node.nodeType === 1 && node.tagName === 'BR') break;
      node = node.nextSibling;
    }
    return null;
  });
  expect(flagPresent).toBe('fi fi-cz');

  // Still attributed to OpenSky, not Flywme — the flag is a presentation
  // add-on, not a sign the value itself was enriched.
  expect(await badgeSourcesForLabel(page, 'Country:')).toEqual(['opensky']);
});

test('a Flywme-resolved Operator Country (via callsign_decode) fills in when adsbdb has nothing', async ({ page }) => {
  // callsign_decode's country data (the airline's home country) is its own
  // "operator_country" field now — Operator itself stays plain text, its
  // flag lives only on the dedicated Operator Country row.
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null,
    operator: { value: 'Ryanair', source: 'callsign_decode', confidence: 0.8 },
    operator_country: { value: 'Ireland', source: 'callsign_decode', confidence: 0.6, country_iso: 'IE' },
    registration: null, manufacturer: null, model: null, year_built: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  function flagClassFor(label) {
    return page.evaluate((lbl) => {
      const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === lbl);
      let node = b.nextSibling;
      while (node) {
        if (node.nodeType === 1 && node.classList.contains('fi')) return node.className;
        if (node.nodeType === 1 && node.tagName === 'BR') break;
        node = node.nextSibling;
      }
      return null;
    }, label);
  }

  expect(await flagClassFor('Operator:')).toBe(null);
  expect(await flagClassFor('Operator Country:')).toBe('fi fi-ie');
});

test('Registration is excluded from the Unknown-treatment: it\'s the header now, not an identityRow', async ({ page }) => {
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
  // Registration has a live value here, and lives in #sidebar-header (the
  // masthead title) rather than an identityRow — no "Unknown" treatment
  // applies to it at all any more, by construction.
  const headerText = await page.evaluate(() => document.querySelector('#sidebar-header').textContent);
  expect(headerText).toContain('F-UNIQ');
});
