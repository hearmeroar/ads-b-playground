const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

// London Heathrow — a real, stable OurAirports entry also used as the
// worked example in tests/backend/test_zones.py.
const HEATHROW = {
  ident: 'EGLL', type: 'large_airport', name: 'London Heathrow Airport',
  lat: 51.470748, lon: -0.459909, elevation_ft: 83, country: 'GB',
  country_name: 'United Kingdom', municipality: 'London', iata: 'LHR', icao: 'EGLL',
};

// London Gatwick — for multi-result and wraparound navigation tests.
const GATWICK = {
  ident: 'EGKK', type: 'large_airport', name: 'London Gatwick Airport',
  lat: 51.153662, lon: -0.182183, elevation_ft: 202, country: 'GB',
  country_name: 'United Kingdom', municipality: 'London', iata: 'LGW', icao: 'EGKK',
};

async function mockAirportSearch(page, counts) {
  await page.route('**/api/airports/search**', (route) => {
    counts.n = (counts.n || 0) + 1;
    counts.lastUrl = route.request().url();
    route.fulfill({ json: { airports: [HEATHROW] } });
  });
}

async function mockAirportSearchMulti(page, counts) {
  await page.route('**/api/airports/search**', (route) => {
    counts.n = (counts.n || 0) + 1;
    counts.lastUrl = route.request().url();
    route.fulfill({ json: { airports: [HEATHROW, GATWICK] } });
  });
}

async function mockZonesActive(page, counts, response) {
  await page.route('**/api/zones/active', (route) => {
    counts.n = (counts.n || 0) + 1;
    counts.lastBody = route.request().postDataJSON();
    if (response.fail) {
      route.fulfill({ status: 500, json: { error: 'zone_change_failed' } });
      return;
    }
    route.fulfill({
      json: {
        center: { lat: HEATHROW.lat, lon: HEATHROW.lon },
        zoom: 8, radius_nm: 220, bbox: { lamin: 49, lomin: -4, lamax: 54, lomax: 3 },
        active_zone_id: 'EGLL',
      },
    });
  });
}

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
});

