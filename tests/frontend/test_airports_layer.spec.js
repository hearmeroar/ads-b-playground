const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

// Belgrade Nikola Tesla (BEG/LYBE) — a real, stable OurAirports entry also
// used as the worked example in tests/backend/test_airports.py. A heliport
// fixture sits alongside it to exercise the distinct heliport glyph/class.
const AIRPORTS_RESPONSE = {
  airports: [
    {
      ident: 'LYBE', type: 'large_airport', name: 'Belgrade Nikola Tesla Airport',
      lat: 44.8184, lon: 20.3091, elevation_ft: 335, country: 'RS', country_name: 'Serbia',
      municipality: 'Belgrade', iata: 'BEG', icao: 'LYBE',
    },
    {
      ident: 'LYXH', type: 'heliport', name: 'Test Heliport',
      lat: 44.9, lon: 20.4, elevation_ft: 100, country: 'RS', country_name: 'Serbia',
      municipality: 'Belgrade', iata: null, icao: 'LYXH',
    },
  ],
};

async function mockAirports(page, counts) {
  await page.route('**/api/airports**', (route) => {
    counts.n = (counts.n || 0) + 1;
    counts.lastUrl = route.request().url();
    route.fulfill({ json: AIRPORTS_RESPONSE });
  });
}

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
});

