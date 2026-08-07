const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
  await page.goto('/');
  await page.waitForSelector('.plane-icon');
  await page.waitForFunction(() => !document.querySelector('#altitude-color-control').classList.contains('ui-config-pending'));
});

test('altitude mode ships enabled with a unit-aware fixed-scale legend', async ({ page }) => {
  await expect(page.locator('#toggle-altitude-color')).toBeChecked();
  await expect(page.locator('#altitude-legend')).toBeVisible();
  await expect(page.locator('#altitude-legend .altitude-legend-label')).toHaveText([
    '9,000 m+', '6,000 m', '3,000 m', '0 m',
  ]);
  const panelGap = await page.evaluate(() => {
    const legend = document.getElementById('altitude-legend').getBoundingClientRect();
    const hud = document.getElementById('hud').getBoundingClientRect();
    return Math.round(hud.left - legend.right);
  });
  expect(panelGap).toBeGreaterThanOrEqual(16);

  await page.click('#unit-toggle .seg-btn[data-value="imperial"]');
  await expect(page.locator('#altitude-legend .altitude-legend-label')).toHaveText([
    '29,528 ft+', '19,685 ft', '9,843 ft', '0 ft',
  ]);
});

test('dark theme uses a subdued translucent aircraft outline', async ({ page }) => {
  await page.click('#theme-mode-toggle .seg-btn[data-value="dark"]');

  const aircraftPath = page.locator('.plane-icon:not(.surface-obstacle-icon):not(.airport-icon) svg path').first();
  await expect(aircraftPath).toHaveCSS('stroke', 'rgba(255, 255, 255, 0.28)');
});

test('altitude color overrides uniform paint without changing source metadata', async ({ page }) => {
  const marker = page.locator('.plane-icon[data-color="#1a73e8"]').filter({ has: page.locator('svg') }).first();
  await expect(marker).toBeVisible();

  // OpenSky's first surviving marker is at exactly 3000 m in the fixture.
  const yellowMarker = page.locator('.plane-icon[data-color="#1a73e8"]')
    .filter({ has: page.locator('svg path') })
    .filter({ hasNot: page.locator('.surface-obstacle-icon') });
  const fills = await yellowMarker.locator('svg path').evaluateAll(
    (paths) => paths.map((path) => getComputedStyle(path).fill)
  );
  expect(fills).toContain('rgb(37, 99, 235)');
  expect(await marker.getAttribute('data-color')).toBe('#1a73e8');
  await expect(page.locator('body')).toHaveClass(/altitude-color-mode/);
  await expect(page.locator('body')).toHaveClass(/uniform-color-mode/);
});

test('disabling altitude mode hides the legend and restores uniform color', async ({ page }) => {
  await page.click('#toggle-altitude-color');
  await expect(page.locator('#altitude-legend')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/altitude-color-mode/);
  await page.waitForTimeout(600);

  const aircraftPath = page.locator('.plane-icon:not(.surface-obstacle-icon) svg path').first();
  await expect(aircraftPath).toHaveCSS('fill', 'rgb(28, 33, 40)');
});

test('UI config can hide the control and disable altitude coloring by default', async ({ page }) => {
  await page.unroute('**/api/config');
  await page.route('**/api/config', (route) => route.fulfill({ json: {
    center: { lat: 51.47, lon: -0.46 }, zoom: 8, radius_nm: 220, sources: {},
    ui: {
      map: { altitude_color: { visible: false, enabled_by_default: false } },
      sidebar: {
        tile_layout: { visible: true, enabled_by_default: true },
        accordion: { default_collapsed: false, groups: {} },
      },
    },
  } }));
  await page.reload();

  await expect(page.locator('#altitude-color-control')).toBeHidden();
  await expect(page.locator('#toggle-altitude-color')).not.toBeChecked();
  await expect(page.locator('#altitude-legend')).toBeHidden();
});
