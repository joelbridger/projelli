/**
 * AI Assistant current surface
 *
 * Keepance 3.0 moved AI chat out of the old sidebar pane. The assistant now
 * opens as a main editor tab with AIChatViewer mounted inside it.
 */

import { test, expect } from '@playwright/test';
import {
  waitForTestModeLoad,
  hardClick,
  safeFill,
  openAIAssistantPane,
} from './helpers/test-utils';

test.describe('AI Assistant', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await openAIAssistantPane(page);
  });

  test('opens as the current main-panel chat surface', async ({ page }) => {
    await expect(page.getByTestId('ai-assistant-tab')).toBeVisible();
    await expect(page.getByTestId('ai-chat-viewer')).toBeVisible();
    await expect(page.getByTestId('chat-title')).toHaveText('AI Assistant');
    await expect(page.getByTestId('chat-input')).toBeVisible();
    await expect(page.getByTestId('chat-send-button')).toBeVisible();
  });

  test('does not render the removed sidebar pane close button', async ({ page }) => {
    const currentSurface = page.getByTestId('ai-assistant-tab');
    await expect(currentSurface.getByRole('button', { name: /close ai assistant pane/i })).toHaveCount(0);
  });

  test('send button enables only after the user types', async ({ page }) => {
    const input = page.getByTestId('chat-input');
    const send = page.getByTestId('chat-send-button');

    await expect(send).toBeDisabled();
    await safeFill(input, 'Summarize the open matter');
    await expect(send).toBeEnabled();
  });

  test('model picker is present and opens its current menu', async ({ page }) => {
    const picker = page.getByTestId('chat-model-picker');
    await expect(picker).toBeVisible();
    await hardClick(picker);

    await expect(
      page.getByTestId('chat-model-picker-empty').or(page.getByRole('menuitem').first())
    ).toBeVisible();
  });

  test('Ctrl+Shift+A focuses the existing AI tab instead of duplicating it', async ({ page }) => {
    await page.keyboard.press('Control+Shift+a');

    const aiTabCount = await page.evaluate(() => {
      const editor = (window as any).__editorStore?.getState?.();
      return (editor?.openTabs ?? []).filter((t: { type?: string }) => t.type === 'ai-assistant').length;
    });

    expect(aiTabCount).toBe(1);
  });
});
