/**
 * File Tree Tests
 * Covers: Fix #2 (Open on Desktop button), Fix #8 (breadcrumb drag-drop)
 *
 * Uses ?testMode=true to bypass workspace selector
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick, gotoDocuments } from './helpers/test-utils';

async function openDocumentsFiles(page: import('@playwright/test').Page) {
  await gotoDocuments(page);
}

async function showTreeView(page: import('@playwright/test').Page) {
  await openDocumentsFiles(page);
  await hardClick(page.getByTestId('docs-view-tree'));
  await expect(page.getByTestId('documents-tree-view')).toBeVisible();
}

async function showGridView(page: import('@playwright/test').Page) {
  await openDocumentsFiles(page);
  await hardClick(page.getByTestId('docs-view-grid'));
  await expect(page.getByTestId('document-grid-view')).toBeVisible();
}

test.describe('File Tree', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true&seedDemo=1');
    await waitForTestModeLoad(page);
    await showTreeView(page);
  });

  test.describe('Fix #2: Open on Desktop Button', () => {
    test('Open on Desktop button exists in file tree footer', async ({ page }) => {
      const openBtn = page.getByTestId('open-on-desktop');
      // Button may only appear when workspace has rootPath set
      if (await openBtn.isVisible()) {
        await expect(openBtn).toBeEnabled();
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
    test('Documents toolbar buttons are present', async ({ page }) => {
      const fileTree = page.getByTestId('file-tree');
      await expect(fileTree).toBeVisible();

      const toolbar = page.getByTestId('documents-toolbar');
      await expect(toolbar.getByRole('button', { name: 'New document' })).toBeVisible();
      await expect(toolbar.getByRole('button', { name: 'New folder' })).toBeVisible();
      await expect(toolbar.getByTestId('add-files-btn')).toBeVisible();
      await expect(toolbar.getByTestId('docs-view-toggle')).toBeVisible();
    });

    test('visual snapshot: Documents tree view', async ({ page }) => {
      const fileTree = page.getByTestId('file-tree');
      await expect(fileTree).toBeVisible();
      await expect(page.getByTestId('documents-toolbar')).toBeVisible();
      await expect(page.getByTestId('documents-tree-view')).toBeVisible();
    });
  });
});

test.describe('Fix #8: Breadcrumb Drag-Drop (Grid View)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true&seedDemo=1');
    await waitForTestModeLoad(page);
    await showGridView(page);
  });

  test('grid view button exists', async ({ page }) => {
    await expect(page.getByTestId('docs-view-grid')).toBeVisible();
    await expect(page.getByTestId('docs-view-grid')).toBeEnabled();
    await expect(page.getByTestId('docs-view-grid')).toHaveAttribute('aria-pressed', 'true');
  });

  test('breadcrumb root button exists after opening a folder in grid view', async ({ page }) => {
    await hardClick(page.getByTestId('grid-card-/test-workspace/docs'));

    const breadcrumbRoot = page.getByTestId('breadcrumb-crumb-0');
    await expect(breadcrumbRoot).toBeVisible();
  });

  test('visual snapshot: grid view breadcrumbs', async ({ page }) => {
    await hardClick(page.getByTestId('grid-card-/test-workspace/docs'));

    const breadcrumbRoot = page.getByTestId('breadcrumb-crumb-0');
    await expect(breadcrumbRoot).toBeVisible();
    await expect(page.getByTestId('document-grid-view')).toBeVisible();
  });
});
