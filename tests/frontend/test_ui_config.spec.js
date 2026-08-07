const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

test('UI config can hide and disable compact tile layout', async ({ page }) => {
  await mockAllSources(page);
  await page.route('**/api/config', (route) => route.fulfill({ json: {
    center: { lat: 51.47, lon: -0.46 },
    zoom: 8,
    radius_nm: 220,
    sources: {},
    ui: {
      sidebar: {
        tile_layout: { visible: false, enabled_by_default: false },
        accordion: { default_collapsed: false, groups: {} },
      },
    },
  } }));

  await page.goto('/');
  await expect(page.locator('#tile-layout-control')).toBeHidden();
  await expect(page.locator('#toggle-tile-layout')).not.toBeChecked();
  expect(await page.evaluate(() => isTileLayoutEnabled())).toBe(false);
});
