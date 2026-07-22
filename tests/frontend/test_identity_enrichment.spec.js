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
    let node = (b.closest('.identity-label-wrap') || b).nextSibling;
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
    let node = (b.closest('.identity-label-wrap') || b).nextSibling;
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
  expect(sidebarText).toContain('Operator? Unknown');
  expect(sidebarText).toContain('Registration Country? Unknown');
  expect(sidebarText).toContain('Year built Unknown');

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

  expect(await badgeSourcesForLabel(page, 'Operator')).toEqual(['flywme']);

  await clickBadge(page, 'Operator');
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
  expect(await badgeSourcesForLabel(page, 'Registration Country')).toEqual(['opensky', 'flywme']);
  // "dddddd"'s registration is independently reported by adsb.fi and
  // airplanes.live too (see fixtures) — the point here is just that
  // 'flywme' is appended last, after whichever live sources already won.
  // Registration's badges are on #sidebar-header's title now (no <b> label).
  const regSources = await page.evaluate(() =>
    [...document.querySelectorAll('#sidebar-header .sidebar-header-title .source-badge')].map((b) => b.dataset.source));
  expect(regSources[regSources.length - 1]).toBe('flywme');
  expect(regSources.length).toBeGreaterThan(1);

  await clickBadge(page, 'Registration Country', 1);
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
    const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === 'Registration Country');
    let node = (b.closest('.identity-label-wrap') || b).nextSibling;
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
  expect(await badgeSourcesForLabel(page, 'Registration Country')).toEqual(['opensky']);
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
      let node = (b.closest('.identity-label-wrap') || b).nextSibling;
      while (node) {
        if (node.nodeType === 1 && node.classList.contains('fi')) return node.className;
        if (node.nodeType === 1 && node.tagName === 'BR') break;
        node = node.nextSibling;
      }
      return null;
    }, label);
  }

  expect(await flagClassFor('Operator')).toBe(null);
  expect(await flagClassFor('Operator Country')).toBe('fi fi-ie');
});

test('each of the four identity-row labels has a click-to-toggle tooltip disambiguating it from the other three, visible with dev mode off', async ({ page }) => {
  // Default all-null identity mock — the tooltip explains the *concept*,
  // so it must work regardless of whether the row resolved to a value or
  // "Unknown", and regardless of dev mode (unlike per-source badges).
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  async function tooltipTextFor(label) {
    // Not a toggle — each click just repositions #source-tooltip and
    // overwrites its content, so no explicit close step is needed between
    // labels (see main.js's shared click handler).
    await page.evaluate((lbl) => {
      const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === lbl);
      // The "(?)" trigger sits right after </b>, inside the same
      // .identity-label-wrap span (not a sibling of the wrapper itself).
      let node = b.nextSibling;
      while (node && !(node.nodeType === 1 && node.classList.contains('info-tip'))) node = node.nextSibling;
      node.click();
    }, label);
    return page.textContent('#source-tooltip');
  }

  expect(await tooltipTextFor('Operator')).toContain('Not necessarily who owns it');
  expect(await tooltipTextFor('Operator Country')).toContain('Not the aircraft’s own country of registration');
  expect(await tooltipTextFor('Registered Owner')).toContain('can differ from the airline actually flying it');
  expect(await tooltipTextFor('Registration Country')).toContain('not who operates or owns it');
});

test('Registration is excluded from the Unknown-treatment: it\'s the header now, not an identityRow', async ({ page }) => {
  // Default all-null identity mock from beforeEach/mockAllSources.
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).toContain('Registration Country? Unknown');
  expect(sidebarText).toContain('Operator? Unknown');
  expect(sidebarText).toContain('Manufacturer Unknown');
  expect(sidebarText).toContain('Model Unknown');
  expect(sidebarText).toContain('Year built Unknown');
  // Registration has a live value here, and lives in #sidebar-header (the
  // masthead title) rather than an identityRow — no "Unknown" treatment
  // applies to it at all any more, by construction.
  const headerText = await page.evaluate(() => document.querySelector('#sidebar-header').textContent);
  expect(headerText).toContain('F-UNIQ');
});

// --- Category fallback (enrichment/aircraft_category.py, the lowest-
// priority tier in the whole category chain — see enrich_identity()) ---

