const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

// eeeeee (adsb.fi, higher dedup priority than airplanes.live even though
// present in both fixtures) and ffffff (airplanes.live-only) are used
// elsewhere in this suite (test_track.spec.js) for the same reason: both
// render as real, distinct markers with no cross-source ambiguity.
async function clickMarker(page, source, icao24) {
  await page.evaluate(({ source, icao24 }) => {
    const marker = ({ adsbfiMarkers, airplanesliveMarkers, openskyMarkers })[source].get(icao24);
    if (!marker || !marker._icon) throw new Error(`Marker ${icao24} from ${source} was not rendered`);
    marker._icon.click();
  }, { source, icao24 });
}

// marker._icon is Leaflet's own wrapper div ("leaflet-marker-icon ..."),
// not the `.plane-icon` div itself (that's a child, set via innerHTML) —
// same distinction setMarkerSelectedClass() in icons.js relies on.
async function isMarkerSelected(page, source, icao24) {
  return page.evaluate(({ source, icao24 }) => {
    const marker = ({ adsbfiMarkers, airplanesliveMarkers, openskyMarkers })[source].get(icao24);
    const el = marker && marker._icon && marker._icon.querySelector('.plane-icon');
    return !!el && el.classList.contains('selected');
  }, { source, icao24 });
}

async function selectedMarkerCount(page) {
  return page.evaluate(() => document.querySelectorAll('.plane-icon.selected').length);
}

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForFunction(() => adsbfiMarkers.has('eeeeee') && airplanesliveMarkers.has('ffffff'));
  await page.waitForTimeout(500);
});

test('selecting an aircraft immediately highlights its marker', async ({ page }) => {
  expect(await selectedMarkerCount(page)).toBe(0);
  await clickMarker(page, 'adsbfiMarkers', 'eeeeee');
  expect(await selectedMarkerCount(page)).toBe(1);
  expect(await isMarkerSelected(page, 'adsbfiMarkers', 'eeeeee')).toBe(true);
});

test('selecting a different aircraft moves the highlight', async ({ page }) => {
  await clickMarker(page, 'adsbfiMarkers', 'eeeeee');
  expect(await isMarkerSelected(page, 'adsbfiMarkers', 'eeeeee')).toBe(true);

  await clickMarker(page, 'airplanesliveMarkers', 'ffffff');
  expect(await selectedMarkerCount(page)).toBe(1); // only one highlighted at a time
  expect(await isMarkerSelected(page, 'adsbfiMarkers', 'eeeeee')).toBe(false);
  expect(await isMarkerSelected(page, 'airplanesliveMarkers', 'ffffff')).toBe(true);
});

test('deselecting via background click removes the highlight', async ({ page }) => {
  await clickMarker(page, 'adsbfiMarkers', 'eeeeee');
  expect(await selectedMarkerCount(page)).toBe(1);

  await page.mouse.click(640, 450); // empty map area, away from zoom controls/markers
  await page.waitForTimeout(300);
  expect(await selectedMarkerCount(page)).toBe(0);
});

test('deselecting via the sidebar close button removes the highlight', async ({ page }) => {
  await clickMarker(page, 'adsbfiMarkers', 'eeeeee');
  expect(await selectedMarkerCount(page)).toBe(1);

  await page.click('#sidebar-close');
  expect(await selectedMarkerCount(page)).toBe(0);
});

test('the highlight survives a subsequent poll cycle', async ({ page }) => {
  await clickMarker(page, 'adsbfiMarkers', 'eeeeee');
  expect(await isMarkerSelected(page, 'adsbfiMarkers', 'eeeeee')).toBe(true);

  // Same idiom test_track.spec.js's cross-source-handoff regression test
  // uses to simulate "another poll happens" without waiting on the real
  // ~10-12s timer.
  await page.evaluate(() => poll());
  await page.waitForTimeout(500);

  // syncMarkers() called setIcon() unconditionally during that poll,
  // tearing down and rebuilding marker._icon's entire subtree — this only
  // stays true if isSelected is baked into iconFor(), not just applied as
  // a one-off instant DOM mutation.
  expect(await isMarkerSelected(page, 'adsbfiMarkers', 'eeeeee')).toBe(true);
  expect(await selectedMarkerCount(page)).toBe(1);
});
