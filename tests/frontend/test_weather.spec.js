const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

const DISCOVERY_RESPONSE = {
  radar: {
    past: [
      { time: 1000, path: '/v2/radar/aaa111' },
      { time: 2000, path: '/v2/radar/bbb222' }, // latest — should be the one used
    ],
    nowcast: [
      { time: 3000, path: '/v2/radar/ccc333' },
    ],
  },
};

const SIGMET_RESPONSE = [
  {
    icaoId: 'LYBA', hazard: 'TURB', qualifier: 'SEV', firName: 'BEOGRAD', base: 10000, top: 30000,
    coords: [{ lat: 43.0, lon: 20.0 }, { lat: 45.0, lon: 20.0 }, { lat: 44.0, lon: 23.0 }],
  },
];

const METAR_RESPONSE = [
  { icaoId: 'LWSK', name: 'Skopje Intl', lat: 41.952, lon: 21.627, fltCat: 'VFR', rawOb: 'METAR LWSK 181320Z ...' },
];

async function mockRainviewer(page, discoveryCount) {
  await page.route('**/public/weather-maps.json', (route) => {
    discoveryCount.n++;
    route.fulfill({ json: DISCOVERY_RESPONSE });
  });
  await page.route('**/v2/radar/**', (route) => route.fulfill({
    status: 200, contentType: 'image/png',
    // Smallest valid 1x1 transparent PNG.
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  }));
}

async function mockAviationWeather(page, counts) {
  await page.route('**/api/sigmet', (route) => {
    counts.sigmet = (counts.sigmet || 0) + 1;
    route.fulfill({ json: SIGMET_RESPONSE });
  });
  await page.route('**/api/metar', (route) => {
    counts.metar = (counts.metar || 0) + 1;
    route.fulfill({ json: METAR_RESPONSE });
  });
}

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
});

