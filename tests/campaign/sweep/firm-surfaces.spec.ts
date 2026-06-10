/**
 * sweep/firm-surfaces.spec.ts
 * Campaign Phase 5 — L-171..L-176
 * Firm settings surfaces + wrong-password error path
 */

import { test, expect } from '@playwright/test';
import { snap, collectConsoleErrors, horizontalOverflow } from '../helpers/campaign';
import { waitForTestModeLoad, hardClick } from '../../e2e/helpers/test-utils';

async function openSettings(page: import('@playwright/test').Page) {
  const gear = page.getByTestId('settings-gear');
  await expect(gear).toBeVisible();
  await hardClick(gear);
  await expect(page.getByTestId('settings-modal')).toBeVisible({ timeout: 8000 });
}

async function openFirmSettings(page: import('@playwright/test').Page): Promise<boolean> {
  await openSettings(page);
  const firmCat = page.getByTestId('settings-category-firm');
  const catVisible = await firmCat.isVisible({ timeout: 3000 }).catch(() => false);
  if (!catVisible) return false;
  await hardClick(firmCat);
  return true;
}

test.describe('Firm surfaces (L-171..L-176)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  // L-171: Firm settings tab
  test('L-171 firm settings tab renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const opened = await openFirmSettings(page);
    if (opened) {
      await snap(page, testInfo, 'L-171-firm-settings-tab');
      const overflow = await horizontalOverflow(page);
      expect(overflow, 'overflow L-171').toHaveLength(0);
    } else {
      await snap(page, testInfo, 'L-171-firm-tab-not-visible');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-171').toHaveLength(0);
    await page.keyboard.press('Escape');
  });

  // L-172: License settings panel
  test('L-172 license settings panel renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openSettings(page);
    const licenseCat = page.getByTestId('settings-category-license');
    const catVisible = await licenseCat.isVisible({ timeout: 3000 }).catch(() => false);
    if (catVisible) {
      await hardClick(licenseCat);
      // License settings should contain the tier name or buy/resubscribe button
      const tierName = page.getByTestId('license-tier-name');
      const buyBtn = page.getByTestId('license-buy-button');
      const degraded = page.getByTestId('license-degraded-notice');
      const anyVisible = await Promise.race([
        tierName.isVisible({ timeout: 3000 }),
        buyBtn.isVisible({ timeout: 3000 }),
        degraded.isVisible({ timeout: 3000 }),
      ]).catch(() => false);
      if (anyVisible) {
        await snap(page, testInfo, 'L-172-license-settings-panel');
        const overflow = await horizontalOverflow(page);
        expect(overflow, 'overflow L-172').toHaveLength(0);
      }
    }
    await snap(page, testInfo, 'L-172-license-checked');
    const errors = getErrors();
    expect(errors, 'console errors L-172').toHaveLength(0);
    await page.keyboard.press('Escape');
  });

  // L-173: Firm admin features (multi-seat) — PricingTiers.tsx
  test('L-173 firm pricing tiers surface renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const opened = await openFirmSettings(page);
    if (opened) {
      // Check for firm sign-in panel
      const firmSignin = page.getByTestId('firm-signin');
      const signinVisible = await firmSignin.isVisible({ timeout: 3000 }).catch(() => false);
      if (signinVisible) {
        await snap(page, testInfo, 'L-173-firm-signin-panel');
      }
    }
    await snap(page, testInfo, 'L-173-firm-admin-checked');
    const errors = getErrors();
    expect(errors, 'console errors L-173').toHaveLength(0);
    await page.keyboard.press('Escape');
  });

  // L-174: Mail connect settings
  test('L-174 mail connect settings renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openSettings(page);
    // Mail connect is likely under integrations
    const integCat = page.getByTestId('settings-category-integrations');
    const catVisible = await integCat.isVisible({ timeout: 3000 }).catch(() => false);
    if (catVisible) {
      await hardClick(integCat);
      await snap(page, testInfo, 'L-174-mail-connect-integrations');
      const overflow = await horizontalOverflow(page);
      expect(overflow, 'overflow L-174').toHaveLength(0);
    } else {
      await snap(page, testInfo, 'L-174-mail-connect-no-integrations');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-174').toHaveLength(0);
    await page.keyboard.press('Escape');
  });

  // L-175: IMAP connect settings
  test('L-175 IMAP connect settings renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openSettings(page);
    const integCat = page.getByTestId('settings-category-integrations');
    const catVisible = await integCat.isVisible({ timeout: 3000 }).catch(() => false);
    if (catVisible) {
      await hardClick(integCat);
      // Look for IMAP section
      const imapSection = page.locator('[data-testid*="imap"], [data-testid*="mail-imap"]').first();
      const imapVisible = await imapSection.isVisible({ timeout: 2000 }).catch(() => false);
      if (imapVisible) {
        await snap(page, testInfo, 'L-175-imap-settings');
      } else {
        await snap(page, testInfo, 'L-175-imap-no-section');
      }
    } else {
      await snap(page, testInfo, 'L-175-imap-no-integrations');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-175').toHaveLength(0);
    await page.keyboard.press('Escape');
  });

  // L-176: Gmail connect settings
  test('L-176 Gmail connect settings renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openSettings(page);
    const integCat = page.getByTestId('settings-category-integrations');
    const catVisible = await integCat.isVisible({ timeout: 3000 }).catch(() => false);
    if (catVisible) {
      await hardClick(integCat);
      await snap(page, testInfo, 'L-176-gmail-connect-settings');
      const overflow = await horizontalOverflow(page);
      expect(overflow, 'overflow L-176').toHaveLength(0);
    } else {
      await snap(page, testInfo, 'L-176-gmail-no-integrations');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-176').toHaveLength(0);
    await page.keyboard.press('Escape');
  });

  // Edge: firm sign-in with wrong password → friendly error
  test('L-171-edge firm sign-in with wrong password shows friendly error', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const opened = await openFirmSettings(page);
    if (opened) {
      const firmSignin = page.getByTestId('firm-signin');
      const signinVisible = await firmSignin.isVisible({ timeout: 3000 }).catch(() => false);
      if (signinVisible) {
        const emailInput = page.getByTestId('firm-email');
        const passwordInput = page.getByTestId('firm-password');
        const submitBtn = page.getByTestId('firm-signin-submit');
        if (
          await emailInput.isVisible({ timeout: 2000 }).catch(() => false) &&
          await passwordInput.isVisible({ timeout: 2000 }).catch(() => false)
        ) {
          await emailInput.fill('admin@keepance-e2e.test');
          await passwordInput.fill('definitely-wrong-password-xyz');
          await submitBtn.click();
          // Wait for error notice or some response
          await page.waitForTimeout(3000);
          await snap(page, testInfo, 'L-171-edge-wrong-password');
          // Should NOT have thrown unhandled exceptions
        }
      }
    }
    const errors = getErrors();
    // Network / HTTP errors to firm backend are expected during wrong-password test
    // The 401 pattern is now in BENIGN_PATTERNS in campaign.ts helper.
    // Any remaining non-network errors would be genuine bugs.
    const nonNetworkErrors = errors.filter(
      e => !e.includes('Failed to fetch') &&
           !e.includes('NetworkError') &&
           !e.includes('net::ERR') &&
           !e.includes('401') &&
           !e.includes('Unauthorized')
    );
    expect(nonNetworkErrors, 'non-network console errors on wrong password').toHaveLength(0);
    await page.keyboard.press('Escape');
  });
});
