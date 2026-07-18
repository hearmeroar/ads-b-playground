const { test, expect } = require('@playwright/test');
const { mockAllSources, iconClassCounts, colorCounts } = require('./helpers');

// Aircraft in the ADSBExchange-compatible shape adsb.fi/airplanes.live
// return, isolated from the shared fixtures (same pattern test_icons.spec.js
// uses) so this doesn't ripple into other tests' exact-count assertions.
// baro_rate is ft/min; +-1000 ft/min (~+-5.08 m/s) is comfortably outside
// VERTICAL_RATE_LEVEL_THRESHOLD_MS (0.5 m/s) either way.
function ac(hex, baroRate) {
  const base = {
    hex, flight: 'CLB1    ', r: 'D-CLMB', t: 'A320', desc: 'AIRBUS A-320',
    alt_baro: 8000, gs: 120, track: 30, category: 'A3', squawk: '3000', lat: 44.3, lon: 21.3,
  };
  return baroRate === undefined ? base : { ...base, baro_rate: baroRate };
}

async function mockClimbDescentFixture(page) {
  await mockAllSources(page);
  await page.route('**/api/states', (r) => r.fulfill({ json: { states: [] } }));
  await page.route('**/api/adsbfi', (r) => r.fulfill({ json: { ac: [] } }));
  await page.route('**/api/airplaneslive', (r) => r.fulfill({
    json: {
      ac: [
        ac('climb01', 1000),   // climbing
        ac('desc0001', -1000), // descending
        ac('level001', 0),     // level — reports a rate, but inside the band
        ac('noratee1'),        // no vertical-rate field at all (matches every real fixture today)
      ],
    },
  }));
}

test('a climbing aircraft renders the climb icon in its normal source color', async ({ page }) => {
  await mockClimbDescentFixture(page);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(500);

  expect(await iconClassCounts(page, 'climbing-icon')).toBe(1);
  const marker = await page.evaluate(() => {
    const el = document.querySelector('.plane-icon.climbing-icon');
    return { color: el.dataset.color };
  });
  expect(marker.color).toBe('#2e7d32'); // airplanes.live green — same as colorCounts()' own 'green'
});

test('a descending aircraft renders the descent icon, rotated opposite the climb icon', async ({ page }) => {
  await mockClimbDescentFixture(page);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(500);

  expect(await iconClassCounts(page, 'descending-icon')).toBe(1);

  const rotations = await page.evaluate(() => {
    const climb = document.querySelector('.plane-icon.climbing-icon .plane-icon-rotate');
    const descend = document.querySelector('.plane-icon.descending-icon .plane-icon-rotate');
    return { climb: climb.style.transform, descend: descend.style.transform };
  });
  expect(rotations.climb).toBe('rotate(-45deg)');
  expect(rotations.descend).toBe('rotate(135deg)');
});

test('a level aircraft (rate inside the band) and one with no rate at all keep their ordinary category icon', async ({ page }) => {
  await mockClimbDescentFixture(page);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(500);

  // Both level001 (rate=0) and noratee1 (no field) are A3/"large" category —
  // neither should have been swapped to a climb/descent icon.
  expect(await iconClassCounts(page, 'large-icon')).toBe(2);
  expect(await iconClassCounts(page, 'climbing-icon')).toBe(1); // only climb01
  expect(await iconClassCounts(page, 'descending-icon')).toBe(1); // only desc0001

  // Total marker count sanity check: exactly 4 aircraft, no extras/misses.
  const total = await page.evaluate(() => document.querySelectorAll('.plane-icon').length);
  expect(total).toBe(4);
});
