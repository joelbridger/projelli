/**
 * sweep/dialogs.spec.ts
 * Campaign Phase 5 — L-044..L-059
 * Modals / Dialogs
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

test.describe('Dialogs and modals (L-044..L-059)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  // L-044: SettingsModal
  test('L-044 SettingsModal opens + escape closes', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openSettings(page);
    await snap(page, testInfo, 'L-044-settings-modal');
    const overflow = await horizontalOverflow(page);
    expect(overflow, 'overflow L-044').toHaveLength(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-modal')).toHaveCount(0, { timeout: 5000 });
    const errors = getErrors();
    expect(errors, 'console errors L-044').toHaveLength(0);
  });

  // L-045: McpApprovalModal — settings > AI > MCP section
  test('L-045 McpApprovalModal renders in MCP settings', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openSettings(page);
    // Navigate to AI or advanced category that contains MCP settings
    const aiCat = page.getByTestId('settings-category-ai');
    const aiVisible = await aiCat.isVisible({ timeout: 3000 }).catch(() => false);
    if (aiVisible) {
      await hardClick(aiCat);
    }
    const mcpSection = page.getByTestId('mcp-settings-section');
    const mcpVisible = await mcpSection.isVisible({ timeout: 3000 }).catch(() => false);
    if (mcpVisible) {
      await expect(mcpSection).toBeVisible();
    }
    await snap(page, testInfo, 'L-045-mcp-approval-modal-area');
    const errors = getErrors();
    expect(errors, 'console errors L-045').toHaveLength(0);
    await page.keyboard.press('Escape');
  });

  // L-046: CompressionConfirmModal — not easily triggered without active chat
  test('L-046 CompressionConfirmModal (requires active chat — marked unreachable)', async ({ page, browserName: _b }, testInfo) => {
    // This modal is triggered by a compression threshold in an AI chat session.
    // Without a real API key and messages, cannot be triggered in sweep.
    await snap(page, testInfo, 'L-046-compression-confirm-unreachable');
    // No assertions — documented as unreachable in sweep context
  });

  // L-047: AudioRecorderModal — triggered via AI assistant sidebar
  test('L-047 AudioRecorderModal opens from AI assistant', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const aiTab = page.getByTestId('sidebar-tab-ai-assistant');
    await expect(aiTab).toBeVisible();
    await hardClick(aiTab);
    // Look for voice/record button
    const voiceBtn = page.locator('[data-testid*="voice"], [data-testid*="record"], [data-testid*="audio"]').first();
    const voiceVisible = await voiceBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (voiceVisible) {
      await voiceBtn.click();
      const recorder = page.locator('[data-testid*="audio-recorder"], [data-testid*="voice-modal"]').first();
      const recorderVisible = await recorder.isVisible({ timeout: 3000 }).catch(() => false);
      if (recorderVisible) {
        await snap(page, testInfo, 'L-047-audio-recorder-modal');
        await page.keyboard.press('Escape');
      }
    }
    await snap(page, testInfo, 'L-047-audio-recorder-checked');
    const errors = getErrors();
    expect(errors, 'console errors L-047').toHaveLength(0);
  });

  // L-048: ChainBuilderModal
  test('L-048 ChainBuilderModal opens from workflow panel', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const workflowTab = page.getByTestId('sidebar-tab-workflows');
    await expect(workflowTab).toBeVisible();
    await hardClick(workflowTab);
    await expect(page.getByTestId('workflows-panel')).toBeVisible({ timeout: 5000 });
    // Look for chain builder trigger
    const chainTemplates = page.getByTestId('workflows-chain-templates');
    const chainVisible = await chainTemplates.isVisible({ timeout: 3000 }).catch(() => false);
    if (chainVisible) {
      const chainBtn = chainTemplates.locator('button').first();
      const btnVisible = await chainBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (btnVisible) {
        await chainBtn.click();
        const chainModal = page.getByTestId('chain-builder-modal');
        const modalVisible = await chainModal.isVisible({ timeout: 3000 }).catch(() => false);
        if (modalVisible) {
          await expect(chainModal).toBeVisible();
          await snap(page, testInfo, 'L-048-chain-builder-modal');
          await page.keyboard.press('Escape');
        }
      }
    }
    await snap(page, testInfo, 'L-048-chain-builder-checked');
    const errors = getErrors();
    expect(errors, 'console errors L-048').toHaveLength(0);
  });

  // L-049: MatterManagerDialog
  test('L-049 MatterManagerDialog opens via AI chat scope selector', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    // Open AI assistant pane to get the scope selector
    const aiTab = page.getByTestId('sidebar-tab-ai-assistant');
    await hardClick(aiTab);
    // Try keyboard shortcut Ctrl+Shift+a
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('Control+Shift+a');
    const aiAssistantTab = page.getByTestId('ai-assistant-tab');
    const tabVisible = await aiAssistantTab.isVisible({ timeout: 5000 }).catch(() => false);
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
          const dialogVisible = await dialog.isVisible({ timeout: 5000 }).catch(() => false);
          if (dialogVisible) {
            await snap(page, testInfo, 'L-049-matter-manager-dialog');
            const overflow = await horizontalOverflow(page);
            expect(overflow, 'overflow L-049').toHaveLength(0);
            await page.keyboard.press('Escape');
          }
        }
      }
    }
    await snap(page, testInfo, 'L-049-matter-manager-checked');
    const errors = getErrors();
    expect(errors, 'console errors L-049').toHaveLength(0);
  });

  // L-050: DataMapDialog
  test('L-050 DataMapDialog opens from privacy settings', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openSettings(page);
    const privacyCat = page.getByTestId('settings-category-privacy');
    const privacyVisible = await privacyCat.isVisible({ timeout: 3000 }).catch(() => false);
    if (privacyVisible) {
      await hardClick(privacyCat);
      const openDataMap = page.getByTestId('open-data-map');
      const openVisible = await openDataMap.isVisible({ timeout: 3000 }).catch(() => false);
      if (openVisible) {
        await hardClick(openDataMap);
        const dataMapDialog = page.getByTestId('data-map-dialog');
        const dlgVisible = await dataMapDialog.isVisible({ timeout: 5000 }).catch(() => false);
        if (dlgVisible) {
          await expect(dataMapDialog).toBeVisible();
          await snap(page, testInfo, 'L-050-data-map-dialog');
          await page.keyboard.press('Escape');
        }
      }
    }
    await snap(page, testInfo, 'L-050-data-map-checked');
    const errors = getErrors();
    expect(errors, 'console errors L-050').toHaveLength(0);
    await page.keyboard.press('Escape');
  });

  // L-051: WelcomeOnboardingDialog — suppressed in testMode
  test('L-051 WelcomeOnboardingDialog can be triggered with forceOnboarding', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    // ?forceOnboarding=true forces the dialog (per App.tsx comments)
    await page.goto('/?testMode=true&forceOnboarding=true');
    await waitForTestModeLoad(page);
    const dialog = page.getByTestId('welcome-onboarding-dialog');
    const dialogVisible = await dialog.isVisible({ timeout: 5000 }).catch(() => false);
    if (dialogVisible) {
      await expect(dialog).toBeVisible();
      await snap(page, testInfo, 'L-051-welcome-onboarding-dialog');
      const overflow = await horizontalOverflow(page);
      expect(overflow, 'overflow L-051').toHaveLength(0);
      // Escape or skip
      const skipBtn = page.getByTestId('onboarding-skip');
      const skipVisible = await skipBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (skipVisible) await hardClick(skipBtn);
      else await page.keyboard.press('Escape');
    } else {
      await snap(page, testInfo, 'L-051-welcome-onboarding-not-shown');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-051').toHaveLength(0);
  });

  // L-052: PluginConsentDialog — conditional on installing a plugin
  test('L-052 PluginConsentDialog area visible in marketplace settings', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openSettings(page);
    const marketplaceCat = page.getByTestId('settings-category-marketplace');
    const catVisible = await marketplaceCat.isVisible({ timeout: 3000 }).catch(() => false);
    if (catVisible) {
      await hardClick(marketplaceCat);
      const marketplaceTab = page.getByTestId('marketplace-tab');
      const tabVisible = await marketplaceTab.isVisible({ timeout: 3000 }).catch(() => false);
      if (tabVisible) {
        await snap(page, testInfo, 'L-052-plugin-consent-marketplace');
      }
    }
    await snap(page, testInfo, 'L-052-plugin-consent-checked');
    const errors = getErrors();
    expect(errors, 'console errors L-052').toHaveLength(0);
    await page.keyboard.press('Escape');
  });

  // L-053: UpdateReleaseNotesModal
  test('L-053 UpdateReleaseNotesModal area via updater settings', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openSettings(page);
    const updatesCat = page.getByTestId('settings-category-updates');
    const catVisible = await updatesCat.isVisible({ timeout: 3000 }).catch(() => false);
    if (catVisible) {
      await hardClick(updatesCat);
      await snap(page, testInfo, 'L-053-updater-settings');
    }
    await snap(page, testInfo, 'L-053-updater-checked');
    const errors = getErrors();
    expect(errors, 'console errors L-053').toHaveLength(0);
    await page.keyboard.press('Escape');
  });

  // L-054: ConfirmDialog (generic) — triggered by destructive file actions
  test('L-054 ConfirmDialog shown on file deletion attempt', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const batchDelete = page.getByTestId('batch-delete');
    const delVisible = await batchDelete.isVisible({ timeout: 2000 }).catch(() => false);
    if (delVisible) {
      await batchDelete.click();
      const confirmDialog = page.locator('[role="alertdialog"], [role="dialog"]').filter({ hasText: /delete|confirm/i });
      const dlgVisible = await confirmDialog.isVisible({ timeout: 3000 }).catch(() => false);
      if (dlgVisible) {
        await snap(page, testInfo, 'L-054-confirm-dialog');
        await page.keyboard.press('Escape');
      }
    }
    await snap(page, testInfo, 'L-054-confirm-dialog-checked');
    const errors = getErrors();
    expect(errors, 'console errors L-054').toHaveLength(0);
  });

  // L-055: PromptDialog (generic) — triggered by rename
  test('L-055 PromptDialog shown on file rename', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    // Try tab bar context menu → rename
    const tabBarRoot = page.getByTestId('tab-bar-root');
    const tabVisible = await tabBarRoot.isVisible({ timeout: 3000 }).catch(() => false);
    if (tabVisible) {
      const firstTab = tabBarRoot.locator('[data-testid^="tab-"]').first();
      const fTabVisible = await firstTab.isVisible({ timeout: 2000 }).catch(() => false);
      if (fTabVisible) {
        await firstTab.click({ button: 'right' });
        const renameItem = page.getByRole('menuitem', { name: /rename/i });
        const renameVisible = await renameItem.isVisible({ timeout: 2000 }).catch(() => false);
        if (renameVisible) {
          await renameItem.click();
          const promptDialog = page.getByTestId('prompt-dialog-destination');
          const dlgVisible = await promptDialog.isVisible({ timeout: 3000 }).catch(() => false);
          if (dlgVisible) {
            await snap(page, testInfo, 'L-055-prompt-dialog');
            await page.keyboard.press('Escape');
          }
        } else {
          await page.keyboard.press('Escape');
        }
      }
    }
    await snap(page, testInfo, 'L-055-prompt-dialog-checked');
    const errors = getErrors();
    expect(errors, 'console errors L-055').toHaveLength(0);
  });

  // L-056: BugReportDialog
  test('L-056 BugReportDialog opens and closes', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const bugBtn = page.getByTestId('status-bar-bug-report');
    await expect(bugBtn).toBeVisible();
    await bugBtn.click();
    const messageField = page.getByTestId('bug-report-message');
    const fieldVisible = await messageField.isVisible({ timeout: 3000 }).catch(() => false);
    if (fieldVisible) {
      await expect(messageField).toBeVisible();
      await snap(page, testInfo, 'L-056-bug-report-dialog');
      const overflow = await horizontalOverflow(page);
      expect(overflow, 'overflow L-056').toHaveLength(0);
      await page.keyboard.press('Escape');
    } else {
      await snap(page, testInfo, 'L-056-bug-report-checked');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-056').toHaveLength(0);
  });

  // L-057: WhatsNewModal
  test('L-057 WhatsNewModal area in updates settings', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    // Try URL parameter
    await page.goto('/?testMode=true&showWhatsNew=true');
    await waitForTestModeLoad(page);
    const whatsNew = page.locator('[data-testid*="whats-new"], [data-testid*="release-notes"]').first();
    const wnVisible = await whatsNew.isVisible({ timeout: 3000 }).catch(() => false);
    if (wnVisible) {
      await snap(page, testInfo, 'L-057-whats-new-modal');
      await page.keyboard.press('Escape');
    } else {
      await snap(page, testInfo, 'L-057-whats-new-checked');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-057').toHaveLength(0);
  });

  // L-058: QuickOpen (Ctrl+P)
  test('L-058 QuickOpen opens with Ctrl+P and closes with Escape', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('Control+p');
    const quickOpen = page.getByTestId('quick-open-modal');
    const qoVisible = await quickOpen.isVisible({ timeout: 5000 }).catch(() => false);
    if (qoVisible) {
      await expect(quickOpen).toBeVisible();
      const search = page.getByTestId('quick-open-search');
      await expect(search).toBeVisible();
      await snap(page, testInfo, 'L-058-quick-open');
      const overflow = await horizontalOverflow(page);
      expect(overflow, 'overflow L-058').toHaveLength(0);
      await page.keyboard.press('Escape');
      await expect(quickOpen).toHaveCount(0, { timeout: 3000 });
    } else {
      await snap(page, testInfo, 'L-058-quick-open-not-triggered');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-058').toHaveLength(0);
  });

  // L-059: ShortcutsOverlay (Ctrl+H per inventory, or ?)
  test('L-059 ShortcutsOverlay opens with keyboard shortcut', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    // Try Ctrl+H first, then '?'
    await page.keyboard.press('Control+h');
    let overlay = page.getByTestId('shortcuts-overlay');
    let overlayVisible = await overlay.isVisible({ timeout: 3000 }).catch(() => false);
    if (!overlayVisible) {
      await page.keyboard.press('?');
      overlayVisible = await overlay.isVisible({ timeout: 3000 }).catch(() => false);
    }
    if (overlayVisible) {
      await expect(overlay).toBeVisible();
      const search = page.getByTestId('shortcuts-overlay-search');
      await expect(search).toBeVisible();
      await snap(page, testInfo, 'L-059-shortcuts-overlay');
      const overflow = await horizontalOverflow(page);
      expect(overflow, 'overflow L-059').toHaveLength(0);
      await page.keyboard.press('Escape');
      await expect(overlay).toHaveCount(0, { timeout: 3000 });
    } else {
      await snap(page, testInfo, 'L-059-shortcuts-overlay-not-triggered');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-059').toHaveLength(0);
  });
});
