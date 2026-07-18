const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

const LOGGED_IN_USER = { sub: 'u1', email: 'pilot@example.com', name: 'Pilot Example', picture: null };

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
  await page.route('**/api/me', (route) => route.fulfill({ json: { user: LOGGED_IN_USER } }));
});

test('saving the selected aircraft posts a snapshot and shows it as saved', async ({ page }) => {
  let postedBody = null;
  await page.route('**/api/collection', (route) => {
    if (route.request().method() === 'POST') {
      postedBody = route.request().postDataJSON();
      route.fulfill({ status: 201, json: { id: 'card1', ...postedBody, saved_at: 1752835200 } });
    } else {
      route.fulfill({ json: { cards: [] } });
    }
  });

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.evaluate(() => {
    const marker = openskyMarkers.get('aaaaaa');
    if (marker && marker._icon) marker._icon.click();
  });
  await expect(page.locator('#sidebar')).toHaveClass(/open/);

  await page.click('#sidebar-save-collection');
  await page.waitForTimeout(150);

  expect(postedBody).not.toBeNull();
  expect(postedBody.icao24).toBe('aaaaaa');
  expect(postedBody.snapshot).toBeTruthy();
  await expect(page.locator('#sidebar-save-collection')).toHaveClass(/saved/);
});

test('opens the collection panel and renders a saved card', async ({ page }) => {
  await page.route('**/api/collection', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ json: { cards: [{
        id: 'card1',
        user_id: 'u1',
        icao24: 'aaaaaa',
        saved_at: 1752835200,
        snapshot: { registration: 'TC-LGY', aircraftType: 'A20N', operator: 'Test Air' },
        photo_url: null, photo_link: null, photo_photographer: null,
      }] } });
    } else {
      route.continue();
    }
  });

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#collection-toggle');

  await expect(page.locator('#collection-panel')).not.toHaveAttribute('hidden', '');
  await expect(page.locator('.collection-card-title')).toHaveText('TC-LGY');
  await expect(page.locator('.collection-card-subtitle')).toHaveText('A20N · Test Air');
});

test('deleting a card removes it from the panel', async ({ page }) => {
  let deletedId = null;
  await page.route('**/api/collection', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ json: { cards: deletedId ? [] : [{
        id: 'card1',
        user_id: 'u1',
        icao24: 'aaaaaa',
        saved_at: 1752835200,
        snapshot: { registration: 'TC-LGY', aircraftType: 'A20N', operator: 'Test Air' },
        photo_url: null, photo_link: null, photo_photographer: null,
      }] } });
    } else {
      route.continue();
    }
  });
  await page.route('**/api/collection/card1', (route) => {
    deletedId = 'card1';
    route.fulfill({ json: { ok: true } });
  });

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#collection-toggle');
  await expect(page.locator('.collection-card')).toHaveCount(1);

  await page.click('.collection-card-delete');
  await page.waitForTimeout(150);
  await expect(page.locator('.collection-card')).toHaveCount(0);
  await expect(page.locator('#collection-panel-empty')).toBeVisible();
});

test('closing the panel hides it', async ({ page }) => {
  await page.route('**/api/collection', (route) => route.fulfill({ json: { cards: [] } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#collection-toggle');
  await expect(page.locator('#collection-panel')).toBeVisible();

  await page.click('#collection-panel-close');
  await expect(page.locator('#collection-panel')).toBeHidden();
});
