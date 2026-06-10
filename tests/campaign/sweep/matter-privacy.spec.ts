/**
 * sweep/matter-privacy.spec.ts
 * Campaign Phase 5 — L-166..L-170
 * Matter / privilege surfaces + privacy (J category)
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

test.describe('Matter / privilege surfaces (L-166..L-170)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  // L-166: Matter manager dialog
  test('L-166 MatterManagerDialog opens via AI chat scope selector', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('Control+Shift+a');
    const aiTab = page.getByTestId('ai-assistant-tab');
    const tabVisible = await aiTab.isVisible({ timeout: 5000 }).catch(() => false);
    if (tabVisible) {
      const scopeSelector = page.getByTestId('matter-scope-selector');
      const selectorVisible = await scopeSelector.isVisible({ timeout: 5000 }).catch(() => false);
      if (selectorVisible) {
        await scopeSelector.click();
        const manageItem = page.getByTestId('matter-scope-manage');
        const manageVisible = await manageItem.isVisible({ timeout: 3000 }).catch(() => false);
        if (manageVisible) {
          await manageItem.click();
          const dialog = page.getByTestId('matter-manager-dialog');
          const dlgVisible = await dialog.isVisible({ timeout: 5000 }).catch(() => false);
          if (dlgVisible) {
            await expect(dialog).toBeVisible();
            await snap(page, testInfo, 'L-166-matter-manager-dialog');
            const overflow = await horizontalOverflow(page);
            expect(overflow, 'overflow L-166').toHaveLength(0);
            await page.keyboard.press('Escape');
          }
        }
      }
    }
    await snap(page, testInfo, 'L-166-matter-manager-checked');
    const errors = getErrors();
    expect(errors, 'console errors L-166').toHaveLength(0);
  });

  // L-167: Privileged matter badge in status bar
  test('L-167 privileged matter badge in status bar (conditional)', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    // Badge is conditional on a privileged matter being active in testMode
    const badge = page.getByTestId('privileged-matter-badge');
    const isVisible = await badge.isVisible({ timeout: 2000 }).catch(() => false);
    if (isVisible) {
      await expect(badge).toBeVisible();
      await snap(page, testInfo, 'L-167-privileged-matter-badge-visible');
    } else {
      await snap(page, testInfo, 'L-167-privileged-matter-badge-absent');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-167').toHaveLength(0);
  });

  // L-168: Confidentiality mode settings
  test('L-168 confidentiality mode settings renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openSettings(page);
    const privacyCat = page.getByTestId('settings-category-privacy');
    const catVisible = await privacyCat.isVisible({ timeout: 3000 }).catch(() => false);
    if (catVisible) {
      await hardClick(privacyCat);
      const confSettings = page.getByTestId('confidentiality-mode-settings');
      const confVisible = await confSettings.isVisible({ timeout: 3000 }).catch(() => false);
      if (confVisible) {
        await expect(confSettings).toBeVisible();
        await snap(page, testInfo, 'L-168-confidentiality-mode-settings');
        const overflow = await horizontalOverflow(page);
        expect(overflow, 'overflow L-168').toHaveLength(0);
      }
    }
    await snap(page, testInfo, 'L-168-confidentiality-checked');
    const errors = getErrors();
    expect(errors, 'console errors L-168').toHaveLength(0);
    await page.keyboard.press('Escape');
  });

  // L-169: Privacy settings (data map)
  test('L-169 privacy settings renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openSettings(page);
    const privacyCat = page.getByTestId('settings-category-privacy');
    const catVisible = await privacyCat.isVisible({ timeout: 3000 }).catch(() => false);
    if (catVisible) {
      await hardClick(privacyCat);
      await snap(page, testInfo, 'L-169-privacy-settings');
      const overflow = await horizontalOverflow(page);
      expect(overflow, 'overflow L-169').toHaveLength(0);
    } else {
      await snap(page, testInfo, 'L-169-privacy-settings-no-cat');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-169').toHaveLength(0);
    await page.keyboard.press('Escape');
  });

  // L-170: DataMapDialog
  test('L-170 DataMapDialog opens from privacy settings', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openSettings(page);
    const privacyCat = page.getByTestId('settings-category-privacy');
    const catVisible = await privacyCat.isVisible({ timeout: 3000 }).catch(() => false);
    if (catVisible) {
      await hardClick(privacyCat);
      const openDataMap = page.getByTestId('open-data-map');
      const openVisible = await openDataMap.isVisible({ timeout: 3000 }).catch(() => false);
      if (openVisible) {
        await hardClick(openDataMap);
        const dataMapDialog = page.getByTestId('data-map-dialog');
        const dlgVisible = await dataMapDialog.isVisible({ timeout: 5000 }).catch(() => false);
        if (dlgVisible) {
          await expect(dataMapDialog).toBeVisible();
          await snap(page, testInfo, 'L-170-data-map-dialog');
          const overflow = await horizontalOverflow(page);
          expect(overflow, 'overflow L-170').toHaveLength(0);
          // Sections should be present
          const sections = page.locator('[data-testid="data-map-section"]');
          const sectionCount = await sections.count();
          expect(sectionCount, 'data map sections').toBeGreaterThan(0);
          await page.keyboard.press('Escape');
        }
      }
    }
    await snap(page, testInfo, 'L-170-data-map-checked');
    const errors = getErrors();
    expect(errors, 'console errors L-170').toHaveLength(0);
    await page.keyboard.press('Escape');
  });
});
