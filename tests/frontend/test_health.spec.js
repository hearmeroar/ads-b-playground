const { test, expect } = require('@playwright/test');

test('GET /api/health returns 200 with status ok', async ({ page }) => {
  const response = await page.goto('/api/health');
  expect(response.status()).toBe(200);

  const text = await page.content();
  const json = JSON.parse(text);
  expect(json).toHaveProperty('status');
  expect(json.status).toBe('ok');
});

test('health response does not leak operational details', async ({ page }) => {
  const response = await page.goto('/api/health');
  const text = await page.content();

  // These terms should NOT appear in the health response
  const forbidden = ['quota', 'opensky', 'adsb', 'flightaware', 'zone', 'bbox', 'config'];
  for (const term of forbidden) {
    expect(text.toLowerCase()).not.toContain(term.toLowerCase());
  }
});

test('health endpoint is accessible without authentication', async ({ page }) => {
  // Don't mock /api/me, don't log in — just hit the endpoint directly
  const response = await page.goto('/api/health');
  expect(response.status()).toBe(200);
});