test('category fallback: Flywme fills the Category row when no live source reported one at all', async ({ page }) => {
  // "aaaaaa" appears in BOTH states.json (OpenSky, category 1=meaningless)
  // AND adsbfi.json (adsb.fi, category A1). So the live categoryDisplay
  // is actually A1 from adsb.fi, not empty.
  // To test the Flywme fallback correctly, select an aircraft that has
  // NO category from any enabled live source at all. Use "bbbbbb" in
  // states.json (OpenSky category 8=rotorcraft) but disable the radius
  // sources entirely OR use a fixture ICAO that appears nowhere in any
  // fixture except states.json with a non-meaningful category.
  // Simpler: use "aaaaaa" but verify it actually has no category from
  // radius sources first (or override the fixture to remove its adsb.fi entry
  // for this test specifically).

  // Route all /api/identity/* calls to return A3
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null, operator: null, operator_country: null, registration: null,
    manufacturer: { value: 'Boeing', source: 'aircraft_type_db', confidence: 1.0 },
    model: { value: '737 MAX 8', source: 'aircraft_type_db', confidence: 1.0 },
    year_built: null,
    category: { value: 'A3', source: 'aircraft_category_db', confidence: 0.9 },
  } }));

  // Also override adsbfi.json to remove aaaaaa so there's no live category
  await page.route('**/api/adsbfi*', (route) => route.fulfill({ json: {
    ac: [
      {
        hex: "dddddd", flight: "DUP123  ", r: "OO-DUP", t: "A320",
        alt_baro: 8000, gs: 108, track: 45, category: "A3", squawk: "3000",
        lat: 44.2, lon: 21.2, dbFlags: 0, type: "adsb_icao"
      },
      {
        hex: "eeeeee", flight: "UNIQ1   ", r: "F-UNIQ", t: "B738",
        alt_baro: 9000, gs: 97, track: 10, category: "A3", squawk: "4000",
        lat: 44.3, lon: 21.3, dbFlags: 1, type: "adsb_icao"
      },
      {
        hex: "474806", flight: null, r: "TWR", t: "TWR",
        alt_baro: "ground", gs: null, track: 0, category: "C0", squawk: null,
        lat: 44.15, lon: 21.15, dbFlags: 0, type: "adsb_icao"
      },
      {
        hex: "999999", flight: "TXLU01", r: "XYZ99", t: "TRUCK",
        alt_baro: "ground", gs: null, track: 0, category: null, squawk: null,
        lat: 44.16, lon: 21.16, dbFlags: 4, type: "adsb_icao"
      },
      {
        hex: "bbbbbb", flight: "TIS1    ", r: "N-TIS1", t: "B787",
        alt_baro: 12000, gs: 450, track: 180, category: "A3", squawk: "2000",
        lat: 44.35, lon: 21.35, dbFlags: 0, type: "tisb_icao"
      }
    ]
  } }));

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, 'aaaaaa', 'opensky');

  // Normal mode: the Category row appears showing the enrichment-derived A3
  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).toContain('A3');
  expect(sidebarText).toContain('Large');

  await page.click('#toggle-dev-mode');
  expect(await badgeSourcesForLabel(page, 'Category:')).toEqual(['flywme']);
  await clickBadge(page, 'Category:');
  expect(await page.textContent('#source-tooltip'))
    .toBe('Flywme — computed from aircraft category database, confidence 0.9');
});

test('category fallback: a live-sourced category is never overwritten, but Flywme\'s guess still co-displays', async ({ page }) => {
  // "dddddd" is OpenSky's dedup winner with a meaningful live category
  // (index 17 = 4, "large") — its own radius-source entries also report
  // "A3", so either way this aircraft already has a real live category.
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null, operator: null, operator_country: null, registration: null,
    manufacturer: null, model: null, year_built: null,
    category: { value: 'A7', source: 'aircraft_category_db', confidence: 0.9 },
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#toggle-dev-mode');
  await selectAircraft(page, 'dddddd', 'opensky');

  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).toContain('Large');
  expect(sidebarText).not.toContain('Rotorcraft');

  // "dddddd" independently reports a category on OpenSky *and* both
  // enabled radius sources (adsbfi/airplaneslive fixtures both carry "A3"
  // for this hex) — the point here is just that 'flywme' is appended last,
  // after every real live source that already reported one.
  const catSources = await badgeSourcesForLabel(page, 'Category:');
  expect(catSources[catSources.length - 1]).toBe('flywme');
  expect(catSources).toContain('opensky');
});

// --- C0-C5 surface-vehicle category tests (backend logic verified in test_enrichment.py parametrized tests) ---
// Frontend only verifies: parameter passing and UI rendering of null fields. Backend tier
// skipping/suppression is backend logic and fully tested at that layer.

test('surface-vehicle aircraft: category_code parameter is passed to enrichment endpoint', async ({ page }) => {
  // Representative test: verify frontend passes category_code to backend.
  // Backend tests (test_enrichment.py parametrized) verify what backend does with it.
  let identityFetchUrl = null;
  await page.route('**/api/identity/**', (route) => {
    identityFetchUrl = route.request().url();
    route.fulfill({ json: {
      country: null, operator: null, operator_country: null, registration: null,
      manufacturer: null, model: null, year_built: null,
    } });
  });
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  // Hex "474806" in the adsbfi fixture has category "C0"
  await selectAircraft(page, '474806', 'adsbfi');

  expect(identityFetchUrl).toContain('category_code=C0');
});

test('surface-vehicle aircraft: null enrichment fields render as dashes in dev mode', async ({ page }) => {
  // Backend returns null for heuristic tiers (suppressed). Frontend renders null as dashes in dev mode.
  // Non-dev rendering is tested via the main "dev mode off" test above (all-null → "Unknown").
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null, operator: null, operator_country: null, registration: null,
    manufacturer: null, model: null, year_built: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#toggle-dev-mode');
  await selectAircraft(page, '474806', 'adsbfi');

  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).toContain('Operator? —');  // Dev mode shows dashes for missing fields
  expect(sidebarText).toContain('Registration Country? —');

  const operatorBadges = await badgeSourcesForLabel(page, 'Operator');
  expect(operatorBadges).toEqual([]);
});
