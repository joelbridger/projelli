/**
 * Collapsed spine labels.
 *
 * The old sidebar used Radix tooltip nodes. The 3.0 spine uses compact icon
 * buttons with native `title` labels when collapsed, so this verifies the
 * current accessible label behavior instead of removed tooltip elements.
 */

import { test, expect } from '@playwright/test';
import { hardClick, waitForTestModeLoad } from './helpers/test-utils';

test.describe('Collapsed spine labels', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('Documents nav exposes a title label when the spine is collapsed', async ({ page }) => {
    await hardClick(page.getByRole('button', { name: 'Collapse sidebar' }));

    const documents = page.getByTestId('spine-nav-collapsed-files');
    await expect(documents).toBeVisible();
    await expect(documents).toHaveAttribute('title', 'Documents');
  });

  test('collapsed spine preserves the active destination state', async ({ page }) => {
    await hardClick(page.getByRole('button', { name: 'Collapse sidebar' }));

    const documents = page.getByTestId('spine-nav-collapsed-files');
    await expect(documents).toHaveAttribute('aria-current', 'page');

    await hardClick(page.getByTestId('spine-nav-collapsed-settings'));
    await expect(page.getByTestId('spine-nav-collapsed-settings')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('settings-page')).toBeVisible();
  });

  test('expanded spine shows inline labels and no collapsed icon buttons', async ({ page }) => {
    await expect(page.getByTestId('spine-nav-files')).toContainText('Documents');
    await expect(page.getByTestId('spine-nav-collapsed-files')).toHaveCount(0);
  });
});
