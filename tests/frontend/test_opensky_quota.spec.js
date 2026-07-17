const { test, expect } = require('@playwright/test');
const { mockAllSources, fixture } = require('./helpers');

// A quota-exhausted OpenSky response: 429-style rate_limited with a retry
// window, exactly what the backend forwards when the daily bucket is spent.
function rateLimited(retryAfterSeconds) {
  return { states: [], error: 'rate_limited', retry_after_seconds: retryAfterSeconds };
}

test('exhausted OpenSky quota auto-disables and locks the source with a countdown tooltip', async ({ page }) => {
  await mockAllSources(page);
  await page.route('**/api/states', (r) => r.fulfill({ json: rateLimited(10980) }));

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon'); // other sources still render
  await page.waitForFunction(() => document.getElementById('toggle-opensky').disabled);

  const state = await page.evaluate(() => ({
    checked: document.getElementById('toggle-opensky').checked,
    disabled: document.getElementById('toggle-opensky').disabled,
    locked: document.getElementById('source-opensky').classList.contains('locked'),
    helpShown: document.getElementById('opensky-help').style.display !== 'none',
    popoverHiddenInitially: document.getElementById('opensky-help-popover').hasAttribute('hidden'),
    count: document.getElementById('count-opensky').textContent,
    quota: document.getElementById('quota').textContent,
  }));

  expect(state.disabled).toBe(true);   // can't be re-enabled by the user
  expect(state.checked).toBe(false);   // forced off
  expect(state.locked).toBe(true);
  expect(state.helpShown).toBe(true);          // the "(?)" icon is visible
  expect(state.popoverHiddenInitially).toBe(true); // popover only opens on click
  expect(state.count).toBe('');        // no OpenSky markers/count while locked
  expect(state.quota).toBe('');

  // Clicking the icon reveals the reason + countdown.
  await page.click('#opensky-help');
  const popover = await page.evaluate(() => ({
    hidden: document.getElementById('opensky-help-popover').hasAttribute('hidden'),
    text: document.getElementById('opensky-help-popover').textContent,
  }));
  expect(popover.hidden).toBe(false);
  expect(popover.text).toContain('map-data quota exhausted'); // distinct from the track quota
  // 10980s = 3h 3m, but the countdown is live and may have ticked by now.
  expect(popover.text).toMatch(/available in 3h \d+m/);

  // Clicking elsewhere closes it again.
  await page.click('#hud .label');
  const closed = await page.evaluate(
    () => document.getElementById('opensky-help-popover').hasAttribute('hidden')
  );
  expect(closed).toBe(true);
});

test('the source auto-restores once the retry window elapses', async ({ page }) => {
  await mockAllSources(page);
  // Short window so the 1s ticker restores it quickly within the test.
  await page.route('**/api/states', (r) => r.fulfill({ json: rateLimited(1) }));

  await page.goto('/');
  await page.waitForFunction(() => document.getElementById('toggle-opensky').disabled);

  // Quota is back now — subsequent polls should get real data again.
  await page.unroute('**/api/states');
  await page.route('**/api/states', (r) => r.fulfill({ json: fixture('states.json') }));

  await page.waitForFunction(() => !document.getElementById('toggle-opensky').disabled, { timeout: 5000 });
  const restored = await page.evaluate(() => ({
    checked: document.getElementById('toggle-opensky').checked,
    disabled: document.getElementById('toggle-opensky').disabled,
    locked: document.getElementById('source-opensky').classList.contains('locked'),
    helpShown: document.getElementById('opensky-help').style.display !== 'none',
    hasMarkers: openskyMarkers.size > 0,
  }));

  expect(restored.disabled).toBe(false);
  expect(restored.checked).toBe(true);
  expect(restored.locked).toBe(false);
  expect(restored.helpShown).toBe(false);
  expect(restored.hasMarkers).toBe(true); // polling resumed and rendered OpenSky
});
