/**
 * AI Assistant as main-panel tab (UX-21)
 *
 * Ctrl+Shift+A (and the new sidebar "Pop out" button) opens the AI
 * Assistant in a main-panel tab — the same `AIChatViewer` that backs
 * `.aichat` files, but mounted with a transient synthetic chatData so
 * nothing is written to disk until the user saves.
 *
 * The sidebar AI pane still works on its own; this is purely additive.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, switchToStandaloneEditorSurface } from './helpers/test-utils';

test.describe('AI Assistant main-panel tab (UX-21)', () => {
  test('Ctrl+Shift+A adds an ai-assistant tab to the editor store', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // Ensure focus is not in an input so the shortcut fires.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

    await page.keyboard.press('Control+Shift+a');

    // The store should record a new tab with type 'ai-assistant'.
    const hasTab = await page.evaluate(() => {
      const editor = (window as any).__editorStore?.getState?.();
      return (editor?.openTabs ?? []).some((t: { type?: string }) => t.type === 'ai-assistant');
    });
    expect(hasTab).toBe(true);

    // And the main panel should mount the ai-assistant render path.
    await expect(page.getByTestId('ai-assistant-tab')).toBeVisible();
  });

  test('Ctrl+Shift+A a second time focuses the existing tab instead of opening a duplicate', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

    await page.keyboard.press('Control+Shift+a');
    const firstCount = await page.evaluate(() => {
      const editor = (window as any).__editorStore?.getState?.();
      return (editor?.openTabs ?? []).filter((t: { type?: string }) => t.type === 'ai-assistant').length;
    });
    expect(firstCount).toBe(1);

    await page.keyboard.press('Control+Shift+a');
    const secondCount = await page.evaluate(() => {
      const editor = (window as any).__editorStore?.getState?.();
      return (editor?.openTabs ?? []).filter((t: { type?: string }) => t.type === 'ai-assistant').length;
    });
    expect(secondCount).toBe(1);
  });

  test('existing .aichat flow keeps rendering an AI chat tab (regression)', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    // AIChatViewer renders inside MainPanel, which only mounts on the
    // standalone editor surface (sidebarActiveTab === 'files') — see
    // helpers/test-utils.ts.
    await switchToStandaloneEditorSurface(page);

    await page.evaluate(() => {
      const editor = (window as any).__editorStore?.getState?.();
      const aichat = {
        id: 'regression',
        title: 'Regression',
        provider: 'anthropic',
        model: 'claude-3-haiku',
        messages: [],
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };
      editor?.openFile?.(
        '/test-workspace/regression.aichat',
        'regression.aichat',
        JSON.stringify(aichat)
      );
      editor?.setActiveTab?.('/test-workspace/regression.aichat');
    });

    // Original behaviour: .aichat file opens AIChatViewer (without the
    // main-panel wrapper testid added for UX-21).
    await expect(page.getByTestId('ai-chat-viewer')).toBeVisible({ timeout: 10_000 });
  });
});
