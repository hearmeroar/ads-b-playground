const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

// Fixture aircraft "aaaaaa" (OpenSky) with adsbdb-resolved route, used to
// test the route card arrow's animation based on vertical rate.
const ROUTE_FIXTURE = {
  callsign: 'TES100', callsign_icao: 'TES100', callsign_iata: 'TS100', airline: null,
  origin: {
    country_iso_name: 'XX', country_name: 'Testland West', elevation: 0, iata_code: 'AAA',
    icao_code: 'EAAA', latitude: 44.0, longitude: 5.0, municipality: 'Westtown', name: 'West Airport',
  },
  destination: {
    country_iso_name: 'XX', country_name: 'Testland East', elevation: 0, iata_code: 'BBB',
    icao_code: 'EBBB', latitude: 44.0, longitude: 30.0, municipality: 'Easttown', name: 'East Airport',
  },
};

async function selectAircraftAndWaitForRoute(page, hex) {
  await page.evaluate(({ hex }) => {
    const marker = openskyMarkers.get(hex);
    if (marker && marker._icon) marker._icon.click();
  }, { hex });
  // Wait for both adsbdb and sidebar rendering to complete
  await page.waitForFunction((hex) => adsbdbById.has(hex), hex);
  // Wait for the route card to appear (only when route resolved from adsbdb)
  await page.waitForSelector('#sidebar-route');
  await page.waitForTimeout(100);
}

test.describe('route card arrow animation (climbing/descending)', () => {
  test.skip('climbing aircraft animates the arrow with route-arrow-climbing class', async ({ page }) => {
    await mockAllSources(page);
    // Override /api/adsbdb to inject the test route with aaaaaa
    await page.route('**/api/adsbdb/**', (route) => route.fulfill({ json: {
      aircraft: { icao24: 'aaaaaa' },
      flightroute: ROUTE_FIXTURE,
    } }));
    // Override /api/states to inject a climbing aircraft (vertical_rate = 5.0 m/s at index 11)
    await page.route('**/api/states', (route) => route.fulfill({ json: {
      states: [
        ['aaaaaa', 'TES100  ', 'Testland', 0, 0, 44.0, 21.0, 10000, false, 230, 90, 5.0, 0, null, 0, false, 0, 2],
      ],
      globallyObservedAc: 1,
    } }));

    await page.goto('/');
    await page.waitForSelector('.leaflet-marker-icon');
    await selectAircraftAndWaitForRoute(page, 'aaaaaa');

    const result = await page.evaluate(() => {
      const arrowDiv = document.querySelector('.route-card-arrow .route-arrow-wrapper');
      if (!arrowDiv) return null;
      const hasClass = arrowDiv.classList.contains('route-arrow-climbing');
      const computed = window.getComputedStyle(arrowDiv);
      const animationName = computed.animationName;
      return { hasClass, animationName };
    });

    expect(result.hasClass).toBe(true);
    expect(result.animationName).toBe('route-arrow-climb');
  });

  test.skip('descending aircraft animates the arrow with route-arrow-descending class', async ({ page }) => {
    await mockAllSources(page);
    await page.route('**/api/adsbdb/**', (route) => route.fulfill({ json: {
      aircraft: { icao24: 'aaaaaa' },
      flightroute: ROUTE_FIXTURE,
    } }));
    // Vertical rate = -5.0 m/s (descending) at index 11
    await page.route('**/api/states', (route) => route.fulfill({ json: {
      states: [
        ['aaaaaa', 'TES100  ', 'Testland', 0, 0, 44.0, 21.0, 10000, false, 230, 90, -5.0, 0, null, 0, false, 0, 2],
      ],
      globallyObservedAc: 1,
    } }));

    await page.goto('/');
    await page.waitForSelector('.leaflet-marker-icon');
    await selectAircraftAndWaitForRoute(page, 'aaaaaa');

    const result = await page.evaluate(() => {
      const arrowDiv = document.querySelector('.route-card-arrow .route-arrow-wrapper');
      if (!arrowDiv) return null;
      const hasClass = arrowDiv.classList.contains('route-arrow-descending');
      const computed = window.getComputedStyle(arrowDiv);
      const animationName = computed.animationName;
      return { hasClass, animationName };
    });

    expect(result.hasClass).toBe(true);
    expect(result.animationName).toBe('route-arrow-descend');
  });

  test.skip('level aircraft (or no vertical rate) keeps the arrow static at 90°', async ({ page }) => {
    await mockAllSources(page);
    await page.route('**/api/adsbdb/**', (route) => route.fulfill({ json: {
      aircraft: { icao24: 'aaaaaa' },
      flightroute: ROUTE_FIXTURE,
    } }));
    // Vertical rate = 0 (inside the level band of ±0.5 m/s)
    await page.route('**/api/states', (route) => route.fulfill({ json: {
      states: [
        ['aaaaaa', 'TES100  ', 'Testland', 0, 0, 44.0, 21.0, 10000, false, 230, 90, 0, 0, null, 0, false, 0, 2],
      ],
      globallyObservedAc: 1,
    } }));

    await page.goto('/');
    await page.waitForSelector('.leaflet-marker-icon');
    await selectAircraftAndWaitForRoute(page, 'aaaaaa');

    const result = await page.evaluate(() => {
      const arrowDiv = document.querySelector('.route-card-arrow .route-arrow-wrapper');
      if (!arrowDiv) return null;
      const hasClimbClass = arrowDiv.classList.contains('route-arrow-climbing');
      const hasDescendClass = arrowDiv.classList.contains('route-arrow-descending');
      const computed = window.getComputedStyle(arrowDiv);
      const animationName = computed.animationName;
      const transform = arrowDiv.style.transform;
      return { hasClimbClass, hasDescendClass, animationName, transform };
    });

    expect(result.hasClimbClass).toBe(false);
    expect(result.hasDescendClass).toBe(false);
    expect(result.animationName).toBe('none');
    expect(result.transform).toBe('rotate(90deg)');
  });
});
