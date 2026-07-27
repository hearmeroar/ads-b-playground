const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

// Operator-configurable source visibility (config/sources.json's
// visible/enabled_by_default, surfaced via /api/config's "sources" key and
// applied in main.js before the startup sequence's first poll()). See
// .ai/proposals/source-visibility-config-2026-07-22.md.
//
// The whole per-source toggle list is a Dev Mode-only feature (2026-07-27
// revision): hidden entirely with dev mode off regardless of any source's
// own "visible" value, and revealed only while dev mode is on — where a
// source's "visible" flag then decides whether that specific row actually
// shows. This is what lets an operator curate which sources a power user
// even sees, not just end users.
//
// The byte-identical-default guarantee itself isn't a dedicated test here —
// mockAllSources()'s own /api/config mock now returns the real shipped
// defaults, so every other spec in this suite passing unchanged already
// proves an unedited config leaves today's default (dev-mode-off) behavior
// untouched.

const MIXED_SOURCES = {
  opensky: { visible: true, enabled_by_default: true },
  adsbfi: { visible: true, enabled_by_default: true },
  adsblol: { visible: true, enabled_by_default: true },
  adsbone: { visible: false, enabled_by_default: false }, // stays hidden even in dev mode
  airplaneslive: { visible: true, enabled_by_default: true },
  aircraftscatter: { visible: true, enabled_by_default: true },
  flightaware: { visible: true, enabled_by_default: false },
  flightradar24: { visible: true, enabled_by_default: false },
};

test('the whole source list stays hidden with dev mode off, regardless of any source\'s configured visibility', async ({ page }) => {
  await mockAllSources(page);
  await page.route('**/api/config', (route) => route.fulfill({ json: {
    center: { lat: 51.47, lon: -0.46 }, zoom: 8, radius_nm: 220, active_zone_id: 'default',
    sources: MIXED_SOURCES,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  expect(await page.isVisible('#hud .sources')).toBe(false);
  // A visible:true source's own row-level state is still applied underneath
  // (main.js's config bootstrap doesn't skip this just because the
  // container is hidden) — only the container's own display governs what a
  // normal, dev-mode-off user actually sees.
  expect(await page.isVisible('#toggle-opensky')).toBe(false);
});

test('turning dev mode on reveals only the sources configured visible: true; a visible: false source stays hidden', async ({ page }) => {
  await mockAllSources(page);
  await page.route('**/api/config', (route) => route.fulfill({ json: {
    center: { lat: 51.47, lon: -0.46 }, zoom: 8, radius_nm: 220, active_zone_id: 'default',
    sources: MIXED_SOURCES,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#toggle-dev-mode');

  expect(await page.isVisible('#hud .sources')).toBe(true);
  expect(await page.isVisible('#toggle-opensky')).toBe(true);
  expect(await page.isVisible('#toggle-adsbone')).toBe(false); // visible: false — stays hidden even in dev mode

  // Now visible and interactive — a power user can flip it.
  await page.click('#toggle-opensky');
  expect(await page.isChecked('#toggle-opensky')).toBe(false);
});

test('turning dev mode back off hides the whole list again', async ({ page }) => {
  await mockAllSources(page);
  await page.route('**/api/config', (route) => route.fulfill({ json: {
    center: { lat: 51.47, lon: -0.46 }, zoom: 8, radius_nm: 220, active_zone_id: 'default',
    sources: MIXED_SOURCES,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#toggle-dev-mode');
  expect(await page.isVisible('#hud .sources')).toBe(true);

  await page.click('#toggle-dev-mode');
  expect(await page.isVisible('#hud .sources')).toBe(false);
});

test('a source configured enabled_by_default: false starts unchecked and is never polled on load, independent of visibility', async ({ page }) => {
  let statesRequests = 0;
  await mockAllSources(page);
  await page.route('**/api/states', (route) => {
    statesRequests += 1;
    route.fulfill({ json: require('./fixtures/states.json') });
  });
  await page.route('**/api/config', (route) => route.fulfill({ json: {
    center: { lat: 51.47, lon: -0.46 }, zoom: 8, radius_nm: 220, active_zone_id: 'default',
    sources: {
      opensky: { visible: true, enabled_by_default: false }, // normally on by default
      adsbfi: { visible: true, enabled_by_default: true },
      adsblol: { visible: true, enabled_by_default: true },
      adsbone: { visible: false, enabled_by_default: false },
      airplaneslive: { visible: true, enabled_by_default: true },
      aircraftscatter: { visible: true, enabled_by_default: true },
      flightaware: { visible: true, enabled_by_default: false },
      flightradar24: { visible: true, enabled_by_default: false },
    },
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(500); // let the first poll cycle settle

  // Checked state and poll gating are read directly off the checkbox
  // element regardless of whether its row is currently visible (dev mode
  // off here) — isSourceEnabled()/poll() never look at visibility.
  expect(await page.isChecked('#toggle-opensky')).toBe(false);
  expect(statesRequests).toBe(0);
});
