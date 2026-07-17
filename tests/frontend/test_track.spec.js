const { test, expect } = require('@playwright/test');
const { mockAllSources, fixture } = require('./helpers');

// Track segments are altitude-coloured, so their stroke is intentionally not
// a fixed colour. Test the layer created by drawTrack() instead of coupling
// this regression check to one point in the colour gradient.
async function trackSegmentCount(page) {
  return page.evaluate(() => (
    trackLayerGroup && map.hasLayer(trackLayerGroup)
      ? trackLayerGroup.getLayers().length
      : 0
  ));
}

async function clickMarker(page, source, icao24) {
  await page.evaluate(({ source, icao24 }) => {
    const marker = ({ adsbfiMarkers, airplanesliveMarkers, openskyMarkers })[source].get(icao24);
    if (!marker || !marker._icon) throw new Error(`Marker ${icao24} from ${source} was not rendered`);
    marker._icon.click();
  }, { source, icao24 });
}

test.beforeEach(async ({ page }) => {
  await mockAllSources(page); // default /api/track/** -> 404
  await page.route('**/api/track/eeeeee', (route) => route.fulfill({ json: fixture('track.json') }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForFunction(() => adsbfiMarkers.has('eeeeee'));
  await page.waitForTimeout(500);
});

test('clicking a marker draws its flight-history track and it stays visible', async ({ page }) => {
  // adsb.fi is enabled by default. Dispatch a real click on its marker's DOM
  // element (not mouse-coordinate hit-testing), which exercises the bound
  // click handler that loads an OpenSky flight history for any source.
  await clickMarker(page, 'adsbfiMarkers', 'eeeeee');
  await page.waitForTimeout(500);
  expect(await trackSegmentCount(page)).toBe(2);

  // Stays visible on its own — nothing clears it a moment later.
  await page.waitForTimeout(500);
  expect(await trackSegmentCount(page)).toBe(2);
});

test('clicking empty map area clears the track', async ({ page }) => {
  await clickMarker(page, 'adsbfiMarkers', 'eeeeee');
  await page.waitForTimeout(500);
  expect(await trackSegmentCount(page)).toBe(2);

  await page.mouse.click(640, 450); // empty map area, away from zoom controls/markers
  await page.waitForTimeout(300);
  expect(await trackSegmentCount(page)).toBe(0);
});

test('a 404 track response leaves no polyline and throws no console error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await clickMarker(page, 'airplanesliveMarkers', 'ffffff'); // no override -> 404
  await page.waitForTimeout(500);

  expect(await trackSegmentCount(page)).toBe(0);
  expect(errors).toEqual([]);
});

test('uses the collected live trail when OpenSky track history is rate limited', async ({ page }) => {
  // Mirrors two positions collected by consecutive polls from a free live
  // source. The track request itself stays on the default 404 mock.
  await page.evaluate(() => {
    recordLiveTrailPoint('ffffff', 44.4, 21.4, 600);
    recordLiveTrailPoint('ffffff', 44.45, 21.45, 650);
  });

  await clickMarker(page, 'airplanesliveMarkers', 'ffffff');
  await page.waitForTimeout(500);

  expect(await trackSegmentCount(page)).toBe(1);
  expect(await page.evaluate(() => trackUsesLiveFallback)).toBe(true);
});

test('track status is shown in HUD when track is unavailable', async ({ page }) => {
  // Route returns 404 with error message (simulating rate limit or not found)
  await page.route('**/api/track/eeeeee', (route) => route.fulfill({
    status: 429,
    json: { error: 'rate_limited' }
  }));

  await clickMarker(page, 'adsbfiMarkers', 'eeeeee');
  await page.waitForTimeout(500);

  // Track should show error in HUD
  const trackStatus = await page.textContent('#track-status');
  expect(trackStatus).toContain('Historical track unavailable');
  expect(trackStatus).toContain('rate_limited');
});

test('track status shows live fallback when using live trail', async ({ page }) => {
  // Override the default 404 mock to return empty path without error
  // (simulating a flight that OpenSky has not segmented yet)
  await page.route('**/api/track/ffffff', (route) => route.fulfill({
    json: { path: [] }
  }));

  await page.evaluate(() => {
    recordLiveTrailPoint('ffffff', 44.4, 21.4, 600);
    recordLiveTrailPoint('ffffff', 44.45, 21.45, 650);
  });

  // Should fall back to live trail
  await clickMarker(page, 'airplanesliveMarkers', 'ffffff');
  await page.waitForTimeout(500);

  const trackStatus = await page.textContent('#track-status');
  expect(trackStatus).toBe('Track: live fallback');
});

test('track status shows cached data when rate limited but cache exists', async ({ page }) => {
  // Return stale cached data with error flag (simulating rate limit with cache)
  await page.route('**/api/track/dddddd', (route) => route.fulfill({
    status: 429,
    json: { path: [[1000, 44.0, 21.0, 10000, 90, false], [1300, 44.05, 21.05, 10000, 90, false]], stale: true, error: 'rate_limited' }
  }));

  await clickMarker(page, 'openskyMarkers', 'dddddd');
  await page.waitForTimeout(500);

  // Track should show with cached data indicator
  const trackStatus = await page.textContent('#track-status');
  expect(trackStatus).toBe('Track: cached data');
  expect(await trackSegmentCount(page)).toBe(1);
});

test('track status clears when deselecting aircraft', async ({ page }) => {
  await page.route('**/api/track/eeeeee', (route) => route.fulfill({
    status: 429,
    json: { error: 'rate_limited' }
  }));

  await clickMarker(page, 'adsbfiMarkers', 'eeeeee');
  await page.waitForTimeout(500);

  // Track status should show error
  let trackStatus = await page.textContent('#track-status');
  expect(trackStatus).toContain('Historical track unavailable');

  // Click empty map to deselect
  await page.mouse.click(640, 450);
  await page.waitForTimeout(300);

  // Track status should be cleared
  trackStatus = await page.textContent('#track-status');
  expect(trackStatus).toBe('');
});
