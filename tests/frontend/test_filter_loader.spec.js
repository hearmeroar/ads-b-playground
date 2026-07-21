const { test, expect } = require('@playwright/test');
const { mockAllSources, fixture } = require('./helpers');

// Holds a route open behind a manually-resolved promise so the pending
// window is observable instead of racing a fast mock — same trick
// test_source_count_spinner.spec.js already uses.
function holdRoute(page, pattern, json) {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  page.route(pattern, async (route) => {
    await held;
    route.fulfill({ json });
  });
  return () => release();
}

test('motion filter shows a spinner and disables its buttons while the poll is in flight', async ({ page }) => {
  await mockAllSources(page);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  const release = holdRoute(page, '**/api/states', fixture('states.json'));
  await page.click('#motion-filter .seg-btn[data-value="airborne"]');

  await page.waitForFunction(() => !document.getElementById('motion-filter-spinner').hidden);
  const pending = await page.evaluate(() => ({
    spinnerHidden: document.getElementById('motion-filter-spinner').hidden,
    disabled: Array.from(document.querySelectorAll('#motion-filter .seg-btn')).map((b) => b.disabled),
  }));
  expect(pending.spinnerHidden).toBe(false);
  expect(pending.disabled).toEqual([true, true, true]);

  release();

  await page.waitForFunction(() => document.getElementById('motion-filter-spinner').hidden);
  const settled = await page.evaluate(() => ({
    spinnerHidden: document.getElementById('motion-filter-spinner').hidden,
    disabled: Array.from(document.querySelectorAll('#motion-filter .seg-btn')).map((b) => b.disabled),
  }));
  expect(settled.spinnerHidden).toBe(true);
  expect(settled.disabled).toEqual([false, false, false]);
});

test('category filter shows a spinner and disables its dropdown trigger while the poll is in flight', async ({ page }) => {
  await mockAllSources(page);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  const release = holdRoute(page, '**/api/states', fixture('states.json'));
  await page.click('#category-filter .dropdown-trigger');
  await page.click('#category-filter .dropdown-option[data-value="light"]');

  await page.waitForFunction(() => !document.getElementById('category-filter-spinner').hidden);
  const pending = await page.evaluate(() => ({
    spinnerHidden: document.getElementById('category-filter-spinner').hidden,
    disabled: document.querySelector('#category-filter .dropdown-trigger').disabled,
  }));
  expect(pending.spinnerHidden).toBe(false);
  expect(pending.disabled).toBe(true);

  release();

  await page.waitForFunction(() => document.getElementById('category-filter-spinner').hidden);
  const settled = await page.evaluate(() => ({
    spinnerHidden: document.getElementById('category-filter-spinner').hidden,
    disabled: document.querySelector('#category-filter .dropdown-trigger').disabled,
  }));
  expect(settled.spinnerHidden).toBe(true);
  expect(settled.disabled).toBe(false);
});

test('hide-non-aircraft toggle shows a spinner and disables itself while the poll is in flight', async ({ page }) => {
  await mockAllSources(page);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  const release = holdRoute(page, '**/api/states', fixture('states.json'));
  await page.click('#toggle-hide-junk');

  await page.waitForFunction(() => !document.getElementById('hide-junk-spinner').hidden);
  const pending = await page.evaluate(() => ({
    spinnerHidden: document.getElementById('hide-junk-spinner').hidden,
    disabled: document.getElementById('toggle-hide-junk').disabled,
  }));
  expect(pending.spinnerHidden).toBe(false);
  expect(pending.disabled).toBe(true);

  release();

  await page.waitForFunction(() => document.getElementById('hide-junk-spinner').hidden);
  const settled = await page.evaluate(() => ({
    spinnerHidden: document.getElementById('hide-junk-spinner').hidden,
    disabled: document.getElementById('toggle-hide-junk').disabled,
  }));
  expect(settled.spinnerHidden).toBe(true);
  expect(settled.disabled).toBe(false);
});

test('a source toggle disables itself while its own poll is in flight, then re-enables', async ({ page }) => {
  await mockAllSources(page);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  // FlightAware ships off by default (CLAUDE.md), so clicking it turns it
  // *on* — the branch whose poll actually awaits this source's own route,
  // unlike turning an already-on source off (which skips fetching it
  // entirely and so never observably holds it disabled for long).
  const release = holdRoute(page, '**/api/flightaware', { flights: [] });
  await page.click('#toggle-flightaware');

  await page.waitForFunction(() => document.getElementById('toggle-flightaware').disabled);
  expect(await page.evaluate(() => document.getElementById('toggle-flightaware').disabled)).toBe(true);

  release();

  await page.waitForFunction(() => !document.getElementById('toggle-flightaware').disabled);
  expect(await page.evaluate(() => document.getElementById('toggle-flightaware').disabled)).toBe(false);
});

test('a poll triggered by another control does not clear the OpenSky quota lockout', async ({ page }) => {
  await mockAllSources(page);
  await page.route('**/api/states', (r) => r.fulfill({
    json: { states: [], error: 'rate_limited', retry_after_seconds: 10980 },
  }));

  await page.goto('/');
  await page.waitForFunction(() => document.getElementById('toggle-opensky').disabled);

  // Trigger a poll via a different control entirely.
  await page.click('#toggle-hide-junk');
  await page.waitForFunction(() => document.getElementById('hide-junk-spinner').hidden);

  // OpenSky's toggle must still be disabled — the quota lockout, not this
  // feature's own re-enable logic, owns that state.
  expect(await page.evaluate(() => document.getElementById('toggle-opensky').disabled)).toBe(true);
  expect(await page.evaluate(() => document.getElementById('source-opensky').classList.contains('locked'))).toBe(true);
});
