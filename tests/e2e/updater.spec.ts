/**
 * Auto-updater UI tests
 *
 * The real `@tauri-apps/plugin-updater` is a no-op outside Tauri (the
 * store's `check()` short-circuits when the Tauri runtime globals aren't
 * present). Rather than mock the plugin module, we drive the updater
 * store directly via window.__updaterStore — the same shape the real
 * plugin would set after a successful check.
 *
 * Verifies:
 *   1. Banner is hidden by default in test mode
 *   2. Banner appears when an update becomes available
 *   3. "See what's changed" opens the release notes modal
 *   4. "Later" dismisses for the session
 *   5. Downloading state shows the progress bar with a percent
 *   6. Ready-to-restart state shows the Restart now button
 *   7. The release notes modal has accessible DialogTitle + DialogDescription
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad } from './helpers/test-utils';

interface FakeUpdate {
  version: string;
  currentVersion: string;
  date: string;
  body: string;
}

const FAKE_UPDATE: FakeUpdate = {
  version: '1.0.8',
  currentVersion: '1.0.7',
  date: '2026-04-15',
  body: 'Highlights:\n\n- Auto-updater now ships out of the box\n- Workflow runs persist as .workflow files\n- Dialog accessibility warnings cleaned up',
};

async function gotoApp(page: import('@playwright/test').Page) {
  await page.goto('/?testMode=true');
  await waitForTestModeLoad(page);
}

async function setAvailable(page: import('@playwright/test').Page, update: FakeUpdate) {
  await page.evaluate((u) => {
    // The store is exposed by UpdateManager's mount effect.
    const store = (window as any).__updaterStore;
    if (!store) throw new Error('updater store not exposed on window');
    store.setState({
      // Use a plain object — the components only read scalar fields.
      available: u,
      status: 'available',
      error: null,
      dismissedThisSession: false,
      downloadProgress: { total: 0, downloaded: 0 },
    });
  }, update as unknown as Record<string, unknown>);
}

async function setDownloading(page: import('@playwright/test').Page, update: FakeUpdate, percent: number) {
  await page.evaluate(
    (args) => {
      const store = (window as any).__updaterStore;
      if (!store) throw new Error('updater store not exposed on window');
      const total = 1000;
      store.setState({
        available: args.update,
        status: 'downloading',
        downloadProgress: { total, downloaded: Math.round((args.percent / 100) * total) },
        dismissedThisSession: false,
      });
    },
    { update: update as unknown as Record<string, unknown>, percent }
  );
}

async function setReadyToRestart(page: import('@playwright/test').Page, update: FakeUpdate) {
  await page.evaluate((u) => {
    const store = (window as any).__updaterStore;
    if (!store) throw new Error('updater store not exposed on window');
    store.setState({
      available: u,
      status: 'ready-to-restart',
      dismissedThisSession: false,
    });
  }, update as unknown as Record<string, unknown>);
}

async function resetUpdater(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const store = (window as any).__updaterStore;
    if (!store) return;
    store.getState().reset();
  });
}

test.describe('Auto-updater UI', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await resetUpdater(page);
  });

  test('banner is hidden by default in test mode', async ({ page }) => {
    await expect(page.getByTestId('update-banner')).toHaveCount(0);
  });

  test('banner appears when an update becomes available', async ({ page }) => {
    await setAvailable(page, FAKE_UPDATE);
    const banner = page.getByTestId('update-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('1.0.8');
    await expect(banner).toContainText('available');
    await expect(page.getByTestId('update-banner-install')).toBeVisible();
    await expect(page.getByTestId('update-banner-see-changes')).toBeVisible();
  });

  test('"See what\'s changed" opens the release notes modal', async ({ page }) => {
    await setAvailable(page, FAKE_UPDATE);
    await page.getByTestId('update-banner-see-changes').click();
    const modal = page.getByTestId('update-release-notes-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: /projelli 1\.0\.8/i })).toBeVisible();
    // Body shows the release notes verbatim.
    await expect(page.getByTestId('update-release-notes-body')).toContainText(
      'Auto-updater now ships out of the box'
    );
    // Close it.
    await page.getByTestId('update-release-notes-later').click();
    await expect(modal).toHaveCount(0);
  });

  test('"Later" dismisses the banner for the session', async ({ page }) => {
    await setAvailable(page, FAKE_UPDATE);
    await page.getByTestId('update-banner-later').click();
    await expect(page.getByTestId('update-banner')).toHaveCount(0);
  });

  test('downloading state shows progress bar and percent', async ({ page }) => {
    await setDownloading(page, FAKE_UPDATE, 47);
    const banner = page.getByTestId('update-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-status', 'downloading');
    await expect(banner).toContainText('47%');
    await expect(page.getByTestId('update-progress-bar')).toBeVisible();
  });

  test('ready-to-restart state shows the Restart now button', async ({ page }) => {
    await setReadyToRestart(page, FAKE_UPDATE);
    const banner = page.getByTestId('update-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-status', 'ready-to-restart');
    await expect(page.getByTestId('update-banner-restart')).toBeVisible();
    await expect(page.getByTestId('update-banner-restart-later')).toBeVisible();
  });

  test('release notes modal has both DialogTitle and DialogDescription (a11y)', async ({ page }) => {
    await setAvailable(page, FAKE_UPDATE);
    await page.getByTestId('update-banner-see-changes').click();
    const modal = page.getByTestId('update-release-notes-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading')).toBeVisible();
    // DialogDescription is rendered as a paragraph; just assert any
    // descriptive text adjacent to the title is present.
    await expect(modal).toContainText(/changed since your current version/i);
  });
});
