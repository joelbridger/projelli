/**
 * "What's new" toast + modal (UX-20)
 *
 * - First-time user: no stored lastSeenVersion → toast stays hidden, and
 *   the current version is written silently.
 * - Upgrade: stored version differs from current → toast appears.
 * - Same version: stored matches → nothing shows.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick } from './helpers/test-utils';

test.describe("What's new toast (UX-20)", () => {
  test('first-time user sees no toast', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('projelli:lastSeenVersion');
      } catch {
        /* no-op */
      }
    });
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await expect(page.getByTestId('whats-new-toast')).toBeHidden();
  });

  test('upgrade from older version shows toast and modal', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('projelli:lastSeenVersion', '0.0.1');
      } catch {
        /* no-op */
      }
    });
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // Toast visible
    const toast = page.getByTestId('whats-new-toast');
    await expect(toast).toBeVisible();

    // Open modal
    await hardClick(page.getByTestId('whats-new-toast-link'));
    const modal = page.getByTestId('whats-new-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(/What's new/i);

    // Toast should close once modal opens (tracking persists the version).
    await expect(toast).toBeHidden();
  });

  test('dismissing the toast persists the version', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('projelli:lastSeenVersion', '0.0.1');
      } catch {
        /* no-op */
      }
    });
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    const toast = page.getByTestId('whats-new-toast');
    await expect(toast).toBeVisible();

    // Read current version from DOM so we don't need to keep this test in
    // sync with the changelog top entry manually.
    const versionText = await toast.textContent();
    const match = versionText!.match(/v(\d+\.\d+\.\d+)/);
    expect(match).not.toBeNull();
    const currentVersion = match![1]!;

    await hardClick(page.getByTestId('whats-new-toast-dismiss'));
    await expect(toast).toBeHidden();

    // The dismiss action should have written the current version. Read it
    // back from localStorage directly.
    const stored = await page.evaluate(() =>
      localStorage.getItem('projelli:lastSeenVersion')
    );
    expect(stored).toBe(currentVersion);
  });

  test('same version shows nothing', async ({ page }) => {
    // Inject a matching version. We use the package.json version because
    // that's what we pinned the changelog to. If the numbers diverge the
    // test will legitimately fail.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('projelli:lastSeenVersion', '1.0.7');
      } catch {
        /* no-op */
      }
    });
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await expect(page.getByTestId('whats-new-toast')).toBeHidden();
  });
});
