import { defineConfig, devices } from '@playwright/test';
import { withBrowserLaunchOptions } from '../scripts/browser-launch.mjs';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4178);

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${String(port)}`,
    launchOptions: withBrowserLaunchOptions(),
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${String(port)}`,
    url: `http://127.0.0.1:${String(port)}`,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
});
