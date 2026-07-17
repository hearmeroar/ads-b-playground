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

test('dedicated category icons render with their distinct CSS classes', async ({ page }) => {
  await mockAllSources(page);
  // Empty all sources except airplaneslive so we only count our test data.
  await page.route('**/api/states', (r) => r.fulfill({ json: { states: [] } }));
  await page.route('**/api/adsbfi', (r) => r.fulfill({ json: { ac: [] } }));
  await page.route('**/api/airplaneslive', (r) => r.fulfill({
    json: {
      ac: [
        ac('light01', 'A1'),
        ac('small01', 'A2'),
        ac('large01', 'A3'),
        ac('hvort01', 'A4'),
        ac('heavy01', 'A5'),
        ac('hperf01', 'A6'),
        ac('rotor01', 'A7'),
        ac('glider01', 'B1'),
        ac('lta0001', 'B2'),
        ac('para0001', 'B3'),
        ac('ultra01', 'B4'),
        ac('uav0001', 'B6'),
      ],
    },
  }));

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(500);

  expect(await iconClassCounts(page, 'light-icon')).toBe(1);
  expect(await iconClassCounts(page, 'small-icon')).toBe(1);
  expect(await iconClassCounts(page, 'large-icon')).toBe(1);
  expect(await iconClassCounts(page, 'high-vortex-large-icon')).toBe(1);
  expect(await iconClassCounts(page, 'heavy-icon')).toBe(1);
  expect(await iconClassCounts(page, 'high-performance-icon')).toBe(1);
  expect(await iconClassCounts(page, 'rotorcraft-icon')).toBe(1);
  expect(await iconClassCounts(page, 'glider-icon')).toBe(1);
  expect(await iconClassCounts(page, 'lighter-than-air-icon')).toBe(1);
  expect(await iconClassCounts(page, 'parachutist-icon')).toBe(1);
  expect(await iconClassCounts(page, 'ultralight-icon')).toBe(1);
  expect(await iconClassCounts(page, 'uav-icon')).toBe(1);
});
