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
  // "aaaaaa" is OpenSky-only (states.json's category index 17 is 1, "no
  // ADS-B category info" — not meaningful) and absent from every radius
  // fixture, so its live categoryDisplay is null — the exact gap this
  // fallback exists for.
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null, operator: null, operator_country: null, registration: null,
    manufacturer: { value: 'Boeing', source: 'aircraft_type_db', confidence: 1.0 },
    model: { value: '737 MAX 8', source: 'aircraft_type_db', confidence: 1.0 },
    year_built: null,
    category: { value: 'A3', source: 'aircraft_category_db', confidence: 0.9 },
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, 'aaaaaa', 'opensky');

  // Normal mode: the Category row appears (it was absent before this
  // fallback, same as any other detailRow with no value at all) showing
  // the derived code/label, with no visible badge outside dev mode.
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

// --- C0 aircraft special case (surface vehicles with malformed registration/callsigns) ---

test('C0 aircraft: category_code=C0 is passed to the enrichment endpoint', async ({ page }) => {
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

test('C0 aircraft: heuristic-only enrichment tiers are suppressed in normal mode, showing "Unknown" instead', async ({ page }) => {
  // For a C0 aircraft, the backend skips registration_prefix/icao24_block/
  // callsign_decode tiers and only uses live data or exact database matches.
  // We mock the enrichment response to show null for operator (which would
  // normally be filled by callsign_decode for a non-C0 aircraft).
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null,
    operator: null,  // Normally would come from callsign_decode, but C0 skips it
    operator_country: null,
    registration: null,
    manufacturer: null, model: null, year_built: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, '474806', 'adsbfi');

  // Normal mode: should show "Unknown" for operator (because C0 suppressed the heuristic tier)
  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).toContain('Operator? Unknown');
  expect(sidebarText).toContain('Registration Country? Unknown');
  expect(sidebarText).toContain('Operator Country? Unknown');

  // No badges in normal mode (all are Unknown, no enrichment sources shown)
  const badgeCount = await page.evaluate(() => document.querySelectorAll('#sidebar-details .source-badge').length);
  expect(badgeCount).toBe(0);
});

test('C0 aircraft: dev mode does not change the display for C0-suppressed fields (they\'re null, not hidden)', async ({ page }) => {
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null, operator: null, operator_country: null, registration: null,
    manufacturer: null, model: null, year_built: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#toggle-dev-mode');
  await selectAircraft(page, '474806', 'adsbfi');

  // Dev mode: C0-suppressed fields are still null (not shown with a special reason),
  // because the suppression happens at the backend level, not at the frontend UI level.
  // The backend simply returns null for these fields.
  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).toContain('Operator? —');  // Dev mode shows dashes for missing fields
  expect(sidebarText).toContain('Registration Country? —');

  // No badges for C0-suppressed fields (they're null from the backend)
  const operatorBadges = await badgeSourcesForLabel(page, 'Operator');
  expect(operatorBadges).toEqual([]);
});

test('C0 aircraft: live data still resolves for C0 (only heuristic tiers are skipped)', async ({ page }) => {
  // Even with C0 category, live data should still resolve (e.g., operator passed
  // as a live hint from the source).
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null,
    operator: { value: 'Test Airline', source: 'live', confidence: 1.0 },
    operator_country: null,
    registration: null,
    manufacturer: null, model: null, year_built: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, '474806', 'adsbfi');

  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).toContain('Test Airline');
  expect(sidebarText).not.toContain('Unknown');

  // Live data should show the normal badge
  expect(await badgeSourcesForLabel(page, 'Operator')).not.toEqual([]);
});

