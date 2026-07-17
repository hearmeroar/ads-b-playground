const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
  await page.goto('/');
  // FlightAware ships off by default (paid/metered) — enable it for these tests.
  await page.click('#toggle-flightaware');
  await page.waitForTimeout(300);
});

test('FlightAware markers render from fixture data', async ({ page }) => {
  await page.route('**/api/flightaware', (route) => {
    const fixture = {
      flights: [
        {
          fa_flight_id: 'ASL439-123',
          ident: 'ASL439',
          aircraft_type: 'A320',
          last_position: {
            latitude: 44.83791,
            longitude: 20.26539,
            altitude: 8,
            groundspeed: 147,
            heading: 122,
            timestamp: new Date().toISOString(),
          },
        },
      ],
    };
    route.fulfill({ json: fixture });
  });

  // Trigger a new poll to fetch the overridden route.
  await page.evaluate(() => poll());
  await page.waitForTimeout(500);

  const hasFlightAwaremarker = await page.evaluate(
    () => flightawareMarkers.size > 0
  );
  expect(hasFlightAwaremarker).toBe(true);
});

test('FlightAware toggle controls marker visibility', async ({ page }) => {
  await page.route('**/api/flightaware', (route) => {
    route.fulfill({ json: {
      flights: [{
        fa_flight_id: 'TEST-123',
        ident: 'TEST',
        aircraft_type: 'B738',
        last_position: {
          latitude: 43.5,
          longitude: 18.5,
          altitude: 20,
          groundspeed: 400,
          heading: 180,
          timestamp: new Date().toISOString(),
        },
      }],
    }});
  });

  await page.evaluate(() => poll());
  await page.waitForTimeout(500);

  const countBefore = await page.evaluate(() => flightawareMarkers.size);
  expect(countBefore).toBeGreaterThan(0);

  await page.click('#toggle-flightaware');
  await page.waitForTimeout(300);
  const countAfter = await page.evaluate(() => flightawareMarkers.size);
  expect(countAfter).toBe(0);

  await page.click('#toggle-flightaware');
  await page.waitForTimeout(300);
  const countRestored = await page.evaluate(() => flightawareMarkers.size);
  expect(countRestored).toBeGreaterThan(0);
});

test('non-matching callsigns render as separate markers', async ({ page }) => {
  // When a FlightAware callsign doesn't match any other source, the FlightAware
  // marker renders independently (the old behavior for non-matches).
  await page.route('**/api/flightaware', (route) => {
    route.fulfill({ json: {
      flights: [{
        fa_flight_id: 'FA-NOMATCH',
        ident: 'UNIQUE999',
        aircraft_type: 'A320',
        last_position: {
          latitude: 43.1,
          longitude: 19.2,
          altitude: 15,
          groundspeed: 300,
          heading: 90,
          timestamp: new Date().toISOString(),
        },
      }],
    }});
  });

  await page.evaluate(() => poll());
  await page.waitForTimeout(500);

  const hasFlightAware = await page.evaluate(
    () => flightawareMarkers.has('FA-NOMATCH')
  );
  expect(hasFlightAware).toBe(true);
});

test('matching callsigns are deduplicated and enriched', async ({ page }) => {
  // When a FlightAware callsign matches an OpenSky/adsb.fi aircraft's callsign,
  // the FlightAware marker is suppressed and its route data enriches the main marker.
  // OpenSky fixture has callsign "TES100  " (from states.json, aaaaaa icao24),
  // which normalizes to "TES100", so FlightAware uses the same.
  await page.route('**/api/flightaware', (route) => {
    route.fulfill({ json: {
      flights: [{
        fa_flight_id: 'FA-MATCH',
        ident: 'TES100',  // matches OpenSky fixture's callsign (normalized)
        aircraft_type: 'A320',
        origin: {
          code: 'LICC',
          code_iata: 'CTA',
          name: 'Catania-Fontanarossa Airport',
        },
        destination: {
          code: 'LYBE',
          code_iata: 'BEG',
          name: 'Belgrade Nikola Tesla Int\'l',
        },
        last_position: {
          latitude: 44.0,
          longitude: 21.0,
          altitude: 150,
          groundspeed: 300,
          heading: 90,
          timestamp: new Date().toISOString(),
        },
      }],
    }});
  });

  await page.evaluate(() => poll());
  await page.waitForTimeout(500);

  // FlightAware marker should NOT be rendered (it was matched and suppressed)
  const hasFlightAware = await page.evaluate(
    () => flightawareMarkers.has('FA-MATCH')
  );
  expect(hasFlightAware).toBe(false);

  // But the OpenSky marker should have the Route row enriched from FlightAware
  const details = await page.evaluate(() => {
    const marker = openskyMarkers.get('aaaaaa');
    if (marker && marker._icon) {
      marker._icon.click();
      return document.querySelector('#sidebar-details')?.textContent || '';
    }
    return '';
  });
  await page.waitForTimeout(300);

  expect(details).toContain('Route');
  expect(details).toContain('Catania-Fontanarossa Airport (CTA)');
  expect(details).toContain('Belgrade Nikola Tesla Int\'l (BEG)');
});

