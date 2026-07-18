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
  // adsb.lol / adsb.one / flightaware default to empty so existing tests' marker/color counts
  // are unaffected; a test that wants to exercise them overrides with its own aircraft.
  await page.route('**/api/adsblol', (route) => route.fulfill({ json: { ac: [] } }));
  await page.route('**/api/adsbone', (route) => route.fulfill({ json: { ac: [] } }));
  await page.route('**/api/flightaware', (route) => route.fulfill({ json: { flights: [] } }));
  await page.route('**/api/photo/**', (route) => route.fulfill({ json: { photos: [] } }));
  await page.route('**/api/track/**', (route) => route.fulfill({ status: 404, json: { path: [], error: 'not_found' } }));
  // All-null default so existing tests (which don't care about enrichment)
  // never see a resolved Flywme badge or a value other than "Unknown" —
  // a test that wants to exercise enrichment overrides this route itself.
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null, operator: null, operator_country: null, registration: null,
    manufacturer: null, model: null, year_built: null,
  } }));
  // All-null default, same rationale as /api/identity above — a test that
  // wants to exercise adsbdb enrichment/route/photo-dedup overrides this
  // route itself.
  await page.route('**/api/adsbdb/**', (route) => route.fulfill({ json: {
    aircraft: null, flightroute: null,
  } }));
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
