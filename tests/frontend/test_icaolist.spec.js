const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

// Mirrors test_identity_enrichment.spec.js's own helpers — see that file
// for why markerMapsBySource/enrichmentById are used instead of a bare
// global marker map or a fixed wait.
async function selectAircraft(page, hex, markerMapName) {
  await page.evaluate(({ hex, markerMapName }) => {
    const marker = markerMapsBySource[markerMapName].get(hex);
    if (marker && marker._icon) marker._icon.click();
  }, { hex, markerMapName });
  await page.waitForFunction((hex) => enrichmentById.has(hex), hex);
  await page.waitForTimeout(100);
}

function badgeSourcesForLabel(page, label) {
  return page.evaluate((lbl) => {
    const labels = [...document.querySelectorAll('#sidebar-details .detail-label')];
    const labelEl = labels.find((el) =>
      el.querySelector('b')?.textContent === lbl || el.textContent.trim() === lbl);
    if (!labelEl) return null;
    return [...labelEl.closest('.detail-row').querySelectorAll('.detail-value .source-badge')]
      .map((badge) => badge.dataset.source);
  }, label);
}

async function clickBadge(page, label, index = 0) {
  await page.evaluate(({ lbl, index }) => {
    const labels = [...document.querySelectorAll('#sidebar-details .detail-label')];
    const labelEl = labels.find((el) =>
      el.querySelector('b')?.textContent === lbl || el.textContent.trim() === lbl);
    const badges = [...labelEl.closest('.detail-row').querySelectorAll('.detail-value .source-badge')];
    badges[index].click();
  }, { lbl: label, index });
  await page.waitForTimeout(100);
}

test.beforeEach(async ({ page }) => {
  await mockAllSources(page); // default /api/identity/** -> all-null
});

test('the ICAOList row stays hidden until dev mode is on, same as adsbdb.com\'s row', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await expect(page.locator('#source-icaolist')).toBeHidden();
  await page.click('#toggle-dev-mode');
  await expect(page.locator('#source-icaolist')).toBeVisible();
  await expect(page.locator('#toggle-icaolist')).toBeChecked();
  await page.click('#toggle-dev-mode');
  await expect(page.locator('#source-icaolist')).toBeHidden();
});

test('dev mode on: an icaolist-sourced field gets its own badge (not flywme) with its own tooltip', async ({ page }) => {
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null,
    operator: { value: 'Air Atlanta Europe', source: 'icaolist', confidence: 0.6 },
    registration: null, manufacturer: null, model: null, year_built: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#toggle-dev-mode');
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  expect(await badgeSourcesForLabel(page, 'Operator')).toEqual(['icaolist']);

  await clickBadge(page, 'Operator');
  expect(await page.textContent('#source-tooltip')).toBe(
    'ICAOList — computed from the rikgale/ICAOList dataset, confidence 0.6');
});

test('turning the ICAOList toggle off drops its contribution immediately, without a fresh poll', async ({ page }) => {
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null,
    operator: { value: 'Air Atlanta Europe', source: 'icaolist', confidence: 0.6 },
    registration: null, manufacturer: null, model: null, year_built: null,
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#toggle-dev-mode');
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  let sidebarText = await page.evaluate(() => document.querySelector('#sidebar').textContent);
  expect(sidebarText).toContain('Air Atlanta Europe');

  await page.click('#toggle-icaolist');
  await page.waitForTimeout(100);

  sidebarText = await page.evaluate(() => document.querySelector('#sidebar').textContent);
  expect(sidebarText).not.toContain('Air Atlanta Europe');
  expect(sidebarText).toContain('Unknown');
});
