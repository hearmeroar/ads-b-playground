const { test, expect } = require('@playwright/test');
const { mockAllSources, fixture } = require('./helpers');

const TRACK_STROKE_SELECTOR = 'path.leaflet-interactive[stroke="#ff6f00"]';

test.beforeEach(async ({ page }) => {
  await mockAllSources(page); // default /api/track/** -> 404
  await page.route('**/api/track/aaaaaa', (route) => route.fulfill({ json: fixture('track.json') }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(500);
});

test('clicking a marker draws its flight-history track and it stays visible', async ({ page }) => {
  // Dispatches a real click on the marker's own DOM element (not mouse-coordinate
  // hit-testing, which can land on a different overlapping marker) so this goes
  // through the actual bound click handler.
  await page.evaluate(() => openskyMarkers.get('aaaaaa')._icon.click());
  await page.waitForTimeout(500);
  expect(await page.$(TRACK_STROKE_SELECTOR)).not.toBeNull();

  // Stays visible on its own — nothing clears it a moment later.
  await page.waitForTimeout(500);
  expect(await page.$(TRACK_STROKE_SELECTOR)).not.toBeNull();
});

test('clicking empty map area clears the track', async ({ page }) => {
  await page.evaluate(() => openskyMarkers.get('aaaaaa')._icon.click());
  await page.waitForTimeout(500);
  expect(await page.$(TRACK_STROKE_SELECTOR)).not.toBeNull();

  await page.mouse.click(640, 450); // empty map area, away from zoom controls/markers
  await page.waitForTimeout(300);
  expect(await page.$(TRACK_STROKE_SELECTOR)).toBeNull();
});

test('a 404 track response leaves no polyline and throws no console error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.evaluate(() => openskyMarkers.get('bbbbbb')._icon.click()); // no override -> 404
  await page.waitForTimeout(500);

  expect(await page.$(TRACK_STROKE_SELECTOR)).toBeNull();
  expect(errors).toEqual([]);
});
