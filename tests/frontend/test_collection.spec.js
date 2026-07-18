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

test('re-selecting an already-saved aircraft shows the save button already filled', async ({ page }) => {
  await page.route('**/api/collection', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ json: { cards: [{
        id: 'card1', user_id: 'u1', icao24: 'aaaaaa', saved_at: 1752835200,
        snapshot: { registration: 'TC-LGY', aircraftType: 'A20N', categoryGroup: 'unknown' },
        photo_url: null, photo_link: null, photo_photographer: null,
      }] } });
    } else {
      route.continue();
    }
  });

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  // checkAuth()'s post-login fetch of /api/collection needs a beat to land
  // before selecting, so savedCardsByIcao is already populated.
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    const marker = openskyMarkers.get('aaaaaa');
    if (marker && marker._icon) marker._icon.click();
  });
  await expect(page.locator('#sidebar-save-collection')).toHaveClass(/saved/);
});

test('an aircraft with ADS-B category "C0" (or flagged as a ground vehicle) shows no save button at all', async ({ page }) => {
  await page.route('**/api/collection', (route) => route.fulfill({ json: { cards: [] } }));
  let postCount = 0;
  await page.route('**/api/collection', (route) => {
    if (route.request().method() === 'POST') postCount++;
    route.fulfill({ json: { cards: [] } });
  });

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  // hex 474806 in the adsb.fi fixture has category "C0" (also a known
  // ground-vehicle registration "TWR", rendered with the tower icon, but
  // still a normal, selectable marker).
  await page.evaluate(() => {
    const marker = adsbfiMarkers.get('474806');
    if (marker && marker._icon) marker._icon.click();
  });
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
  await page.waitForTimeout(300); // let the sidebar's own open transition finish

  // Not just disabled — not in the DOM's visible layout at all, since
  // there's nothing meaningful to save for a non-aircraft.
  await expect(page.locator('#sidebar-save-collection')).toBeHidden();
  expect(postCount).toBe(0);
});

test('opens the collection panel and renders cards grouped by category', async ({ page }) => {
  await page.route('**/api/collection', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ json: { cards: [
        {
          id: 'card1', user_id: 'u1', icao24: 'aaaaaa', saved_at: 1752835200,
          snapshot: { registration: 'TC-LGY', aircraftType: 'A20N', operator: 'Test Air', categoryGroup: 'unknown' },
          photo_url: null, photo_link: null, photo_photographer: null,
        },
        {
          id: 'card2', user_id: 'u1', icao24: 'dddddd', saved_at: 1752835100,
          snapshot: { registration: 'OO-DUP', aircraftType: 'A320', operator: 'Dup Air', categoryGroup: 'large' },
          photo_url: null, photo_link: null, photo_photographer: null,
        },
      ] } });
    } else {
      route.continue();
    }
  });

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#collection-toggle');

  await expect(page.locator('#collection-panel')).not.toHaveAttribute('hidden', '');
  await expect(page.locator('#collection-panel-title')).toHaveText('My collection · 2');

  const groupHeaders = page.locator('.collection-group-header');
  await expect(groupHeaders).toHaveCount(2);
  // "large" is ordered before "unknown" in the fixed weight-class order.
  await expect(groupHeaders.nth(0)).toHaveText('Large · 1');
  await expect(groupHeaders.nth(1)).toHaveText('Unknown / no info · 1');

  await expect(page.locator('.collection-card-title').first()).toHaveText('OO-DUP');
  await expect(page.locator('.collection-card-subtitle').first()).toHaveText('A320');
});

test('shows a descriptive empty state with an icon when there is nothing saved', async ({ page }) => {
  await page.route('**/api/collection', (route) => route.fulfill({ json: { cards: [] } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#collection-toggle');

  await expect(page.locator('#collection-panel-empty')).toBeVisible();
  await expect(page.locator('.collection-empty-icon svg')).toBeVisible();
  await expect(page.locator('.collection-empty-title')).toHaveText('No saved aircraft yet');
});

test('removing a card dims it with an Undo action instead of deleting it outright', async ({ page }) => {
  let deleteCalled = false;
  let restoredBody = null;
  await page.route('**/api/collection', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ json: { cards: [{
        id: 'card1', user_id: 'u1', icao24: 'aaaaaa', saved_at: 1752835200,
        snapshot: { registration: 'TC-LGY', aircraftType: 'A20N', categoryGroup: 'unknown' },
        photo_url: null, photo_link: null, photo_photographer: null,
      }] } });
    } else if (route.request().method() === 'POST') {
      // Undo re-POSTs the ghost's remembered snapshot to re-create the card.
      restoredBody = route.request().postDataJSON();
      route.fulfill({ status: 201, json: { id: 'card2', user_id: 'u1', saved_at: 1752835300, ...restoredBody } });
    } else {
      route.continue();
    }
  });
  await page.route('**/api/collection/card1', (route) => {
    deleteCalled = true;
    route.fulfill({ json: { ok: true } });
  });

  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#collection-toggle');
  await expect(page.locator('.collection-card')).toHaveCount(1);

  await page.click('.collection-card-icon-btn');
  await page.waitForTimeout(150);

  expect(deleteCalled).toBe(true);
  // The card is still in the DOM, just dimmed with an Undo affordance —
  // the real DELETE already happened, this is a session-scoped grace period.
  await expect(page.locator('.collection-card')).toHaveCount(1);
  await expect(page.locator('.collection-card.removed')).toHaveCount(1);
  await expect(page.locator('.collection-card-removed-label')).toHaveText('Removed');

  await page.click('.collection-card-undo-btn');
  await page.waitForTimeout(150);
  expect(restoredBody).not.toBeNull();
  expect(restoredBody.icao24).toBe('aaaaaa');
  await expect(page.locator('.collection-card.removed')).toHaveCount(0);
  await expect(page.locator('.collection-card')).toHaveCount(1);
});

test('closing the panel hides it via the close button and Escape', async ({ page }) => {
  await page.route('**/api/collection', (route) => route.fulfill({ json: { cards: [] } }));
  await page.goto('/');
  await page.waitForSelector('.leaflet-marker-icon');
  await page.click('#collection-toggle');
  await expect(page.locator('#collection-panel')).toBeVisible();

  await page.click('#collection-panel-close');
  await expect(page.locator('#collection-panel')).toBeHidden();

  await page.click('#collection-toggle');
  await expect(page.locator('#collection-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#collection-panel')).toBeHidden();
});
