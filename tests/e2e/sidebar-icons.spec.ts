/**
 * Spine icon consistency.
 *
 * The redesigned 3.0 spine no longer gives each SVG its own test id. Icons
 * inherit their color from the spine button, so the test reads the icon color
 * through the current `spine-nav-*` button handles.
 */

import { test, expect, type Locator } from '@playwright/test';
import { waitForTestModeLoad } from './helpers/test-utils';

const SPINE_IDS = [
  'matters',
  'search',
  'files',
  'email',
  'workflows',
  'audit',
  'privacy',
  'settings',
] as const;

async function iconColor(button: Locator): Promise<string> {
  await expect(button).toBeVisible();
  return button.evaluate((el) => {
    const icon = el.querySelector('svg');
    if (!icon) throw new Error('Spine nav button is missing its icon');
    return window.getComputedStyle(icon).color;
  });
}

test.describe('Spine nav icons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('inactive nav icons all share the same computed color', async ({ page }) => {
    const inactiveColors = await Promise.all(
      SPINE_IDS.filter((id) => id !== 'files').map((id) =>
        iconColor(page.getByTestId(`spine-nav-${id}`))
      )
    );

    const first = inactiveColors[0];
    expect(first).toBeTruthy();
    for (const color of inactiveColors) {
      expect(color).toBe(first);
    }
  });

  test('active nav icon color differs from inactive nav icon color', async ({ page }) => {
    const activeColor = await iconColor(page.getByTestId('spine-nav-files'));
    const inactiveColor = await iconColor(page.getByTestId('spine-nav-search'));

    expect(activeColor).not.toBe(inactiveColor);
  });
});
