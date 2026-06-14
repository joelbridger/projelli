/**
 * Welcome screen copy tests (UX-05 + UX-06, redesigned)
 *
 * The branded start screen carries:
 *   - UX-06: a tagline and a "Learn more" link in the footer
 *   - UX-05: a preview of the default folder structure under "New Workspace"
 */

import { test, expect } from '@playwright/test';
import { waitForAppLoad } from './helpers/test-utils';

test.describe('Welcome screen copy (UX-05 + UX-06)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);
  });

  test('tagline is visible', async ({ page }) => {
    const pitch = page.getByTestId('welcome-dialog-pitch');
    await expect(pitch).toBeVisible();
    await expect(pitch).toContainText(/Your practice folder/);
  });

  test('"Learn more" link is present in footer', async ({ page }) => {
    const link = page.getByTestId('welcome-dialog-learn-more');
    await expect(link).toBeVisible();
    await expect(link).toBeEnabled();
    await expect(link).toContainText(/Learn more/);
  });

  test('new-workspace card shows structure preview', async ({ page }) => {
    const preview = page.getByTestId('new-workspace-structure-preview');
    await expect(preview).toBeVisible();

    const text = (await preview.textContent()) ?? '';
    expect(text).toMatch(/docs\//);
    expect(text).toMatch(/research\//);
    expect(text).toMatch(/templates\//);
  });

  test('action cards are visible and enabled', async ({ page }) => {
    const openExisting = page.getByTestId('open-existing-workspace');
    const newWorkspace = page.getByTestId('new-workspace');

    await expect(openExisting).toBeVisible();
    await expect(openExisting).toBeEnabled();
    await expect(newWorkspace).toBeVisible();
    await expect(newWorkspace).toBeEnabled();
  });
});
