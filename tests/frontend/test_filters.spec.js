const { test, expect } = require('@playwright/test');
const { mockAllSources, colorCounts } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(500);
});

test('motion filter partitions OpenSky markers into air/ground correctly', async ({ page }) => {
  // states.json: 5 total, 4 airborne, 1 on the ground ("gggggg").
  await page.click('#motion-filter .seg-btn[data-value="airborne"]');
  await page.waitForTimeout(500);
  expect((await colorCounts(page)).blue).toBe(4);

  await page.click('#motion-filter .seg-btn[data-value="ground"]');
  await page.waitForTimeout(500);
  expect((await colorCounts(page)).blue).toBe(1);

  await page.click('#motion-filter .seg-btn[data-value="all"]');
  await page.waitForTimeout(500);
  expect((await colorCounts(page)).blue).toBe(5);
});

test('category dropdown filters to an exact count', async ({ page }) => {
  await page.click('#category-filter .dropdown-trigger');
  await page.click('#category-filter .dropdown-option[data-value="rotorcraft"]');
  await page.waitForTimeout(500);

  const total = await page.evaluate(() => document.getElementById('count').textContent);
  expect(total).toBe('1'); // only "bbbbbb" (OpenSky category 8) qualifies

  await page.click('#category-filter .dropdown-trigger');
  await page.click('#category-filter .dropdown-option[data-value="all"]');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.getElementById('count').textContent)).toBe('7');
});

test('Hide non-aircraft hides junk by default and reveals it with a triangle icon when disabled', async ({ page }) => {
  let counts = await colorCounts(page);
  expect(counts.red).toBe(1); // TWR + callsign-pattern entries hidden by default

  await page.click('#toggle-hide-junk');
  await page.waitForTimeout(600);
  counts = await colorCounts(page);
  expect(counts.red).toBe(3); // both junk entries now shown alongside the real one

  const triangleCount = await page.evaluate(
    () => document.querySelectorAll('.plane-icon svg path[d^="M12,3L22,20H2L12,3z"]').length
  );
  expect(triangleCount).toBe(2); // the TWR and callsign-pattern entries specifically
});
