/**
 * Welcome dialog copy tests (UX-05 + UX-06)
 *
 * The welcome dialog (shown on first run, before any workspace exists) now
 * carries:
 *   - UX-06: an elevator pitch paragraph and a "Learn more" link to the
 *     public Getting Started doc.
 *   - UX-05: a preview of the default folder structure that the "New
 *     Workspace" button will create (docs/, research/, templates/).
 *
 * This file pins both pieces of copy so they can't silently regress.
 */

import { test, expect } from '@playwright/test';
import { waitForAppLoad } from './helpers/test-utils';

test.describe('Welcome dialog copy (UX-05 + UX-06)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);
  });

  test('elevator pitch paragraph is visible', async ({ page }) => {
    const pitch = page.getByTestId('welcome-dialog-pitch');
    await expect(pitch).toBeVisible();
    await expect(pitch).toContainText(/real files on your computer/);
  });

  test('"Learn more" link is present and clickable', async ({ page }) => {
    const link = page.getByTestId('welcome-dialog-learn-more');
    await expect(link).toBeVisible();
    await expect(link).toBeEnabled();
    await expect(link).toContainText(/Learn more/);
  });

  test('new-workspace button shows structure preview instead of vague "With default structure"', async ({ page }) => {
    const preview = page.getByTestId('new-workspace-structure-preview');
    await expect(preview).toBeVisible();

    // The preview should mention the real folders that get created
    const text = (await preview.textContent()) ?? '';
    expect(text).toMatch(/docs\//);
    expect(text).toMatch(/research\//);
    expect(text).toMatch(/templates\//);

    // The old vague subtitle must not appear
    const dialog = page.getByTestId('workspace-selector-dialog');
    await expect(dialog).not.toContainText('With default structure');
  });
});
