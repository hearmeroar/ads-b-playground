const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

const KEYS = ['light', 'dark', 'voyager', 'streets', 'satellite', 'terrain'];

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
});

test('Voyager is the active basemap on load, all others are not', async ({ page }) => {
  const active = await page.evaluate((keys) =>
    Object.fromEntries(keys.map((k) => [k, map.hasLayer(baseLayers[k])])), KEYS);
  expect(active).toEqual({ light: false, dark: false, voyager: true, streets: false, satellite: false, terrain: false });

  const label = await page.textContent('#basemap-filter .dropdown-value');
  expect(label).toBe('Voyager');
});

for (const key of KEYS.filter((k) => k !== 'voyager')) {
  test(`switching to ${key} swaps the active tile layer and label`, async ({ page }) => {
    await page.click('#basemap-filter .dropdown-trigger');
    await page.click(`#basemap-filter .dropdown-option[data-value="${key}"]`);

    const active = await page.evaluate((keys) =>
      Object.fromEntries(keys.map((k) => [k, map.hasLayer(baseLayers[k])])), KEYS);
    const expected = Object.fromEntries(KEYS.map((k) => [k, k === key]));
    expect(active).toEqual(expected);

    const label = await page.textContent('#basemap-filter .dropdown-value');
    expect(label.toLowerCase()).toBe(key);
    expect(await page.isVisible('#basemap-filter .dropdown-menu')).toBe(false);
  });
}

test('the dropdown closes after picking an option', async ({ page }) => {
  await page.click('#basemap-filter .dropdown-trigger');
  expect(await page.evaluate(() => document.getElementById('basemap-filter').classList.contains('open'))).toBe(true);

  await page.click('#basemap-filter .dropdown-option[data-value="dark"]');
  expect(await page.evaluate(() => document.getElementById('basemap-filter').classList.contains('open'))).toBe(false);
});
