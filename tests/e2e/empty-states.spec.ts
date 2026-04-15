/**
 * Empty state tests (UX-07)
 *
 * Sidebar panels that can legitimately be empty now render through a single
 * `<EmptyState>` component with a consistent shape: icon, title, description,
 * optional CTA, optional keyboard shortcut hint. Each panel gets a testid of
 * the form `empty-state-{panelName}` so we can pin them individually.
 *
 * Panels covered here:
 *   - Files (empty on a fresh workspace; shows Ctrl+N shortcut + CTA)
 *   - Search (no query entered yet)
 *   - AI Audit (0 entries)
 *   - Trash (0 deleted items)
 *   - Whiteboard (0 whiteboards)
 *
 * Workflows is intentionally NOT covered because the 15 built-in workflow
 * templates are always rendered — there's no empty state for that panel.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick } from './helpers/test-utils';

test.describe('Sidebar empty states (UX-07)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('Files panel empty state renders with shortcut hint and CTA', async ({ page }) => {
    // Files tab is active by default in test mode with a fresh mock workspace
    const emptyState = page.getByTestId('empty-state-files');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText(/No files yet/);

    // Keyboard shortcut hint
    const shortcut = page.getByTestId('empty-state-files-shortcut');
    await expect(shortcut).toBeVisible();
    await expect(shortcut).toHaveText('Ctrl+N');

    // Primary CTA for creating a Markdown file
    const cta = page.getByTestId('empty-state-files-cta');
    await expect(cta).toBeVisible();
    await expect(cta).toBeEnabled();
  });

  test('Search panel empty state renders before any query is entered', async ({ page }) => {
    const searchTab = page.getByTestId('sidebar-tab-search');
    await hardClick(searchTab);

    const emptyState = page.getByTestId('empty-state-search');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText(/Search your workspace/);
  });

  test('AI Audit panel empty state renders when no entries exist', async ({ page }) => {
    const auditTab = page.getByTestId('sidebar-tab-audit');
    await hardClick(auditTab);

    const emptyState = page.getByTestId('empty-state-audit');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText(/No AI actions yet/);
  });

  test('Trash panel empty state renders when trash is empty', async ({ page }) => {
    const trashTab = page.getByTestId('sidebar-tab-trash');
    await hardClick(trashTab);

    const emptyState = page.getByTestId('empty-state-trash');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText(/Trash is empty/);
  });

  test('Whiteboard panel empty state renders with a create-CTA', async ({ page }) => {
    const whiteboardTab = page.getByTestId('sidebar-tab-whiteboard');
    await hardClick(whiteboardTab);

    const emptyState = page.getByTestId('empty-state-whiteboard');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText(/No whiteboards yet/);

    const cta = page.getByTestId('empty-state-whiteboard-cta');
    await expect(cta).toBeVisible();
    await expect(cta).toBeEnabled();
  });
});
