const { test, expect } = require('@playwright/test');
const { mockAllSources, iconClassCounts } = require('./helpers');

// Aircraft in the ADSBExchange-compatible shape the radius sources return,
// one per category exercised here — isolated from the shared fixtures so
// this doesn't ripple into the exact-count assertions other tests make
// against states.json/adsbfi.json/airplaneslive.json.
function ac(hex, category) {
  return {
    hex, flight: 'ICON1   ', r: 'D-ICON', t: 'A320', desc: 'AIRBUS A-320',
    alt_baro: 8000, gs: 120, track: 30, category, squawk: '3000', lat: 44.3, lon: 21.3,
  };
}

test('heavy, high performance, high vortex large and UAV categories render their dedicated icons', async ({ page }) => {
  await mockAllSources(page);
  await page.route('**/api/states', (r) => r.fulfill({ json: { states: [] } }));
  await page.route('**/api/adsbfi', (r) => r.fulfill({
    json: {
      ac: [
        ac('heavy01', 'A5'),
        ac('hperf01', 'A6'),
        ac('hvort01', 'A4'),
        ac('uav0001', 'B6'),
      ],
    },
  }));

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(500);

  expect(await iconClassCounts(page, 'high-performance-icon')).toBe(1);
  expect(await iconClassCounts(page, 'uav-icon')).toBe(1);
  // high_vortex_large deliberately reuses the "heavy" glyph/class, so both
  // aircraft above count together here.
  expect(await iconClassCounts(page, 'heavy-icon')).toBe(2);
});
