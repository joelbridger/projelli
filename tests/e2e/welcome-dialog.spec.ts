/**
 * Welcome Dialog Tests (UX-01)
 *
 * The welcome dialog shown at first run must either:
 *   (a) be strictly blocking (no X button, Escape does not dismiss), or
 *   (b) have a functional close (X closes, Escape closes).
 *
 * Our chosen behaviour: first-run is strictly blocking (no rootPath means there's
 * nothing to return to). The X button must not render in that state, and Escape
 * must not leave the dialog in a broken limbo.
 *
 * This file pins that contract so the old "X does nothing" regression can never
 * come back.
 */

import { test, expect } from '@playwright/test';
import { waitForAppLoad } from './helpers/test-utils';

test.describe('Welcome dialog (first run)', () => {
  test('dialog is visible on load without test mode', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    await expect(page.getByTestId('workspace-selector-dialog')).toBeVisible();
    await expect(page.getByTestId('open-existing-workspace')).toBeVisible();
    await expect(page.getByTestId('new-workspace')).toBeVisible();
  });

  test('close X button is hidden in first-run state (no broken dismiss)', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    const dialog = page.getByTestId('workspace-selector-dialog');
    await expect(dialog).toBeVisible();

    // In first-run state the Radix-rendered Close button must not be visible —
    // otherwise clicking it would be a no-op (the UX-01 bug). We accept either
    // "not in DOM" or "in DOM but display:none" as valid hiding.
    const closeButton = dialog.locator('button:has(span.sr-only:text("Close"))');
    await expect(closeButton).toBeHidden();
  });

  test('Escape does not dismiss first-run dialog into a broken state', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    const dialog = page.getByTestId('workspace-selector-dialog');
    await expect(dialog).toBeVisible();

    // Press Escape — because there's no workspace yet, the dialog should
    // remain open (strictly blocking). The alternative "dismiss into empty
    // app state" is not supported because there is no empty app state.
    await page.keyboard.press('Escape');

    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('open-existing-workspace')).toBeVisible();
  });
});
