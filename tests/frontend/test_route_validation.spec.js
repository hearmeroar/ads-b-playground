const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

// "aaaaaa" (OpenSky, states.json): lat 44.0, lon 21.0, track 90°
// (due east), altitude 10000m, ground speed 230 m/s (828 km/h) — a
// realistic high-altitude cruise state used as the aircraft's current
// position/kinematics for every case below. No FlightAware/live route for
// this aircraft, so Route is filled purely by the adsbdb tier.
const CONSISTENT_ROUTE = {
  callsign: 'TES100', callsign_icao: 'TES100', callsign_iata: 'TS100', airline: null,
  // Roughly west-to-east along the aircraft's own latitude, with the
  // aircraft's current position sitting between them — track 90° (due
  // east) lines up with heading toward the destination.
  origin: {
    country_iso_name: 'XX', country_name: 'Testland West', elevation: 0, iata_code: 'AAA',
    icao_code: 'EAAA', latitude: 44.0, longitude: 5.0, municipality: 'Westtown', name: 'West Airport',
  },
  destination: {
    country_iso_name: 'XX', country_name: 'Testland East', elevation: 0, iata_code: 'BBB',
    icao_code: 'EBBB', latitude: 44.0, longitude: 30.0, municipality: 'Easttown', name: 'East Airport',
  },
};

// A route thousands of km away from the aircraft's actual position, with
// its track pointed the wrong way too — the "definitely not this route"
// case, landing in the Reject band.
const IMPLAUSIBLE_ROUTE = {
  callsign: 'TES100', callsign_icao: 'TES100', callsign_iata: 'TS100', airline: null,
  origin: {
    country_iso_name: 'YY', country_name: 'Farland', elevation: 0, iata_code: 'CCC',
    icao_code: 'ECCC', latitude: 10.0, longitude: 10.0, municipality: 'Farcity', name: 'Far Origin Airport',
  },
  destination: {
    country_iso_name: 'YY', country_name: 'Farland', elevation: 0, iata_code: 'DDD',
    icao_code: 'EDDD', latitude: 15.0, longitude: 15.0, municipality: 'Otherfarcity', name: 'Far Destination Airport',
  },
};

async function selectAircraft(page, hex, markerMapName) {
  await page.evaluate(({ hex, markerMapName }) => {
    const marker = markerMapsBySource[markerMapName].get(hex);
    if (marker && marker._icon) marker._icon.click();
  }, { hex, markerMapName });
  await page.waitForFunction((hex) => adsbdbById.has(hex), hex);
  await page.waitForTimeout(100);
}

function rowHtml(page, label) {
  return page.evaluate((lbl) => {
    const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === lbl);
    if (!b) return null;
    let html = '';
    let node = b.nextSibling;
    while (node && !(node.nodeType === 1 && node.tagName === 'BR')) {
      html += node.nodeType === 1 ? node.outerHTML : node.textContent;
      node = node.nextSibling;
    }
    return html;
  }, label);
}

