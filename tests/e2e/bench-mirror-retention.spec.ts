/**
 * Browser mirror of the Windows bench smoke checklist's Wave 4 Track D stub
 * (scripts/bench-smoke/checks/wave-stubs.mjs: wave4-retention-attestation —
 * see docs/qa/E2E-SMOKE-MIRROR.md for the full mapping).
 *
 * The bench harness still lists this as a TODO stub ("hasn't merged"), but
 * grepping current lantern-plus source found it HAS merged since that stub
 * was written: src/features/settings/RetentionSettings.tsx +
 * src/platform/privacy/ui/DataMapDialog.tsx's "Wave 4 Track D" block +
 * src/platform/privacy/attestation.ts (CHANGELOG.md's "Retention policy
 * engine + local redaction + attestation export (Wave 4 Track D)" entry).
 * This spec covers the half of the stub's acceptance criteria that is pure
 * client-side UI (the retention policy control + its live state on the Data
 * Map); the ".docx export" action itself needs a real Tauri fs plugin call
 * (`@tauri-apps/plugin-fs`) and the native OOXML engine, so it is NOT
 * exercised end-to-end here — see docs/qa/E2E-SMOKE-MIRROR.md.
 */

import { test, expect } from '@playwright/test';
import { hardClick, waitForTestModeLoad } from './helpers/test-utils';

async function openPrivacySettings(page: import('@playwright/test').Page) {
  await hardClick(page.getByTestId('settings-gear'));
  await hardClick(page.getByTestId('settings-category-privacy'));
  await hardClick(page.getByTestId('subheader-privacy'));
  await expect(page.getByTestId('retention-settings')).toBeVisible({ timeout: 10_000 });
}

test.describe('Bench mirror: Wave 4 Track D — retention policy + attestation', () => {
  test('wave4-retention-attestation: retention policy control renders and its state reflects on the Data Map', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await openPrivacySettings(page);

    // Default mode.
    await expect(page.getByTestId('retention-mode-keep-everything')).toBeChecked();

    // Switch to "delete audio after N days" and confirm the day input appears.
    await hardClick(page.getByTestId('retention-mode-delete-audio-after-days'));
    await expect(page.getByTestId('retention-days')).toBeVisible({ timeout: 5_000 });

    // The same policy state appears on the Data Map dialog (DataMapDialog.tsx's
    // "Wave 4 Track D" row), reachable from this same Privacy panel.
    await hardClick(page.getByTestId('privacy-open-data-map'));
    const retentionRow = page.getByTestId('data-map-retention');
    await expect(retentionRow).toBeVisible({ timeout: 10_000 });
    await expect(retentionRow).not.toContainText('Keep everything');

    // The attestation export button renders (pure UI); its real success path
    // needs a Tauri fs plugin + the native OOXML engine, so only presence is
    // asserted here, not a completed export.
    await expect(retentionRow.getByTestId('attestation-export')).toBeVisible();
  });
});
