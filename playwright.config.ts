import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Keepance UI tests
 *
 * Key principles:
 * - Use data-testid selectors (page.getByTestId()) - never CSS selectors
 * - Always assert visibility/enabled before interacting
 * - No waitForTimeout - use locator assertions instead
 * - Visual snapshots for layout regression detection
 * - Accessibility tests with axe-core
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1, // 1 retry locally for cold-start flakes
  // Limit workers: WSL dev server on Windows FS is slow on cold start
  workers: process.env.CI ? 1 : 2,
  reporter: 'html',

  timeout: 60_000, // Per-test timeout (cold start can be slow)

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 60_000, // Dev server cold start on WSL can be slow
  },

  // Locale matrix (Stream E task 7.1):
  // The default `chromium` project keeps the existing snapshot baselines
  // pointing at English. The `en`, `es`, `de` projects bootstrap the app
  // with a `?lang=...` query param (handled in src/main.tsx) so every
  // existing E2E spec can run unchanged across locales. Run a single
  // locale via `npx playwright test --project=es`, or the whole matrix
  // with `npx playwright test --project=en --project=es --project=de`.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'en',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173/?lang=en',
        locale: 'en-US',
      },
    },
    {
      name: 'es',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173/?lang=es',
        locale: 'es-ES',
      },
    },
    {
      name: 'de',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173/?lang=de',
        locale: 'de-DE',
      },
    },
  ],

  // Run dev server before tests
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
