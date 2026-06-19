/**
 * Task 3 — Data-map onboarding step: scrollable + accordion, footer always reachable
 *
 * Verifies the data-map step in the first-run onboarding:
 *   1. At least 5 accordion sections present; the first opens by default (so the
 *      attorney lands on a readable plain-English section), the rest start closed
 *   2. Single-open: opening section 1 closes the first
 *   3. The continue button is in the viewport at 1366x720 without page scrolling
 *
 * Uses ?testMode=true&forceOnboarding=true to show the wizard in the test env.
 */

import { test, expect } from '@playwright/test';
import { hardClick } from './helpers/test-utils';

/**
 * Navigate the first-run onboarding to the trust/data-map step.
 * ?forceOnboarding=true bypasses the IS_TEST_MODE guard and shows the wizard.
 */
async function gotoAndNavigateToTrustStep(page: import('@playwright/test').Page) {
  await page.goto('/?testMode=true&forceOnboarding=true');
  await page.waitForLoadState('networkidle');

  // Welcome → advance using per-step stable testid (locale-proof)
  const letsGoBtn = page.getByTestId('onboarding-next-welcome');
  await expect(letsGoBtn).toBeVisible({ timeout: 15_000 });
  await hardClick(letsGoBtn);

  // Profession step → advance using the profession-step-specific testid
  const professionNext = page.getByTestId('onboarding-next-profession');
  await expect(professionNext).toBeVisible({ timeout: 8_000 });
  await professionNext.click();

  // Identity step → continue with the default name/photo values.
  const identityNext = page.getByTestId('onboarding-identity-next');
  await expect(identityNext).toBeVisible({ timeout: 8_000 });
  await hardClick(identityNext);

  // Workspace step → advance using the workspace-specific testid
  const workspaceNext = page.getByTestId('onboarding-workspace-next');
  await expect(workspaceNext).toBeVisible({ timeout: 8_000 });
  await hardClick(workspaceNext);

  // Now on the trust/data-map step.
  await expect(page.getByTestId('onboarding-step-trust')).toBeVisible({ timeout: 8_000 });
}

async function openDataMapFromTrustStep(page: import('@playwright/test').Page) {
  await hardClick(page.getByTestId('onboarding-trust-open-data-map'));
  await expect(page.getByTestId('data-map-dialog')).toBeVisible({ timeout: 8_000 });
}

test.describe('Data-map onboarding accordion (Task 3) — 1366x720', () => {
  test.use({ viewport: { width: 1366, height: 720 } });

  test('sections: at least 5 present; first open by default, rest closed', async ({ page }) => {
    await gotoAndNavigateToTrustStep(page);
    await openDataMapFromTrustStep(page);

    // DATA_MAP_ROWS has 7 rows
    const sections = page.getByTestId('data-map-section');
    const triggers = page.getByTestId('data-map-section-trigger');
    const count = await sections.count();
    expect(count).toBeGreaterThanOrEqual(5);

    // The first row is open by default so the attorney immediately reads a full
    // plain-English section; the remaining rows start closed.
    await expect(triggers.nth(0)).toHaveAttribute('aria-expanded', 'true');
    for (let i = 1; i < count; i++) {
      await expect(triggers.nth(i)).toHaveAttribute('aria-expanded', 'false');
    }
  });

  test('accordion single-open: opening section 1 closes the default-open section 0', async ({ page }) => {
    await gotoAndNavigateToTrustStep(page);
    await openDataMapFromTrustStep(page);

    const triggers = page.getByTestId('data-map-section-trigger');

    // Section 0 starts open by default.
    await expect(triggers.nth(0)).toHaveAttribute('aria-expanded', 'true');

    // Click section 1 → 1 opens, 0 closes (single-open model preserved).
    await triggers.nth(1).click();
    await expect(triggers.nth(1)).toHaveAttribute('aria-expanded', 'true');
    await expect(triggers.nth(0)).toHaveAttribute('aria-expanded', 'false');
  });

  test('continue button is in viewport without page scrolling', async ({ page }) => {
    await gotoAndNavigateToTrustStep(page);

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

    // Welcome → advance with per-step stable testid
    const letsGoBtn = page.getByTestId('onboarding-next-welcome');
    await expect(letsGoBtn).toBeVisible({ timeout: 15_000 });
    await hardClick(letsGoBtn);

    // Profession step → advance with profession-step-specific testid
    const professionNext = page.getByTestId('onboarding-next-profession');
    await expect(professionNext).toBeVisible({ timeout: 8_000 });
    await professionNext.click();

    const identityNext = page.getByTestId('onboarding-identity-next');
    await expect(identityNext).toBeVisible({ timeout: 8_000 });
    await hardClick(identityNext);

    // Workspace step → advance with workspace-specific testid
    const workspaceNext = page.getByTestId('onboarding-workspace-next');
    await expect(workspaceNext).toBeVisible({ timeout: 8_000 });
    await hardClick(workspaceNext);

    await expect(page.getByTestId('onboarding-step-trust')).toBeVisible({ timeout: 8_000 });

    const continueBtn = page.getByTestId('onboarding-data-continue');
    await expect(continueBtn).toBeVisible();
    await expect(continueBtn).toBeInViewport();
  });
});
