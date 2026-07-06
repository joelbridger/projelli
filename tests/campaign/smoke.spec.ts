/**
 * Smoke spec — Lantern 3.0 campaign baseline.
 *
 * Loads ?testMode=true, asserts:
 *   - app shell is visible (sidebar + status-bar + app-container)
 *   - zero non-benign console errors
 *   - zero horizontal overflow
 *
 * Runs across all three viewport projects defined in playwright.campaign.config.ts.
 * Screenshots are taken at each checkpoint via snap().
 */

import { test, expect } from '@playwright/test';
import { snap, collectConsoleErrors, horizontalOverflow } from './helpers/campaign';

test.describe('Campaign Smoke — app shell', () => {
  test('app shell visible, no console errors, no horizontal overflow', async ({
    page,
  }, testInfo) => {
    // Start collecting console errors before navigation so nothing is missed.
    const getErrors = collectConsoleErrors(page);

    await page.goto('/?testMode=true');

    // Wait for the sidebar to be visible — the canonical "app shell ready" signal
    // used by all e2e tests. Allow a generous timeout for cold server starts.
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('status-bar')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('app-container')).toBeVisible({ timeout: 10_000 });

    // Take the baseline screenshot.
    await snap(page, testInfo, 'smoke-app-shell');

    // Assert: zero non-benign console errors.
    const errors = getErrors();
    expect(
      errors,
      `Console errors detected:\n${errors.join('\n')}`,
    ).toHaveLength(0);

    // Assert: zero horizontal overflow at this viewport.
    const overflowOffenders = await horizontalOverflow(page);
    expect(
      overflowOffenders,
      `Horizontal overflow detected:\n${overflowOffenders.join('\n')}`,
    ).toHaveLength(0);
  });
});