test('typing below the minimum length fires no search request', async ({ page }) => {
  const counts = {};
  await mockAirportSearch(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.fill('#zone-search-input', 'h');
  await page.waitForTimeout(500); // past ZONE_SEARCH_DEBOUNCE_MS
  expect(counts.n).toBeUndefined();
});

test('typing a valid query fetches results and renders them after the debounce', async ({ page }) => {
  const counts = {};
  await mockAirportSearch(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.fill('#zone-search-input', 'heathrow');
  await page.waitForTimeout(500); // past ZONE_SEARCH_DEBOUNCE_MS

  expect(counts.n).toBe(1);
  expect(counts.lastUrl).toContain('q=heathrow');
  await expect(page.locator('#zone-search')).toHaveClass(/open/);
  const resultText = await page.textContent('.zone-search-result-name');
  expect(resultText).toContain('London Heathrow Airport');
  expect(resultText).toContain('LHR');
});

test('selecting a result recenters the map and re-polls immediately', async ({ page }) => {
  const searchCounts = {};
  const zoneCounts = {};
  const statesCounts = { n: 0 };
  await mockAirportSearch(page, searchCounts);
  await mockZonesActive(page, zoneCounts, {});
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  // Override /api/states (registered again after mockAllSources, so this
  // wins) purely to count calls — content doesn't matter for this test.
  await page.route('**/api/states', (route) => {
    statesCounts.n += 1;
    route.fulfill({ json: { states: [] } });
  });
  const statesBefore = statesCounts.n;

  await page.fill('#zone-search-input', 'heathrow');
  await page.waitForTimeout(500);
  await page.click('.zone-search-option');
  await page.waitForTimeout(300);

  expect(zoneCounts.n).toBe(1);
  expect(zoneCounts.lastBody.lat).toBeCloseTo(HEATHROW.lat, 4);
  expect(zoneCounts.lastBody.lon).toBeCloseTo(HEATHROW.lon, 4);
  expect(zoneCounts.lastBody.zone_id).toBe('EGLL');

  const center = await page.evaluate(() => map.getCenter());
  expect(center.lat).toBeCloseTo(HEATHROW.lat, 1);
  expect(center.lng).toBeCloseTo(HEATHROW.lon, 1);

  // poll() fired right away rather than waiting for the next interval tick.
  expect(statesCounts.n).toBeGreaterThan(statesBefore);

  // Selecting a result collapses the dropdown and fills the input.
  await expect(page.locator('#zone-search')).not.toHaveClass(/open/);
  expect(await page.inputValue('#zone-search-input')).toContain('London Heathrow Airport');
});

test('selecting a result rebuilds the scan-radius rings around the new center', async ({ page }) => {
  const searchCounts = {};
  const zoneCounts = {};
  await mockAirportSearch(page, searchCounts);
  await mockZonesActive(page, zoneCounts, {});
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  // Turn the rings on before switching zones so the rebuilt layer must also
  // stay visible, not just correctly centered.
  await page.check('#toggle-scan-radius');

  await page.fill('#zone-search-input', 'heathrow');
  await page.waitForTimeout(500);
  await page.click('.zone-search-option');
  await page.waitForTimeout(300);

  const shown = await page.evaluate(() => map.hasLayer(scanRadiusLayer));
  expect(shown).toBe(true);

  const ringCenter = await page.evaluate(() => {
    let center = null;
    scanRadiusLayer.eachLayer((l) => {
      if (l instanceof L.Circle) center = l.getLatLng();
    });
    return center;
  });
  expect(ringCenter.lat).toBeCloseTo(HEATHROW.lat, 3);
  expect(ringCenter.lng).toBeCloseTo(HEATHROW.lon, 3);
});

test('a failed zone change shows an inline error and leaves the map untouched', async ({ page }) => {
  const searchCounts = {};
  const zoneCounts = {};
  await mockAirportSearch(page, searchCounts);
  await mockZonesActive(page, zoneCounts, { fail: true });
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  const centerBefore = await page.evaluate(() => map.getCenter());

  await page.fill('#zone-search-input', 'heathrow');
  await page.waitForTimeout(500);
  await page.click('.zone-search-option');
  await page.waitForTimeout(300);

  await expect(page.locator('#zone-search-status')).not.toHaveAttribute('hidden', '');
  const statusText = await page.textContent('#zone-search-status');
  expect(statusText.length).toBeGreaterThan(0);

  const centerAfter = await page.evaluate(() => map.getCenter());
  expect(centerAfter.lat).toBeCloseTo(centerBefore.lat, 3);
  expect(centerAfter.lng).toBeCloseTo(centerBefore.lng, 3);
});

test('the first result is highlighted by default when results render', async ({ page }) => {
  const counts = {};
  await mockAirportSearch(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.fill('#zone-search-input', 'heathrow');
  await page.waitForTimeout(500);

  await expect(page.locator('#zone-search-results .dropdown-option').first()).toHaveClass(/active/);
});

test('ArrowDown and ArrowUp navigate through results with wraparound', async ({ page }) => {
  const counts = {};
  await mockAirportSearchMulti(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.fill('#zone-search-input', 'london');
  await page.waitForTimeout(500);

  // First result should be highlighted by default
  await expect(page.locator('#zone-search-results .dropdown-option').nth(0)).toHaveClass(/active/);
  await expect(page.locator('#zone-search-results .dropdown-option').nth(1)).not.toHaveClass(/active/);

  // ArrowDown moves to second result
  await page.press('#zone-search-input', 'ArrowDown');
  await expect(page.locator('#zone-search-results .dropdown-option').nth(0)).not.toHaveClass(/active/);
  await expect(page.locator('#zone-search-results .dropdown-option').nth(1)).toHaveClass(/active/);

  // ArrowDown again wraps back to first result
  await page.press('#zone-search-input', 'ArrowDown');
  await expect(page.locator('#zone-search-results .dropdown-option').nth(0)).toHaveClass(/active/);
  await expect(page.locator('#zone-search-results .dropdown-option').nth(1)).not.toHaveClass(/active/);

  // ArrowUp from first wraps to last result
  await page.press('#zone-search-input', 'ArrowUp');
  await expect(page.locator('#zone-search-results .dropdown-option').nth(0)).not.toHaveClass(/active/);
  await expect(page.locator('#zone-search-results .dropdown-option').nth(1)).toHaveClass(/active/);
});

test('Enter selects the currently-highlighted result, not just the first', async ({ page }) => {
  const searchCounts = {};
  const zoneCounts = {};
  const statesCounts = { n: 0 };
  await mockAirportSearchMulti(page, searchCounts);
  await mockZonesActive(page, zoneCounts, {});
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.route('**/api/states', (route) => {
    statesCounts.n += 1;
    route.fulfill({ json: { states: [] } });
  });

  await page.fill('#zone-search-input', 'london');
  await page.waitForTimeout(500);

  // Move highlight to second result (Gatwick)
  await page.press('#zone-search-input', 'ArrowDown');

  // Press Enter to select the highlighted (Gatwick) result
  await page.press('#zone-search-input', 'Enter');
  await page.waitForTimeout(300);

  // Verify the zone change request went to Gatwick, not Heathrow
  expect(zoneCounts.n).toBe(1);
  expect(zoneCounts.lastBody.zone_id).toBe('EGKK');
  expect(zoneCounts.lastBody.lat).toBeCloseTo(GATWICK.lat, 4);
  expect(zoneCounts.lastBody.lon).toBeCloseTo(GATWICK.lon, 4);

  // Verify the input value updated to Gatwick
  expect(await page.inputValue('#zone-search-input')).toContain('London Gatwick Airport');

  // Verify poll() was called
  expect(statesCounts.n).toBeGreaterThan(0);
});

test('Enter and Arrows do nothing when the dropdown is closed', async ({ page }) => {
  const searchCounts = {};
  const zoneCounts = {};
  await mockAirportSearch(page, searchCounts);
  await mockZonesActive(page, zoneCounts, {});
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.fill('#zone-search-input', 'heathrow');
  await page.waitForTimeout(500);

  // Close the dropdown with Escape
  await page.press('#zone-search-input', 'Escape');
  await expect(page.locator('#zone-search')).not.toHaveClass(/open/);

  // Press Enter while dropdown is closed — should do nothing
  await page.press('#zone-search-input', 'Enter');
  await page.waitForTimeout(300);

  // No zone change request should have been made
  expect(zoneCounts.n).toBeUndefined();

  // Dropdown should still be closed
  await expect(page.locator('#zone-search')).not.toHaveClass(/open/);
});

test('Escape still closes the dropdown (regression test)', async ({ page }) => {
  const counts = {};
  await mockAirportSearch(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.fill('#zone-search-input', 'heathrow');
  await page.waitForTimeout(500);

  // Dropdown should be open
  await expect(page.locator('#zone-search')).toHaveClass(/open/);

  // Press Escape to close
  await page.press('#zone-search-input', 'Escape');

  // Dropdown should be closed
  await expect(page.locator('#zone-search')).not.toHaveClass(/open/);
});
