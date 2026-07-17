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
  // adsb.lol / adsb.one default to empty so existing tests' marker/color counts
  // are unaffected; a dedup test overrides these with its own aircraft.
  await page.route('**/api/adsblol', (route) => route.fulfill({ json: { ac: [] } }));
  await page.route('**/api/adsbone', (route) => route.fulfill({ json: { ac: [] } }));
  await page.route('**/api/photo/**', (route) => route.fulfill({ json: { photos: [] } }));
  await page.route('**/api/track/**', (route) => route.fulfill({ status: 404, json: { path: [], error: 'not_found' } }));
}

// Counts markers by source color via the wrapper div's data-color attribute
// (set by rotatedDivIcon()/towerIcon() regardless of icon shape) rather than
// counting colored <path> elements inside the SVG — icons like rotorcraft/uav
// have multiple colored paths per marker, which would otherwise inflate these
// counts once such a shape appears in a fixture.
function colorCounts(page) {
  return page.evaluate(() => ({
    blue: document.querySelectorAll('.plane-icon[data-color="#1a73e8"]').length,
    red: document.querySelectorAll('.plane-icon[data-color="#e53935"]').length,
    green: document.querySelectorAll('.plane-icon[data-color="#2e7d32"]').length,
  }));
}

// Counts markers by their shape-specific CSS class (e.g. "ground-icon",
// "rotorcraft-icon") — a stable hook independent of each icon's internal
// SVG structure.
function iconClassCounts(page, cssClass) {
  return page.evaluate((cls) => document.querySelectorAll('.plane-icon.' + cls).length, cssClass);
}

module.exports = { fixture, mockAllSources, colorCounts, iconClassCounts };
