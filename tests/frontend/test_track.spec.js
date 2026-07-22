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
  await page.waitForFunction(() => airplanesliveMarkers.has('ffffff'));
  await page.evaluate(() => {
    recordLiveTrailPoint('ffffff', 44.4, 21.4, 600);
    recordLiveTrailPoint('ffffff', 44.45, 21.45, 650);
  });

  await clickMarker(page, 'airplanesliveMarkers', 'ffffff');
  await page.waitForTimeout(500);

  expect(await trackSegmentCount(page)).toBe(1);
  expect(await page.evaluate(() => trackUsesLiveFallback)).toBe(true);
});

test('track status is shown in HUD when track is unavailable, with the reason behind its (?)', async ({ page }) => {
  await page.route('**/api/track/eeeeee', (route) => route.fulfill({
    status: 429,
    json: { error: 'rate_limited', retry_after_seconds: 10980 }
  }));

  await clickMarker(page, 'adsbfiMarkers', 'eeeeee');
  await page.waitForTimeout(500);

  // The line itself stays short; the explanation lives in the popover.
  expect(await page.textContent('#track-status')).toBe('Historical track unavailable');
  expect(await page.evaluate(
    () => document.getElementById('track-help-popover').hasAttribute('hidden')
  )).toBe(true);

  await page.click('#track-help');
  const popover = await page.evaluate(() => ({
    hidden: document.getElementById('track-help-popover').hasAttribute('hidden'),
    text: document.getElementById('track-help-popover').textContent,
  }));
  expect(popover.hidden).toBe(false);
  expect(popover.text).toContain('historical-track quota'); // the separate /tracks/* bucket
  // 10980s = 3h 3m, but the countdown is live and may have ticked by now.
  expect(popover.text).toMatch(/available in 3h \d+m/);

  // Clicking elsewhere closes it, same as the OpenSky source popover.
  await page.click('#hud .label');
  expect(await page.evaluate(
    () => document.getElementById('track-help-popover').hasAttribute('hidden')
  )).toBe(true);
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

test('sidebar stays open across cross-source marker handoff (dedup priority change)', async ({ page }) => {
  // Regression: when an aircraft moves from a lower-priority source (adsb.fi)
  // to a higher-priority one (OpenSky) between polls, the sidebar used to
  // close spuriously even though the aircraft is still alive. This test
  // simulates that handoff in three poll cycles.

  // Poll 1: aircraft 'hhhhhh' appears only in adsb.fi
  await page.route('**/api/adsbfi', (route) => route.fulfill({
    json: {
      ac: [
        { hex: 'hhhhhh', flight: 'TST100  ', r: 'N123AA', t: 'B737', alt_baro: 8000, gs: 450, track: 45, lat: 44.0, lon: 21.0 }
      ]
    }
  }));

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForFunction(() => adsbfiMarkers.has('hhhhhh'));
  await page.waitForTimeout(500);

  // Click the adsb.fi marker to select the aircraft
  await clickMarker(page, 'adsbfiMarkers', 'hhhhhh');
  await page.waitForTimeout(500);

  // Sidebar is open and we have at least 1 trail point collected
  let sidebarOpen = await page.evaluate(() => document.getElementById('sidebar').classList.contains('open'));
  expect(sidebarOpen).toBe(true);
  let selectedId = await page.evaluate(() => selectedIcao24);
  expect(selectedId).toBe('hhhhhh');

  // Poll 2: adsb.fi reports 'hhhhhh' at a second position (builds trail)
  await page.route('**/api/adsbfi', (route) => route.fulfill({
    json: {
      ac: [
        { hex: 'hhhhhh', flight: 'TST100  ', r: 'N123AA', t: 'B737', alt_baro: 8200, gs: 460, track: 45, lat: 44.05, lon: 21.05 }
      ]
    }
  }));
  await page.evaluate(() => poll());
  await page.waitForTimeout(500);

  // Sidebar still open, track should now have at least one segment
  sidebarOpen = await page.evaluate(() => document.getElementById('sidebar').classList.contains('open'));
  expect(sidebarOpen).toBe(true);
  let trackSegments = await trackSegmentCount(page);
  expect(trackSegments).toBeGreaterThan(0);

  // Poll 3: OpenSky NOW ALSO reports 'hhhhhh' (higher priority) — dedup handoff.
  // adsb.fi still reports it but will be excluded from render (already in
  // openskyMarkers). The bug would cause clearStaleMarkers(adsbfiMarkers)
  // to spuriously call deselectAircraft() since 'hhhhhh' won't be in adsb.fi's
  // render list. The fix keeps sidebar open.
  await page.route('**/api/states', (route) => route.fulfill({
    json: {
      time: 2000,
      rate_limit_remaining: 3999,
      states: [
        ['hhhhhh', 'TST100  ', 'Testland', 1500, 1500, 21.05, 44.05, 8200, false, 460, 45, 0, null, 8200, '2000', false, 0, 1]
      ]
    }
  }));
  await page.route('**/api/adsbfi', (route) => route.fulfill({
    json: {
      ac: [
        { hex: 'hhhhhh', flight: 'TST100  ', r: 'N123AA', t: 'B737', alt_baro: 8200, gs: 460, track: 45, lat: 44.05, lon: 21.05 }
      ]
    }
  }));
  await page.evaluate(() => poll());
  await page.waitForTimeout(500);

  // Key assertions: sidebar is STILL OPEN (regression guard)
  sidebarOpen = await page.evaluate(() => document.getElementById('sidebar').classList.contains('open'));
  expect(sidebarOpen).toBe(true);
  selectedId = await page.evaluate(() => selectedIcao24);
  expect(selectedId).toBe('hhhhhh');

  // Marker handoff happened as expected: now in opensky, removed from adsb.fi
  let hasInOpenSky = await page.evaluate(() => openskyMarkers.has('hhhhhh'));
  let hasInAdsbfi = await page.evaluate(() => adsbfiMarkers.has('hhhhhh'));
  expect(hasInOpenSky).toBe(true);
  expect(hasInAdsbfi).toBe(false);

  // Track is still visible (live fallback kept fresh)
  trackSegments = await trackSegmentCount(page);
  expect(trackSegments).toBeGreaterThan(0);

  // Finally: confirm the "genuinely gone" case still closes the sidebar.
  // Stop reporting 'hhhhhh' from everywhere.
  await page.route('**/api/states', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/adsbfi', (route) => route.fulfill({ json: { ac: [] } }));
  await page.evaluate(() => poll());
  await page.waitForTimeout(500);

  // Now the sidebar SHOULD close (no regression)
  sidebarOpen = await page.evaluate(() => document.getElementById('sidebar').classList.contains('open'));
  expect(sidebarOpen).toBe(false);
});
