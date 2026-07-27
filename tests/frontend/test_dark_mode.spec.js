const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

async function cssVar(page, name) {
  return page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
}

test.describe('theme mode — chrome only (no toggle interaction)', () => {
  test('OS dark preference seeds dark chrome tokens and the Dark segment, but leaves the basemap untouched', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await mockAllSources(page);
    await page.goto('/');
    await page.waitForSelector('.leaflet-marker-icon');

    expect(await page.getAttribute('html', 'data-theme')).toBe('dark');
    expect(await cssVar(page, '--marker-fill-color')).toBe('#ffd400');
    expect(await page.evaluate(() => document.querySelector('#theme-mode-toggle .seg-btn[data-value="dark"]').classList.contains('active'))).toBe(true);
    expect(await page.evaluate(() => document.querySelector('#theme-mode-toggle .seg-btn[data-value="light"]').classList.contains('active'))).toBe(false);

    // map-init.js seeds its initial basemap from the same prefers-color-scheme
    // check used above, paired via THEME_BASEMAP — dark OS preference pairs
    // with the Dark basemap at load, not just from a later toggle click.
    const label = await page.textContent('#basemap-filter .dropdown-value');
    expect(label).toBe('Dark');
  });

  test('OS light preference seeds light chrome tokens and the Light segment, paired with the Voyager basemap', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await mockAllSources(page);
    await page.goto('/');
    await page.waitForSelector('.leaflet-marker-icon');

    expect(await page.getAttribute('html', 'data-theme')).toBe('light');
    expect(await cssVar(page, '--marker-fill-color')).toBe('#1c2128');
    expect(await page.evaluate(() => document.querySelector('#theme-mode-toggle .seg-btn[data-value="light"]').classList.contains('active'))).toBe(true);

    // Regression guard for the basemap/chrome mismatch bug: an OS-light
    // visitor used to get light chrome but a hardcoded dark basemap.
    const label = await page.textContent('#basemap-filter .dropdown-value');
    expect(label).toBe('Voyager');
  });
});

test.describe('theme mode — toggle interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await mockAllSources(page);
    await page.goto('/');
    await page.waitForSelector('.leaflet-marker-icon');
  });

  test('clicking Dark flips data-theme, tokens, basemap, and the dropdown label', async ({ page }) => {
    await page.click('#theme-mode-toggle .seg-btn[data-value="dark"]');
    await page.waitForTimeout(300);

    expect(await page.getAttribute('html', 'data-theme')).toBe('dark');
    expect(await page.evaluate(() => document.querySelector('#theme-mode-toggle .seg-btn[data-value="dark"]').classList.contains('active'))).toBe(true);

    // Basemap auto-switches to the paired Dark tiles, and the (otherwise
    // independent) basemap dropdown UI stays in sync rather than showing a
    // stale label — this is the exact desync bug the syncBasemapDropdownUi()
    // refactor guards against.
    expect(await page.evaluate(() => map.hasLayer(baseLayers.dark))).toBe(true);
    expect(await page.textContent('#basemap-filter .dropdown-value')).toBe('Dark');
    expect(await page.evaluate(() => document.querySelector('#basemap-filter .dropdown-option[data-value="dark"]').classList.contains('active'))).toBe(true);

    // Uniform marker fill/stroke both flip to the dark-theme pair.
    const marker = await page.$('.plane-icon[data-color="#1a73e8"]');
    expect(marker).not.toBeNull();
    const strokeVar = await cssVar(page, '--marker-stroke-color');
    expect(strokeVar).toBe('#1a1a1a');
  });

  test('clicking Light (after switching to Dark) restores the paired Voyager basemap', async ({ page }) => {
    await page.click('#theme-mode-toggle .seg-btn[data-value="dark"]');
    await page.waitForTimeout(300);
    await page.click('#theme-mode-toggle .seg-btn[data-value="light"]');
    await page.waitForTimeout(300);

    expect(await page.getAttribute('html', 'data-theme')).toBe('light');
    expect(await page.evaluate(() => map.hasLayer(baseLayers.voyager))).toBe(true);
    expect(await page.textContent('#basemap-filter .dropdown-value')).toBe('Voyager');
    expect(await cssVar(page, '--marker-stroke-color')).toBe('#ffffff');
  });

  test('toggling triggers exactly one immediate re-poll, not zero and not a runaway timer', async ({ page }) => {
    let stateRequests = 0;
    await page.route('**/api/states', (route) => {
      stateRequests += 1;
      route.fulfill({ json: require('./fixtures/states.json') });
    });
    await page.waitForTimeout(200); // let any in-flight startup poll settle
    const before = stateRequests;

    await page.click('#theme-mode-toggle .seg-btn[data-value="dark"]');
    await page.waitForTimeout(300);

    expect(stateRequests).toBe(before + 1);
  });

  test('the (?) help popover opens with explanatory text and closes on outside click', async ({ page }) => {
    await page.click('#theme-mode-help');
    expect(await page.isVisible('#theme-mode-help-popover')).toBe(true);
    const text = await page.textContent('#theme-mode-help-popover');
    expect(text.length).toBeGreaterThan(0);

    await page.click('#map');
    expect(await page.isVisible('#theme-mode-help-popover')).toBe(false);
  });

  // Regression guard for the "marker shows the other theme's color after
  // toggling" bug: fill used to be baked into the SVG markup as a literal,
  // with no CSS rule referencing --marker-fill-color at all, so it only
  // repainted whenever that marker's source next resynced via syncMarkers()
  // (icons.js) — which could lag well behind the toggle. Fill is now driven
  // by a body.uniform-color-mode CSS rule, so it must update the instant
  // data-theme changes, with no dependency on poll()'s own /api/states
  // request ever resolving. Holding that request open (same trick
  // test_source_count_spinner.spec.js uses) proves the repaint isn't
  // waiting on it.
  test('marker fill and stroke repaint instantly on toggle, even while the follow-up poll is still in flight', async ({ page }) => {
    let releaseStates;
    const held = new Promise((resolve) => { releaseStates = resolve; });
    await page.route('**/api/states', async (route) => {
      await held;
      route.fulfill({ json: require('./fixtures/states.json') });
    });

    await page.click('#theme-mode-toggle .seg-btn[data-value="dark"]');

    const marker = '.plane-icon[data-color="#1a73e8"] svg path';
    await page.waitForFunction(
      (sel) => getComputedStyle(document.querySelector(sel)).fill === 'rgb(255, 212, 0)',
      marker,
      { timeout: 2000 },
    );
    const fill = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).fill, marker);
    const stroke = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).stroke, marker);
    expect(fill).toBe('rgb(255, 212, 0)'); // #ffd400, dark theme's uniform fill
    expect(stroke).toBe('rgb(26, 26, 26)'); // #1a1a1a, dark theme's uniform stroke

    releaseStates();
  });
});

test.describe('Google sign-in button theming', () => {
  test('button background switches to the dark variant with the theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await mockAllSources(page);
    await page.goto('/');
    await page.waitForSelector('.leaflet-marker-icon');

    const lightBg = await page.evaluate(() =>
      getComputedStyle(document.getElementById('google-signin-btn')).backgroundColor);
    expect(lightBg).toBe('rgb(255, 255, 255)');

    await page.click('#theme-mode-toggle .seg-btn[data-value="dark"]');
    await page.waitForTimeout(300);

    const darkBg = await page.evaluate(() =>
      getComputedStyle(document.getElementById('google-signin-btn')).backgroundColor);
    expect(darkBg).toBe('rgb(19, 19, 20)');
  });
});
