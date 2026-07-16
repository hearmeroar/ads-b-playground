const { test, expect } = require('@playwright/test');
const { mockAllSources, colorCounts } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(500);
});

test('renders exact marker counts per source with the 3-way dedup chain applied', async ({ page }) => {
  // states.json: 5 OpenSky entries, all rendered (none are junk/filtered by default).
  // adsbfi.json: "dddddd" duplicates an OpenSky entry (hidden), "eeeeee" is unique
  //   (shown), the TWR + callsign-pattern entries are hidden by the default junk filter.
  // airplaneslive.json: "dddddd" duplicates OpenSky and "eeeeee" duplicates adsb.fi's
  //   unique entry (both hidden), only "ffffff" is uniquely its own (shown).
  const counts = await colorCounts(page);
  expect(counts).toEqual({ blue: 5, red: 1, green: 1 });

  const total = await page.evaluate(() => document.getElementById('count').textContent);
  expect(total).toBe('7');
});

test('overlapping aircraft is deduped (not drawn twice) and its OpenSky popup is enriched', async ({ page }) => {
  await page.evaluate(() => openskyMarkers.get('dddddd').openPopup());
  await page.waitForTimeout(300);

  const popupText = await page.evaluate(() => document.querySelector('.leaflet-popup-content').textContent);
  expect(popupText).toContain('Registration'); // OpenSky's own vector has no such field
  expect(popupText).toContain('OO-DUP');
  expect(popupText).toContain('AIRBUS A-320');

  // it must not also exist as a separate adsb.fi/airplanes.live marker
  const dedupedAway = await page.evaluate(
    () => !adsbfiMarkers.has('dddddd') && !airplanesliveMarkers.has('dddddd')
  );
  expect(dedupedAway).toBe(true);
});

test('emergency squawk is highlighted in the popup', async ({ page }) => {
  await page.evaluate(() => openskyMarkers.get('cccccc').openPopup());
  await page.waitForTimeout(300);

  const emergencyEl = await page.$('.leaflet-popup-content .emergency');
  expect(emergencyEl).not.toBeNull();
  expect(await emergencyEl.textContent()).toContain('7700');
});

test('disabling then re-enabling a source restores its markers immediately (no 12s wait)', async ({ page }) => {
  await page.click('#toggle-adsbfi');
  await page.waitForTimeout(600);
  expect((await colorCounts(page)).red).toBe(0);

  await page.click('#toggle-adsbfi');
  await page.waitForTimeout(600); // well under the 12s poll interval
  expect((await colorCounts(page)).red).toBe(1);
});
