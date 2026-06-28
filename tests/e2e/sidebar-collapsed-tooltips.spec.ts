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

  test('Client Map nav exposes a title label when the spine is collapsed', async ({ page }) => {
    await hardClick(page.getByRole('button', { name: 'Collapse sidebar' }));

    const clientMap = page.getByTestId('spine-nav-collapsed-matters');
    await expect(clientMap).toBeVisible();
    await expect(clientMap).toHaveAttribute('title', 'Client Map');
  });

  test('collapsed spine preserves the active destination state', async ({ page }) => {
    await hardClick(page.getByRole('button', { name: 'Collapse sidebar' }));

    // Lands on the Client Map (matters).
    const clientMap = page.getByTestId('spine-nav-collapsed-matters');
    await expect(clientMap).toHaveAttribute('aria-current', 'page');

    await hardClick(page.getByTestId('spine-nav-collapsed-workflows'));
    await expect(page.getByTestId('spine-nav-collapsed-workflows')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('associate-home')).toBeVisible();
  });

  test('expanded spine shows inline labels and no collapsed icon buttons', async ({ page }) => {
    await expect(page.getByTestId('spine-nav-matters')).toContainText('Client Map');
    await expect(page.getByTestId('spine-nav-collapsed-matters')).toHaveCount(0);
  });
});
