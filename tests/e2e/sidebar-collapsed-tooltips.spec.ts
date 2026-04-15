/**
 * Collapsed sidebar tooltips (UX-23)
 *
 * When the sidebar is collapsed, each section icon has no label next to it.
 * Hovering or focusing the icon should surface a Radix tooltip with the
 * label + (if defined) keyboard shortcut.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick } from './helpers/test-utils';

test.describe('Collapsed sidebar tooltips (UX-23)', () => {
  test('Files tab shows a tooltip when sidebar is collapsed', async ({
    page,
  }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // Collapse the sidebar.
    await hardClick(page.getByTestId('sidebar-collapse-button'));

    // Hover the Files icon — tooltip should appear.
    const filesTab = page.getByTestId('sidebar-tab-files');
    await filesTab.hover();

    const tooltip = page.getByTestId('sidebar-tab-files-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Files');
  });

  test('AI Assistant tooltip includes its keyboard shortcut', async ({
    page,
  }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await hardClick(page.getByTestId('sidebar-collapse-button'));

    const aiTab = page.getByTestId('sidebar-tab-ai-assistant');
    await aiTab.hover();

    const tooltip = page.getByTestId('sidebar-tab-ai-assistant-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('AI Assistant');
    // Shortcut text is platform-dependent; on Linux/Windows the app uses
    // plus-joined "Ctrl+Shift+A". On macOS the tests still run on the
    // webserver process's platform (headless Chrome → Linux in CI).
    await expect(tooltip).toContainText(/Ctrl\+Shift\+A|⌘⇧A/);
  });

  test('tooltips do not appear when sidebar is expanded', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // Do NOT collapse. Hover — no tooltip should show because the label
    // is already visible inline.
    await page.getByTestId('sidebar-tab-files').hover();
    await expect(
      page.getByTestId('sidebar-tab-files-tooltip')
    ).toBeHidden();
  });
});
