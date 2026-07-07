/**
 * Light-only theme lock.
 *
 * The old top-header theme toggle is intentionally gone. The app still keeps
 * the hidden theme engine for future development, but the user-facing app
 * boots light and does not expose a theme picker.
 */

import { test, expect, type Page } from '@playwright/test';
import { waitForTestModeLoad } from './helpers/test-utils';

async function addThemeSeedInitScript(
  page: Page,
  seed: {
    theme?: 'light' | 'dark' | 'system';
    themeExplicitlyChosen?: boolean;
    legacyRawTheme?: 'light' | 'dark' | 'system';
  }
) {
  await page.addInitScript((nextSeed) => {
    localStorage.removeItem('lantern:settings');
    localStorage.removeItem('theme');
    if (nextSeed.legacyRawTheme) {
      localStorage.setItem('theme', nextSeed.legacyRawTheme);
    }
    if (!nextSeed.theme) return;
    localStorage.setItem(
      'lantern:settings',
      JSON.stringify({
        state: {
          values: { theme: nextSeed.theme },
          themeExplicitlyChosen: nextSeed.themeExplicitlyChosen === true,
          _migrated: true,
          featuresTourCompleted: false,
          language: null,
        },
        version: 1,
      })
    );
  }, seed);
}

test.describe('Light-only theme lock', () => {
  test('first run shows no theme toggle and applies light', async ({ page }) => {
    await addThemeSeedInitScript(page, {});
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await expect(page.getByTestId('theme-toggle')).toHaveCount(0);
    await expect(page.getByTestId('theme-icon-light')).toHaveCount(0);
    await expect(page.getByTestId('theme-icon-dark')).toHaveCount(0);
    await expect(page.getByTestId('theme-icon-system')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('an old dark value without the explicit-choice stamp normalizes to light', async ({
    page,
  }) => {
    await addThemeSeedInitScript(page, { theme: 'dark' });
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await expect(page.getByTestId('theme-toggle')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('an old system value without the explicit-choice stamp ignores dark OS mode', async ({
    page,
  }) => {
    await addThemeSeedInitScript(page, { theme: 'system' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await expect(page.getByTestId('theme-toggle')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('the legacy raw theme key is deleted and never exposes a toggle', async ({
    page,
  }) => {
    await addThemeSeedInitScript(page, { legacyRawTheme: 'dark' });
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(page.getByTestId('theme-toggle')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBeNull();
  });
});
