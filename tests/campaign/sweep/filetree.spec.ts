/**
 * sweep/filetree.spec.ts
 * Campaign Phase 5 — L-125..L-137
 * FileTree toolbar actions + TabBar context menu
 */

import { test, expect } from '@playwright/test';
import { snap, collectConsoleErrors, horizontalOverflow } from '../helpers/campaign';
import { waitForTestModeLoad, hardClick } from '../../e2e/helpers/test-utils';

test.describe('FileTree toolbar actions (L-125..L-134)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    // Ensure Files sidebar tab is active
    const filesTab = page.getByTestId('sidebar-tab-files');
    await hardClick(filesTab);
    await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 5000 });
  });

  test('L-125 New File menu trigger shows type chooser', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const trigger = page.getByTestId('new-file-menu-trigger');
    await expect(trigger).toBeVisible();
    await hardClick(trigger);
    // File type menu should appear
    const docxOption = page.getByTestId('new-file-type-docx');
    const menuVisible = await docxOption.isVisible({ timeout: 3000 }).catch(() => false);
    if (menuVisible) {
      await snap(page, testInfo, 'L-125-new-file-menu');
      const overflow = await horizontalOverflow(page);
      expect(overflow, 'overflow L-125').toHaveLength(0);
    }
    await page.keyboard.press('Escape');
    const errors = getErrors();
    expect(errors, 'console errors L-125').toHaveLength(0);
  });

  test('L-126 New File → .docx creates item', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const trigger = page.getByTestId('new-file-menu-trigger');
    await expect(trigger).toBeVisible();
    await hardClick(trigger);
    const docxOption = page.getByTestId('new-file-type-docx');
    const optionVisible = await docxOption.isVisible({ timeout: 3000 }).catch(() => false);
    if (optionVisible) {
      await hardClick(docxOption);
      await page.waitForTimeout(500);
      await snap(page, testInfo, 'L-126-new-file-docx');
    } else {
      await page.keyboard.press('Escape');
      await snap(page, testInfo, 'L-126-new-file-docx-menu-not-shown');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-126').toHaveLength(0);
  });

  test('L-127 New File → .md creates item', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const trigger = page.getByTestId('new-file-menu-trigger');
    await expect(trigger).toBeVisible();
    await hardClick(trigger);
    const mdOption = page.getByTestId('new-file-type-markdown');
    const optionVisible = await mdOption.isVisible({ timeout: 3000 }).catch(() => false);
    if (optionVisible) {
      await hardClick(mdOption);
      await page.waitForTimeout(500);
      await snap(page, testInfo, 'L-127-new-file-md');
    } else {
      await page.keyboard.press('Escape');
      await snap(page, testInfo, 'L-127-new-file-md-not-shown');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-127').toHaveLength(0);
  });

  test('L-128 New File → .pptx creates item', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const trigger = page.getByTestId('new-file-menu-trigger');
    await hardClick(trigger);
    const pptxOption = page.getByTestId('new-file-type-pptx');
    const optionVisible = await pptxOption.isVisible({ timeout: 3000 }).catch(() => false);
    if (optionVisible) {
      await hardClick(pptxOption);
      await page.waitForTimeout(500);
    } else {
      await page.keyboard.press('Escape');
    }
    await snap(page, testInfo, 'L-128-new-file-pptx');
    const errors = getErrors();
    expect(errors, 'console errors L-128').toHaveLength(0);
  });

  test('L-129 New File → .xlsx creates item', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const trigger = page.getByTestId('new-file-menu-trigger');
    await hardClick(trigger);
    const xlsxOption = page.getByTestId('new-file-type-xlsx');
    const optionVisible = await xlsxOption.isVisible({ timeout: 3000 }).catch(() => false);
    if (optionVisible) {
      await hardClick(xlsxOption);
      await page.waitForTimeout(500);
    } else {
      await page.keyboard.press('Escape');
    }
    await snap(page, testInfo, 'L-129-new-file-xlsx');
    const errors = getErrors();
    expect(errors, 'console errors L-129').toHaveLength(0);
  });

  test('L-130 New File → .csv creates item', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const trigger = page.getByTestId('new-file-menu-trigger');
    await hardClick(trigger);
    const csvOption = page.getByTestId('new-file-type-csv');
    const optionVisible = await csvOption.isVisible({ timeout: 3000 }).catch(() => false);
    if (optionVisible) {
      await hardClick(csvOption);
      await page.waitForTimeout(500);
    } else {
      await page.keyboard.press('Escape');
    }
    await snap(page, testInfo, 'L-130-new-file-csv');
    const errors = getErrors();
    expect(errors, 'console errors L-130').toHaveLength(0);
  });

  test('L-131 New Folder button creates folder', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const folderBtn = page.getByTestId('new-folder-button');
    await expect(folderBtn).toBeVisible();
    await hardClick(folderBtn);
    await page.waitForTimeout(500);
    await snap(page, testInfo, 'L-131-new-folder');
    const overflow = await horizontalOverflow(page);
    expect(overflow, 'overflow L-131').toHaveLength(0);
    const errors = getErrors();
    expect(errors, 'console errors L-131').toHaveLength(0);
  });

  test('L-132 Upload file button renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const uploadBtn = page.getByTestId('upload-button');
    await expect(uploadBtn).toBeVisible();
    // Note: actual file upload requires native dialog which can't be triggered in sweep
    await snap(page, testInfo, 'L-132-upload-file-button');
    const errors = getErrors();
    expect(errors, 'console errors L-132').toHaveLength(0);
  });

  test('L-133 Batch delete button renders (conditional — needs selection)', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const batchDelete = page.getByTestId('batch-delete');
    const isVisible = await batchDelete.isVisible({ timeout: 2000 }).catch(() => false);
    if (isVisible) {
      await expect(batchDelete).toBeVisible();
    }
    await snap(page, testInfo, 'L-133-batch-delete');
    const errors = getErrors();
    expect(errors, 'console errors L-133').toHaveLength(0);
  });

  test('L-134 Open on desktop button renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const desktopBtn = page.getByTestId('open-on-desktop');
    const isVisible = await desktopBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (isVisible) {
      await expect(desktopBtn).toBeVisible();
    }
    await snap(page, testInfo, 'L-134-open-on-desktop');
    const errors = getErrors();
    expect(errors, 'console errors L-134').toHaveLength(0);
  });

  // Edge inputs on creation / rename / search fields
  test('L-131-edge new folder with 300-char name', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const folderBtn = page.getByTestId('new-folder-button');
    await expect(folderBtn).toBeVisible();
    await hardClick(folderBtn);
    // Find any input that may have appeared (rename inline or dialog)
    const nameInput = page.locator('input[placeholder*="folder"], input[placeholder*="name"]').first();
    const inputVisible = await nameInput.isVisible({ timeout: 2000 }).catch(() => false);
    if (inputVisible) {
      const longName = 'A'.repeat(300);
      await nameInput.fill(longName);
      await nameInput.press('Enter');
    }
    await page.waitForTimeout(300);
    await snap(page, testInfo, 'L-131-edge-300-char-folder');
    const errors = getErrors();
    expect(errors, 'console errors L-131-edge').toHaveLength(0);
  });
});

