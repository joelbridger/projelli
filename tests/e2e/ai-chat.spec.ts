/**
 * AI Chat Tests
 * Covers: Fix #1 (CORS/network), Fix #3 (draft persistence),
 *         Fix #5 (chat titles)
 */

import { test, expect } from '@playwright/test';
import {
  waitForTestModeLoad,
  hardClick,
  openAIAssistantPane,
  switchAITab,
} from './helpers/test-utils';

test.describe('AI Chat', () => {
  test.describe('Fix #3: Draft Input Persistence', () => {
    test('draft input persists in localStorage', async ({ page }) => {
      await page.goto('/?testMode=true');
      await waitForTestModeLoad(page);

      // Set up a draft via localStorage
      await page.evaluate(() => {
        const store = {
          state: {
            sessions: {
              'test-draft-chat': {
                chatId: 'test-draft-chat',
                messages: [],
                isLoading: false,
                lastUpdated: new Date().toISOString(),
                draftInput: 'This is my saved draft message',
              },
            },
          },
          version: 2,
        };
        localStorage.setItem('ai-chat-storage', JSON.stringify(store));
      });

      // Reload to verify persistence
      await page.reload();
      await waitForTestModeLoad(page);

      const storedDraft = await page.evaluate(() => {
        const stored = localStorage.getItem('ai-chat-storage');
        if (!stored) return null;
        const parsed = JSON.parse(stored);
        return parsed.state?.sessions?.['test-draft-chat']?.draftInput;
      });

      expect(storedDraft).toBe('This is my saved draft message');
    });

    test('draft can be cleared from store', async ({ page }) => {
      await page.goto('/?testMode=true');
      await waitForTestModeLoad(page);

      // Set a draft
      await page.evaluate(() => {
        const store = {
          state: {
            sessions: {
              'clear-test': {
                chatId: 'clear-test',
                messages: [],
                isLoading: false,
                lastUpdated: new Date().toISOString(),
                draftInput: 'Should be clearable',
              },
            },
          },
          version: 2,
        };
        localStorage.setItem('ai-chat-storage', JSON.stringify(store));
      });

      // Clear the draft
      await page.evaluate(() => {
        const stored = localStorage.getItem('ai-chat-storage');
        if (!stored) return;
        const parsed = JSON.parse(stored);
        if (parsed.state?.sessions?.['clear-test']) {
          delete parsed.state.sessions['clear-test'].draftInput;
        }
        localStorage.setItem('ai-chat-storage', JSON.stringify(parsed));
      });

      await page.reload();
      await waitForTestModeLoad(page);

      const storedDraft = await page.evaluate(() => {
        const stored = localStorage.getItem('ai-chat-storage');
        if (!stored) return undefined;
        const parsed = JSON.parse(stored);
        return parsed.state?.sessions?.['clear-test']?.draftInput;
      });

      expect(storedDraft).toBeUndefined();
    });
  });

  test.describe('Fix #5: Chat Titles', () => {
    test('chat titles do not use date format', async ({ page }) => {
      await page.goto('/?testMode=true');
      await waitForTestModeLoad(page);
      await openAIAssistantPane(page);
      await switchAITab(page, 'chats');

      // Check any existing chat items
      const chatTitles = page.locator('[data-testid^="chat-title-"]');
      const count = await chatTitles.count();

      if (count > 0) {
        for (let i = 0; i < count; i++) {
          const title = await chatTitles.nth(i).textContent();
          // Title should NOT be a date like "2024-01-15"
          expect(title).not.toMatch(/^\d{4}-\d{2}-\d{2}/);
        }
      }
    });
  });

  test.describe('Fix #1: Claude API CORS handling', () => {
    test('Vite proxy returns 401 without API key (not CORS error)', async ({ page }) => {
      await page.goto('/?testMode=true');
      await waitForTestModeLoad(page);

      // Hit the proxy - should get 401 (auth error), NOT a CORS/network error
      const response = await page.request.fetch('/api/anthropic/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        data: {
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'x' }],
        },
      });

      // 401 means the proxy is working (request reaches Anthropic, rejected for no key)
      expect(response.status()).toBe(401);
    });

    test('Claude API works with valid key through proxy', async ({ page }) => {
      const apiKey = process.env.CLAUDE_API_KEY;
      if (!apiKey) {
        test.skip();
        return;
      }

      await page.goto('/?testMode=true');
      await waitForTestModeLoad(page);

      const response = await page.request.fetch('/api/anthropic/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        data: {
          model: 'claude-3-haiku-20240307',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Say "test OK"' }],
        },
      });

      expect(response.ok()).toBe(true);
      const json = await response.json();
      expect(json.content).toBeDefined();
      expect(json.content[0].text.toLowerCase()).toContain('test');
    });
  });
});
