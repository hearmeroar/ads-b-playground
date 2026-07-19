const { test, expect } = require('@playwright/test');
const { mockAllSources, fixture } = require('./helpers');

// Reading the count slot's shape rather than its text: a pill is the number,
// a spinner is the .count-spinner child, and neither is an empty slot.
function slotState(page, name) {
  return page.evaluate((n) => {
    const el = document.getElementById('count-' + n);
    return {
      text: el.textContent,
      spinning: !!el.querySelector('.count-spinner'),
      loading: el.classList.contains('loading'),
    };
  }, name);
}

test('enabling a source shows a spinner until its first count lands, then the pill', async ({ page }) => {
  await mockAllSources(page);

  // adsb.one ships off. Hold its response open so the pending state is
  // observable rather than a race against a fast mock.
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/adsbone', async (r) => {
    await held;
    r.fulfill({ json: fixture('adsbfi.json') });
  });

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  // Off: no pill, no spinner.
  expect(await slotState(page, 'adsbone')).toEqual({ text: '', spinning: false, loading: false });

  // adsb.one's row is hidden in the HUD (Cloudflare block on the upstream —
  // see CLAUDE.md). page.click() can't target a display:none element at all
  // (no layout box, even with force: true), so invoke the native DOM click
  // directly; the toggle/wiring underneath are otherwise untouched.
  await page.evaluate(() => document.getElementById('toggle-adsbone').click());

  // On, data still in flight: spinner stands in for the pill.
  await page.waitForFunction(() => !!document.querySelector('#count-adsbone .count-spinner'));
  const pending = await slotState(page, 'adsbone');
  expect(pending.spinning).toBe(true);
  expect(pending.loading).toBe(true);
  expect(pending.text).toBe(''); // no stale number behind the spinner

  release();

  // Data in: spinner gives way to the pill.
  await page.waitForFunction(() => {
    const el = document.getElementById('count-adsbone');
    return !el.querySelector('.count-spinner') && el.textContent !== '';
  });
  const settled = await slotState(page, 'adsbone');
  expect(settled.spinning).toBe(false);
  expect(settled.loading).toBe(false);
  expect(settled.text).toMatch(/^\d+$/);
});

test('a source that returns nothing settles on 0 rather than spinning forever', async ({ page }) => {
  await mockAllSources(page);
  await page.route('**/api/adsbone', (r) => r.fulfill({ status: 500, body: 'nope' }));

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  // adsb.one's row is hidden in the HUD (Cloudflare block — see CLAUDE.md).
  // page.click() can't target a display:none element (no layout box, even
  // with force: true), so invoke the native DOM click directly instead.
  await page.evaluate(() => document.getElementById('toggle-adsbone').click());

  await page.waitForFunction(
    () => document.getElementById('count-adsbone').textContent === '0',
    { timeout: 5000 }
  );
  expect(await slotState(page, 'adsbone')).toEqual({ text: '0', spinning: false, loading: false });
});

test('turning a source back off clears the slot entirely', async ({ page }) => {
  await mockAllSources(page);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(300);

  expect((await slotState(page, 'adsbfi')).text).toMatch(/^\d+$/);

  await page.click('#toggle-adsbfi');
  await page.waitForFunction(() => document.getElementById('count-adsbfi').textContent === '');
  expect(await slotState(page, 'adsbfi')).toEqual({ text: '', spinning: false, loading: false });
});
