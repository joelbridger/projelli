/**
 * Editor toolbar overflow menu
 *
 * Secondary controls (Download, History, Split, Outline) are always
 * inside the "…" overflow DropdownMenu in both wide and compact viewports.
 * Export is the only control that stays inline (markdown files only).
 *
 * The toolbar container carries a `data-compact` attribute that reflects
 * the current breakpoint decision — we assert on it so the data model
 * stays honest, but visual behaviour is identical in both modes.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick } from './helpers/test-utils';

async function openAnyMarkdownFile(page: import('@playwright/test').Page) {
  // Test mode seeds a workspace with sample files. Open Files tab and click
  // the first markdown file in the tree if one exists.
  await hardClick(page.getByTestId('sidebar-tab-files'));
  const mdFiles = page.getByTestId('file-tree').locator('[role="treeitem"]');
  const count = await mdFiles.count();
  if (count > 0) {
    await hardClick(mdFiles.first());
    // Wait for the toolbar to be rendered (indicates a tab is open)
    await expect(page.getByTestId('main-panel-toolbar')).toBeVisible();
  }
}

test.describe('Editor toolbar overflow', () => {
  test('narrow viewport marks toolbar as compact', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 800 });
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await openAnyMarkdownFile(page);

    const toolbar = page.getByTestId('main-panel-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toHaveAttribute('data-compact', 'true');

    // Overflow trigger is visible in compact mode.
    await expect(page.getByTestId('toolbar-overflow')).toBeVisible();

    // Outline is now always in the overflow, never a standalone button.
    await expect(page.locator('[data-testid="toolbar-outline"]')).toHaveCount(0);

    // Opening the overflow menu exposes the moved items.
    await hardClick(page.getByTestId('toolbar-overflow'));
    await expect(page.getByTestId('toolbar-overflow-outline')).toBeVisible();
  });

  test('wide viewport still uses overflow for secondary controls', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await openAnyMarkdownFile(page);

    const toolbar = page.getByTestId('main-panel-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toHaveAttribute('data-compact', 'false');

    // Overflow button is always present (unified overflow pattern).
    await expect(page.getByTestId('toolbar-overflow')).toBeVisible();

    // Outline is inside the overflow, not standalone.
    await expect(page.locator('[data-testid="toolbar-outline"]')).toHaveCount(0);

    // Open the overflow to verify secondary items are accessible.
    await hardClick(page.getByTestId('toolbar-overflow'));
    await expect(page.getByTestId('toolbar-overflow-outline')).toBeVisible();
  });
});
