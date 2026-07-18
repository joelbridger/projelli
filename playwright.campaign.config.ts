/**
 * Playwright campaign configuration — Keepance 3.0 usability campaign.
 *
 * Extends the patterns from the main playwright.config.ts but targets:
 *   - testDir: tests/campaign/
 *   - Three viewport projects (1366x768, 1536x864, 1920x1080), English only
 *   - screenshot: 'on' (every test), trace: 'on', video: 'retain-on-failure'
 *   - outputDir: docs/quality/2026-06-10-v3-usability-campaign/runs/
 *   - Reuses the existing dev server (reuseExistingServer: true always)
 *
 * Run: npx playwright test -c playwright.campaign.config.ts
 * Single viewport: npx playwright test -c playwright.campaign.config.ts --project=1366
 * Keep screenshots: CAMPAIGN_KEEP_SHOTS=1 npx playwright test -c playwright.campaign.config.ts
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { withBrowserLaunchOptions } from './scripts/browser-launch.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.resolve(
  __dirname,
  'docs/quality/2026-06-10-v3-usability-campaign/runs',
);

export default defineConfig({
  testDir: './tests/campaign',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 2,
  reporter: [
    ['html', { outputFolder: 'docs/quality/2026-06-10-v3-usability-campaign/report' }],
    ['list'],
  ],

  timeout: 60_000,
  outputDir: OUTPUT_DIR,

  use: {
    baseURL: 'http://localhost:5173',
    launchOptions: withBrowserLaunchOptions(),
    trace: 'on',
    video: 'retain-on-failure',
    screenshot: 'on',
    actionTimeout: 10_000,
    navigationTimeout: 60_000,
    locale: 'en-US',
  },

  projects: [
    {
      name: '1366',
      use: {
        viewport: { width: 1366, height: 768 },
      },
    },
    {
      name: '1536',
      use: {
        viewport: { width: 1536, height: 864 },
      },
    },
    {
      name: '1920',
      use: {
        viewport: { width: 1920, height: 1080 },
      },
    },
  ],

  // Reuse the already-running Vite dev server — never spin a new one in
  // campaign runs (the dev server may have been started by the orchestrator).
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
