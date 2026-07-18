const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
});

test('centers the map on the selected aircraft\'s current position, keeping the current zoom', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  // Pan/zoom away from the aircraft first, so centering is an observable change.
  await page.evaluate(() => map.setView([30, 40], 5));
  const zoomBefore = await page.evaluate(() => map.getZoom());

  await page.evaluate(() => {
    const marker = openskyMarkers.get('aaaaaa');
    if (marker && marker._icon) marker._icon.click();
  });
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
  await page.waitForTimeout(300); // let the sidebar's own open transition finish

  await page.click('#sidebar-center-map');
  // Leaflet flies to the new center rather than snapping instantly,
  // especially over the large pan distance this test sets up (zoom 5,
  // far from the aircraft) — give the animation time to finish.
  await page.waitForTimeout(1000);

  // "aaaaaa" is at lat 44.0, lon 21.0 in states.json.
  const center = await page.evaluate(() => map.getCenter());
  expect(center.lat).toBeCloseTo(44.0, 1);
  expect(center.lng).toBeCloseTo(21.0, 1);
  // Zoom level is preserved, not reset to some default.
  expect(await page.evaluate(() => map.getZoom())).toBe(zoomBefore);
});

test('does nothing when no aircraft is selected', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.evaluate(() => map.setView([30, 40], 5));

  // The button is only reachable inside the closed sidebar, but clicking
  // it programmatically with nothing selected must be a safe no-op.
  await page.evaluate(() => document.getElementById('sidebar-center-map').click());
  await page.waitForTimeout(100);

  const center = await page.evaluate(() => map.getCenter());
  expect(center.lat).toBeCloseTo(30, 1);
  expect(center.lng).toBeCloseTo(40, 1);
});
