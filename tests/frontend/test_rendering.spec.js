const { test, expect } = require('@playwright/test');
const { mockAllSources, colorCounts } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(500);
});

test('renders exact marker counts per source with the dedup chain applied', async ({ page }) => {
  // ICAO24_DEDUP_PRIORITY (constants.js): airplanes.live > adsb.fi > adsb.lol
  // > adsb.one > Aircraft Scatter > OpenSky > FlightRadar24.
  // airplaneslive.json: "dddddd", "ffffff" — both shown (green).
  // adsbfi.json: "dddddd" is claimed by airplanes.live; its remaining five
  // visible entries render red. OpenSky retains two visible entries.
  const counts = await colorCounts(page);
  expect(counts).toEqual({ blue: 2, red: 5, green: 2 });

  // Nine distinct aircraft remain after deduplication.
  const total = await page.evaluate(() => document.getElementById('count').textContent);
  expect(total).toBe('9');
});

test('overlapping aircraft is deduped (not drawn twice), owned by the highest-priority source', async ({ page }) => {
  // dddddd is owned by airplanes.live under the configured priority.
  await page.evaluate(() => {
    const marker = airplanesliveMarkers.get('dddddd');
    if (marker && marker._icon) marker._icon.click();
  });
  await page.waitForTimeout(300);

  // Registration/Aircraft type come from its airplanes.live record.
  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar').textContent);
  expect(sidebarText).toContain('OO-DUP');
  expect(sidebarText).toContain('AIRBUS A-320');

  // It must not also exist as a separate OpenSky/adsb.fi marker.
  const dedupedAway = await page.evaluate(
    () => !openskyMarkers.has('dddddd') && !adsbfiMarkers.has('dddddd')
  );
  expect(dedupedAway).toBe(true);
});

test('emergency squawk is highlighted in the sidebar', async ({ page }) => {
  await page.evaluate(() => {
    const marker = openskyMarkers.get('cccccc');
    if (marker && marker._icon) marker._icon.click();
  });
  await page.waitForTimeout(300);

  const emergencyEl = await page.$('#sidebar-details .emergency');
  expect(emergencyEl).not.toBeNull();
  expect(await emergencyEl.textContent()).toContain('7700');
});

test('disabling then re-enabling a source restores its markers immediately (no 12s wait)', async ({ page }) => {
  // The per-source toggle list is dev-mode-only (2026-07-27) — open it so
  // #toggle-adsbfi is reachable.
  await page.click('#toggle-dev-mode');
  await page.click('#toggle-adsbfi');
  await page.waitForTimeout(600);
  expect((await colorCounts(page)).red).toBe(0);

  await page.click('#toggle-adsbfi');
  await page.waitForTimeout(600); // well under the 12s poll interval
  expect((await colorCounts(page)).red).toBe(5);
});

test('Aircraft Scatter renders only aircraft not covered by airplanes.live', async ({ page }) => {
  await page.route('**/api/aircraftscatter', (route) => route.fulfill({ json: { ac: [
    // Already rendered by airplanes.live: must stay deduplicated.
    { hex: 'ffffff', flight: 'DUP999', alt_baro: 3000, gs: 100, track: 90, lat: 44.4, lon: 21.4 },
    { hex: '777777', flight: 'SCAT1', alt_baro: 9000, gs: 180, track: 120, lat: 44.5, lon: 21.5 },
  ] } }));

  // Aircraft Scatter now ships checked by default (ICAO24_DEDUP_PRIORITY,
  // constants.js) — no toggle click needed, it fetches on page load.
  await page.goto('/');
  await page.waitForFunction(() => aircraftscatterMarkers.has('777777'));

  expect(await page.evaluate(() => aircraftscatterMarkers.has('ffffff'))).toBe(false);
  expect(await page.locator('.plane-icon[data-color="#00838f"]').count()).toBe(1);
});

test('fast sources paint before a deliberately slow one resolves (two-phase render)', async ({ page }) => {
  // adsb.lol is held open indefinitely until released — while it's pending,
  // the other default-enabled sources (airplanes.live/adsb.fi/OpenSky, all
  // fulfilled near-instantly by mockAllSources()) must already have painted
  // their markers, proving poll() doesn't wait for every enabled source to
  // settle before rendering anything (see poll()'s early/final two-phase
  // render in main.js).
  let releaseSlow;
  const slowHeld = new Promise((resolve) => { releaseSlow = resolve; });
  await page.route('**/api/adsblol', async (route) => {
    await slowHeld;
    route.fulfill({ json: { ac: [] } });
  });

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  // Fast sources' markers (green airplanes.live, red adsb.fi, blue OpenSky)
  // are already on the map while adsb.lol is still deliberately held open.
  const early = await colorCounts(page);
  expect(early.green + early.red + early.blue).toBeGreaterThan(0);
  // adsb.lol's own color hasn't rendered anything yet (no data arrived).
  expect(await page.locator('.plane-icon[data-color="#8e24aa"]').count()).toBe(0);
  // The initial-load overlay is already gone — it's tied to the first paint,
  // not to every enabled source settling.
  expect(await page.evaluate(() => document.getElementById('map-loader').classList.contains('hidden'))).toBe(true);

  releaseSlow();
  await page.waitForTimeout(300);
  // The final pass (once adsb.lol's fetch settles) is a no-op here since
  // its fixture is empty, but confirms the poll cycle completed without
  // error and the fast sources' markers are still present.
  const afterFinal = await colorCounts(page);
  expect(afterFinal.green + afterFinal.red + afterFinal.blue).toBeGreaterThan(0);
});
