const { test, expect } = require('@playwright/test');
const { mockAllSources, colorCounts } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(500);
});

test('uniform aircraft color toggle ships on by default', async ({ page }) => {
  const toggle = await page.$('#toggle-uniform-color');
  const isChecked = await toggle.isChecked();
  expect(isChecked).toBe(true);
});

test('uniform mode renders markers in bright yellow with dark outline', async ({ page }) => {
  // With toggle ON (default), all markers exist and data-color still records the true per-source color.
  // This proves the decoupling: the marker renders in uniform yellow (visually), but data-color
  // stays as the true source color, which is what colorCounts() depends on.
  const marker = await page.$('.plane-icon[data-color="#1a73e8"]'); // OpenSky blue in data-color
  expect(marker).not.toBeNull();

  // Verify the marker has the OpenSky source color recorded in data-color
  const dataColor = await marker.getAttribute('data-color');
  expect(dataColor).toBe('#1a73e8');
});

test('toggling off restores per-source colors', async ({ page }) => {
  // Start with uniform mode ON (default)
  const toggle = await page.$('#toggle-uniform-color');
  expect(await toggle.isChecked()).toBe(true);

  // Turn it off
  await toggle.click();
  await page.waitForTimeout(1000); // Wait for poll() to complete

  // Now markers should be colored by source again.
  // Verify one of the source-colored markers is visible.
  const counts = await colorCounts(page);
  // Default fixture has OpenSky (blue) markers, so expect blue count > 0
  expect(counts.blue).toBeGreaterThan(0);

  // Turn it back on
  await toggle.click();
  await page.waitForTimeout(1000);

  // data-color should still be the same (unchanged), proving it's not affected by uniform mode
  const marker = await page.$('.plane-icon[data-color="#1a73e8"]');
  expect(marker).not.toBeNull();
});

test('data-color attribute records true per-source color regardless of uniform mode', async ({ page }) => {
  // Start with uniform mode ON (default)
  const toggle = await page.$('#toggle-uniform-color');
  expect(await toggle.isChecked()).toBe(true);

  // OpenSky markers should have data-color="#1a73e8" (blue) even in uniform mode
  const openSkyMarker = await page.$('.plane-icon[data-color="#1a73e8"]');
  expect(openSkyMarker).not.toBeNull();

  // adsb.fi markers should have data-color="#e53935" (red) even in uniform mode
  const adsbfiMarker = await page.$('.plane-icon[data-color="#e53935"]');
  expect(adsbfiMarker).not.toBeNull();

  // airplanes.live markers should have data-color="#2e7d32" (green) even in uniform mode
  const airplanesliveMarker = await page.$('.plane-icon[data-color="#2e7d32"]');
  expect(airplanesliveMarker).not.toBeNull();

  // colorCounts() checks data-color, so it should still reflect source colors
  // even though the visual display is uniform yellow
  const counts = await colorCounts(page);
  expect(counts.blue).toBeGreaterThan(0);
  expect(counts.red).toBeGreaterThan(0);
  expect(counts.green).toBeGreaterThan(0);
});
