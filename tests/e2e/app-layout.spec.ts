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

test.describe('Spine Navigation (test mode)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('spine has all current navigation destinations', async ({ page }) => {
    const expectedTabs = ['matters', 'search', 'files', 'email', 'workflows', 'audit', 'privacy', 'settings'];
    for (const tabId of expectedTabs) {
      await expect(page.getByTestId(`spine-nav-${tabId}`)).toBeVisible();
    }
  });

  test('spine collapse and expand buttons work', async ({ page }) => {
    const collapseBtn = page.getByRole('button', { name: 'Collapse sidebar' });
    await hardClick(collapseBtn);
    await expect(page.getByTestId('spine-nav-collapsed-files')).toBeVisible();

    const expandBtn = page.getByRole('button', { name: 'Expand' });
    await hardClick(expandBtn);
    await expect(page.getByTestId('spine-nav-files')).toBeVisible();
  });

  test('clicking spine tabs switches content', async ({ page }) => {
    await hardClick(page.getByTestId('spine-nav-search'));
    await expect(page.getByRole('heading', { name: 'Search' })).toBeVisible();
    await expect(page.getByTestId('ask-composer-input')).toBeVisible();

    await hardClick(page.getByTestId('spine-nav-workflows'));
    await expect(page.getByTestId('associate-home')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();

    await hardClick(page.getByTestId('spine-nav-files'));
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
    await expect(page.getByTestId('documents-tab-strip')).toBeVisible();
  });

  test('visual snapshot: main app in test mode', async ({ page }) => {
    await expect(page).toHaveScreenshot('main-app-test-mode.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
    });
  });
});
