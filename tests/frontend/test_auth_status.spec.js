const { test, expect } = require('@playwright/test');
const { mockAllSources } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await mockAllSources(page);
});

test('shows a sign-in link when logged out', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({ json: { user: null } }));
  await page.goto('/');
  await expect(page.locator('#auth-status')).toHaveText('Sign in with Google');
  await expect(page.locator('#auth-status')).not.toHaveClass(/logged-in/);
});

test('clicking sign-in navigates to the Google OAuth route', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({ json: { user: null } }));
  // Stub the real route so the test doesn't depend on whether the test
  // server has real Google credentials configured — only the navigation
  // target matters here.
  await page.route('**/api/login/google', (route) => route.fulfill({ json: { stub: true } }));
  await page.goto('/');
  await expect(page.locator('#auth-status')).toHaveText('Sign in with Google');

  await page.click('#auth-status');
  await page.waitForURL(/\/api\/login\/google$/);
});

test('shows a greeting and logout option when logged in', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({
    json: { user: { sub: 'u1', email: 'pilot@example.com', name: 'Pilot Example', picture: null } },
  }));
  await page.goto('/');
  await expect(page.locator('#auth-status')).toHaveText('Hi, Pilot Example · Logout');
  await expect(page.locator('#auth-status')).toHaveClass(/logged-in/);
});

test('logging out clears the greeting', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({
    json: { user: { sub: 'u1', email: 'pilot@example.com', name: 'Pilot Example', picture: null } },
  }));
  let loggedOut = false;
  await page.route('**/api/logout', (route) => {
    loggedOut = true;
    route.fulfill({ json: { ok: true } });
  });
  await page.goto('/');
  await expect(page.locator('#auth-status')).toHaveClass(/logged-in/);

  await page.click('#auth-status');
  await page.waitForTimeout(100);
  expect(loggedOut).toBe(true);
  await expect(page.locator('#auth-status')).toHaveText('Sign in with Google');
});
