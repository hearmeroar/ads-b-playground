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
// skipHealth (boolean): if true, don't mock /api/health (lets it hit the real backend)
async function mockAllSources(page, { skipHealth = false } = {}) {
  // Mock external tile requests (CARTO basemap tiles) - these were causing
  // page.goto() to hang waiting for "load" event since external CDN was never responding
  await page.route('https://basemaps.cartocdn.com/**', (route) => {
    // Respond with a 1x1 transparent PNG to complete tile requests without network
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, // IHDR chunk size
      0x49, 0x48, 0x44, 0x52, // IHDR
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 pixel
      0x08, 0x02, 0x00, 0x00, 0x00, // 8 bits per sample, color type 2
      0x90, 0x77, 0x53, 0xDE, // CRC
      0x00, 0x00, 0x00, 0x0C, // IDAT chunk size
      0x49, 0x44, 0x41, 0x54, // IDAT
      0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0xFE, 0xFF, 0x00, 0x00, 0x00, 0x02, // data
      0x00, 0x01, 0xF6, 0x18, 0xDD, 0x8D, // CRC
      0x00, 0x00, 0x00, 0x00, // IEND chunk size
      0x49, 0x45, 0x4E, 0x44, // IEND
      0xAE, 0x42, 0x60, 0x82, // CRC
    ]);
    route.fulfill({ contentType: 'image/png', body: pngBuffer });
  });

  if (!skipHealth) {
    await page.route('**/api/health', (route) => route.fulfill({ json: { status: 'ok' } }));
  }
  await page.route('**/api/states', (route) => route.fulfill({ json: fixture('states.json') }));
  await page.route('**/api/adsbfi', (route) => route.fulfill({ json: fixture('adsbfi.json') }));
  await page.route('**/api/airplaneslive', (route) => route.fulfill({ json: fixture('airplaneslive.json') }));
  // adsb.lol / adsb.one / flightaware default to empty so existing tests' marker/color counts
  // are unaffected; a test that wants to exercise them overrides with its own aircraft.
  await page.route('**/api/adsblol', (route) => route.fulfill({ json: { ac: [] } }));
  await page.route('**/api/adsbone', (route) => route.fulfill({ json: { ac: [] } }));
  await page.route('**/api/flightaware', (route) => route.fulfill({ json: { flights: [] } }));
  await page.route('**/api/flightradar24', (route) => route.fulfill({ json: { flights: [] } }));
  await page.route('**/api/photo/**', (route) => route.fulfill({ json: { photos: [] } }));
  await page.route('**/api/track/**', (route) => route.fulfill({ status: 404, json: { path: [], error: 'not_found' } }));
  // All-null default so existing tests (which don't care about enrichment)
  // never see a resolved Flywme badge or a value other than "Unknown" —
  // a test that wants to exercise enrichment overrides this route itself.
  await page.route('**/api/identity/**', (route) => route.fulfill({ json: {
    country: null, operator: null, operator_country: null, registration: null,
    manufacturer: null, model: null, year_built: null, category: null,
  } }));
  // Mock /api/identity/stats explicitly - specific to stats endpoint
  await page.route('**/api/identity/stats', (route) => route.fulfill({ json: {
    identity_count: 0, history_count: 0,
  } }));
  // All-null default, same rationale as /api/identity above — a test that
  // wants to exercise adsbdb enrichment/route/photo-dedup overrides this
  // route itself.
  await page.route('**/api/adsbdb/**', (route) => route.fulfill({ json: {
    aircraft: null, flightroute: null,
  } }));
  // Mock /api/config
  await page.route('**/api/config', (route) => route.fulfill({ json: {
    center: { lat: 51.47, lon: -0.46 },
    zoom: 8,
    radius_nm: 220,
    bbox: [49.47, -2.46, 53.47, 1.54],
    active_zone_id: 'default',
  } }));
  // Mock /api/me (auth check)
  await page.route('**/api/me', (route) => route.fulfill({ json: { user: null } }));
  // Don't mock airline-logos manifest — tests that check logos need the real manifest
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
