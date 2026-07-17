const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(500);
});

// "dddddd" is OpenSky's own marker (dedup winner) enriched with adsb.fi's
// registration/aircraft type (OO-DUP / AIRBUS A-320) — a good aircraft to
// exercise both an OpenSky-sourced field (e.g. Altitude) and an
// adsb.fi-sourced enrichment field (Registration) in the same sidebar.
async function selectDddddd(page) {
  await page.evaluate(() => {
    const marker = openskyMarkers.get('dddddd');
    if (marker && marker._icon) marker._icon.click();
  });
  await page.waitForTimeout(300);
}

test('dev mode off matches today\'s exact rendering (no regression)', async ({ page }) => {
  await selectDddddd(page);
  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).toContain('Registration');
  expect(sidebarText).toContain('OO-DUP');
  expect(sidebarText).not.toContain('—'); // no dash placeholders when off
  const badgeCount = await page.evaluate(() => document.querySelectorAll('#sidebar-details .source-badge').length);
  expect(badgeCount).toBe(0);
});

test('dev mode shows a dash for missing fields and never hides a group', async ({ page }) => {
  await page.click('#toggle-dev-mode');
  await selectDddddd(page);

  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  // "gggggg"/aaaaaa etc have no autopilot/weather data in the fixtures, so
  // these groups are normally hidden entirely — dev mode must show them.
  expect(sidebarText).toContain('Autopilot');
  expect(sidebarText).toContain('Weather');
  expect(sidebarText).toContain('—'); // dash placeholder present somewhere
});

test('a populated field shows a colored source badge with a click-to-toggle tooltip', async ({ page }) => {
  await page.click('#toggle-dev-mode');
  await selectDddddd(page);

  // Registration is an adsb.fi-enrichment-only field on this aircraft. Rows
  // aren't individually wrapped elements (just <b>label:</b> value<badge>
  // concatenated with <br> inside one .detail-group div), so scope by
  // matching the badge that immediately follows the "Registration:" text
  // in the group's innerHTML rather than DOM traversal from a shared parent.
  const badgeSource = await page.evaluate(() => {
    const html = document.querySelector('#sidebar-details').innerHTML;
    const m = html.match(/<b>Registration:<\/b>[^<]*<span class="source-badge"[^>]*data-source="([^"]+)"/);
    return m ? m[1] : null;
  });
  expect(badgeSource).toBe('adsbfi');

  // Tooltip hidden until clicked.
  expect(await page.getAttribute('#source-tooltip', 'hidden')).not.toBeNull();

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === 'Registration:');
    let node = b.nextSibling;
    while (node && !(node.nodeType === 1 && node.classList.contains('source-badge'))) node = node.nextSibling;
    node.click();
  });
  await page.waitForTimeout(100);

  expect(await page.getAttribute('#source-tooltip', 'hidden')).toBeNull();
  expect(await page.textContent('#source-tooltip')).toBe('adsb.fi');

  // Clicking elsewhere closes it.
  await page.click('#map');
  await page.waitForTimeout(100);
  expect(await page.getAttribute('#source-tooltip', 'hidden')).not.toBeNull();
});

test('toggling dev mode off restores the exact non-dev-mode markup', async ({ page }) => {
  await page.click('#toggle-dev-mode');
  await selectDddddd(page);
  await page.click('#toggle-dev-mode'); // off again, sidebar still open

  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).toContain('Registration');
  expect(sidebarText).toContain('OO-DUP');
  expect(sidebarText).not.toContain('—');
  const badgeCount = await page.evaluate(() => document.querySelectorAll('#sidebar-details .source-badge').length);
  expect(badgeCount).toBe(0);
});
