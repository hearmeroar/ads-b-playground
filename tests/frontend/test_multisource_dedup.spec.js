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
  // adsb.one's row is hidden in the HUD (Cloudflare block on the whole
  // upstream subdomain — see CLAUDE.md) but its toggle/wiring still exist
  // underneath. Playwright's page.click() (even with force: true) can't
  // click a display:none element at all — it has no layout box to compute
  // coordinates from — so invoke the native DOM click directly instead.
  // Enabling it puts all four radius sources live for this dedup check
  // (adsb.lol ships on already).
  await page.evaluate(() => document.getElementById('toggle-adsbone').click());
  await page.waitForTimeout(600);

  // Priority airplanes.live > adsb.fi > adsb.lol > adsb.one > Aircraft
  // Scatter > OpenSky > FlightRadar24 (ICAO24_DEDUP_PRIORITY, constants.js):
  // airplanes.live (the highest-priority source that has it) owns the
  // single marker; the three lower-priority sources are deduped away.
  const membership = await page.evaluate(() => ({
    adsbfi: adsbfiMarkers.has('multi1'),
    adsblol: adsblolMarkers.has('multi1'),
    adsbone: adsboneMarkers.has('multi1'),
    airplaneslive: airplanesliveMarkers.has('multi1'),
  }));
  expect(membership).toEqual({ adsbfi: false, adsblol: false, adsbone: false, airplaneslive: true });

  // Exactly one aircraft on the map in total.
  const total = await page.evaluate(() => document.getElementById('count').textContent);
  expect(total).toBe('1');
});

test('toggling off the source that owns the selected aircraft\'s marker deselects it', async ({ page }) => {
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
  // adsb.lol ships on by default and now outranks OpenSky in
  // ICAO24_DEDUP_PRIORITY (constants.js), so it — not OpenSky — owns this
  // aircraft's marker, showing LOL-ONLY as its own native registration
  // field (not enrichment on top of another source's marker).

  await page.evaluate(() => {
    const m = adsblolMarkers.get('aaaaaa');
    if (m && m._icon) m._icon.click();
  });
  await page.waitForTimeout(300);
  // Registration (LOL-ONLY) is #sidebar-header's title now, not #sidebar-details.
  const header = await page.evaluate(() => document.querySelector('#sidebar-header').textContent);
  expect(header).toContain('LOL-ONLY');
  expect(await page.evaluate(() => document.getElementById('sidebar').classList.contains('open'))).toBe(true);

  // Turn adsb.lol off: clearAllMarkers(adsblolMarkers) removes its marker
  // for the currently-selected aircraft and — since the selected aircraft
  // was one of the markers just removed — deselects it (existing
  // clearAllMarkers()/deselectAircraft() behavior in icons.js/sidebar-track.js,
  // unrelated to this reorder; it already applied identically to every
  // other non-OpenSky source before this change). Unlike a genuine
  // cross-source handoff (a different source claiming the same aircraft
  // between two poll cycles — see test_track.spec.js), this is an explicit
  // user action removing the very source that owned the open sidebar's
  // aircraft, so closing it is the correct, existing behavior.
  await page.click('#toggle-adsblol');
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => document.getElementById('sidebar').classList.contains('open'))).toBe(false);
});
