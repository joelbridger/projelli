import { defineConfig, devices } from '@playwright/test';
import { withBrowserLaunchOptions } from './scripts/browser-launch.mjs';

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

// CI quarantine: specs with CI-environment-sensitive failures (state / onboarding /
// demo-mode / visual differences that only appear when process.env.CI is set). They
// are excluded from the CI gate (E2E_CI_QUARANTINE=1) so it stays a trustworthy green
// hard-gate. They STILL run locally.
//
// OWNED + DATED: every spec below has an owner + a fix-or-delete-by date in
// docs/quality/e2e-flaky-quarantine.md — a quarantine with no deadline rots into a
// graveyard. Adding a spec here REQUIRES adding a row there in the same change; by
// its date a spec must be fixed (and removed here), deleted, or re-dated with a reason.
// F3.7b (2026-07-03): both whole-file entries FIXED and removed — see
// docs/quality/e2e-flaky-quarantine.md for the root causes + fixes
// (templates-marketplace.spec.ts: a real product-code test seam replaced the
// dev-only Vite module-graph import; web-demo.spec.ts: the e2e CI job now
// also builds + merges the web-demo bundle so /index.demo.html exists under
// the production preview server). wedge-proof.spec.ts's remaining 1
// CI-divergent (but deterministic, non-flaky) test keeps its per-test
// in-spec skip — see the file itself.
const CI_QUARANTINE: string[] = [];

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: process.env['E2E_CI_QUARANTINE'] ? CI_QUARANTINE : [],
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
    launchOptions: withBrowserLaunchOptions(),
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