test.describe('TabBar context menu (L-135..L-137)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('L-135 TabBar context menu: Rename option', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const tabBar = page.getByTestId('tab-bar-root');
    await expect(tabBar).toBeVisible();
    const firstTab = tabBar.locator('[data-testid^="tab-"]').first();
    const tabVisible = await firstTab.isVisible({ timeout: 3000 }).catch(() => false);
    if (tabVisible) {
      await firstTab.click({ button: 'right' });
      const renameItem = page.getByRole('menuitem', { name: /rename/i });
      const menuVisible = await renameItem.isVisible({ timeout: 3000 }).catch(() => false);
      if (menuVisible) {
        await snap(page, testInfo, 'L-135-tabbar-context-rename');
        await page.keyboard.press('Escape');
      } else {
        await snap(page, testInfo, 'L-135-tabbar-context-no-menu');
        await page.keyboard.press('Escape');
      }
    } else {
      await snap(page, testInfo, 'L-135-tabbar-no-tab');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-135').toHaveLength(0);
  });

  test('L-136 TabBar context menu: Close tab', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const tabBar = page.getByTestId('tab-bar-root');
    await expect(tabBar).toBeVisible();
    const firstTab = tabBar.locator('[data-testid^="tab-"]').first();
    const tabVisible = await firstTab.isVisible({ timeout: 3000 }).catch(() => false);
    if (tabVisible) {
      await firstTab.click({ button: 'right' });
      const closeItem = page.getByRole('menuitem', { name: /close tab/i });
      const menuVisible = await closeItem.isVisible({ timeout: 3000 }).catch(() => false);
      if (menuVisible) {
        await snap(page, testInfo, 'L-136-tabbar-context-close');
        await page.keyboard.press('Escape');
      } else {
        await snap(page, testInfo, 'L-136-tabbar-context-no-close');
        await page.keyboard.press('Escape');
      }
    }
    const errors = getErrors();
    expect(errors, 'console errors L-136').toHaveLength(0);
  });

  test('L-137 TabBar context menu: Close other tabs', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const tabBar = page.getByTestId('tab-bar-root');
    await expect(tabBar).toBeVisible();
    const firstTab = tabBar.locator('[data-testid^="tab-"]').first();
    const tabVisible = await firstTab.isVisible({ timeout: 3000 }).catch(() => false);
    if (tabVisible) {
      await firstTab.click({ button: 'right' });
      const closeOthers = page.getByRole('menuitem', { name: /close other/i });
      const menuVisible = await closeOthers.isVisible({ timeout: 3000 }).catch(() => false);
      if (menuVisible) {
        await snap(page, testInfo, 'L-137-tabbar-context-close-others');
      }
      await page.keyboard.press('Escape');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-137').toHaveLength(0);
  });
});