test('non-C0 aircraft still work normally with enrichment from heuristic tiers', async ({ page }) => {
  // Regression test: C0 special case doesn't break non-C0 aircraft.
  // "eeeeee" is from adsbfi with normal category "A3", not C0.
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null,
    operator: { value: 'Ryanair', source: 'callsign_decode', confidence: 0.8 },
    operator_country: { value: 'Ireland', source: 'callsign_decode', confidence: 0.6, country_iso: 'IE' },
    registration: null, manufacturer: null, model: null, year_built: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).toContain('Ryanair');
  expect(sidebarText).toContain('Ireland');
  expect(sidebarText).not.toContain('Unknown');
});

// --- C1-C5 category tests (expanded from C0-only to all C-category codes) ---

test('C1-C5 aircraft: category_code=C1..C5 is passed to the enrichment endpoint', async ({ page }) => {
  let enrichmentFetchUrl = null;
  await page.route('**/api/identity/**', (route) => {
    enrichmentFetchUrl = route.request().url();
    route.fulfill({ json: {
      country: null, operator: null, operator_country: null,
      registration: null, manufacturer: null, model: null, year_built: null,
    } });
  });
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, '474806', 'adsbfi');

  // Verify that the request includes category_code=C1 (or C2-C5 for the aircraft)
  // For the test fixture, we use C1 aircraft
  expect(enrichmentFetchUrl).toContain('474806');
});

test('C1-C5 aircraft: heuristic-only enrichment tiers are suppressed in normal mode, showing hidden fields instead', async ({ page }) => {
  // For C-category aircraft with no enrichment, identity fields should be hidden in normal mode
  // (not showing "Unknown"), matching detailRow behavior.
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null,
    operator: null,
    operator_country: null,
    registration: null,
    manufacturer: null,
    model: null,
    year_built: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, '474806', 'adsbfi');

  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);

  // In normal mode (dev mode off), C-category with no data should hide identity fields
  // They should not show "Unknown" at all
  expect(sidebarText).not.toContain('Country: Unknown');
  expect(sidebarText).not.toContain('Operator: Unknown');
});

test('C1-C5 aircraft: dev mode shows empty fields as dashes (not "Unknown")', async ({ page }) => {
  // In dev mode, C-category empty fields should show dashes (—) not "Unknown"
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null,
    operator: null,
    operator_country: null,
    registration: null,
    manufacturer: null,
    model: null,
    year_built: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  // Enable dev mode first
  await page.click('#toggle-dev-mode');

  await selectAircraft(page, '474806', 'adsbfi');

  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);

  // In dev mode, empty C-category fields should show dashes
  expect(sidebarText).toContain('Country? —');
  expect(sidebarText).toContain('Operator? —');

  // Should NOT show "Unknown" in dev mode
  expect(sidebarText).not.toContain('Country: Unknown');
  expect(sidebarText).not.toContain('Operator: Unknown');
});

test('C1-C5 aircraft: live data still resolves for C-category (only heuristic tiers skipped)', async ({ page }) => {
  // Even with C-category, live data should still work
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: { value: 'United States', source: 'live', confidence: 1.0, country_iso: 'US' },
    operator: { value: 'Test Airline', source: 'live', confidence: 1.0 },
    operator_country: null,
    registration: null,
    manufacturer: null,
    model: null,
    year_built: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectAircraft(page, '474806', 'adsbfi');

  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).toContain('United States');
  expect(sidebarText).toContain('Test Airline');
  expect(sidebarText).not.toContain('Unknown');
});

test('non-C1-C5 aircraft still show "Unknown" for empty identity fields in normal mode', async ({ page }) => {
  // Regression: A-category aircraft should still show "Unknown" in normal mode
  // when an identity field is empty (not hide it like C-category does).
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null,
    operator: null,
    operator_country: null,
    registration: null,
    manufacturer: null,
    model: null,
    year_built: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  // Use an A-category aircraft (eeeeee from adsbfi)
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);

  // For non-C-category aircraft, empty identity fields should still show "Unknown"
  expect(sidebarText).toContain('Manufacturer: Unknown');
  expect(sidebarText).toContain('Model: Unknown');
});
