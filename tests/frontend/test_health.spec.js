const { test, expect } = require('@playwright/test');

test('GET /api/health returns 200 with status ok', async ({ request }) => {
  // Hit the real /api/health endpoint (not mocked)
  const response = await request.get('http://127.0.0.1:5050/api/health');
  expect(response.status()).toBe(200);

  const json = await response.json();
  expect(json).toHaveProperty('status');
  expect(json.status).toBe('ok');
});

test('health response does not leak operational details', async ({ request }) => {
  // Hit the real /api/health endpoint (not mocked)
  const response = await request.get('http://127.0.0.1:5050/api/health');
  const text = await response.text();

  // These terms should NOT appear in the health response
  const forbidden = ['quota', 'opensky', 'adsb', 'flightaware', 'zone', 'bbox', 'config'];
  for (const term of forbidden) {
    expect(text.toLowerCase()).not.toContain(term.toLowerCase());
  }
});

test('health endpoint is accessible without authentication', async ({ request }) => {
  // Don't mock /api/me, don't log in — just hit the endpoint directly
  const response = await request.get('http://127.0.0.1:5050/api/health');
  expect(response.status()).toBe(200);
});
