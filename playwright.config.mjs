import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT || 4174);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: origin,
    colorScheme: 'light',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry'
  },
  webServer: {
    command: 'node scripts/fixture-server.mjs',
    env: { PORT: String(port) },
    url: `${origin}/__fixture_health`,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000
  },
  projects: [
    {
      name: 'desktop-chromium',
      testMatch: ['**/desktop.spec.mjs', '**/accessibility.spec.mjs'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 }
      }
    },
    {
      name: 'mobile-chromium',
      testMatch: '**/mobile.spec.mjs',
      use: { ...devices['Pixel 5'] }
    }
  ]
});
