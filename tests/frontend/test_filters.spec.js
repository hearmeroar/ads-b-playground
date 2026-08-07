const { test, expect } = require('@playwright/test');
const { mockAllSources, colorCounts, iconClassCounts } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(500);
});

test('motion filter partitions visible OpenSky markers into air/ground correctly', async ({ page }) => {
  // Higher-priority sources own three overlapping OpenSky aircraft, leaving
  // one visible airborne marker and one visible ground marker.
  await page.click('#motion-filter .seg-btn[data-value="airborne"]');
  await page.waitForTimeout(500);
  expect((await colorCounts(page)).blue).toBe(1);

  await page.click('#motion-filter .seg-btn[data-value="ground"]');
  await page.waitForTimeout(500);
  expect((await colorCounts(page)).blue).toBe(1);

  await page.click('#motion-filter .seg-btn[data-value="all"]');
  await page.waitForTimeout(500);
  expect((await colorCounts(page)).blue).toBe(2);
});

test('category dropdown filters to an exact count', async ({ page }) => {
  await page.click('#category-filter .dropdown-trigger');
  await page.click('#category-filter .dropdown-option[data-value="rotorcraft"]');
  await page.waitForTimeout(500);

  const total = await page.evaluate(() => document.getElementById('count').textContent);
  expect(total).toBe('1'); // only "bbbbbb" (OpenSky category 8) qualifies

  await page.click('#category-filter .dropdown-trigger');
  await page.click('#category-filter .dropdown-option[data-value="all"]');
  await page.waitForTimeout(500);
  // 7 real aircraft + 2 non-aircraft entries, shown by default now that
  // "Hide non-aircraft" ships off.
  expect(await page.evaluate(() => document.getElementById('count').textContent)).toBe('9');
});

test('non-aircraft entries are shown with a tower icon by default and hidden when the filter is enabled', async ({ page }) => {
  await expect(page.locator('#motion-filter + .show-filter-option #toggle-hide-junk')).toHaveCount(1);
  await expect(page.locator('#motion-filter').locator('xpath=..').locator('.filter-title')).toContainText('Show');

  let counts = await colorCounts(page);
  expect(counts.red).toBe(5); // both junk entries shown by default
  expect(await iconClassCounts(page, 'surface-obstacle-icon')).toBe(2); // the TWR and callsign-pattern entries specifically

  await page.click('#toggle-hide-junk');
  await page.waitForTimeout(600);
  counts = await colorCounts(page);
  expect(counts.red).toBe(3); // TWR + callsign-pattern entries now hidden
  expect(await iconClassCounts(page, 'surface-obstacle-icon')).toBe(0);
});

test('an MLAT helicopter with registration and type is not classified as a ground object', async ({ page }) => {
  await page.route('**/api/adsbfi', (route) => route.fulfill({ json: { ac: [{
    hex: '406370', flight: 'PIPE65', r: 'G-CGNE', t: 'R44',
    desc: 'ROBINSON R-44 Raven', alt_baro: 700, gs: 134,
    track: 10, lat: 51.266625, lon: 1.234904, type: 'mlat',
  }] } }));

  await page.waitForFunction(() => adsbfiMarkers.has('406370'));
  const markerClasses = await page.evaluate(() =>
    adsbfiMarkers.get('406370')._icon.querySelector('.plane-icon').className
  );
  expect(markerClasses).toContain('unknown-icon');
  expect(markerClasses).not.toContain('surface-obstacle-icon');
});

test('a TWR callsign without registration or type is classified as a ground object', async ({ page }) => {
  await page.route('**/api/adsbfi', (route) => route.fulfill({ json: { ac: [{
    hex: '43bf7e', flight: 'TWR', alt_baro: 'ground', gs: 0,
    track: 0, lat: 51.47, lon: -0.46, type: 'adsb_icao_nt',
  }] } }));

  await page.waitForFunction(() => adsbfiMarkers.has('43bf7e'));
  const markerClasses = await page.evaluate(() =>
    adsbfiMarkers.get('43bf7e')._icon.querySelector('.plane-icon').className
  );
  expect(markerClasses).toContain('surface-obstacle-icon');
});

test('a real aircraft turns grey on the ground and restores its marker color after takeoff', async ({ page }) => {
  // Isolate ground/source paint beneath the higher-priority altitude mode.
  await page.click('#toggle-altitude-color');
  let onGround = true;
  await page.route('**/api/adsbfi', (route) => route.fulfill({ json: { ac: [{
    hex: '3b7ba7', flight: 'DRAG76', r: 'F-ZAJB', t: 'EC45',
    desc: 'AIRBUS HELICOPTERS EC-145',
    alt_baro: onGround ? 'ground' : 2500,
    gs: onGround ? 0 : 105,
    track: 120, category: 'A7', squawk: null,
    lat: 51.47, lon: -0.46, dbFlags: 0, type: 'adsb_icao',
  }] } }));

  await page.waitForFunction(() => adsbfiMarkers.has('3b7ba7'));

  const marker = page.locator('.plane-icon.rotorcraft-icon[data-color="#e53935"]');
  await expect(marker).toHaveClass(/on-ground/);
  // Ground grey must win over the more-specific uniform-color rule.
  await expect(marker.locator('svg path').first()).toHaveCSS('fill', 'rgb(100, 116, 139)');
  await expect(page.locator('.plane-icon.surface-obstacle-icon[data-color="#e53935"]')).toHaveCount(0);

  // Switching to per-source colors must keep it grey until takeoff.
  await page.click('#toggle-uniform-color');
  await expect(marker.locator('svg path').first()).toHaveCSS('fill', 'rgb(100, 116, 139)');

  onGround = false;
  await page.evaluate(() => poll());

  await expect(marker).not.toHaveClass(/on-ground/);
  await expect(marker.locator('svg path').first()).toHaveCSS('fill', 'rgb(229, 57, 53)');
  await expect(page.locator('.plane-icon.surface-obstacle-icon[data-color="#e53935"]')).toHaveCount(0);
});
