const { test, expect } = require('@playwright/test');
const { mockAllSources, fixture } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
});

test('no photo requests happen on page load or after panning the map', async ({ page }) => {
  const photoRequests = [];
  page.on('request', (req) => { if (req.url().includes('/api/photo/')) photoRequests.push(req.url()); });

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(500);
  expect(photoRequests.length).toBe(0);

  await page.mouse.move(640, 450);
  await page.mouse.down();
  await page.mouse.move(600, 400, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(photoRequests.length).toBe(0);
});

test('clicking a marker shows the photo and required attribution', async ({ page }) => {
  await page.route('**/api/photo/**', (route) => route.fulfill({ json: fixture('photo-found.json') }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const marker = openskyMarkers.get('aaaaaa');
    if (marker && marker._icon) marker._icon.click();
  });
  await page.waitForTimeout(600);

  const state = await page.evaluate(() => {
    const box = document.querySelector('#sidebar-gallery .gallery-image-wrap');
    const credit = document.querySelector('#sidebar-gallery .gallery-credit');
    const creditLink = credit.querySelector('a');
    return {
      hasImg: !!box.querySelector('img'),
      creditText: credit ? credit.textContent : '',
      creditHref: creditLink ? creditLink.href : null,
    };
  });
  expect(state.hasImg).toBe(true);
  expect(state.creditText).toContain('Test Photographer');
  expect(state.creditHref).toContain('planespotters.net');
});

test('shows a neutral placeholder when no photo is found, with no console error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.route('**/api/photo/**', (route) => route.fulfill({ json: fixture('photo-empty.json') }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const marker = openskyMarkers.get('aaaaaa');
    if (marker && marker._icon) marker._icon.click();
  });
  await page.waitForTimeout(600);

  expect(await page.evaluate(() => !!document.querySelector('#sidebar-gallery .gallery-placeholder'))).toBe(true);
  expect(errors).toEqual([]);
});

test('reopening the same sidebar does not refetch (client-side cache)', async ({ page }) => {
  let requestCount = 0;
  await page.route('**/api/photo/**', (route) => {
    requestCount++;
    route.fulfill({ json: fixture('photo-found.json') });
  });
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const marker = openskyMarkers.get('aaaaaa');
    if (marker && marker._icon) marker._icon.click();
  });
  await page.waitForTimeout(600);
  expect(requestCount).toBe(1);

  // Close sidebar
  await page.click('#sidebar-close');
  await page.waitForTimeout(200);
  // Reopen same aircraft
  await page.evaluate(() => {
    const marker = openskyMarkers.get('aaaaaa');
    if (marker && marker._icon) marker._icon.click();
  });
  await page.waitForTimeout(400);
  expect(requestCount).toBe(1);
});

test('photo survives a poll cycle while the sidebar stays open (regression guard)', async ({ page }) => {
  let requestCount = 0;
  await page.route('**/api/photo/**', (route) => {
    requestCount++;
    route.fulfill({ json: fixture('photo-found.json') });
  });
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const marker = openskyMarkers.get('aaaaaa');
    if (marker && marker._icon) marker._icon.click();
  });
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => !!document.querySelector('#sidebar-gallery img'))).toBe(true);

  // poll() re-runs every 12s and could replace an already-open sidebar's DOM
  // (see the CLAUDE.md gotcha) — this simulates that tick happening while open.
  await page.evaluate(() => poll());
  await page.waitForTimeout(500);

  expect(await page.evaluate(() => !!document.querySelector('#sidebar-gallery img'))).toBe(true);
  expect(await page.evaluate(() => !!document.querySelector('#sidebar-gallery .gallery-spinner'))).toBe(false);
  expect(requestCount).toBe(1); // cache hit, no re-fetch
});
