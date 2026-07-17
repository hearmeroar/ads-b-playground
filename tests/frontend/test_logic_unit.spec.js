const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

// These exercise the page's own top-level pure functions directly via
// page.evaluate() — they're plain `const`/`function` in a non-module inline
// <script>, so nothing is importable from Node, but bare identifiers are
// still resolvable inside an evaluated expression in that page's context.
test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
  await page.goto('/');
  await page.waitForSelector('#map');
});

test('looksLikeGroundVehicle flags TWR registration/aircraft-type', async ({ page }) => {
  const result = await page.evaluate(() =>
    looksLikeGroundVehicle({ category: null, registration: 'TWR', aircraftType: 'TWR', callsign: '' })
  );
  expect(result).toBe(true);
});

test('looksLikeGroundVehicle flags the airport-ground-vehicle callsign pattern', async ({ page }) => {
  const result = await page.evaluate(() =>
    looksLikeGroundVehicle({ category: null, registration: 'XYZ99', aircraftType: null, callsign: 'TXLU01' })
  );
  expect(result).toBe(true);
});

test('looksLikeGroundVehicle flags OpenSky surface-vehicle/obstacle categories', async ({ page }) => {
  const result = await page.evaluate(() =>
    looksLikeGroundVehicle({ category: 18, registration: null, aircraftType: null, callsign: '' })
  );
  expect(result).toBe(true);
});

test('looksLikeGroundVehicle flags ADSBExchange surface-vehicle/obstacle categories', async ({ page }) => {
  const result = await page.evaluate(() =>
    looksLikeGroundVehicle({ category: 'C3', registration: null, aircraftType: null, callsign: '' })
  );
  expect(result).toBe(true);
});

test('looksLikeGroundVehicle does not flag a normal airliner', async ({ page }) => {
  const result = await page.evaluate(() =>
    looksLikeGroundVehicle({ category: 'A3', registration: 'D-ABCD', aircraftType: 'A320', callsign: 'DLH441' })
  );
  expect(result).toBe(false);
});

test('categoryGroupFor unifies OpenSky numeric and ADSBExchange letter+digit codes', async ({ page }) => {
  const openskyGroup = await page.evaluate(() => categoryGroupFor({ openskyCategory: 6 }));
  const adsbExchangeGroup = await page.evaluate(() => categoryGroupFor({ adsbExchangeCategory: 'A5' }));
  expect(openskyGroup).toBe('heavy');
  expect(adsbExchangeGroup).toBe('heavy');
});

test('formatSquawk highlights only the universal ICAO emergency codes', async ({ page }) => {
  const emergency = await page.evaluate(() => formatSquawk('7700'));
  const normal = await page.evaluate(() => formatSquawk('2000'));
  const none = await page.evaluate(() => formatSquawk(null));
  expect(emergency).toContain('EMERGENCY');
  expect(normal).toBe('2000');
  expect(none).toBeNull();
});

test('formatVerticalRateUnit reports climbing/descending/level thresholds', async ({ page }) => {
  const climbing = await page.evaluate(() => formatVerticalRateUnit(5.2));
  const descending = await page.evaluate(() => formatVerticalRateUnit(-6.1));
  const level = await page.evaluate(() => formatVerticalRateUnit(0.1));
  expect(climbing).toContain('climbing');
  expect(descending).toContain('descending');
  expect(level).toBe('level');
});
