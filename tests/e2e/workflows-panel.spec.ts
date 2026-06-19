/**
 * Workflows surface tests
 *
 * Keepance 3.0 replaced the old narrow WorkflowPanel + "full view" modal
 * with the main Workflows page (`AssociateHome`). These tests cover the
 * current user-facing workflow picker instead of the removed modal.
 */

import { test, expect } from '@playwright/test';
import {
  waitForTestModeLoad,
  hardClick,
  safeFill,
  openSidebarTab,
} from './helpers/test-utils';

test.describe('Workflows surface', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await openSidebarTab(page, 'workflows');
  });

  test('page fills the available app height', async ({ page }) => {
    const surface = page.getByTestId('associate-home');
    await expect(surface).toBeVisible();

    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(600);
  });

  test('shows category filters and workflow cards', async ({ page }) => {
    await expect(page.getByTestId('associate-toolbar')).toBeVisible();
    await expect(page.getByTestId('associate-search')).toBeVisible();

    await expect(page.getByTestId('associate-section-legal')).toBeVisible();
    await expect(page.getByTestId('associate-card-legal-evidence-gap-analyzer')).toBeVisible();
  });

  test('search filters the workflow grid', async ({ page }) => {
    const search = page.getByTestId('associate-search');
    await expect(search).toBeVisible();

    await expect(page.getByTestId('associate-card-legal-evidence-gap-analyzer')).toBeVisible();

    await safeFill(search, '___nomatchterm___');
    await expect(page.getByTestId('associate-empty')).toBeVisible();
  });

  test('category sections can collapse and expand', async ({ page }) => {
    const toggle = page.getByTestId('associate-section-toggle-legal');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await hardClick(toggle);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await hardClick(toggle);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('workflow cards expose stable run buttons', async ({ page }) => {
    await expect(page.getByTestId('associate-card-legal-evidence-gap-analyzer')).toBeVisible();
    await expect(page.getByTestId('associate-run-legal-evidence-gap-analyzer')).toBeVisible();
  });
});
