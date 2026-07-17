const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

// Aircraft in the ADSBExchange-compatible shape the radius sources return.
function ac(hex, reg, lat, lon) {
  return {
    hex, flight: 'MULTI   ', r: reg, t: 'A320', desc: 'AIRBUS A-320',
    alt_baro: 6000, gs: 120, track: 30, category: 'A3', squawk: '3000', lat, lon,
  };
}

test('same ICAO24 from 4 radius sources renders one marker, from the highest-priority source', async ({ page }) => {
  await mockAllSources(page);
  // Isolate the radius chain: no OpenSky aircraft at all.
  await page.route('**/api/states', (r) => r.fulfill({ json: { states: [] } }));
  // The very same hex "multi1" reported by all four radius sources at once.
  await page.route('**/api/adsbfi', (r) => r.fulfill({ json: { ac: [ac('multi1', 'FI-REG', 44.5, 21.5)] } }));
  await page.route('**/api/adsblol', (r) => r.fulfill({ json: { ac: [ac('multi1', 'LOL-REG', 44.6, 21.6)] } }));
  await page.route('**/api/adsbone', (r) => r.fulfill({ json: { ac: [ac('multi1', 'ONE-REG', 44.7, 21.7)] } }));
  await page.route('**/api/airplaneslive', (r) => r.fulfill({ json: { ac: [ac('multi1', 'ALIVE-REG', 44.8, 21.8)] } }));

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  // adsb.one ships off by default (Cloudflare block) — enable it so all four
  // radius sources are live for this dedup check (adsb.lol ships on already).
  await page.click('#toggle-adsbone');
  await page.waitForTimeout(600);

  // Priority OpenSky > adsb.fi > adsb.lol > adsb.one > airplanes.live: adsb.fi
  // (the highest-priority source that has it) owns the single marker; the three
  // lower-priority sources are deduped away.
  const membership = await page.evaluate(() => ({
    adsbfi: adsbfiMarkers.has('multi1'),
    adsblol: adsblolMarkers.has('multi1'),
    adsbone: adsboneMarkers.has('multi1'),
    airplaneslive: airplanesliveMarkers.has('multi1'),
  }));
  expect(membership).toEqual({ adsbfi: true, adsblol: false, adsbone: false, airplaneslive: false });

  // Exactly one aircraft on the map in total.
  const total = await page.evaluate(() => document.getElementById('count').textContent);
  expect(total).toBe('1');
});

test('enrichment from a lower-priority source disappears when that source is toggled off', async ({ page }) => {
  await mockAllSources(page);
  // One OpenSky aircraft "aaaaaa" — OpenSky state vectors carry no registration.
  await page.route('**/api/states', (r) => r.fulfill({
    json: { states: [['aaaaaa', 'TES100  ', 'Testland', 1000, 1000, 21.0, 44.0, 10000, false, 230, 90, 0, null, 10200, '2000', false, 0, 1]] },
  }));
  // Its registration is supplied ONLY by adsb.lol; the other radius sources
  // don't know this aircraft at all.
  await page.route('**/api/adsbfi', (r) => r.fulfill({ json: { ac: [] } }));
  await page.route('**/api/adsbone', (r) => r.fulfill({ json: { ac: [] } }));
  await page.route('**/api/airplaneslive', (r) => r.fulfill({ json: { ac: [] } }));
  await page.route('**/api/adsblol', (r) => r.fulfill({ json: { ac: [ac('aaaaaa', 'LOL-ONLY', 44.0, 21.0)] } }));

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  // adsb.lol ships on by default, so it's already enriching the OpenSky aircraft.

  await page.evaluate(() => {
    const m = openskyMarkers.get('aaaaaa');
    if (m && m._icon) m._icon.click();
  });
  await page.waitForTimeout(300);
  let sidebar = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebar).toContain('LOL-ONLY'); // enriched from adsb.lol

  // Turn adsb.lol off: it triggers an immediate poll, the open sidebar re-renders.
  await page.click('#toggle-adsblol');
  await page.waitForTimeout(600);
  sidebar = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebar).not.toContain('LOL-ONLY'); // the only enricher is gone
});