test('all four weather layers are off by default and fetch nothing', async ({ page }) => {
  const discoveryCount = { n: 0 };
  const awCounts = {};
  await mockRainviewer(page, discoveryCount);
  await mockAviationWeather(page, awCounts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(300);

  expect(discoveryCount.n).toBe(0);
  expect(awCounts.sigmet).toBeUndefined();
  expect(awCounts.metar).toBeUndefined();
  expect(await page.evaluate(() => weatherTileState.precip.layer === null)).toBe(true);
  expect(await page.evaluate(() => weatherTileState.nowcast.layer === null)).toBe(true);
  expect(await page.evaluate(() => weatherSigmetState.layer === null)).toBe(true);
  expect(await page.evaluate(() => weatherMetarState.layer === null)).toBe(true);
});

test('enabling Precipitation adds a tile layer using the latest past frame', async ({ page }) => {
  const discoveryCount = { n: 0 };
  await mockRainviewer(page, discoveryCount);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#toggle-weather-precip');
  await page.waitForFunction(() => weatherTileState.precip.layer !== null);

  expect(discoveryCount.n).toBe(1);
  expect(await page.evaluate(() => map.hasLayer(weatherTileState.precip.layer))).toBe(true);
  const url = await page.evaluate(() => weatherTileState.precip.layer._url);
  expect(url).toContain('/v2/radar/bbb222/'); // the later (latest) of the two past frames
  expect(await page.evaluate(() => weatherTileState.precip.layer.options.pane)).toBe('weatherPane');
  expect(await page.evaluate(() => weatherTileState.precip.layer.options.maxZoom)).toBe(19);
  // RainViewer's radar tiles genuinely stop at native zoom 7 (a real ~1-3KB
  // "Zoom Level Not Supported" placeholder image past that, not a blank
  // tile) — maxNativeZoom upscales instead of ever requesting past z=7.
  expect(await page.evaluate(() => weatherTileState.precip.layer.options.maxNativeZoom)).toBe(7);
});

test('enabling Forecast uses the nowcast frame, independently of Precipitation', async ({ page }) => {
  const discoveryCount = { n: 0 };
  await mockRainviewer(page, discoveryCount);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#toggle-weather-precip');
  await page.click('#toggle-weather-nowcast');
  await page.waitForFunction(() => weatherTileState.precip.layer !== null && weatherTileState.nowcast.layer !== null);

  // Both layers can be on at the same time — this is the whole point of the
  // multi-layer redesign (the old single-select dropdown couldn't do this).
  expect(await page.evaluate(() => map.hasLayer(weatherTileState.precip.layer))).toBe(true);
  expect(await page.evaluate(() => map.hasLayer(weatherTileState.nowcast.layer))).toBe(true);
  const nowcastUrl = await page.evaluate(() => weatherTileState.nowcast.layer._url);
  expect(nowcastUrl).toContain('/v2/radar/ccc333/');

  // Turning Precipitation back off leaves Forecast running.
  await page.click('#toggle-weather-precip');
  expect(await page.evaluate(() => weatherTileState.precip.layer === null)).toBe(true);
  expect(await page.evaluate(() => weatherTileState.nowcast.layer !== null && map.hasLayer(weatherTileState.nowcast.layer))).toBe(true);
});

test('switching the basemap does not remove an active precipitation layer (dedicated pane)', async ({ page }) => {
  const discoveryCount = { n: 0 };
  await mockRainviewer(page, discoveryCount);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#toggle-weather-precip');
  await page.waitForFunction(() => weatherTileState.precip.layer !== null);

  await page.click('#basemap-filter .dropdown-trigger');
  await page.click('#basemap-filter .dropdown-option[data-value="dark"]');

  expect(await page.evaluate(() => weatherTileState.precip.layer !== null && map.hasLayer(weatherTileState.precip.layer))).toBe(true);
});

test('disabling Precipitation removes the layer and stops further discovery fetches', async ({ page }) => {
  const discoveryCount = { n: 0 };
  await mockRainviewer(page, discoveryCount);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#toggle-weather-precip');
  await page.waitForFunction(() => weatherTileState.precip.layer !== null);
  expect(discoveryCount.n).toBe(1);

  await page.click('#toggle-weather-precip');
  expect(await page.evaluate(() => weatherTileState.precip.layer === null)).toBe(true);
  expect(await page.evaluate(() => weatherTileState.precip.timer === null)).toBe(true);

  await page.waitForTimeout(300);
  expect(discoveryCount.n).toBe(1); // no further fetch once disabled
});

test('enabling SIGMET fetches /api/sigmet and renders a hazard polygon', async ({ page }) => {
  const awCounts = {};
  await mockAviationWeather(page, awCounts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#toggle-weather-sigmet');
  await page.waitForFunction(() => weatherSigmetState.layer !== null);

  expect(awCounts.sigmet).toBe(1);
  const polygonCount = await page.evaluate(() => {
    let n = 0;
    weatherSigmetState.layer.eachLayer((l) => { if (l instanceof L.Polygon) n++; });
    return n;
  });
  expect(polygonCount).toBe(1);

  await page.click('#toggle-weather-sigmet');
  expect(await page.evaluate(() => weatherSigmetState.layer === null)).toBe(true);
});

test('enabling METAR fetches /api/metar and renders a station marker', async ({ page }) => {
  const awCounts = {};
  await mockAviationWeather(page, awCounts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#toggle-weather-metar');
  await page.waitForFunction(() => weatherMetarState.layer !== null);

  expect(awCounts.metar).toBe(1);
  const markerCount = await page.evaluate(() => {
    let n = 0;
    weatherMetarState.layer.eachLayer((l) => { if (l instanceof L.CircleMarker) n++; });
    return n;
  });
  expect(markerCount).toBe(1);

  await page.click('#toggle-weather-metar');
  expect(await page.evaluate(() => weatherMetarState.layer === null)).toBe(true);
});

test('all four layers can be enabled simultaneously', async ({ page }) => {
  const discoveryCount = { n: 0 };
  const awCounts = {};
  await mockRainviewer(page, discoveryCount);
  await mockAviationWeather(page, awCounts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#toggle-weather-precip');
  await page.click('#toggle-weather-nowcast');
  await page.click('#toggle-weather-sigmet');
  await page.click('#toggle-weather-metar');
  await page.waitForFunction(() =>
    weatherTileState.precip.layer !== null && weatherTileState.nowcast.layer !== null
    && weatherSigmetState.layer !== null && weatherMetarState.layer !== null);

  expect(await page.evaluate(() => [
    map.hasLayer(weatherTileState.precip.layer),
    map.hasLayer(weatherTileState.nowcast.layer),
    map.hasLayer(weatherSigmetState.layer),
    map.hasLayer(weatherMetarState.layer),
  ])).toEqual([true, true, true, true]);
});
