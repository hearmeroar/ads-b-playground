const { test, expect } = require('@playwright/test');
const { mockAllSources, fixture } = require('./helpers');

// Airline logo (airlineLogoHtml(), static/airline-logos/) is looked up from
// the 3-letter ICAO prefix of the callsign, independent of the fixtures'
// own Operator/adsbdb data — so these tests only need to swap the
// callsign on an existing marker ("dddddd"), not build a whole new
// aircraft. "RYR..." resolves via the manifest's tier-1 (soaring-symbols)
// entry; a callsign with no manifest entry at all must render no logo.
function statesWithCallsign(callsign) {
  const states = fixture('states.json');
  const row = states.states.find((s) => s[0] === 'dddddd');
  row[1] = callsign;
  return states;
}

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
});

test('known airline callsign shows the vendored logo next to Operator', async ({ page }) => {
  await page.route('**/api/states', (route) => route.fulfill({ json: statesWithCallsign('RYR123B ') }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  // AIRLINE_LOGO_MANIFEST (map-init.js) loads via its own async fetch,
  // independent of the poll cycle above — wait for it so the click below
  // doesn't race a manifest that's still {}.
  await page.waitForFunction(() => Object.keys(AIRLINE_LOGO_MANIFEST).length > 0);
  await page.evaluate(() => {
    const marker = openskyMarkers.get('dddddd');
    if (marker && marker._icon) marker._icon.click();
  });
  await page.waitForSelector('#sidebar-details .airline-logo');

  const src = await page.evaluate(() => document.querySelector('#sidebar-details .airline-logo').getAttribute('src'));
  expect(src).toBe('airline-logos/soaring/RYR.svg');
});

test('callsign with no matching airline renders no logo', async ({ page }) => {
  await page.route('**/api/states', (route) => route.fulfill({ json: statesWithCallsign('ZZZ999  ') }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForFunction(() => Object.keys(AIRLINE_LOGO_MANIFEST).length > 0);
  await page.evaluate(() => {
    const marker = openskyMarkers.get('dddddd');
    if (marker && marker._icon) marker._icon.click();
  });
  await page.waitForSelector('#sidebar-details');
  await page.waitForTimeout(200);

  const count = await page.evaluate(() => document.querySelectorAll('#sidebar-details .airline-logo').length);
  expect(count).toBe(0);
});
