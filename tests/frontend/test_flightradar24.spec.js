const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
  await page.goto('/');
});

test('ships off by default', async ({ page }) => {
  const checked = await page.evaluate(
    () => document.getElementById('toggle-flightradar24').checked
  );
  expect(checked).toBe(false);
  const size = await page.evaluate(() => flightradar24Markers.size);
  expect(size).toBe(0);
});

test('markers render once enabled, from fixture data', async ({ page }) => {
  await page.route('**/api/flightradar24', (route) => route.fulfill({ json: {
    flights: [{
      id: '40bff2eb', icao_24bit: '123456', latitude: 44.5, longitude: 21.5,
      heading: 312, altitude: 36000, ground_speed: 424, squawk: '',
      aircraft_code: 'B38M', registration: 'G-TUMH', time: Math.floor(Date.now() / 1000),
      origin_airport_iata: 'HRG', destination_airport_iata: 'BRS',
      number: 'BY325', airline_iata: 'BY', airline_icao: 'TUI',
      on_ground: false, vertical_speed: 0, callsign: 'TOM3XD',
    }],
  }}));

  await page.click('#toggle-flightradar24');
  await page.waitForTimeout(500);

  const hasMarker = await page.evaluate(() => flightradar24Markers.has('123456'));
  expect(hasMarker).toBe(true);
});

test('toggle controls marker visibility', async ({ page }) => {
  await page.route('**/api/flightradar24', (route) => route.fulfill({ json: {
    flights: [{
      id: 'x', icao_24bit: '123456', latitude: 44.5, longitude: 21.5,
      heading: 0, altitude: 10000, ground_speed: 200, squawk: '',
      aircraft_code: 'B738', registration: 'TEST', time: Math.floor(Date.now() / 1000),
      origin_airport_iata: null, destination_airport_iata: null,
      number: null, airline_iata: null, airline_icao: null,
      on_ground: false, vertical_speed: 0, callsign: 'TESTFR',
    }],
  }}));

  await page.click('#toggle-flightradar24');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => flightradar24Markers.size)).toBeGreaterThan(0);

  await page.click('#toggle-flightradar24');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => flightradar24Markers.size)).toBe(0);
});

test('an aircraft already shown by OpenSky is not double-marked', async ({ page }) => {
  // states.json's "aaaaaa" is already rendered by OpenSky (on by default) —
  // FlightRadar24 sits lowest priority, so it must not claim the same hex.
  await page.route('**/api/flightradar24', (route) => route.fulfill({ json: {
    flights: [{
      id: 'dup', icao_24bit: 'AAAAAA', latitude: 44.0, longitude: 21.0,
      heading: 90, altitude: 10000, ground_speed: 230, squawk: '2000',
      aircraft_code: 'A320', registration: 'DUPTEST', time: Math.floor(Date.now() / 1000),
      origin_airport_iata: null, destination_airport_iata: null,
      number: null, airline_iata: null, airline_icao: null,
      on_ground: false, vertical_speed: 0, callsign: 'TES100',
    }],
  }}));

  await page.click('#toggle-flightradar24');
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => ({
    opensky: openskyMarkers.has('aaaaaa'),
    fr24: flightradar24Markers.has('aaaaaa'),
  }));
  expect(state.opensky).toBe(true);
  expect(state.fr24).toBe(false);
});

test('Route card renders the bare IATA code from FlightRadar24 data', async ({ page }) => {
  await page.route('**/api/flightradar24', (route) => route.fulfill({ json: {
    flights: [{
      id: 'route-1', icao_24bit: '123456', latitude: 44.5, longitude: 21.5,
      heading: 312, altitude: 36000, ground_speed: 424, squawk: '',
      aircraft_code: 'B38M', registration: 'G-TUMH', time: Math.floor(Date.now() / 1000),
      origin_airport_iata: 'HRG', destination_airport_iata: 'BRS',
      number: 'BY325', airline_iata: 'BY', airline_icao: 'TUI',
      on_ground: false, vertical_speed: 0, callsign: 'TOM3XD',
    }],
  }}));

  await page.click('#toggle-flightradar24');
  await page.waitForTimeout(500);

  const clicked = await page.evaluate(() => {
    const marker = flightradar24Markers.get('123456');
    if (marker && marker._icon) { marker._icon.click(); return true; }
    return false;
  });
  expect(clicked).toBe(true);
  await page.waitForTimeout(300);

  const routeText = await page.evaluate(() => document.querySelector('#sidebar-route')?.textContent || '');
  expect(routeText).toContain('HRG');
  expect(routeText).toContain('BRS');
});
