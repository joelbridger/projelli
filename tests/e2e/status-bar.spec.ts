/**
 * Status Bar Tests
 * Covers: Fix #6 (show project name instead of full path)
 *
 * Uses ?testMode=true to bypass workspace selector
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad } from './helpers/test-utils';

test.describe('Fix #6: Status Bar Project Name', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('status bar is visible', async ({ page }) => {
    const statusBar = page.getByTestId('status-bar');
    await expect(statusBar).toBeVisible();
  });

  test('status bar shows project name (not full path)', async ({ page }) => {
    const projectName = page.getByTestId('status-bar-project-name');
    await expect(projectName).toBeVisible();

    const text = await projectName.textContent();
    expect(text).toBeTruthy();

    // The project name should NOT contain path separators
    if (text !== 'No workspace') {
      expect(text).not.toContain('/');
      expect(text).not.toContain('\\');
      expect(text).not.toContain('C:');
      expect(text).not.toContain('Users');
    }
  });

  test('status bar shows tab count', async ({ page }) => {
    const tabCount = page.getByTestId('status-bar-tab-count');
    await expect(tabCount).toBeVisible();
    const text = await tabCount.textContent();
    expect(text).toMatch(/\d+ files? open/);
  });

  test('visual snapshot: status bar', async ({ page }) => {
    const statusBar = page.getByTestId('status-bar');
    await expect(statusBar).toBeVisible();
    await expect(statusBar).toHaveScreenshot('status-bar.png');
  });
});
