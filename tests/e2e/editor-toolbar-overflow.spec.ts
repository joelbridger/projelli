/**
 * Editor toolbar overflow menu (UX-13)
 *
 * At narrow widths the right-side toolbar collapses History / Split /
 * Outline / Backlinks / Export into a "…" overflow DropdownMenu. Save and
 * Download remain visible inline regardless of width. Switching back to a
 * wide viewport should restore the inline layout.
 *
 * The toolbar container carries a `data-compact` attribute that reflects
 * the current breakpoint decision — we assert on both that attribute and
 * the actual visibility of inline buttons so the visual intent matches the
 * data model.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick } from './helpers/test-utils';

async function openAnyMarkdownFile(page: import('@playwright/test').Page) {
  // Test mode seeds a workspace with sample files. Open Files tab and click
  // the first markdown file in the tree if one exists; otherwise create one.
  await hardClick(page.getByTestId('sidebar-tab-files'));
  const mdFiles = page.getByTestId('file-tree').locator('[role="treeitem"]');
  const count = await mdFiles.count();
  if (count > 0) {
    await hardClick(mdFiles.first());
    // Wait for the toolbar to be rendered (indicates a tab is open)
    await expect(page.getByTestId('main-panel-toolbar')).toBeVisible();
  }
}

test.describe('Editor toolbar overflow (UX-13)', () => {
  test('narrow viewport collapses overflow items into a … menu', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 800 });
    await page.goto('/?test-mode=1');
    await waitForTestModeLoad(page);
    await openAnyMarkdownFile(page);

    const toolbar = page.getByTestId('main-panel-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toHaveAttribute('data-compact', 'true');

    // Overflow trigger is visible; inline outline/backlinks are not.
    await expect(page.getByTestId('toolbar-overflow')).toBeVisible();
    await expect(page.getByTestId('toolbar-outline')).toHaveCount(0);
    await expect(page.getByTestId('toolbar-backlinks')).toHaveCount(0);

    // Save/Download (critical) stay visible if a file is open.
    const hasTab = await page.getByTestId('toolbar-download').count();
    if (hasTab > 0) {
      await expect(page.getByTestId('toolbar-download')).toBeVisible();
    }

    // Opening the overflow menu exposes the moved items.
    await hardClick(page.getByTestId('toolbar-overflow'));
    await expect(page.getByTestId('toolbar-overflow-outline')).toBeVisible();
    await expect(page.getByTestId('toolbar-overflow-backlinks')).toBeVisible();
  });

  test('wide viewport shows inline items and no overflow menu', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/?test-mode=1');
    await waitForTestModeLoad(page);
    await openAnyMarkdownFile(page);

    const toolbar = page.getByTestId('main-panel-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toHaveAttribute('data-compact', 'false');

    await expect(page.getByTestId('toolbar-overflow')).toHaveCount(0);
    await expect(page.getByTestId('toolbar-outline')).toBeVisible();
    await expect(page.getByTestId('toolbar-backlinks')).toBeVisible();
  });
});
