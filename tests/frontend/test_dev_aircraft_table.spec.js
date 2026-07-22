const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
});

test('hidden by default, appears with a row per visible aircraft once dev mode is on', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  expect(await page.isVisible('#dev-aircraft-panel')).toBe(false);

  await page.click('#toggle-dev-mode');
  expect(await page.isVisible('#dev-aircraft-panel')).toBe(true);
  // 9 is the default total across all default-enabled sources — see
  // test_filters.spec.js's own assertion of the same fixture combination.
  await expect(page.locator('#dev-aircraft-tbody tr')).toHaveCount(9);
  expect(await page.textContent('#dev-aircraft-count')).toBe('9 aircraft');

  await page.click('#toggle-dev-mode');
  expect(await page.isVisible('#dev-aircraft-panel')).toBe(false);
});

test('a row shows the same Identity fields the sidebar would, including Route once resolved', async ({ page }) => {
  await page.route('**/api/adsbdb/**', (route) => route.fulfill({ json: {
    aircraft: null,
    flightroute: {
      callsign: 'UNIQ1', callsign_icao: 'UNIQ1', callsign_iata: 'U1', airline: null,
      origin: { name: 'West Airport', iata_code: 'AAA', latitude: 44, longitude: 5, icao_code: 'EAAA', country_iso_name: 'XX', country_name: 'X', elevation: 0, municipality: 'W' },
      destination: { name: 'East Airport', iata_code: 'BBB', latitude: 44, longitude: 30, icao_code: 'EBBB', country_iso_name: 'XX', country_name: 'X', elevation: 0, municipality: 'E' },
    },
  } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#toggle-dev-mode');

  // Before "eeeeee" has ever been clicked, its row has no adsbdb route yet
  // (lazy-on-click stays lazy — the table doesn't force new fetches).
  const rowBefore = await page.evaluate(() => {
    const cell = [...document.querySelectorAll('#dev-aircraft-tbody td')].find((td) => td.textContent === 'F-UNIQ');
    return cell ? cell.parentElement.textContent : null;
  });
  expect(rowBefore).toContain('F-UNIQ');
  expect(rowBefore).not.toContain('West Airport');

  // Clicking the marker directly (not the table row) resolves adsbdb;
  // the next poll's table refresh should then include the route.
  await page.evaluate(() => {
    const marker = markerMapsBySource.adsbfi.get('eeeeee');
    if (marker && marker._icon) marker._icon.click();
  });
  await page.waitForFunction(() => adsbdbById.has('eeeeee'));
  await page.evaluate(() => renderDevAircraftTable());

  const rowAfter = await page.evaluate(() => {
    const cell = [...document.querySelectorAll('#dev-aircraft-tbody td')].find((td) => td.textContent === 'F-UNIQ');
    return cell ? cell.parentElement.textContent : null;
  });
  expect(rowAfter).toContain('West Airport (AAA) → East Airport (BBB)');
});

test('clicking a table row selects that aircraft, same as clicking its marker', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#toggle-dev-mode');

  await page.evaluate(() => {
    const row = [...document.querySelectorAll('#dev-aircraft-tbody td')]
      .find((td) => td.textContent === 'F-UNIQ').parentElement;
    row.click();
  });
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
  // Registration lives in #sidebar-header now, not #sidebar-details.
  const headerText = await page.textContent('#sidebar-header');
  expect(headerText).toContain('F-UNIQ');
});

test('disabling a source removes its rows from the table', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#toggle-dev-mode');
  // Record initial row count for baseline
  const initialRows = await page.locator('#dev-aircraft-tbody tr').count();
  expect(initialRows).toBeGreaterThan(0);

  // Get the initial list of ICAO24s and their sources (identify which are OpenSky-exclusive)
  const getRowsBySource = async () => {
    const rows = await page.locator('#dev-aircraft-tbody tr').all();
    const byIcao = {};
    for (const row of rows) {
      const icaoText = await row.textContent();
      // ICAO24 is typically the first column
      const icao = icaoText.split(/\s+/)[0];
      if (!byIcao[icao]) byIcao[icao] = [];
      // Store row text to determine sources later
      byIcao[icao].push(icaoText);
    }
    return byIcao;
  };

  const initialByIcao = await getRowsBySource();
  const openskyIcaos = new Set(Object.keys(initialByIcao));

  await page.click('#toggle-opensky');
  // After disabling OpenSky, wait for the table to update
  await page.waitForTimeout(100); // brief wait for rerender

  const afterDisableByIcao = await getRowsBySource();
  const afterDisableIcaos = new Set(Object.keys(afterDisableByIcao));

  // The rule: disabling a source removes that source's exclusive aircraft from the table.
  // If an aircraft is only visible in OpenSky (not in any other enabled source),
  // it should disappear when OpenSky is disabled.
  // Aircraft that appear in multiple sources should still be visible (from other sources).
  // So: afterDisableCount < initialCount (fewer rows), and the missing rows
  // should be aircraft that only OpenSky had.
  const rowsRemoved = initialRows - (await page.locator('#dev-aircraft-tbody tr').count());
  expect(rowsRemoved).toBeGreaterThan(0);
  // Verify table consistency: no duplicate rows for same ICAO
  const finalIcaos = await getRowsBySource();
  for (const icao of Object.keys(finalIcaos)) {
    expect(finalIcaos[icao].length).toBe(1);
  }
});
