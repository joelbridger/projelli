/**
 * Theme 3-state cycle (UX-25)
 *
 * The toggle in the top-right header cycles system → light → dark → system.
 * In 'system' mode the app listens to prefers-color-scheme so OS changes
 * flow through. Persistence lives in localStorage['theme'].
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick } from './helpers/test-utils';

test.describe('Theme cycle (UX-25)', () => {
  test('first run defaults to system theme with correct icon', async ({ page }) => {
    // Clear any stored theme from previous runs so we hit the default branch.
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('theme');
      } catch {
        /* no-op */
      }
    });
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toHaveAttribute('data-theme', 'system');
    await expect(page.getByTestId('theme-icon-system')).toBeVisible();
  });

  test('clicking cycles system → light → dark → system', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('theme');
      } catch {
        /* no-op */
      }
    });
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    const toggle = page.getByTestId('theme-toggle');

    // Start: system
    await expect(toggle).toHaveAttribute('data-theme', 'system');

    // Click 1: light
    await hardClick(toggle);
    await expect(toggle).toHaveAttribute('data-theme', 'light');
    await expect(page.getByTestId('theme-icon-light')).toBeVisible();

    // Click 2: dark
    await hardClick(toggle);
    await expect(toggle).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('theme-icon-dark')).toBeVisible();

    // Click 3: back to system
    await hardClick(toggle);
    await expect(toggle).toHaveAttribute('data-theme', 'system');
    await expect(page.getByTestId('theme-icon-system')).toBeVisible();
  });

  test('persists the preference across reloads', async ({ page }) => {
    // Seed localStorage explicitly to 'light' BEFORE navigation. This
    // exercises the real persistence path: a reload should pick up the
    // stored value and render 'light'. (An earlier version of this test
    // relied on click-then-reload, but page.reload() re-runs the
    // addInitScript which would clobber the click-written value.)
    await page.addInitScript(() => {
      try {
        localStorage.setItem('theme', 'light');
      } catch {
        /* no-op */
      }
    });
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await expect(page.getByTestId('theme-toggle')).toHaveAttribute(
      'data-theme',
      'light'
    );

    await page.reload();
    await waitForTestModeLoad(page);
    await expect(page.getByTestId('theme-toggle')).toHaveAttribute(
      'data-theme',
      'light'
    );
  });

  test('dark theme applies the dark class to <html>', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('theme', 'dark');
      } catch {
        /* no-op */
      }
    });
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('system mode syncs effective theme with prefers-color-scheme', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('theme', 'system');
      } catch {
        /* no-op */
      }
    });
    // Emulate dark OS preference BEFORE navigation so the initial render
    // picks it up. In Chromium, emulateMedia affects matchMedia immediately.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // HTML should have `dark` class because system prefers dark and the
    // user hasn't overridden.
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Swap OS preference to light. The matchMedia listener should flip
    // the effective theme.
    await page.emulateMedia({ colorScheme: 'light' });
    // Give React a tick. toHaveClass polls for up to 5s by default.
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });
});
