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

    // Basemap stays whatever map-init.js's own default is (currently 'dark')
    // regardless of OS preference — auto-switching is only ever triggered by
    // an explicit toggle click, never applied silently on load.
    const label = await page.textContent('#basemap-filter .dropdown-value');
    expect(label).toBe('Dark');
  });

  test('OS light preference seeds light chrome tokens and the Light segment', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await mockAllSources(page);
    await page.goto('/');
    await page.waitForSelector('.leaflet-marker-icon');

    expect(await page.getAttribute('html', 'data-theme')).toBe('light');
    expect(await cssVar(page, '--marker-fill-color')).toBe('#1c2128');
    expect(await page.evaluate(() => document.querySelector('#theme-mode-toggle .seg-btn[data-value="light"]').classList.contains('active'))).toBe(true);
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
});