test('FlightAware sidebar shows Route row with origin/destination', async ({ page }) => {
  await page.route('**/api/flightaware', (route) => {
    route.fulfill({ json: {
      flights: [{
        fa_flight_id: 'ROUTE-TEST-1',
        ident: 'ROUTE',
        aircraft_type: 'A320',
        origin: {
          code: 'LICC',
          code_iata: 'CTA',
          name: 'Catania-Fontanarossa Airport',
        },
        destination: {
          code: 'LYBE',
          code_iata: 'BEG',
          name: 'Belgrade Nikola Tesla Int\'l',
        },
        last_position: {
          latitude: 44.83791,
          longitude: 20.26539,
          altitude: 8,
          groundspeed: 147,
          heading: 122,
          timestamp: new Date().toISOString(),
        },
      }],
    }});
  });

  await page.evaluate(() => poll());
  await page.waitForTimeout(500);

  const routeText = await page.evaluate(() => {
    const marker = flightawareMarkers.get('ROUTE-TEST-1');
    if (marker && marker._icon) {
      marker._icon.click();
      return true;
    }
    return false;
  });
  expect(routeText).toBe(true);

  await page.waitForTimeout(300);
  const sidebarText = await page.evaluate(() => {
    return document.querySelector('#sidebar-details')?.textContent || '';
  });
  expect(sidebarText).toContain('Route');
  expect(sidebarText).toContain('Catania-Fontanarossa Airport (CTA)');
  expect(sidebarText).toContain('Belgrade Nikola Tesla Int\'l (BEG)');
});

test('FlightAware marker click shows live fallback track when API unavailable', async ({ page }) => {
  await page.route('**/api/flightaware', (route) => {
    route.fulfill({ json: {
      flights: [{
        fa_flight_id: 'TRACK-TEST-1',
        ident: 'TRACK',
        aircraft_type: 'B738',
        last_position: {
          latitude: 43.2,
          longitude: 19.5,
          altitude: 25,
          groundspeed: 350,
          heading: 270,
          timestamp: new Date().toISOString(),
        },
      }],
    }});
  });

  await page.evaluate(() => poll());
  await page.waitForTimeout(500);

  const clicked = await page.evaluate(() => {
    const marker = flightawareMarkers.get('TRACK-TEST-1');
    if (marker && marker._icon) {
      marker._icon.click();
      return true;
    }
    return false;
  });
  expect(clicked).toBe(true);

  await page.waitForTimeout(300);
  // The sidebar should be open without erroring (even though track 404s).
  const isSidebarOpen = await page.evaluate(() => {
    return document.getElementById('sidebar').style.display !== 'none';
  });
  expect(isSidebarOpen).toBe(true);
});

test('FlightAware respects motion filter (hides grounded aircraft)', async ({ page }) => {
  await page.route('**/api/flightaware', (route) => {
    route.fulfill({ json: {
      flights: [
        {
          fa_flight_id: 'AIRBORNE-1',
          ident: 'AIR',
          aircraft_type: 'A320',
          last_position: {
            latitude: 44.0,
            longitude: 20.0,
            altitude: 20,
            groundspeed: 400,
            heading: 180,
            timestamp: new Date().toISOString(),
          },
        },
        {
          fa_flight_id: 'GROUNDED-1',
          ident: 'GND',
          aircraft_type: 'B738',
          last_position: {
            latitude: 43.0,
            longitude: 19.0,
            altitude: 0,
            groundspeed: 0,
            heading: 180,
            timestamp: new Date().toISOString(),
          },
        },
      ],
    }});
  });

  await page.evaluate(() => poll());
  await page.waitForTimeout(500);

  // Both should render by default (motion filter ships "All").
  let bothPresent = await page.evaluate(
    () => flightawareMarkers.has('AIRBORNE-1') && flightawareMarkers.has('GROUNDED-1')
  );
  expect(bothPresent).toBe(true);

  // Toggle to "Air" only — grounded disappears.
  await page.click('[data-value="airborne"]');
  await page.waitForTimeout(300);
  const airOnlyPresent = await page.evaluate(
    () => flightawareMarkers.has('AIRBORNE-1') && !flightawareMarkers.has('GROUNDED-1')
  );
  expect(airOnlyPresent).toBe(true);

  // Toggle to "Ground" only — airborne disappears.
  await page.click('[data-value="ground"]');
  await page.waitForTimeout(300);
  const groundOnlyPresent = await page.evaluate(
    () => !flightawareMarkers.has('AIRBORNE-1') && flightawareMarkers.has('GROUNDED-1')
  );
  expect(groundOnlyPresent).toBe(true);
});
