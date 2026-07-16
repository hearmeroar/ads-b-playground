const fs = require('fs');
const path = require('path');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8'));
}

// Mocks all backend routes with sane, deterministic defaults so tests never
// depend on live external data (OpenSky/adsb.fi/airplanes.live/Planespotters
// all drift between requests — observed firsthand during manual testing).
// Individual tests can override any of these by registering a more specific
// page.route() afterwards — Playwright gives priority to the most recently
// registered matching route.
async function mockAllSources(page) {
  await page.route('**/api/states', (route) => route.fulfill({ json: fixture('states.json') }));
  await page.route('**/api/adsbfi', (route) => route.fulfill({ json: fixture('adsbfi.json') }));
  await page.route('**/api/airplaneslive', (route) => route.fulfill({ json: fixture('airplaneslive.json') }));
  await page.route('**/api/photo/**', (route) => route.fulfill({ json: { photos: [] } }));
  await page.route('**/api/track/**', (route) => route.fulfill({ status: 404, json: { path: [], error: 'not_found' } }));
}

function colorCounts(page) {
  return page.evaluate(() => ({
    blue: document.querySelectorAll('.plane-icon svg path[fill="#1a73e8"]').length,
    red: document.querySelectorAll('.plane-icon svg path[fill="#e53935"]').length,
    green: document.querySelectorAll('.plane-icon svg path[fill="#2e7d32"]').length,
  }));
}

module.exports = { fixture, mockAllSources, colorCounts };