test.describe('pure geometry functions (route-validation.js)', () => {
  test('initialBearingDeg matches the doc\'s own EGLL->KJFK worked example (~288°)', async ({ page }) => {
    await mockAllSources(page);
    await page.goto('/');
    await page.waitForSelector('.leaflet-marker-icon');
    const bearing = await page.evaluate(() => initialBearingDeg(51.4706, -0.461941, 40.6413, -73.7781));
    expect(bearing).toBeGreaterThan(286);
    expect(bearing).toBeLessThan(290);
  });

  test('routeProgressPercent is ~0 at origin and ~100 at destination', async ({ page }) => {
    await mockAllSources(page);
    await page.goto('/');
    await page.waitForSelector('.leaflet-marker-icon');
    const atOrigin = await page.evaluate(() => routeProgressPercent(44, 5, 44, 30, 44, 5));
    const atDest = await page.evaluate(() => routeProgressPercent(44, 5, 44, 30, 44, 30));
    expect(atOrigin).toBeCloseTo(0, 0);
    expect(atDest).toBeCloseTo(100, 0);
  });

  test('validateAdsbdbRoute scores a geometrically consistent flight Medium or above', async ({ page }) => {
    await mockAllSources(page);
    await page.goto('/');
    await page.waitForSelector('.leaflet-marker-icon');
    const result = await page.evaluate(() => validateAdsbdbRoute({
      curLat: 44.0, curLon: 21.0, trackDeg: 90, speedKmh: 828, altitudeM: 10000,
      originLat: 44.0, originLon: 5.0, destLat: 44.0, destLon: 30.0,
    }));
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(['medium', 'high', 'very_high']).toContain(result.band);
  });

  test('validateAdsbdbRoute rejects a route nowhere near the aircraft', async ({ page }) => {
    await mockAllSources(page);
    await page.goto('/');
    await page.waitForSelector('.leaflet-marker-icon');
    const result = await page.evaluate(() => validateAdsbdbRoute({
      curLat: 44.0, curLon: 21.0, trackDeg: 270, speedKmh: 828, altitudeM: 10000,
      originLat: 10.0, originLon: 10.0, destLat: 15.0, destLon: 15.0,
    }));
    expect(result.score).toBeLessThan(40);
    expect(result.band).toBe('reject');
  });

  // Regression test for a real mismatch found via live testing: a Norse
  // Atlantic 787 (icao24 47b217) cruising over Bosnia, whose callsign
  // IGO49F adsbdb resolved to an unrelated IndiGo Mumbai->Manchester
  // flight. ~760km cross-track — a different flight entirely, not a
  // slightly-off one — but scored 74.6/Medium before the distance gate was
  // added, since track alignment/progress/speed/altitude alone (75 of the
  // 100 points) can look coincidentally plausible even when the aircraft
  // isn't anywhere near the claimed route.
  test('a route hundreds of km off is rejected even when the other checks look plausible in isolation', async ({ page }) => {
    await mockAllSources(page);
    await page.goto('/');
    await page.waitForSelector('.leaflet-marker-icon');
    const result = await page.evaluate(() => validateAdsbdbRoute({
      curLat: 44.4605, curLon: 18.1282, trackDeg: 289.63, speedKmh: 226.66 * 3.6, altitudeM: 12192,
      originLat: 19.0886993408, originLon: 72.8678970337, // Mumbai
      destLat: 53.349375, destLon: -2.279521, // Manchester
    }));
    expect(Math.abs(result.checks.distanceToRoute.distanceKm)).toBeGreaterThan(300);
    expect(result.band).toBe('reject');
  });
});

test.describe('Route row end-to-end', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllSources(page);
  });

  test('a geometrically consistent adsbdb route renders with no warning', async ({ page }) => {
    await page.route('**/api/adsbdb/**', (route) => route.fulfill({ json: {
      aircraft: null, flightroute: CONSISTENT_ROUTE,
    } }));
    await page.goto('/');
    await page.waitForSelector('.leaflet-marker-icon');
    await selectAircraft(page, 'aaaaaa', 'opensky');

    const html = await rowHtml(page, 'Route:');
    expect(html).toContain('West Airport (AAA)');
    expect(html).toContain('East Airport (BBB)');
    expect(html).not.toContain('route-warning');
    expect(html).not.toContain('⚠');
  });

  test('a geometrically implausible adsbdb route shows a warning even outside dev mode', async ({ page }) => {
    await page.route('**/api/adsbdb/**', (route) => route.fulfill({ json: {
      aircraft: null, flightroute: IMPLAUSIBLE_ROUTE,
    } }));
    await page.goto('/');
    await page.waitForSelector('.leaflet-marker-icon');
    await selectAircraft(page, 'aaaaaa', 'opensky');

    const html = await rowHtml(page, 'Route:');
    expect(html).toContain('route-warning');
    expect(html).toContain('⚠');
    expect(html).toContain('Far Origin Airport (CCC)');
  });

  test('dev mode shows the score breakdown in the Route badge tooltip', async ({ page }) => {
    await page.route('**/api/adsbdb/**', (route) => route.fulfill({ json: {
      aircraft: null, flightroute: IMPLAUSIBLE_ROUTE,
    } }));
    await page.goto('/');
    await page.waitForSelector('.leaflet-marker-icon');
    await page.click('#toggle-dev-mode');
    await selectAircraft(page, 'aaaaaa', 'opensky');

    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#sidebar-details b')].find((el) => el.textContent === 'Route:');
      let node = b.nextSibling;
      while (node && !(node.nodeType === 1 && node.classList.contains('source-badge'))) node = node.nextSibling;
      node.click();
    });
    const tooltip = await page.textContent('#source-tooltip');
    expect(tooltip).toContain('adsbdb.com');
    expect(tooltip).toContain('Reject confidence');
  });
});
