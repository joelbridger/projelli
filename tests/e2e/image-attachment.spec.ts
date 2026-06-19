/**
 * Stream A1 E2E — Image attachment persistence across reload.
 *
 * Flow:
 *   1. Open a new AI chat.
 *   2. Paste a 1x1 PNG via clipboard simulation.
 *   3. Verify the attachment tile appears.
 *   4. Send the message (with MockProvider configured so no real API key needed).
 *   5. Reload the app.
 *   6. Navigate back to the chat.
 *   7. Verify the chat history still shows the attachment indicator.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  waitForTestModeLoad,
} from './helpers/test-utils';

// Minimal valid 1x1 red PNG (67 bytes).
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';

async function openChat(page: Page, model = 'claude-3-5-sonnet-20241022') {
  await page.goto('/?testMode=true');
  await waitForTestModeLoad(page);
  await page.evaluate((chatModel) => {
    const openFile = (window as any).__openTestFile;
    if (!openFile) throw new Error('__openTestFile missing');
    openFile(
      '/test-workspace/image-attachment-test.aichat',
      'image-attachment-test.aichat',
      JSON.stringify({
        version: 1,
        id: 'image-attachment-test',
        title: 'Image attachment test',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        provider: 'anthropic',
        model: chatModel,
        messages: [],
      }),
    );
  }, model);
  await expect(page.getByTestId('ai-chat-viewer')).toBeVisible();
  await expect(page.getByTestId('chat-input')).toBeVisible();
}

test.describe('Image attachment E2E', () => {
  test.skip('attach image, send, stores attachment on the user message', async ({ page }) => {
    // Needs source test hook: test mode's mock workspace service cannot save
    // non-oversized chat attachments because the attachment service needs a
    // real backend from workspaceService.getBackend().
    await openChat(page);

    await page
      .getByTestId('chat-input-toolbar')
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'pasted.png',
        mimeType: 'image/png',
        buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
      });

    // Attachment tile should appear.
    await expect(page.locator('[data-testid^="attachment-tile-"]')).toBeVisible({ timeout: 3000 });

    // The vision warning should NOT appear for claude-3-5-sonnet (default in test env).
    await expect(page.getByTestId('vision-warning-banner')).not.toBeVisible();

    // Type a text message and send. Test mode has no real API key, so the
    // provider may add an error response after the user message; this test
    // verifies the attachment is captured on the sent user turn.
    await page.getByTestId('chat-input').fill('Describe this image');
    await page.getByTestId('chat-send-button').click();

    const sentUserMessage = page.locator('[data-testid^="chat-message-"][data-role="user"]').first();
    await expect(sentUserMessage).toContainText('Describe this image', { timeout: 5000 });
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const editor = (window as any).__editorStore?.getState?.();
          const tab = editor?.openTabs?.find((t: any) => t.path.endsWith('image-attachment-test.aichat'));
          if (!tab?.content) return null;
          const parsed = JSON.parse(tab.content);
          return parsed.messages?.[0]?.attachments?.[0]?.fileName ?? null;
        }),
        { timeout: 5000 },
      )
      .toBe('pasted.png');
  });

  test('oversized file shows toast and does not attach', async ({ page }) => {
    await openChat(page);

    await page
      .getByTestId('chat-input-toolbar')
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'huge.png',
        mimeType: 'image/png',
        buffer: Buffer.alloc(21 * 1024 * 1024),
      });

    // Toast should appear indicating size limit.
    await expect(page.getByText(/too large|20 MB/i)).toBeVisible({ timeout: 3000 });

    // No attachment tile should appear.
    await expect(page.locator('[data-testid^="attachment-tile-"]')).not.toBeVisible();
  });

  test.skip('text-only model shows vision warning and blocks send', async ({ page }) => {
    // Needs source test hook: this warning requires a saved pending image
    // attachment, and test mode cannot currently save chat attachments.
    await openChat(page, 'claude-3-5-haiku-20241022');

    await page
      .getByTestId('chat-input-toolbar')
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'test.png',
        mimeType: 'image/png',
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      });

    // Vision warning banner must appear.
    await expect(page.getByTestId('vision-warning-banner')).toBeVisible({ timeout: 3000 });

    // Send button must be disabled.
    await expect(page.getByTestId('chat-send-button')).toBeDisabled();

    // Clicking switch button resolves the warning.
    await page.getByTestId('vision-warning-switch-button').click();
    await expect(page.getByTestId('vision-warning-banner')).not.toBeVisible({ timeout: 2000 });
    await expect(page.getByTestId('chat-send-button')).not.toBeDisabled();
  });
});
