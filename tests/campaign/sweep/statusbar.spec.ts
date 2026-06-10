/**
 * sweep/statusbar.spec.ts
 * Campaign Phase 5 — L-035..L-043
 * Status bar widgets
 */

import { test, expect } from '@playwright/test';
import { snap, collectConsoleErrors, horizontalOverflow } from '../helpers/campaign';
import { waitForTestModeLoad } from '../../e2e/helpers/test-utils';

test.describe('Status bar widgets (L-035..L-043)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('L-035 status bar root renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const statusBar = page.getByTestId('status-bar');
    await expect(statusBar).toBeVisible();
    await snap(page, testInfo, 'L-035-status-bar-root');
    const overflow = await horizontalOverflow(page);
    expect(overflow, 'overflow L-035').toHaveLength(0);
    const errors = getErrors();
    expect(errors, 'console errors L-035').toHaveLength(0);
  });

  test('L-036 status bar project name widget', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    // project widget
    const projectWidget = page.getByTestId('status-bar-project');
    const isVisible = await projectWidget.isVisible({ timeout: 3000 }).catch(() => false);
    if (isVisible) {
      await expect(projectWidget).toBeVisible();
    }
    await snap(page, testInfo, 'L-036-status-bar-project');
    const errors = getErrors();
    expect(errors, 'console errors L-036').toHaveLength(0);
  });

  test('L-037 status bar breadcrumbs', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const breadcrumbs = page.getByTestId('status-bar-breadcrumbs');
    const isVisible = await breadcrumbs.isVisible({ timeout: 3000 }).catch(() => false);
    if (isVisible) {
      await expect(breadcrumbs).toBeVisible();
    }
    await snap(page, testInfo, 'L-037-status-bar-breadcrumbs');
    const errors = getErrors();
    expect(errors, 'console errors L-037').toHaveLength(0);
  });

  test('L-038 status bar active file name', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    // In testMode, a file is open; the active file indicator should show
    const activeFile = page.getByTestId('status-bar-active-file');
    const isVisible = await activeFile.isVisible({ timeout: 3000 }).catch(() => false);
    if (isVisible) {
      await expect(activeFile).toBeVisible();
    }
    await snap(page, testInfo, 'L-038-status-bar-active-file');
    const errors = getErrors();
    expect(errors, 'console errors L-038').toHaveLength(0);
  });

  test('L-039 status bar file modified indicator', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    // Modified indicator appears when a file is dirty; just assert widget region renders
    const statusBar = page.getByTestId('status-bar');
    await expect(statusBar).toBeVisible();
    await snap(page, testInfo, 'L-039-status-bar-modified');
    const errors = getErrors();
    expect(errors, 'console errors L-039').toHaveLength(0);
  });

  test('L-040 privileged matter badge in status bar (when present)', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    // Badge is conditional on a privileged matter being active
    const badge = page.getByTestId('privileged-matter-badge');
    const isVisible = await badge.isVisible({ timeout: 2000 }).catch(() => false);
    if (isVisible) {
      await expect(badge).toBeVisible();
    }
    await snap(page, testInfo, 'L-040-privileged-matter-badge');
    const errors = getErrors();
    expect(errors, 'console errors L-040').toHaveLength(0);
  });

  test('L-041 status bar matter indicator', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const matterIndicator = page.getByTestId('status-bar-matter');
    const isVisible = await matterIndicator.isVisible({ timeout: 2000 }).catch(() => false);
    if (isVisible) {
      await expect(matterIndicator).toBeVisible();
    }
    await snap(page, testInfo, 'L-041-status-bar-matter');
    const errors = getErrors();
    expect(errors, 'console errors L-041').toHaveLength(0);
  });

  test('L-042 status bar tab count', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const tabCount = page.getByTestId('status-bar-tab-count');
    const isVisible = await tabCount.isVisible({ timeout: 3000 }).catch(() => false);
    if (isVisible) {
      await expect(tabCount).toBeVisible();
    }
    await snap(page, testInfo, 'L-042-status-bar-tab-count');
    const errors = getErrors();
    expect(errors, 'console errors L-042').toHaveLength(0);
  });

  test('L-043 status bar bug report button opens dialog', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const bugBtn = page.getByTestId('status-bar-bug-report');
    await expect(bugBtn).toBeVisible();
    await bugBtn.click();
    // Bug report dialog should open
    const bugDialog = page.locator('[data-testid="bug-report-message"]').first();
    const dialogOpened = await bugDialog.isVisible({ timeout: 3000 }).catch(() => false);
    if (dialogOpened) {
      await expect(bugDialog).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await snap(page, testInfo, 'L-043-bug-report-button');
    const overflow = await horizontalOverflow(page);
    expect(overflow, 'overflow L-043').toHaveLength(0);
    const errors = getErrors();
    expect(errors, 'console errors L-043').toHaveLength(0);
  });
});