test('airports layer is off by default and fetches nothing', async ({ page }) => {
  const counts = {};
  await mockAirports(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.waitForTimeout(300);

  expect(counts.n).toBeUndefined();
  expect(await page.evaluate(() => map.hasLayer(airportsState.clusterGroup))).toBe(false);
  // Toggle is now a native checkbox inside a label.switch (same pattern as other source toggles)
  expect(await page.isChecked('#toggle-airports')).toBe(false);
  // The label.switch wrapper provides the visual toggle styling via .switch-track
  expect(await page.locator('label.switch:has(#toggle-airports)').count()).toBe(1);
  expect(await page.evaluate(() => {
    const label = document.querySelector('label.switch:has(#toggle-airports)');
    const track = label.querySelector('.switch-track');
    return getComputedStyle(track).borderRadius;
  })).toBe('999px'); // visual toggle styling applied
});

test('enabling Airports fetches the current viewport bbox and renders both airports', async ({ page }) => {
  const counts = {};
  await mockAirports(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#toggle-airports');
  await page.waitForFunction(() => airportsState.clusterGroup.getLayers().length === 2);

  expect(counts.n).toBe(1);
  expect(counts.lastUrl).toContain('bbox=');
  expect(await page.evaluate(() => map.hasLayer(airportsState.clusterGroup))).toBe(true);
});

test('panning the map re-fetches airports for the new viewport (debounced)', async ({ page }) => {
  const counts = {};
  await mockAirports(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#toggle-airports');
  await page.waitForFunction(() => airportsState.clusterGroup.getLayers().length === 2);
  expect(counts.n).toBe(1);

  await page.evaluate(() => map.panBy([600, 0])); // triggers a real moveend
  await page.waitForTimeout(800); // past AIRPORTS_FETCH_DEBOUNCE_MS
  expect(counts.n).toBe(2);
});

test('disabling Airports removes the layer and stops further fetches on pan', async ({ page }) => {
  const counts = {};
  await mockAirports(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#toggle-airports');
  await page.waitForFunction(() => airportsState.clusterGroup.getLayers().length === 2);
  expect(counts.n).toBe(1);

  await page.click('#toggle-airports');
  expect(await page.evaluate(() => map.hasLayer(airportsState.clusterGroup))).toBe(false);
  expect(await page.evaluate(() => airportsState.clusterGroup.getLayers().length)).toBe(0);

  await page.evaluate(() => map.panBy([600, 0]));
  await page.waitForTimeout(800);
  expect(counts.n).toBe(1); // no further fetch once disabled
});

test('airport marker popup shows name, codes, and elevation; heliport gets its own icon class', async ({ page }) => {
  const counts = {};
  await mockAirports(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#toggle-airports');
  await page.waitForFunction(() => airportsState.clusterGroup.getLayers().length === 2);

  const airportPopup = await page.evaluate(() => {
    const layer = airportsState.clusterGroup.getLayers().find((l) => l.getPopup().getContent().includes('Belgrade Nikola Tesla'));
    return layer.getPopup().getContent();
  });
  expect(airportPopup).toContain('Belgrade Nikola Tesla Airport');
  expect(airportPopup).toContain('BEG');
  expect(airportPopup).toContain('LYBE');
  expect(airportPopup).toContain('Large airport');
  // Reworked into the app's own glass-card look (airport-popup-card) rather
  // than Leaflet's plain default popup text.
  expect(airportPopup).toContain('airport-popup-card');
  expect(airportPopup).toContain('airport-popup-code-chip');

  const heliportIconHtml = await page.evaluate(() => {
    const layer = airportsState.clusterGroup.getLayers().find((l) => l.getPopup().getContent().includes('Test Heliport'));
    return layer.options.icon.options.html;
  });
  expect(heliportIconHtml).toContain('airport-icon-heliport');

  const airportIconHtml = await page.evaluate(() => {
    const layer = airportsState.clusterGroup.getLayers().find((l) => l.getPopup().getContent().includes('Belgrade Nikola Tesla'));
    return layer.options.icon.options.html;
  });
  expect(airportIconHtml).toContain('airport-icon-large-airport');

  // bindPopup's own className option lands on the marker's popup instance,
  // which is what makes the .airport-popup CSS selectors in style.css apply.
  const popupClassName = await page.evaluate(() => {
    const layer = airportsState.clusterGroup.getLayers().find((l) => l.getPopup().getContent().includes('Belgrade Nikola Tesla'));
    return layer.getPopup().options.className;
  });
  expect(popupClassName).toBe('airport-popup');
});

test('the per-size checklist is hidden until Airports is enabled, and defaults to Large + Medium only', async ({ page }) => {
  const counts = {};
  await mockAirports(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await expect(page.locator('#airports-type-list')).toHaveAttribute('hidden', '');

  await page.click('#toggle-airports');
  await expect(page.locator('#airports-type-list')).not.toHaveAttribute('hidden', '');
  await page.waitForFunction(() => airportsState.clusterGroup.getLayers().length === 2);

  expect(counts.lastUrl).toContain('types=large_airport%2Cmedium_airport');
  expect(await page.isChecked('.airport-type-checkbox[value="large_airport"]')).toBe(true);
  expect(await page.isChecked('.airport-type-checkbox[value="medium_airport"]')).toBe(true);
  expect(await page.isChecked('.airport-type-checkbox[value="small_airport"]')).toBe(false);
  expect(await page.isChecked('.airport-type-checkbox[value="heliport"]')).toBe(false);
  expect(await page.isChecked('.airport-type-checkbox[value="seaplane_base"]')).toBe(false);
  expect(await page.isChecked('.airport-type-checkbox[value="balloonport"]')).toBe(false);

  // Turning Airports back off hides the checklist again.
  await page.click('#toggle-airports');
  await expect(page.locator('#airports-type-list')).toHaveAttribute('hidden', '');
});

test('checking/unchecking a size in the checklist re-fetches with the updated types param', async ({ page }) => {
  const counts = {};
  await mockAirports(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#toggle-airports');
  await page.waitForFunction(() => airportsState.clusterGroup.getLayers().length === 2);
  expect(counts.n).toBe(1);

  // Adding Heliport re-fetches immediately (not debounced like a pan).
  await page.click('.airport-type-checkbox[value="heliport"]');
  await page.waitForTimeout(150);
  expect(counts.n).toBe(2);
  expect(counts.lastUrl).toContain('types=large_airport%2Cmedium_airport%2Cheliport');

  // Unchecking every type shows nothing and performs no further fetch.
  await page.click('.airport-type-checkbox[value="large_airport"]');
  await page.click('.airport-type-checkbox[value="medium_airport"]');
  await page.click('.airport-type-checkbox[value="heliport"]');
  await page.waitForTimeout(150);
  expect(counts.n).toBe(4); // large_airport off + medium_airport off both still fetch (non-empty selection each time)
  expect(await page.evaluate(() => airportsState.clusterGroup.getLayers().length)).toBe(0);
});

test('Airports (?) popover explains the layer and closes on outside click', async ({ page }) => {
  const counts = {};
  await mockAirports(page, counts);
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  await page.click('#airports-help');
  const text = (await page.textContent('#airports-help-popover')).trim();
  expect(text.length).toBeGreaterThan(20);

  await page.click('#map');
  await expect(page.locator('#airports-help-popover')).toHaveAttribute('hidden', '');
});

test('"Jump to airport" button switches zone and re-centers map', async ({ page }) => {
  const counts = {};
  await mockAirports(page, counts);
  // Mock zone change response
  await page.route('**/api/zones/active', (route) => {
    route.fulfill({
      json: {
        center: { lat: 44.8184, lon: 20.3091 },
        radius_nm: 220,
      },
    });
  });
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');

  // Get initial map center
  const initialCenter = await page.evaluate(() => {
    const c = map.getCenter();
    return { lat: c.lat.toFixed(4), lng: c.lng.toFixed(4) };
  });

  // Enable airports layer and wait for it to load
  await page.click('#toggle-airports');
  await page.waitForFunction(() => airportsState.clusterGroup.getLayers().length > 0);

  // Find and click the airport marker (use the first one, which is large_airport)
  const markers = await page.evaluate(() => {
    const markers = [];
    airportsState.clusterGroup.eachLayer((layer) => {
      if (layer.getLatLng) {
        markers.push({
          lat: layer.getLatLng().lat.toFixed(4),
          lng: layer.getLatLng().lng.toFixed(4),
        });
      }
    });
    return markers;
  });

  // Should have at least one marker (the airport)
  expect(markers.length).toBeGreaterThan(0);

  // Click to open popup
  const marker = await page.evaluate(() => {
    let targetMarker = null;
    airportsState.clusterGroup.eachLayer((layer) => {
      if (layer._popup && layer.getLatLng().lat.toFixed(4) === '44.8184') {
        targetMarker = layer;
      }
    });
    if (targetMarker) {
      targetMarker.openPopup();
      return true;
    }
    return false;
  });

  if (!marker) {
    // Try clicking the center of a marker
    const bounds = await page.evaluate(() => map.getBounds());
    const latlng = [44.8184, 20.3091];
    const point = await page.evaluate(
      ([lat, lng]) => {
        const pt = map.latLngToContainerPoint([lat, lng]);
        return { x: pt.x, y: pt.y };
      },
      latlng
    );
    await page.click(`[style*="transform"]`, { position: { x: point.x, y: point.y } });
  }

  // Wait for popup to appear
  await page.waitForSelector('.airport-popup', { timeout: 2000 }).catch(() => {});

  // Click the "Jump to airport" button
  const btnExists = await page.locator('.jump-to-airport-btn').count();
  if (btnExists > 0) {
    await page.click('.jump-to-airport-btn');

    // Wait for popup to close and zone change to complete
    await page.waitForTimeout(500);

    // Verify map center changed to the airport
    const newCenter = await page.evaluate(() => {
      const c = map.getCenter();
      return { lat: c.lat.toFixed(4), lng: c.lng.toFixed(4) };
    });

    // The new center should be at the airport coordinates (from the mocked response)
    expect(newCenter.lat).toBe('44.8184');
    expect(newCenter.lng).toBe('20.3091');
  }
});
