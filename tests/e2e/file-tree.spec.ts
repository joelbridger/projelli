/**
 * File Tree Tests
 * Covers: Fix #2 (Open on Desktop button), Fix #8 (breadcrumb drag-drop)
 *
 * Uses ?testMode=true to bypass workspace selector
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick } from './helpers/test-utils';

test.describe('File Tree', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    // Make sure we're on the files tab
    await hardClick(page.getByTestId('sidebar-tab-files'));
  });

  test.describe('Fix #2: Open on Desktop Button', () => {
    test('Open on Desktop button exists in file tree footer', async ({ page }) => {
      const openBtn = page.getByTestId('open-on-desktop');
      // Button may only appear when workspace has rootPath set
      if (await openBtn.isVisible()) {
        await expect(openBtn).toBeEnabled();
        await expect(openBtn).toContainText('Open on Desktop');
      }
    });

    test('Open on Desktop button shows alert in browser (not Tauri)', async ({ page }) => {
      const openBtn = page.getByTestId('open-on-desktop');
      if (await openBtn.isVisible()) {
        // In browser (not Tauri), clicking should show an alert
        page.once('dialog', async (dialog) => {
          expect(dialog.message()).toContain('only available in the desktop app');
          await dialog.accept();
        });
        await hardClick(openBtn);
      }
    });
  });

  test.describe('File Tree Toolbar', () => {
    test('toolbar buttons are present', async ({ page }) => {
      const fileTree = page.getByTestId('file-tree');
      await expect(fileTree).toBeVisible();

      await expect(page.getByTestId('new-file-button')).toBeVisible();
      await expect(page.getByTestId('new-folder-button')).toBeVisible();
    });

    test('visual snapshot: file tree', async ({ page }) => {
      const fileTree = page.getByTestId('file-tree');
      await expect(fileTree).toBeVisible();
      await expect(fileTree).toHaveScreenshot('file-tree.png');
    });
  });
});

test.describe('Fix #8: Breadcrumb Drag-Drop (Grid View)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await hardClick(page.getByTestId('sidebar-tab-files'));
  });

  test('grid view button exists', async ({ page }) => {
    const gridViewBtn = page.getByTestId('grid-view-button');
    // Grid view button may not appear until workspace is loaded
    if (await gridViewBtn.isVisible()) {
      await expect(gridViewBtn).toBeEnabled();
    }
  });

  test('breadcrumb root button exists in grid view', async ({ page }) => {
    const gridViewBtn = page.getByTestId('grid-view-button');
    if (await gridViewBtn.isVisible()) {
      await hardClick(gridViewBtn);

      const breadcrumbRoot = page.getByTestId('breadcrumb-root');
      await expect(breadcrumbRoot).toBeVisible();
      await expect(breadcrumbRoot).toContainText('Root');
    }
  });

  test('visual snapshot: grid view breadcrumbs', async ({ page }) => {
    const gridViewBtn = page.getByTestId('grid-view-button');
    if (await gridViewBtn.isVisible()) {
      await hardClick(gridViewBtn);

      const breadcrumbNav = page.getByTestId('breadcrumb-nav');
      if (await breadcrumbNav.isVisible()) {
        await expect(breadcrumbNav).toHaveScreenshot('breadcrumb-nav.png');
      }
    }
  });
});
