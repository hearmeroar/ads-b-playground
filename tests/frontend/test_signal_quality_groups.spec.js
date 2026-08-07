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

test('detail groups are accessible accordions and every field has an icon', async ({ page }) => {
  await page.goto('http://127.0.0.1:5050/');
  await page.waitForLoadState('networkidle');

  await page.click('#toggle-dev-mode');
  await selectAircraft(page, 'eeeeee', 'adsbfi');

  const firstGroup = page.locator('#sidebar-details .detail-group').first();
  const toggle = firstGroup.locator('.detail-group-toggle');
  const body = firstGroup.locator('.detail-group-body');

  await expect(toggle.locator('.detail-group-chevron')).toBeVisible();
  await expect(toggle).toHaveCSS('text-transform', 'none');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(body).toBeVisible();

  const secondGroup = page.locator('#sidebar-details .detail-group').nth(1);
  await expect(secondGroup).toHaveCSS('margin-top', '8px');
  await expect(secondGroup).toHaveCSS('padding', '8px');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(body).toBeHidden();

  await page.evaluate(() => renderSelectedDetails());
  const rerenderedFirstGroup = page.locator('#sidebar-details .detail-group').first();
  await expect(rerenderedFirstGroup.locator('.detail-group-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(rerenderedFirstGroup.locator('.detail-group-body')).toBeHidden();

  await rerenderedFirstGroup.locator('.detail-group-toggle').click();
  await expect(rerenderedFirstGroup.locator('.detail-group-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(rerenderedFirstGroup.locator('.detail-group-body')).toBeVisible();

  await page.evaluate(() => {
    detailGroupCollapsedOverrides.clear();
    sidebarAccordionConfig.groups.position = true;
    renderSelectedDetails();
  });
  const configuredCollapsedGroup = page.locator('[data-group-key="position"]').locator('..');
  await expect(configuredCollapsedGroup.locator('.detail-group-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(configuredCollapsedGroup.locator('.detail-group-body')).toBeHidden();
  await page.evaluate(() => {
    sidebarAccordionConfig.groups.position = false;
    detailGroupCollapsedOverrides.clear();
    renderSelectedDetails();
  });

  const rows = page.locator('#sidebar-details .detail-row');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(0);
  expect(await page.locator('#sidebar-details .detail-row .detail-field-icon').count()).toBe(await rows.count());
  await expect(rows.first().locator('.detail-field-icon')).toHaveCSS('width', '15px');
  await expect(firstGroup.locator('.detail-group-icon')).toHaveCSS('width', '26px');

  const themedHierarchy = await firstGroup.evaluate((group) => {
    const root = document.documentElement;
    const originalTheme = root.dataset.theme;
    const results = ['light', 'dark'].map((theme) => {
      root.dataset.theme = theme;
      const title = group.querySelector('.detail-group-toggle');
      const groupIcon = group.querySelector('.detail-group-icon');
      const fieldLabel = group.querySelector('.detail-label');
      const fieldIcon = group.querySelector('.detail-field-icon');
      const tile = group.querySelector('.detail-row');
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--app-surface)';
      document.body.appendChild(probe);
      const surface = getComputedStyle(probe).backgroundColor;
      probe.style.backgroundColor = 'var(--app-surface-hover)';
      const surfaceHover = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        theme,
        title: getComputedStyle(title).color,
        groupIcon: getComputedStyle(groupIcon).color,
        fieldLabel: getComputedStyle(fieldLabel).color,
        fieldIcon: getComputedStyle(fieldIcon).color,
        groupBackground: getComputedStyle(group).backgroundColor,
        tileBackground: getComputedStyle(tile).backgroundColor,
        shellBackground: getComputedStyle(document.querySelector('#sidebar')).backgroundColor,
        surface,
        surfaceHover,
      };
    });
    if (originalTheme) root.dataset.theme = originalTheme;
    else delete root.dataset.theme;
    return results;
  });
  const colorAlpha = (color) => {
    const channels = color.match(/[\d.]+/g)?.map(Number) ?? [];
    return channels.length === 4 ? channels[3] : 1;
  };
  for (const hierarchy of themedHierarchy) {
    expect(hierarchy.groupIcon).toBe(hierarchy.title);
    expect(hierarchy.fieldIcon).toBe(hierarchy.fieldLabel);
    expect(hierarchy.title).not.toBe(hierarchy.fieldLabel);
    expect(hierarchy.groupBackground).toBe(hierarchy.surface);
    expect(hierarchy.tileBackground).toBe(hierarchy.surfaceHover);
    expect(colorAlpha(hierarchy.surface)).toBeLessThan(0.9);
    expect(colorAlpha(hierarchy.shellBackground)).toBeLessThan(0.9);
  }

  const tileHelp = page.locator('#sidebar-details .detail-group-body.tiles .detail-label .info-tip').first();
  const helpAlignment = await tileHelp.evaluate((tip) => {
    const labelRect = tip.closest('.detail-label').getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    return Math.abs(labelRect.right - tipRect.right);
  });
  expect(helpAlignment).toBeLessThanOrEqual(1);

  await page.click('#toggle-tile-layout');
  const listBody = page.locator('#sidebar-details .detail-group-body:not(.tiles)').first();
  await expect(listBody).toBeVisible();

  const listNicRow = page.locator('#sidebar-details [data-field="nic"]').first();
  const listHelpGap = await listNicRow.evaluate((row) => {
    const labelMain = row.querySelector('.detail-label-main').getBoundingClientRect();
    const tip = row.querySelector('.info-tip').getBoundingClientRect();
    return tip.left - labelMain.right;
  });
  expect(listHelpGap).toBeGreaterThanOrEqual(0);
  expect(listHelpGap).toBeLessThanOrEqual(5);

  const rowWithSecondary = page.locator(
    '#sidebar-details .detail-group-body:not(.tiles) .detail-row:has(.identity-logo-country)'
  ).first();
  await expect(rowWithSecondary).toBeVisible();
  const secondaryAlignment = await rowWithSecondary.evaluate((row) => {
    const primary = row.querySelector('.identity-logo-name').getBoundingClientRect();
    const secondary = row.querySelector('.identity-logo-country').getBoundingClientRect();
    return Math.abs(primary.left - secondary.left);
  });
  expect(secondaryAlignment).toBeLessThanOrEqual(1);

  await page.click('#toggle-tile-layout');
  const restoredTileHelp = page.locator(
    '#sidebar-details .detail-group-body.tiles .detail-label .info-tip'
  ).first();
  const restoredTileAlignment = await restoredTileHelp.evaluate((tip) => {
    const labelRect = tip.closest('.detail-label').getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    return Math.abs(labelRect.right - tipRect.right);
  });
  expect(restoredTileAlignment).toBeLessThanOrEqual(1);

  const accuracyIcons = await page.locator(
    '[data-field="nic"] .detail-field-icon path, '
    + '[data-field="nicBaro"] .detail-field-icon path, '
    + '[data-field="nacP"] .detail-field-icon path, '
    + '[data-field="nacV"] .detail-field-icon path, '
    + '[data-field="sil"] .detail-field-icon path, '
    + '[data-field="gva"] .detail-field-icon path, '
    + '[data-field="sda"] .detail-field-icon path, '
    + '[data-field="radiusOfContainmentM"] .detail-field-icon path'
  ).evaluateAll((paths) => paths.map((path) => path.getAttribute('d')));
  expect(accuracyIcons).toHaveLength(8);
  expect(new Set(accuracyIcons).size).toBe(8);
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
