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
 *
 * E2E_BASE_URL:
 *   When set (e.g. "http://localhost:4173" for the preview server), Playwright
 *   points all projects at that server and skips auto-starting the dev webServer
 *   (the preview script manages its own server lifecycle). Per-project ?lang=*
 *   URLs are derived from E2E_BASE_URL so they also point at preview, not :5173.
 *
 *   When unset, the default dev-server behavior (localhost:5173, auto-start via
 *   `npm run dev`) is preserved unchanged.
 */

const E2E_BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1, // 1 retry locally for cold-start flakes
  // Limit workers: WSL dev server on Windows FS is slow on cold start
  workers: process.env.CI ? 1 : 2,
  reporter: 'html',

  // Visual snapshots are environment-sensitive (font hinting / anti-aliasing differ
  // between machines). A small tolerance keeps the CI gate from flaking on sub-pixel
  // rendering noise while still catching real layout regressions (which move far more
  // than 2% of pixels).
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },

  timeout: 60_000, // Per-test timeout (cold start can be slow)

  use: {
    baseURL: E2E_BASE_URL,
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
        baseURL: `${E2E_BASE_URL}/?lang=en`,
        locale: 'en-US',
      },
    },
    {
      name: 'es',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `${E2E_BASE_URL}/?lang=es`,
        locale: 'es-ES',
      },
    },
    {
      name: 'de',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `${E2E_BASE_URL}/?lang=de`,
        locale: 'de-DE',
      },
    },
  ],

  // Run dev server before tests — skipped when E2E_BASE_URL is set because the
  // preview script (scripts/run-e2e-preview.sh) manages its own server.
  webServer: process.env['E2E_BASE_URL']
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
});
