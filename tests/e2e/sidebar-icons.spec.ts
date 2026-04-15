/**
 * Sidebar icon consistency (UX-11)
 *
 * Every sidebar tab icon should have the same computed color in its inactive
 * state (driven by the parent Button's `text-muted-foreground` class). No
 * single tab — in particular Research or Whiteboard, which previously used
 * accent colors elsewhere in the codebase — should be permanently tinted.
 *
 * The test also confirms that the currently active tab's icon takes a
 * different color than the inactive tabs (so we're not regressing to a
 * flat no-active-state look).
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad } from './helpers/test-utils';

const TAB_IDS = [
  'files',
  'search',
  'workflows',
  'ai-assistant',
  'research',
  'whiteboard',
  'audit',
  'trash',
] as const;

test.describe('Sidebar tab icons (UX-11)', () => {
  test('inactive tab icons all share the same computed color', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // Files is the default active tab. Grab the computed color of each INACTIVE
    // tab icon and confirm they match each other. Research (BookOpen) is the
    // one we most care about — it used to render in a permanent orange/brown.
    const colors = await Promise.all(
      TAB_IDS.filter((id) => id !== 'files').map(async (id) => {
        const icon = page.getByTestId(`sidebar-tab-${id}-icon`);
        await expect(icon).toBeVisible();
        return icon.evaluate((el) => window.getComputedStyle(el).color);
      })
    );

    const first = colors[0];
    expect(first).toBeTruthy();
    for (const c of colors) {
      expect(c).toBe(first);
    }
  });

  test('active tab icon color differs from inactive tab icon color', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    const activeIcon = page.getByTestId('sidebar-tab-files-icon');
    const inactiveIcon = page.getByTestId('sidebar-tab-research-icon');

    await expect(activeIcon).toBeVisible();
    await expect(inactiveIcon).toBeVisible();

    const activeColor = await activeIcon.evaluate(
      (el) => window.getComputedStyle(el).color
    );
    const inactiveColor = await inactiveIcon.evaluate(
      (el) => window.getComputedStyle(el).color
    );

    expect(activeColor).not.toBe(inactiveColor);
  });
});
