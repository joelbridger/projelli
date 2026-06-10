/**
 * Task 3 — Data-map onboarding step: scrollable + accordion, footer always reachable
 *
 * Verifies the data-map step in the first-run wizard:
 *   1. At least 5 accordion sections present, all closed by default
 *   2. Clicking section 0 opens it; clicking section 1 then opens 1 and closes 0
 *   3. The continue button is in the viewport at 1366x720 without page scrolling
 *
 * Uses ?testMode=true&forceOnboarding=true to show the wizard in the test env.
 */

import { test, expect } from '@playwright/test';
import { hardClick } from './helpers/test-utils';

/**
 * Navigate the first-run wizard to the data step.
 * ?forceOnboarding=true bypasses the IS_TEST_MODE guard and shows the wizard.
 */
async function gotoAndNavigateToDataStep(page: import('@playwright/test').Page) {
  await page.goto('/?testMode=true&forceOnboarding=true');
  await page.waitForLoadState('networkidle');

  // Welcome → advance using stable testid (locale-proof)
  const letsGoBtn = page.getByTestId('onboarding-next').first();
  await expect(letsGoBtn).toBeVisible({ timeout: 15_000 });
  await hardClick(letsGoBtn);

  // Profession step → advance using the same testid on the profession-step CTA
  // (the top-right skip link is a plain <button> without a testid; this picks
  // the primary CTA which is data-testid="onboarding-next").
  const professionNext = page.getByTestId('onboarding-next').first();
  await expect(professionNext).toBeVisible({ timeout: 8_000 });
  await professionNext.click();

  // Workspace step → advance using the workspace-specific testid
  const workspaceNext = page.getByTestId('onboarding-workspace-next');
  await expect(workspaceNext).toBeVisible({ timeout: 8_000 });
  await hardClick(workspaceNext);

  // Now on data step — verify the data-step container is visible
  const dataStep = page.getByTestId('onboarding-data-step');
  await expect(dataStep).toBeVisible({ timeout: 8_000 });
}

test.describe('Data-map onboarding accordion (Task 3) — 1366x720', () => {
  test.use({ viewport: { width: 1366, height: 720 } });

  test('sections: at least 5 present, all closed by default', async ({ page }) => {
    await gotoAndNavigateToDataStep(page);

    // DATA_MAP_ROWS has 6 rows
    const sections = page.getByTestId('data-map-section');
    const count = await sections.count();
    expect(count).toBeGreaterThanOrEqual(5);

    // All start closed
    for (let i = 0; i < count; i++) {
      await expect(sections.nth(i)).toHaveAttribute('data-state', 'closed');
    }
  });

  test('accordion single-open: clicking section 0 opens it; clicking section 1 opens 1 and closes 0', async ({ page }) => {
    await gotoAndNavigateToDataStep(page);

    const sections = page.getByTestId('data-map-section');
    const triggers = page.getByTestId('data-map-section-trigger');

    // Click section 0 → opens
    await triggers.nth(0).click();
    await expect(sections.nth(0)).toHaveAttribute('data-state', 'open');

    // Click section 1 → 1 opens, 0 closes
    await triggers.nth(1).click();
    await expect(sections.nth(1)).toHaveAttribute('data-state', 'open');
    await expect(sections.nth(0)).toHaveAttribute('data-state', 'closed');
  });

  test('continue button is in viewport without page scrolling', async ({ page }) => {
    await gotoAndNavigateToDataStep(page);

    const continueBtn = page.getByTestId('onboarding-data-continue');
    await expect(continueBtn).toBeVisible();
    await expect(continueBtn).toBeInViewport();
  });
});

test.describe('Data-map onboarding accordion — 1920x1080', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('continue button is in viewport at 1920x1080', async ({ page }) => {
    await page.goto('/?testMode=true&forceOnboarding=true');
    await page.waitForLoadState('networkidle');

    // Welcome → advance with stable testid
    const letsGoBtn = page.getByTestId('onboarding-next').first();
    await expect(letsGoBtn).toBeVisible({ timeout: 15_000 });
    await hardClick(letsGoBtn);

    // Profession step → advance with stable testid
    const professionNext = page.getByTestId('onboarding-next').first();
    await expect(professionNext).toBeVisible({ timeout: 8_000 });
    await professionNext.click();

    // Workspace step → advance with workspace-specific testid
    const workspaceNext = page.getByTestId('onboarding-workspace-next');
    await expect(workspaceNext).toBeVisible({ timeout: 8_000 });
    await hardClick(workspaceNext);

    const dataStep = page.getByTestId('onboarding-data-step');
    await expect(dataStep).toBeVisible({ timeout: 8_000 });

    const continueBtn = page.getByTestId('onboarding-data-continue');
    await expect(continueBtn).toBeVisible();
    await expect(continueBtn).toBeInViewport();
  });
});
