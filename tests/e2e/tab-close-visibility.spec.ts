/**
 * Tab close X visibility (UX-22)
 *
 * - Active tab: close X always visible (opacity 1).
 * - Inactive tab, not hovered: close X hidden (opacity 0).
 * - Inactive tab, hovered: close X visible (opacity 1 via group-hover).
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad } from './helpers/test-utils';

function pathToTestId(path: string): string {
  return path
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

test.describe('Tab close X visibility (UX-22)', () => {
  test('active tab always shows the close X', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // Test mode pre-loads test1.md + test2.txt tabs. The most recently
    // opened one is active.
    const activePath = '/test-workspace/docs/test2.txt';
    const closeBtn = page.getByTestId(`tab-close-${pathToTestId(activePath)}`);
    await expect(closeBtn).toBeVisible();
    // Opacity is the visibility contract — check it explicitly.
    await expect(closeBtn).toHaveCSS('opacity', '1');
  });

  test('inactive tab hides the close X until hover', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    const inactivePath = '/test-workspace/docs/test1.md';
    const inactiveTab = page.getByTestId(`tab-${pathToTestId(inactivePath)}`);
    const closeBtn = page.getByTestId(
      `tab-close-${pathToTestId(inactivePath)}`
    );
    // The close button still renders in the DOM (for keyboard navigation),
    // but with opacity 0.
    await expect(inactiveTab).toBeVisible();
    await expect(closeBtn).toHaveCSS('opacity', '0');

    // Hover the inactive tab: the close button should become visible via
    // the `group-hover:opacity-100` class.
    await inactiveTab.hover();
    await expect(closeBtn).toHaveCSS('opacity', '1');
  });
});
