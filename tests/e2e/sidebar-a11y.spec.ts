/**
 * Spine navigation accessibility.
 *
 * Keepance 3.0 replaced the old tablist sidebar with a primary navigation
 * spine. The current contract is page-style navigation: each item is a normal
 * button, the selected surface uses aria-current="page", and keyboard users
 * can focus and activate each nav item.
 */

import { test, expect } from '@playwright/test';
import { hardClick, waitForTestModeLoad } from './helpers/test-utils';

const SPINE_ITEMS = [
  { id: 'matters', label: 'Client Map' },
  { id: 'search', label: 'Ask' },
  { id: 'workflows', label: 'Workflows' },
] as const;

test.describe('Spine nav accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('primary spine navigation is labelled and exposes every destination', async ({ page }) => {
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();

    for (const item of SPINE_ITEMS) {
      const button = page.getByTestId(`spine-nav-${item.id}`);
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
      await expect(button).toContainText(item.label);
    }
  });

  test('the active destination is marked with aria-current', async ({ page }) => {
    // The 3-tab IA lands on the Client Map (matters).
    const matters = page.getByTestId('spine-nav-matters');
    await expect(matters).toHaveAttribute('aria-current', 'page');

    const search = page.getByTestId('spine-nav-search');
    await expect(search).not.toHaveAttribute('aria-current', 'page');

    await hardClick(search);
    await expect(search).toHaveAttribute('aria-current', 'page');
    await expect(matters).not.toHaveAttribute('aria-current', 'page');
  });

  test('keyboard users can focus and activate spine destinations', async ({ page }) => {
    const workflows = page.getByTestId('spine-nav-workflows');
    await workflows.focus();
    await expect(workflows).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(workflows).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('associate-home')).toBeVisible();
  });
});
