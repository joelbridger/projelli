/**
 * Sidebar accessibility (UX-03)
 *
 * The sidebar section switcher is a tablist. Each section button must have
 * role="tab" with aria-selected that tracks the active tab, and the content
 * pane must be a tabpanel labelled by the active tab. Arrow keys must move
 * focus between tabs following the native tablist keyboard pattern.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad } from './helpers/test-utils';

test.describe('Sidebar nav tablist semantics', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('sidebar tab container has role="tablist" with vertical orientation', async ({ page }) => {
    const tablist = page.getByRole('tablist', { name: 'Sidebar sections' });
    await expect(tablist).toBeVisible();
    await expect(tablist).toHaveAttribute('aria-orientation', 'vertical');
  });

  test('each sidebar tab has role="tab" and correct aria-selected', async ({ page }) => {
    // Files tab starts active
    const filesTab = page.getByTestId('sidebar-tab-files');
    await expect(filesTab).toHaveAttribute('role', 'tab');
    await expect(filesTab).toHaveAttribute('aria-selected', 'true');

    // Other tabs are not selected
    const searchTab = page.getByTestId('sidebar-tab-search');
    await expect(searchTab).toHaveAttribute('role', 'tab');
    await expect(searchTab).toHaveAttribute('aria-selected', 'false');

    // Activating a different tab flips aria-selected
    await searchTab.click();
    await expect(searchTab).toHaveAttribute('aria-selected', 'true');
    await expect(filesTab).toHaveAttribute('aria-selected', 'false');
  });

  test('active content pane is a tabpanel labelled by the active tab', async ({ page }) => {
    const content = page.getByTestId('sidebar-content');
    await expect(content).toHaveAttribute('role', 'tabpanel');
    // When Files is active, the panel should be labelled by the Files tab's id
    await expect(content).toHaveAttribute('aria-labelledby', 'sidebar-tab-files');

    await page.getByTestId('sidebar-tab-workflows').click();
    await expect(content).toHaveAttribute('aria-labelledby', 'sidebar-tab-workflows');
  });

  test('arrow-down moves focus to the next tab', async ({ page }) => {
    const filesTab = page.getByTestId('sidebar-tab-files');
    await filesTab.focus();
    await expect(filesTab).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('sidebar-tab-search')).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('sidebar-tab-workflows')).toBeFocused();
  });

  test('arrow-up moves focus to the previous tab', async ({ page }) => {
    const workflowsTab = page.getByTestId('sidebar-tab-workflows');
    await workflowsTab.focus();
    await expect(workflowsTab).toBeFocused();

    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('sidebar-tab-search')).toBeFocused();
  });
});
