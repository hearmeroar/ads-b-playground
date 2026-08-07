const { test, expect } = require('@playwright/test');
const { mockAllSources, fixture } = require('./helpers');

// Airline logo (airlineLogoHtml(), static/airline-logos/) is looked up from
// the 3-letter ICAO prefix of the callsign, independent of the fixtures'
// own Operator/adsbdb data — so these tests only need to swap the
// callsign on an existing marker ("dddddd"), not build a whole new
// aircraft. "RYR..." resolves via the manifest's tier-1 (soaring-symbols)
// entry; a callsign with no manifest entry at all must render no logo.
function airplanesLiveWithCallsign(callsign) {
  const data = fixture('airplaneslive.json');
  data.ac.find((aircraft) => aircraft.hex === 'dddddd').flight = callsign;
  return data;
}

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
});

test('known airline callsign shows the vendored logo next to Operator', async ({ page }) => {
  await page.route('**/api/airplaneslive', (route) => route.fulfill({ json: airplanesLiveWithCallsign('RYR123B ') }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  // AIRLINE_LOGO_MANIFEST (map-init.js) loads via its own async fetch,
  // independent of the poll cycle above — wait for it so the click below
  // doesn't race a manifest that's still {}.
  await page.waitForFunction(() => Object.keys(AIRLINE_LOGO_MANIFEST).length > 0);
  await page.evaluate(() => {
    const marker = airplanesliveMarkers.get('dddddd');
    if (marker && marker._icon) marker._icon.click();
  });
  await page.waitForSelector('#sidebar-details .airline-logo');

  const src = await page.evaluate(() => document.querySelector('#sidebar-details .airline-logo').getAttribute('src'));
  expect(src).toBe('airline-logos/soaring/RYR.svg');

  await page.click('#toggle-tile-layout');
  const listRow = page.locator('#sidebar-details .detail-group-body:not(.tiles) .identity-logo-row:has(.airline-logo)').first();
  const listLogo = listRow.locator('.identity-logo-square');
  await expect(listLogo).toHaveCSS('width', '32px');
  await expect(listLogo).toHaveCSS('height', '32px');
  const listGeometry = await listRow.evaluate((row) => {
    const rowRect = row.getBoundingClientRect();
    const valueRect = row.querySelector('.identity-logo-value').getBoundingClientRect();
    const logoRect = row.querySelector('.identity-logo-square').getBoundingClientRect();
    const copyRect = row.querySelector('.identity-logo-copy').getBoundingClientRect();
    return {
      contained: valueRect.left >= rowRect.left && valueRect.right <= rowRect.right + 1,
      topAligned: Math.abs(logoRect.top - copyRect.top) <= 1,
    };
  });
  expect(listGeometry).toEqual({ contained: true, topAligned: true });
});

test('callsign with no matching airline renders no logo', async ({ page }) => {
  await page.route('**/api/airplaneslive', (route) => route.fulfill({ json: airplanesLiveWithCallsign('ZZZ999  ') }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForFunction(() => Object.keys(AIRLINE_LOGO_MANIFEST).length > 0);
  await page.evaluate(() => {
    const marker = airplanesliveMarkers.get('dddddd');
    if (marker && marker._icon) marker._icon.click();
  });
  await page.waitForSelector('#sidebar-details');
  await page.waitForTimeout(200);

  const count = await page.evaluate(() => document.querySelectorAll('#sidebar-details .airline-logo').length);
  expect(count).toBe(0);
});

test('known operator name renders its manifest logo without a callsign', async ({ page }) => {
  await page.route('**/api/airplaneslive', (route) => route.fulfill({ json: airplanesLiveWithCallsign(null) }));
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null,
    operator: { value: 'Ryanair', source: 'live', confidence: 1, logo_icao: 'RYR' },
    operator_country: null, registration: null, manufacturer: null,
    model: null, year_built: null, category: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForFunction(() => Object.keys(AIRLINE_LOGO_MANIFEST).length > 0);
  await page.evaluate(() => airplanesliveMarkers.get('dddddd')._icon.click());

  const logo = page.locator('#sidebar-details .identity-logo-row:has-text("Ryanair") .airline-logo');
  await expect(logo).toHaveAttribute('src', 'airline-logos/soaring/RYR.svg');
});
