const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

// Belgrade Nikola Tesla (BEG/LYBE) — a real, stable OurAirports entry also
// used as the worked example in tests/backend/test_airports.py. A heliport
// fixture sits alongside it to exercise the distinct heliport glyph/class.
const AIRPORTS_RESPONSE = {
  airports: [
    {
      ident: 'LYBE', type: 'large_airport', name: 'Belgrade Nikola Tesla Airport',
      lat: 44.8184, lon: 20.3091, elevation_ft: 335, country: 'RS', country_name: 'Serbia',
      municipality: 'Belgrade', iata: 'BEG', icao: 'LYBE',
    },
    {
      ident: 'LYXH', type: 'heliport', name: 'Test Heliport',
      lat: 44.9, lon: 20.4, elevation_ft: 100, country: 'RS', country_name: 'Serbia',
      municipality: 'Belgrade', iata: null, icao: 'LYXH',
    },
  ],
};

async function mockAirports(page, counts) {
  await page.route('**/api/airports**', (route) => {
    counts.n = (counts.n || 0) + 1;
    counts.lastUrl = route.request().url();
    route.fulfill({ json: AIRPORTS_RESPONSE });
  });
}

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
});

test('airports layer is off by default and fetches nothing', async ({ page }) => {
  const counts = {};
  await mockAirports(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(300);

  expect(counts.n).toBeUndefined();
  expect(await page.evaluate(() => map.hasLayer(airportsState.clusterGroup))).toBe(false);
});

test('enabling Airports fetches the current viewport bbox and renders both airports', async ({ page }) => {
  const counts = {};
  await mockAirports(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#toggle-airports');
  await page.waitForFunction(() => airportsState.clusterGroup.getLayers().length === 2);

  expect(counts.n).toBe(1);
  expect(counts.lastUrl).toContain('bbox=');
  expect(await page.evaluate(() => map.hasLayer(airportsState.clusterGroup))).toBe(true);
});

test('panning the map re-fetches airports for the new viewport (debounced)', async ({ page }) => {
  const counts = {};
  await mockAirports(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#toggle-airports');
  await page.waitForFunction(() => airportsState.clusterGroup.getLayers().length === 2);
  expect(counts.n).toBe(1);

  await page.evaluate(() => map.panBy([600, 0])); // triggers a real moveend
  await page.waitForTimeout(800); // past AIRPORTS_FETCH_DEBOUNCE_MS
  expect(counts.n).toBe(2);
});

test('disabling Airports removes the layer and stops further fetches on pan', async ({ page }) => {
  const counts = {};
  await mockAirports(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#toggle-airports');
  await page.waitForFunction(() => airportsState.clusterGroup.getLayers().length === 2);
  expect(counts.n).toBe(1);

  await page.click('#toggle-airports');
  expect(await page.evaluate(() => map.hasLayer(airportsState.clusterGroup))).toBe(false);
  expect(await page.evaluate(() => airportsState.clusterGroup.getLayers().length)).toBe(0);

  await page.evaluate(() => map.panBy([600, 0]));
  await page.waitForTimeout(800);
  expect(counts.n).toBe(1); // no further fetch once disabled
});

test('airport marker popup shows name, codes, and elevation; heliport gets its own icon class', async ({ page }) => {
  const counts = {};
  await mockAirports(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#toggle-airports');
  await page.waitForFunction(() => airportsState.clusterGroup.getLayers().length === 2);

  const airportPopup = await page.evaluate(() => {
    const layer = airportsState.clusterGroup.getLayers().find((l) => l.getPopup().getContent().includes('Belgrade Nikola Tesla'));
    return layer.getPopup().getContent();
  });
  expect(airportPopup).toContain('Belgrade Nikola Tesla Airport');
  expect(airportPopup).toContain('BEG');
  expect(airportPopup).toContain('LYBE');
  expect(airportPopup).toContain('Large airport');

  const heliportIconHtml = await page.evaluate(() => {
    const layer = airportsState.clusterGroup.getLayers().find((l) => l.getPopup().getContent().includes('Test Heliport'));
    return layer.options.icon.options.html;
  });
  expect(heliportIconHtml).toContain('airport-icon-heliport');

  const airportIconHtml = await page.evaluate(() => {
    const layer = airportsState.clusterGroup.getLayers().find((l) => l.getPopup().getContent().includes('Belgrade Nikola Tesla'));
    return layer.options.icon.options.html;
  });
  expect(airportIconHtml).toContain('airport-icon-large-airport');
});

test('Airports (?) popover explains the layer and closes on outside click', async ({ page }) => {
  const counts = {};
  await mockAirports(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#airports-help');
  const text = (await page.textContent('#airports-help-popover')).trim();
  expect(text.length).toBeGreaterThan(20);

  await page.click('#map');
  await expect(page.locator('#airports-help-popover')).toHaveAttribute('hidden', '');
});
