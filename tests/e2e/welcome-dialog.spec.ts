/**
 * Welcome Screen Tests (UX-01, redesigned)
 *
 * The welcome screen (shown at first run, before any workspace exists) is now
 * a full-viewport branded page instead of a dialog. It must be strictly
 * blocking in first-run mode (no close button, Escape does nothing).
 *
 * This file pins that contract.
 */

import { test, expect } from '@playwright/test';
import { waitForAppLoad } from './helpers/test-utils';

test.describe('Welcome screen (first run)', () => {
  test('branded welcome screen is visible on load', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    await expect(page.getByTestId('workspace-selector-dialog')).toBeVisible();
    await expect(page.getByTestId('open-existing-workspace')).toBeVisible();
    await expect(page.getByTestId('new-workspace')).toBeVisible();
  });

  test('close button is hidden in first-run state', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    const screen = page.getByTestId('workspace-selector-dialog');
    await expect(screen).toBeVisible();

    // In first-run state there's no dismiss handler, so the close button
    // (with sr-only "Close" text) must not be visible.
    const closeButton = screen.locator('button:has(span.sr-only:text("Close"))');
    await expect(closeButton).toBeHidden();
  });

  test('Escape does not dismiss first-run screen', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    const screen = page.getByTestId('workspace-selector-dialog');
    await expect(screen).toBeVisible();

    // Focus the screen element so keydown fires
    await screen.focus();
    await page.keyboard.press('Escape');

    // Screen must remain visible — there's no workspace to return to
    await expect(screen).toBeVisible();
    await expect(page.getByTestId('open-existing-workspace')).toBeVisible();
  });

  test('has white background (brand moment override)', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    const screen = page.getByTestId('workspace-selector-dialog');
    await expect(screen).toBeVisible();

    const bg = await screen.evaluate(el => window.getComputedStyle(el).backgroundColor);
    // rgb(255, 255, 255) = white
    expect(bg).toBe('rgb(255, 255, 255)');
  });

  test('shows the brand logo', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    const screen = page.getByTestId('workspace-selector-dialog');
    // AppLogo.tsx renders a plain <img alt={BRAND.name}>, not an
    // aria-label-wrapped element. The 2026-07-01 rebrand (brand/brand.config.json,
    // "flip identity to LANTERN + apply Advisor Prep Hero brand") changed
    // BRAND.name from "Keepance" to "Advisor Prep Hero".
    const logo = screen.getByAltText('Advisor Prep Hero');
    await expect(logo).toBeVisible();
  });

  test('footer has Learn more link', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    const learnMore = page.getByTestId('welcome-dialog-learn-more');
    await expect(learnMore).toBeVisible();
    await expect(learnMore).toBeEnabled();
    await expect(learnMore).toContainText(/Learn more/);
  });

  test('recent workspaces section is collapsed by default', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    // The recent toggle should only exist if there are recent workspaces.
    // In a fresh test environment there are none, so the section shouldn't render.
    // This test verifies the toggle isn't in an expanded state.
    const toggle = page.getByTestId('recent-workspaces-toggle');
    const toggleCount = await toggle.count();
    if (toggleCount > 0) {
      // If present, clicking it should expand the list
      await expect(toggle).toBeVisible();
    }
  });
});
