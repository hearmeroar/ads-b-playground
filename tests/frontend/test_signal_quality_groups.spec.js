import { test, expect } from '@playwright/test';
import { mockAllSources } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
});

async function selectAircraft(page, hex, markerMapName) {
  await page.evaluate(({ hex, markerMapName }) => {
    const marker = markerMapsBySource[markerMapName].get(hex);
    if (marker && marker._icon) marker._icon.click();
  }, { hex, markerMapName });
  await page.waitForTimeout(200);
}

// eeeeee (adsb.fi/airplanes.live only fixture) carries no NIC/NACp/etc. data
// at all, so these DO-260B rows only render with dev mode on (which always
// renders every row, dash-placeholder or not — see render-details.js's
// detailRow()). Every test below turns dev mode on before selecting.

test('Signal & Data Quality splits into three groups', async ({ page }) => {
  await page.goto('http://127.0.0.1:5050/');
  await page.waitForLoadState('networkidle');

  await page.click('#toggle-dev-mode');
  await page.waitForTimeout(100);

  // Select adsb.fi aircraft (eeeeee is adsb.fi/airplanes.live only)
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  // Wait for sidebar to appear
  await page.waitForSelector('#sidebar-details');

  // Check that three separate detail-groups exist with the correct titles
  const groups = await page.locator('.detail-group').all();
  const titles = await Promise.all(groups.map(g => g.locator('.detail-group-title').textContent()));

  expect(titles.some(t => t.includes('Message Info'))).toBeTruthy();
  expect(titles.some(t => t.includes('Position Accuracy'))).toBeTruthy();
  expect(titles.some(t => t.includes('Signal & Reception'))).toBeTruthy();
});

test('DO-260B fields have (?) help icons with tooltips', async ({ page }) => {
  await page.goto('http://127.0.0.1:5050/');
  await page.waitForLoadState('networkidle');

  await page.click('#toggle-dev-mode');
  await page.waitForTimeout(100);

  // Select adsb.fi aircraft
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  await page.waitForSelector('#sidebar-details');

  // Check that NIC, NACp, NACv, SIL, GVA, SDA have .info-tip icons
  const fields = ['NIC', 'NACp', 'NACv', 'SIL', 'GVA', 'SDA'];
  for (const field of fields) {
    const row = await page.locator(`.detail-label:has-text("${field}")`).locator('..').first();
    const hasTip = await row.locator('.info-tip').count();
    expect(hasTip).toBeGreaterThan(0, `${field} should have an .info-tip help icon`);
  }
});

test('Clicking DO-260B help icon shows explanation in #source-tooltip', async ({ page }) => {
  await page.goto('http://127.0.0.1:5050/');
  await page.waitForLoadState('networkidle');

  await page.click('#toggle-dev-mode');
  await page.waitForTimeout(100);

  // Select adsb.fi aircraft
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  await page.waitForSelector('#sidebar-details');

  // Click the NIC help icon
  const nicRow = await page.locator(`[data-field="nic"]`).first();
  const nicTip = nicRow.locator('.info-tip');

  await nicTip.click();

  // Check that #source-tooltip is visible with the right text
  const tooltip = page.locator('#source-tooltip');
  await expect(tooltip).toBeVisible();
  const tooltipText = await tooltip.textContent();

  expect(tooltipText).toContain('Navigation Integrity Category');
  expect(tooltipText).toContain('tighter guarantee');
});

test('Tooltip closes on outside click', async ({ page }) => {
  await page.goto('http://127.0.0.1:5050/');
  await page.waitForLoadState('networkidle');

  await page.click('#toggle-dev-mode');
  await page.waitForTimeout(100);

  // Select adsb.fi aircraft
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  await page.waitForSelector('#sidebar-details');

  // Click the help icon
  const nicRow = await page.locator(`[data-field="nic"]`).first();
  await nicRow.locator('.info-tip').click();

  // Verify tooltip is visible
  const tooltip = page.locator('#source-tooltip');
  await expect(tooltip).toBeVisible();

  // Click outside (e.g. on the map, away from the dev-mode-shifted sidebar)
  await page.click('#map', { position: { x: 850, y: 360 } });

  // Verify tooltip is hidden
  await expect(tooltip).toBeHidden();
});

test('Dev-mode source badges still render alongside help icons', async ({ page }) => {
  await page.goto('http://127.0.0.1:5050/');
  await page.waitForLoadState('networkidle');

  // Turn on dev mode
  await page.click('#toggle-dev-mode');
  await page.waitForTimeout(100);

  // Select adsb.fi aircraft
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  await page.waitForSelector('#sidebar-details');

  // Check that NIC row has both a help icon and a source badge
  const nicRow = await page.locator(`[data-field="nic"]`).first();
  const hasTip = await nicRow.locator('.info-tip').count();
  const hasBadge = await nicRow.locator('.source-badge').count();

  expect(hasTip).toBeGreaterThan(0, 'NIC should have help icon');
  expect(hasBadge).toBeGreaterThan(0, 'NIC should have source badge in dev mode');
});
