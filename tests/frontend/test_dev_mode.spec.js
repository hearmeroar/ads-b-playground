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
  // Registration is #sidebar-header's title now, no <b>Registration:</b>
  // label wrapper anywhere.
  const headerText = await page.evaluate(() => document.querySelector('#sidebar-header').textContent);
  expect(headerText).toContain('OO-DUP');
  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).not.toContain('—'); // no dash placeholders when off
  const badgeCount = await page.evaluate(() =>
    document.querySelectorAll('#sidebar-header .source-badge, #sidebar-details .source-badge, #sidebar-route .source-badge').length);
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

// Rows aren't individually wrapped elements (just <b>label:</b>
// value<badge><badge> concatenated with <br> inside one .detail-group div),
// so this walks nextSibling from the row's own <b> label, collecting every
// .source-badge up to the row-separating <br> — the same scoping trick the
// row-badge assertions below rely on.
function badgeSourcesForLabel(page, label) {
  return page.evaluate((lbl) => {
    const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === lbl);
    if (!b) return null;
    const sources = [];
    let node = b.nextSibling;
    while (node && !(node.nodeType === 1 && node.tagName === 'BR')) {
      if (node.nodeType === 1 && node.classList.contains('source-badge')) sources.push(node.dataset.source);
      node = node.nextSibling;
    }
    return sources;
  }, label);
}

test('a field reported by only one source shows exactly one badge, with a click-to-toggle tooltip', async ({ page }) => {
  await page.click('#toggle-dev-mode');
  await selectDddddd(page);

  // Country (originCountry) has no equivalent field on adsb.fi/airplanes.live's
  // own parsed record at all (normalizeAdsbExchange always sets it null) —
  // OpenSky is the only possible source for it, a clean single-badge case.
  expect(await badgeSourcesForLabel(page, 'Country:')).toEqual(['opensky']);

  // Tooltip hidden until clicked.
  expect(await page.getAttribute('#source-tooltip', 'hidden')).not.toBeNull();

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === 'Country:');
    let node = b.nextSibling;
    while (node && !(node.nodeType === 1 && node.classList.contains('source-badge'))) node = node.nextSibling;
    node.click();
  });
  await page.waitForTimeout(100);

  expect(await page.getAttribute('#source-tooltip', 'hidden')).toBeNull();
  expect(await page.textContent('#source-tooltip')).toBe('OpenSky');

  // Clicking elsewhere closes it. A plain center click would now land on
  // the sidebar itself — dev mode docks it to the right of the "all
  // aircraft" table (#sidebar.dev-shifted), so both stay visible/usable
  // together — so this targets open map area between that table+sidebar
  // pair (left) and #hud (right) instead.
  await page.click('#map', { position: { x: 850, y: 360 } });
  await page.waitForTimeout(100);
  expect(await page.getAttribute('#source-tooltip', 'hidden')).not.toBeNull();
});

test('a field independently reported by several enabled sources shows one badge per source', async ({ page }) => {
  await page.click('#toggle-dev-mode');
  await selectDddddd(page);

  // Fixture "dddddd" is reported by both adsb.fi and airplanes.live (both
  // enabled by default), each with its own "OO-DUP" registration record —
  // dev mode must show a badge for each, not just the one whose value won.
  // Registration is the header's title now, badges attach there directly
  // (no <b>Registration:</b> label wrapper).
  const sources = await page.evaluate(() =>
    [...document.querySelectorAll('#sidebar-header .sidebar-header-title .source-badge')].map((b) => b.dataset.source));
  expect(sources).toEqual(['airplaneslive', 'adsbfi']);

  // Each badge opens its own tooltip independently.
  await page.evaluate(() => {
    document.querySelectorAll('#sidebar-header .sidebar-header-title .source-badge')[0].click(); // airplanes.live
  });
  await page.waitForTimeout(100);
  expect(await page.textContent('#source-tooltip')).toBe('airplanes.live');

  await page.evaluate(() => {
    document.querySelectorAll('#sidebar-header .sidebar-header-title .source-badge')[1].click(); // adsb.fi
  });
  await page.waitForTimeout(100);
  expect(await page.textContent('#source-tooltip')).toBe('adsb.fi');
});

test('toggling dev mode off restores the exact non-dev-mode markup', async ({ page }) => {
  await page.click('#toggle-dev-mode');
  await selectDddddd(page);
  await page.click('#toggle-dev-mode'); // off again, sidebar still open

  const headerText = await page.evaluate(() => document.querySelector('#sidebar-header').textContent);
  expect(headerText).toContain('OO-DUP');
  const sidebarText = await page.evaluate(() => document.querySelector('#sidebar-details').textContent);
  expect(sidebarText).not.toContain('—');
  const badgeCount = await page.evaluate(() =>
    document.querySelectorAll('#sidebar-header .source-badge, #sidebar-details .source-badge, #sidebar-route .source-badge').length);
  expect(badgeCount).toBe(0);
});

// /api/adsbdb/** is always mocked (see mockAllSources), so the real backend
// endpoint this stats panel reads from (app.py's persistent _identity_cache)
// never actually gets populated during this suite — asserting the exact
// shape rather than a specific count, since the real number depends on
// backend state this test doesn't control.
test('dev mode shows the identity-cache stats line, hidden the rest of the time', async ({ page }) => {
  // mockAllSources' blanket "**/api/identity/**" mock (for the per-aircraft
  // enrichment route) would otherwise also swallow this distinct stats
  // route — register a more specific override (Playwright matches the
  // most-recently-registered route) with the real shape this endpoint
  // actually returns.
  await page.route('**/api/identity/stats', (route) => route.fulfill({
    json: { identity_count: 3, history_count: 1 },
  }));

  expect(await page.isVisible('#dev-identity-stats')).toBe(false);

  await page.click('#toggle-dev-mode');
  await page.waitForFunction(() => document.querySelector('#dev-identity-stats').textContent.length > 0);
  const text = await page.textContent('#dev-identity-stats');
  expect(text).toBe('Identity cache: 3 aircraft · 1 changes logged');

  await page.click('#toggle-dev-mode');
  expect(await page.isVisible('#dev-identity-stats')).toBe(false);
});
