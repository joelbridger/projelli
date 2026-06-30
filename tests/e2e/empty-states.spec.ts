/**
 * Empty state tests (UX-07)
 *
 * Keepance 3.0 replaced the old sidebar panels with full-page surfaces in the
 * Spine shell. These tests cover the empty states that still exist in that
 * current shell.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick, gotoDocuments } from './helpers/test-utils';

test.describe('Shell empty states (UX-07)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('lantern:docs-view', 'grid');
      } catch {
        /* no-op */
      }
    });
    await page.goto('/?testMode=true&seedDemo=1');
    await waitForTestModeLoad(page);
  });

  test('Documents empty state renders with create actions', async ({ page }) => {
    await gotoDocuments(page);
    await page.evaluate(() => {
      (window as unknown as { __setTestFileTree?: (tree: unknown[]) => void }).__setTestFileTree?.([]);
    });

    const emptyState = page.getByTestId('grid-empty-state');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText(/Your workspace is ready/);

    await expect(emptyState.getByRole('button', { name: 'New Word document' })).toBeVisible();
    await expect(emptyState.getByRole('button', { name: 'New folder' })).toBeVisible();
  });

  test('Search empty state renders before any query is entered', async ({ page }) => {
    await hardClick(page.getByTestId('spine-nav-search'));

    await expect(page.getByText('What do you want to find?')).toBeVisible();
    await expect(page.getByTestId('ask-composer-input')).toBeVisible();
  });

  test('Activity Log empty state renders when no entries exist', async ({ page }) => {
    await hardClick(page.getByTestId('settings-gear'));
    await hardClick(page.getByTestId('settings-category-activity-log'));

    const emptyState = page.getByTestId('audit-empty-state');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText(/No activity logged yet/);
  });

  test('Trash empty state renders when trash is empty', async ({ page }) => {
    await gotoDocuments(page);
    await hardClick(page.getByTestId('docs-trash-toggle'));

    const emptyState = page.getByTestId('empty-state-trash');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText(/Trash is empty/);
  });
});
