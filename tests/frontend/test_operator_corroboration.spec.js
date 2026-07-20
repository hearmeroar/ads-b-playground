const { test, expect } = require('@playwright/test');
const { mockAllSources, fixture } = require('./helpers');

// A callsign-decoded Operator/Operator Country whose claimed country
// conflicts with the aircraft's own ICAO24 hex-address country
// (enrich_identity()'s needs_corroboration flag) is withheld entirely in
// normal mode for rotorcraft specifically — the real reported bug: a
// Romanian rescue helicopter's "MAI" callsign (Ministerul Afacerilor
// Interne) decoding to "Mauritania Airlines International". Every other
// category still shows the value (cross-border leasing legitimately
// produces this same kind of mismatch constantly), just with extra
// dev-mode tooltip detail. "bbbbbb" (states.json) already carries OpenSky
// category 8 (rotorcraft); "dddddd" carries category 4 (large).
async function selectOpenSky(page, hex) {
  await page.evaluate((hex) => {
    const marker = openskyMarkers.get(hex);
    if (marker && marker._icon) marker._icon.click();
  }, hex);
  await page.waitForFunction((hex) => enrichmentById.has(hex), hex);
  await page.waitForTimeout(100);
}

function needsCorroborationIdentityResponse() {
  return {
    country: null,
    operator: { value: 'Mauritania Airlines International', source: 'callsign_decode', confidence: 0.8, needs_corroboration: true },
    operator_country: { value: 'Mauritania', source: 'callsign_decode', confidence: 0.6, country_iso: 'MR', needs_corroboration: true },
    registration: null, manufacturer: null, model: null, year_built: null, category: null,
  };
}

test.beforeEach(async ({ page }) => {
  await mockAllSources(page); // default /api/identity/** -> all-null
});

test('rotorcraft: an unconfirmed operator/operator_country renders as "Unknown" in normal mode', async ({ page }) => {
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: needsCorroborationIdentityResponse() }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectOpenSky(page, 'bbbbbb');

  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).toContain('Operator? Unknown');
  expect(sidebarText).toContain('Operator Country? Unknown');
  expect(sidebarText).not.toContain('Mauritania');

  const badgeCount = await page.evaluate(() => document.querySelectorAll('#sidebar-details .source-badge').length);
  expect(badgeCount).toBe(0);
});

test('rotorcraft: dev mode reveals the unconfirmed value with a warning tag', async ({ page }) => {
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: needsCorroborationIdentityResponse() }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#toggle-dev-mode');
  await selectOpenSky(page, 'bbbbbb');

  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).toContain('Mauritania Airlines International');
  expect(sidebarText).toContain('Mauritania');

  const tagCount = await page.evaluate(() => document.querySelectorAll('#sidebar-details .field-unconfirmed-tag').length);
  expect(tagCount).toBe(2); // Operator + Operator Country
  const tagText = await page.evaluate(() => document.querySelector('#sidebar-details .field-unconfirmed-tag').textContent);
  expect(tagText).toContain('Unconfirmed');
});

test('non-rotorcraft: an unconfirmed operator/operator_country still renders normally (no over-suppression)', async ({ page }) => {
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: needsCorroborationIdentityResponse() }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await selectOpenSky(page, 'dddddd');

  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).toContain('Mauritania Airlines International');
  expect(sidebarText).toContain('Mauritania');

  // No visible warning tag in normal mode for a non-rotorcraft aircraft.
  const tagCount = await page.evaluate(() => document.querySelectorAll('#sidebar-details .field-unconfirmed-tag').length);
  expect(tagCount).toBe(0);

  // Dev mode: value still shows plainly (no tag — only rotorcraft gets the
  // visible tag), but the badge tooltip carries the extra conflict detail.
  await page.click('#toggle-dev-mode');
  await page.waitForTimeout(100);
  const sidebarTextDev = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarTextDev).toContain('Mauritania Airlines International');
  const tagCountDev = await page.evaluate(() => document.querySelectorAll('#sidebar-details .field-unconfirmed-tag').length);
  expect(tagCountDev).toBe(0);

  const detailAttr = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === 'Operator');
    let node = (b.closest('.identity-label-wrap') || b).nextSibling;
    while (node && !(node.nodeType === 1 && node.tagName === 'BR')) {
      if (node.nodeType === 1 && node.classList.contains('source-badge')) return node.dataset.detail;
      node = node.nextSibling;
    }
    return null;
  });
  expect(detailAttr).toContain('unconfirmed');
});

// The wrong-photo half of the same real bug: a bare internal fleet number
// like "333" (seen on real military/government helicopters — not a real
// ICAO/FAA-format tail number) used to be sent straight to Planespotters'
// registration lookup, risking a false match. looksLikePlausibleRegistration()
// (constants.js) now gates that call on the registration containing a letter.
test('a bare numeric registration skips the reg-based photo lookup and uses the hex fallback', async ({ page }) => {
  const adsbfi = fixture('adsbfi.json');
  const row = adsbfi.ac.find((a) => a.hex === 'dddddd');
  row.r = '333';
  await page.route('**/api/adsbfi', (route) => route.fulfill({ json: adsbfi }));

  const requestedPaths = [];
  await page.route('**/api/photo/**', (route) => {
    requestedPaths.push(new URL(route.request().url()).pathname);
    route.fulfill({ json: { photos: [] } });
  });
  await page.route('**/api/photo2/**', (route) => route.fulfill({ json: { photos: [] } }));

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.evaluate(() => {
    const marker = openskyMarkers.get('dddddd');
    if (marker && marker._icon) marker._icon.click();
  });
  await page.waitForTimeout(300);

  expect(requestedPaths.some((p) => p.includes('/reg/'))).toBe(false);
  expect(requestedPaths.some((p) => p.includes('/hex/dddddd'))).toBe(true);
});
