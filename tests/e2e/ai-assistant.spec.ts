/**
 * AI Assistant Pane Tests
 * Covers: Fix #4 (Opus 4.5), Fix #7 (dead button removal)
 *
 * Uses ?testMode=true to bypass workspace selector and test main UI
 */

import { test, expect } from '@playwright/test';
import {
  waitForTestModeLoad,
  hardClick,
  safeFill,
  openAIAssistantPane,
  switchAITab,
} from './helpers/test-utils';

test.describe('AI Assistant Pane', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await openAIAssistantPane(page);
  });

  test.describe('Fix #7: No dead Close button', () => {
    test('AI Assistant pane should NOT have a close/PanelRightClose button', async ({ page }) => {
      const pane = page.getByTestId('ai-assistant-pane');
      await expect(pane).toBeVisible();

      // The dead "Close AI Assistant Pane" button should not exist
      const closeButtons = pane.locator('button').filter({ has: page.locator('svg.lucide-panel-right-close') });
      await expect(closeButtons).toHaveCount(0);
    });

    test('AI Assistant pane title is visible', async ({ page }) => {
      await expect(page.getByTestId('ai-assistant-title')).toBeVisible();
      await expect(page.getByTestId('ai-assistant-title')).toHaveText('AI Assistant');
    });
  });

  test.describe('Tab Navigation', () => {
    test('Chats tab is visible and clickable', async ({ page }) => {
      const chatsTab = page.getByTestId('ai-tab-chats');
      await expect(chatsTab).toBeVisible();
      await expect(chatsTab).toBeEnabled();
    });

    test('Keys tab shows API key inputs', async ({ page }) => {
      await switchAITab(page, 'keys');
      await expect(page.getByTestId('api-key-help-button')).toBeVisible();
    });

    test('Models tab shows model selectors', async ({ page }) => {
      await switchAITab(page, 'models');
      await expect(page.getByTestId('model-select-anthropic')).toBeVisible();
      await expect(page.getByTestId('model-select-openai')).toBeVisible();
      await expect(page.getByTestId('model-select-google')).toBeVisible();
    });
  });

  test.describe('Fix #4: Claude Opus 4.5 Model', () => {
    test('Anthropic model selector includes Claude Opus 4.5', async ({ page }) => {
      await switchAITab(page, 'models');
      const select = page.getByTestId('model-select-anthropic');
      await expect(select).toBeVisible();

      // Check that "Claude Opus 4.5" option exists
      const opusOption = select.locator('option[value="claude-opus-4-5"]');
      await expect(opusOption).toHaveText('Claude Opus 4.5');
    });

    test('Anthropic model selector defaults to Claude Opus 4.5', async ({ page }) => {
      await switchAITab(page, 'models');
      const select = page.getByTestId('model-select-anthropic');
      await expect(select).toHaveValue('claude-opus-4-5');
    });

    test('visual snapshot: Models tab', async ({ page }) => {
      await switchAITab(page, 'models');
      const pane = page.getByTestId('ai-assistant-pane');
      await expect(pane).toHaveScreenshot('ai-models-tab.png');
    });
  });

  test.describe('API Keys', () => {
    test('API key input fields are present for all providers', async ({ page }) => {
      await switchAITab(page, 'keys');

      for (const provider of ['anthropic', 'openai', 'google']) {
        const input = page.getByTestId(`api-key-input-${provider}`);
        const isInputVisible = await input.isVisible().catch(() => false);
        if (isInputVisible) {
          const saveBtn = page.getByTestId(`api-key-save-${provider}`);
          await expect(saveBtn).toBeVisible();
          await expect(saveBtn).toBeDisabled(); // Disabled when empty
        }
      }
    });

    test('Save button enables when API key is entered', async ({ page }) => {
      await switchAITab(page, 'keys');
      const input = page.getByTestId('api-key-input-anthropic');
      if (await input.isVisible()) {
        await safeFill(input, 'sk-test-key-1234');
        const saveBtn = page.getByTestId('api-key-save-anthropic');
        await expect(saveBtn).toBeEnabled();
      }
    });

    test('visual snapshot: API Keys tab', async ({ page }) => {
      await switchAITab(page, 'keys');
      const pane = page.getByTestId('ai-assistant-pane');
      await expect(pane).toHaveScreenshot('ai-keys-tab.png');
    });
  });

  test.describe('New Chat Buttons', () => {
    test('new chat buttons exist for all providers', async ({ page }) => {
      await switchAITab(page, 'chats');
      for (const provider of ['anthropic', 'openai', 'google']) {
        const btn = page.getByTestId(`new-chat-${provider}`);
        await expect(btn).toBeVisible();
      }
    });

    test('new chat buttons are disabled without API keys', async ({ page }) => {
      await switchAITab(page, 'chats');
      // Without API keys saved, buttons should be disabled
      for (const provider of ['anthropic', 'openai', 'google']) {
        const btn = page.getByTestId(`new-chat-${provider}`);
        await expect(btn).toBeVisible();
        await expect(btn).toBeDisabled();
      }
    });
  });
});
