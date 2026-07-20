const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
});

test('shows a "Sign in with Google" button when logged out', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({ json: { user: null } }));
  await page.goto('/');
  await expect(page.locator('#google-signin-btn')).toBeVisible();
  await expect(page.locator('#google-signin-btn')).toContainText('Sign in with Google');
  await expect(page.locator('#user-menu')).toBeHidden();
});

test('clicking the Google button navigates to the OAuth route', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({ json: { user: null } }));
  // Stub the real route so the test doesn't depend on whether the test
  // server has real Google credentials configured — only the navigation
  // target matters here.
  await page.route('**/api/login/google', (route) => route.fulfill({ json: { stub: true } }));
  await page.goto('/');

  await page.click('#google-signin-btn');
  await page.waitForURL(/\/api\/login\/google$/);
});

test('shows an avatar pill with the user\'s name when logged in', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({
    json: { user: { sub: 'u1', email: 'pilot@example.com', name: 'Pilot Example', picture: null } },
  }));
  await page.goto('/');
  await expect(page.locator('#google-signin-btn')).toBeHidden();
  await expect(page.locator('#user-menu')).toBeVisible();
  await expect(page.locator('#user-menu-name')).toHaveText('Pilot Example');
  // No real photo — falls back to the built-in silhouette rather than a
  // broken image or an empty src.
  await expect(page.locator('#user-avatar')).toHaveAttribute('src', /^data:image\/svg\+xml/);
});

test('the avatar pill opens a dropdown with the email, collection link, and sign out', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({
    json: { user: { sub: 'u1', email: 'pilot@example.com', name: 'Pilot Example', picture: null } },
  }));
  await page.goto('/');

  await expect(page.locator('#user-menu')).not.toHaveClass(/open/);
  await page.click('#user-menu-trigger');
  await expect(page.locator('#user-menu')).toHaveClass(/open/);
  await expect(page.locator('#user-menu-email')).toHaveText('pilot@example.com');
  await expect(page.locator('#user-menu-collection')).toBeVisible();
  await expect(page.locator('#user-menu-logout')).toBeVisible();

  // Clicking outside closes it again, same as the other HUD dropdowns.
  await page.mouse.click(10, 10);
  await expect(page.locator('#user-menu')).not.toHaveClass(/open/);
});

test('signing out from the menu clears the avatar and restores the sign-in button', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({
    json: { user: { sub: 'u1', email: 'pilot@example.com', name: 'Pilot Example', picture: null } },
  }));
  let loggedOut = false;
  await page.route('**/api/logout', (route) => {
    loggedOut = true;
    route.fulfill({ json: { ok: true } });
  });
  await page.goto('/');
  await expect(page.locator('#user-menu')).toBeVisible();

  await page.click('#user-menu-trigger');
  await page.click('#user-menu-logout');
  await page.waitForTimeout(100);
  expect(loggedOut).toBe(true);
  await expect(page.locator('#google-signin-btn')).toBeVisible();
  await expect(page.locator('#user-menu')).toBeHidden();
});
