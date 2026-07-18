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

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
});

test('weather is off by default and does not fetch until a mode is selected', async ({ page }) => {
  const discoveryCount = { n: 0 };
  await mockRainviewer(page, discoveryCount);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(300);

  expect(discoveryCount.n).toBe(0);
  expect(await page.evaluate(() => weatherLayer === null)).toBe(true);
  expect(await page.textContent('#weather-filter .dropdown-value')).toBe('Off');
});

test('selecting Precipitation fetches the discovery JSON and adds a tile layer using the latest past frame', async ({ page }) => {
  const discoveryCount = { n: 0 };
  await mockRainviewer(page, discoveryCount);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#weather-filter .dropdown-trigger');
  await page.click('#weather-filter .dropdown-option[data-value="radar"]');
  await page.waitForFunction(() => weatherLayer !== null);

  expect(discoveryCount.n).toBe(1);
  expect(await page.evaluate(() => map.hasLayer(weatherLayer))).toBe(true);
  const url = await page.evaluate(() => weatherLayer._url);
  expect(url).toContain('/v2/radar/bbb222/'); // the later (latest) of the two past frames
  // Lives in its own pane, not the default tilePane the basemaps share.
  expect(await page.evaluate(() => weatherLayer.options.pane)).toBe('weatherPane');
  expect(await page.evaluate(() => weatherLayer.options.maxZoom)).toBe(19);
  // RainViewer's radar tiles genuinely stop at native zoom 7 (a real ~1-3KB
  // "Zoom Level Not Supported" placeholder image past that, not a blank
  // tile) — maxNativeZoom upscales instead of ever requesting past z=7.
  expect(await page.evaluate(() => weatherLayer.options.maxNativeZoom)).toBe(7);
});

test('selecting Forecast uses the nowcast frame instead', async ({ page }) => {
  const discoveryCount = { n: 0 };
  await mockRainviewer(page, discoveryCount);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#weather-filter .dropdown-trigger');
  await page.click('#weather-filter .dropdown-option[data-value="nowcast"]');
  await page.waitForFunction(() => weatherLayer !== null);

  const url = await page.evaluate(() => weatherLayer._url);
  expect(url).toContain('/v2/radar/ccc333/');
});

test('switching the basemap does not remove the weather layer (dedicated pane)', async ({ page }) => {
  const discoveryCount = { n: 0 };
  await mockRainviewer(page, discoveryCount);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#weather-filter .dropdown-trigger');
  await page.click('#weather-filter .dropdown-option[data-value="radar"]');
  await page.waitForFunction(() => weatherLayer !== null);

  await page.click('#basemap-filter .dropdown-trigger');
  await page.click('#basemap-filter .dropdown-option[data-value="dark"]');

  expect(await page.evaluate(() => weatherLayer !== null && map.hasLayer(weatherLayer))).toBe(true);
});

test('switching back to Off removes the layer and stops further discovery fetches', async ({ page }) => {
  const discoveryCount = { n: 0 };
  await mockRainviewer(page, discoveryCount);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#weather-filter .dropdown-trigger');
  await page.click('#weather-filter .dropdown-option[data-value="radar"]');
  await page.waitForFunction(() => weatherLayer !== null);
  expect(discoveryCount.n).toBe(1);

  await page.click('#weather-filter .dropdown-trigger');
  await page.click('#weather-filter .dropdown-option[data-value="off"]');
  expect(await page.evaluate(() => weatherLayer === null)).toBe(true);
  expect(await page.evaluate(() => weatherRefreshTimer === null)).toBe(true);

  // No further discovery fetch happens once off (the interval was cleared).
  await page.waitForTimeout(300);
  expect(discoveryCount.n).toBe(1);
});
