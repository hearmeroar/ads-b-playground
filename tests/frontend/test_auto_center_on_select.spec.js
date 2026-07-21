const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
});

test('auto-centers the map when selecting an aircraft (toggle on by default)', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  // Verify toggle defaults to checked
  const autoCenterToggle = await page.locator('#toggle-auto-center');
  const isChecked = await autoCenterToggle.isChecked();
  expect(isChecked).toBe(true);

  // Pan/zoom away so the centering is observable
  await page.evaluate(() => map.setView([30, 40], 5));
  const zoomBefore = await page.evaluate(() => map.getZoom());

  // Click the aircraft marker
  await page.evaluate(() => {
    const marker = openskyMarkers.get('aaaaaa');
    if (marker && marker._icon) marker._icon.click();
  });
  await expect(page.locator('#sidebar')).toHaveClass(/open/);

  // Wait for animation to complete (1500ms duration + buffer)
  await page.waitForTimeout(800);

  // Verify map flew to the aircraft position (lat 44.0, lon 21.0 from states.json)
  const center = await page.evaluate(() => map.getCenter());
  expect(center.lat).toBeCloseTo(44.0, 1);
  expect(center.lng).toBeCloseTo(21.0, 1);

  // Zoom level should be preserved
  expect(await page.evaluate(() => map.getZoom())).toBe(zoomBefore);
});

test('does not auto-center when toggle is unchecked', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  // Uncheck the auto-center toggle
  await page.locator('#toggle-auto-center').uncheck();

  // Pan/zoom away
  await page.evaluate(() => map.setView([30, 40], 5));
  const centerBefore = await page.evaluate(() => map.getCenter());
  const zoomBefore = await page.evaluate(() => map.getZoom());

  // Click the aircraft marker
  await page.evaluate(() => {
    const marker = openskyMarkers.get('aaaaaa');
    if (marker && marker._icon) marker._icon.click();
  });
  await expect(page.locator('#sidebar')).toHaveClass(/open/);

  // Wait a bit (no animation should occur)
  await page.waitForTimeout(500);

  // Map position should be unchanged
  const centerAfter = await page.evaluate(() => map.getCenter());
  expect(centerAfter.lat).toBeCloseTo(centerBefore.lat, 1);
  expect(centerAfter.lng).toBeCloseTo(centerBefore.lng, 1);
  expect(await page.evaluate(() => map.getZoom())).toBe(zoomBefore);
});

test('respects the toggle state when toggled on after being off', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  // Start with toggle off
  await page.locator('#toggle-auto-center').uncheck();

  // Pan away
  await page.evaluate(() => map.setView([30, 40], 5));

  // Click marker — should not move
  await page.evaluate(() => {
    const marker = openskyMarkers.get('aaaaaa');
    if (marker && marker._icon) marker._icon.click();
  });
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
  await page.waitForTimeout(100);
  const centerWithToggleOff = await page.evaluate(() => map.getCenter());

  // Close sidebar
  await page.locator('#sidebar-close').click();
  await page.waitForTimeout(100);

  // Now turn toggle back on and select again
  await page.locator('#toggle-auto-center').check();
  await page.evaluate(() => {
    const marker = openskyMarkers.get('aaaaaa');
    if (marker && marker._icon) marker._icon.click();
  });
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
  await page.waitForTimeout(800);

  // Should now be centered on aircraft
  const centerWithToggleOn = await page.evaluate(() => map.getCenter());
  expect(centerWithToggleOn.lat).toBeCloseTo(44.0, 1);
  expect(centerWithToggleOn.lng).toBeCloseTo(21.0, 1);
});
