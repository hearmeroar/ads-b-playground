// @ts-check
const { defineConfig } = require('@playwright/test');

// A non-default port avoids colliding with macOS's AirPlay Receiver, which
// listens on 5000 by default and can confuse this health check even though
// Flask itself binds there just fine.
const PORT = 5050;

module.exports = defineConfig({
  testDir: './tests/frontend',
  timeout: 30000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  webServer: {
    command: '.venv/bin/python app.py',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: { PORT: String(PORT) },
  },
});
