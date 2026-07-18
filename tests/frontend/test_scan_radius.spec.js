const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

// scanRadiusLayer is rebuilt from the real (unmocked) /api/config response
// — center {lat:44, lon:21}, radius_nm:220 — once that fetch resolves.
async function waitForScanRadiusLayer(page) {
  await page.waitForFunction(() => {
    let count = 0;
    scanRadiusLayer.eachLayer(() => count++);
    return count > 0;
  });
}

test('scan radius rings are off by default and toggle on/off', async ({ page }) => {
  await mockAllSources(page);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await waitForScanRadiusLayer(page);

  const shownInitially = await page.evaluate(() => map.hasLayer(scanRadiusLayer));
  expect(shownInitially).toBe(false);

  await page.click('#toggle-scan-radius');
  const shownAfterToggleOn = await page.evaluate(() => map.hasLayer(scanRadiusLayer));
  expect(shownAfterToggleOn).toBe(true);

  // 4 round-number ticks (50/100/150/200 nm) + 1 distinct edge ring (220 nm)
  // = 5 circles, each with its own label marker = 5 more layers.
  const layerCounts = await page.evaluate(() => {
    let circles = 0, markers = 0;
    scanRadiusLayer.eachLayer((l) => {
      if (l instanceof L.Circle) circles++;
      else if (l instanceof L.Marker) markers++;
    });
    return { circles, markers };
  });
  expect(layerCounts.circles).toBe(5);
  expect(layerCounts.markers).toBe(5);

  // The 4 round-number rings, converted nm -> meters.
  const radii = await page.evaluate(() => {
    const r = [];
    scanRadiusLayer.eachLayer((l) => { if (l instanceof L.Circle) r.push(Math.round(l.getRadius())); });
    return r.sort((a, b) => a - b);
  });
  expect(radii).toEqual([50, 100, 150, 200, 220].map((nm) => Math.round(nm * 1852)));

  const labelTexts = await page.evaluate(() => {
    const texts = [];
    scanRadiusLayer.eachLayer((l) => { if (l instanceof L.Marker) texts.push(l.getIcon().options.html); });
    return texts.sort();
  });
  expect(labelTexts).toContain('50 nm');
  expect(labelTexts).toContain('100 nm');
  expect(labelTexts).toContain('150 nm');
  expect(labelTexts).toContain('200 nm');
  expect(labelTexts.some((t) => t.includes('Scan radius') && t.includes('220 nm'))).toBe(true);

  await page.click('#toggle-scan-radius');
  const shownAfterToggleOff = await page.evaluate(() => map.hasLayer(scanRadiusLayer));
  expect(shownAfterToggleOff).toBe(false);
});
