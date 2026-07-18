/**
 * Spine navigation accessibility.
 *
 * Lantern 3.0 replaced the old tablist sidebar with a primary navigation
 * spine. The current contract is page-style navigation: each item is a normal
 * button, the selected surface uses aria-current="page", and keyboard users
 * can focus and activate each nav item.
 */

import { test, expect } from '@playwright/test';
import { hardClick, waitForTestModeLoad } from './helpers/test-utils';

const SPINE_ITEMS = [
  { id: 'home', label: 'Home' },
  { id: 'matters', label: 'Clients' },
  { id: 'search', label: /^(Ask|Preguntar|Fragen)$/ },
] as const;

const PRIMARY_NAVIGATION_LABEL = /^(Primary|Principal|Primär)$/;
const ASK_HEADING = /^(Ask|Preguntar|Fragen)$/;

test.describe('Spine nav accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('primary spine navigation is labelled and exposes every destination', async ({ page }) => {
    await expect(page.getByRole('navigation', { name: PRIMARY_NAVIGATION_LABEL })).toBeVisible();

    for (const item of SPINE_ITEMS) {
      const button = page.getByTestId(`spine-nav-${item.id}`);
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
      await expect(button).toContainText(item.label);
    }
  });

  test('the active destination is marked with aria-current', async ({ page }) => {
    // The 3-item spine lands on Home.
    const home = page.getByTestId('spine-nav-home');
    await expect(home).toHaveAttribute('aria-current', 'page');

    const search = page.getByTestId('spine-nav-search');
    await expect(search).not.toHaveAttribute('aria-current', 'page');

    await hardClick(search);
    await expect(search).toHaveAttribute('aria-current', 'page');
    await expect(home).not.toHaveAttribute('aria-current', 'page');
  });

  test('keyboard users can focus and activate spine destinations', async ({ page }) => {
    const search = page.getByTestId('spine-nav-search');
    await search.focus();
    await expect(search).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(search).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: ASK_HEADING })).toBeVisible();
  });
});
