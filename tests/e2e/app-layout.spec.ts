/**
 * App Layout & Navigation Tests
 * Verifies core UI elements are present and navigable
 */

import { test, expect } from '@playwright/test';
import { waitForAppLoad, waitForTestModeLoad, hardClick } from './helpers/test-utils';

test.describe('App Layout', () => {
  test('app loads and shows workspace selector', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    const workspaceSelector = page.getByTestId('open-existing-workspace');
    await expect(workspaceSelector).toBeVisible();
  });

  test('workspace selector has both action buttons', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    const openExisting = page.getByTestId('open-existing-workspace');
    await expect(openExisting).toBeEnabled();
    const newWorkspace = page.getByTestId('new-workspace');
    await expect(newWorkspace).toBeVisible();
    await expect(newWorkspace).toBeEnabled();
  });

  test('visual snapshot: workspace selector', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);
    await expect(page).toHaveScreenshot('workspace-selector.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
    });
  });
});

test.describe('Sidebar Navigation (test mode)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('sidebar has all navigation tabs', async ({ page }) => {
    const expectedTabs = ['files', 'search', 'workflows', 'ai-assistant', 'research', 'whiteboard', 'audit', 'trash'];
    for (const tabId of expectedTabs) {
      await expect(page.getByTestId(`sidebar-tab-${tabId}`)).toBeVisible();
    }
  });

  test('sidebar collapse button works', async ({ page }) => {
    const collapseBtn = page.getByTestId('sidebar-collapse-button');
    await expect(collapseBtn).toBeVisible();
    await hardClick(collapseBtn);
    // After collapse, content area should not be visible
    await expect(page.getByTestId('sidebar-content')).not.toBeVisible();
  });

  test('clicking sidebar tabs switches content', async ({ page }) => {
    // Click AI Assistant tab
    await hardClick(page.getByTestId('sidebar-tab-ai-assistant'));
    await expect(page.getByTestId('ai-assistant-pane')).toBeVisible();

    // Click Files tab
    await hardClick(page.getByTestId('sidebar-tab-files'));
    await expect(page.getByTestId('file-tree')).toBeVisible();
  });

  test('visual snapshot: main app in test mode', async ({ page }) => {
    await expect(page).toHaveScreenshot('main-app-test-mode.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
    });
  });
});
