/**
 * S06 — Settings → API keys
 *
 * Goal: AI Assistant "Keys" tab showing Anthropic + OpenAI + Gemini rows,
 * Anthropic with a masked key (sk-ant-a••••••••3xQ), OpenAI also masked.
 *
 * Approach: seed localStorage with fake keys before page load so the
 * useApiKeys hook reads them on mount. Then interact to open the AI
 * assistant sidebar and switch to the Keys tab.
 */

import { captureStill } from '../lib/capture-still';
import type { Page } from 'playwright';

// Fake keys that render as realistic masks via maskKey():
//   'sk-ant-api03-abcde3xQ' → sk-ant-a••••••••3xQ
//   'sk-projUSER8aB'        → sk-proj••••••••8aB
const FAKE_ANTHROPIC_KEY = 'sk-ant-api03-abcdefghijk3xQ';
const FAKE_OPENAI_KEY = 'sk-projUSERKEYFAKE8aB';

async function beforeShot(page: Page): Promise<void> {
  // 1. Switch sidebar to the AI Assistant tab.
  await page.click('[data-testid="sidebar-tab-ai-assistant"]');

  // 2. Wait for the AI Assistant pane to mount.
  await page.waitForSelector('[data-testid="ai-tab-keys"]', { timeout: 5000 });

  // 3. Click the "Keys" tab.
  await page.click('[data-testid="ai-tab-keys"]');

  // 4. Wait for at least the Anthropic key row to be visible.
  await page.waitForSelector('[data-testid="api-key-row-anthropic"]', { timeout: 5000 });

  // 5. Settle — the masked input reads from existingKey which comes from the
  //    apiKeys prop set up by useApiKeys (loaded from localStorage on mount).
  await page.waitForTimeout(300);
}

export async function shot06() {
  return captureStill({
    shotKey: 'apiKeys',
    outputName: 'screenshot-06-api-keys.png',
    pressKit: true,
    viewport: { width: 1280, height: 800 },
    windowTitle: 'Linterly — Keepance',
    localStorageSeed: {
      apiKey_anthropic: FAKE_ANTHROPIC_KEY,
      apiKey_openai: FAKE_OPENAI_KEY,
    },
    beforeShot,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  shot06().then((p) => console.log(`✓ ${p}`));
}
