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

import { test, expect } from '@playwright/test';

// Minimal valid 1x1 red PNG (67 bytes).
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';

test.describe('Image attachment E2E', () => {
  test('paste image, send, reload, history persists with attachment', async ({ page }) => {
    await page.goto('/');

    // Navigate to AI Assistant and create a new chat.
    await page.getByTestId('sidebar-link-ai-assistant').click();
    await page.getByTestId('new-chat-button').click();
    await expect(page.getByTestId('chat-input')).toBeVisible();

    // Simulate paste event with image clipboard data.
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/png' });
      const file = new File([blob], 'pasted.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true });
      document.querySelector('[data-testid="chat-input-toolbar"]')!.dispatchEvent(event);
    }, TINY_PNG_BASE64);

    // Attachment tile should appear.
    await expect(page.locator('[data-testid^="attachment-tile-"]')).toBeVisible({ timeout: 3000 });

    // The vision warning should NOT appear for claude-3-5-sonnet (default in test env).
    await expect(page.getByTestId('vision-warning-banner')).not.toBeVisible();

    // Type a text message and send.
    await page.getByTestId('chat-input').fill('Describe this image');
    await page.getByTestId('chat-send-button').click();

    // Wait for response bubble to appear (mock provider responds fast).
    await expect(page.locator('.chat-message-bubble').last()).toBeVisible({ timeout: 10000 });

    // Capture chat title from breadcrumb or header for navigation after reload.
    const chatTitle = await page.getByTestId('chat-header-title').textContent();

    // Reload the app.
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Re-open the same chat.
    if (chatTitle) {
      await page.getByText(chatTitle).first().click();
    }

    // The user message with the attachment should appear in history.
    // Check for an attachment indicator (tile or icon) in the chat history.
    await expect(
      page.locator('[data-testid^="history-attachment-"]').first()
    ).toBeVisible({ timeout: 5000 });
  });

  test('oversized file shows toast and does not attach', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('sidebar-link-ai-assistant').click();
    await page.getByTestId('new-chat-button').click();

    // Create a 21 MB fake PNG file and drop it.
    await page.evaluate(() => {
      const oversized = new File([new ArrayBuffer(21 * 1024 * 1024)], 'huge.png', {
        type: 'image/png',
      });
      const dt = new DataTransfer();
      dt.items.add(oversized);
      const event = new DragEvent('drop', { dataTransfer: dt, bubbles: true });
      document.querySelector('[data-testid="chat-input-toolbar"]')!.dispatchEvent(event);
    });

    // Toast should appear indicating size limit.
    await expect(page.getByText(/too large|20 MB/i)).toBeVisible({ timeout: 3000 });

    // No attachment tile should appear.
    await expect(page.locator('[data-testid^="attachment-tile-"]')).not.toBeVisible();
  });

  test('text-only model shows vision warning and blocks send', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('sidebar-link-ai-assistant').click();
    await page.getByTestId('new-chat-button').click();

    // Switch the chat to claude-3-5-haiku (text-only).
    // This assumes the model picker is accessible via testid; adjust if different.
    await page.getByTestId('chat-model-picker').click();
    await page.getByText('claude-3-5-haiku').click();

    // Paste a tiny PNG.
    await page.evaluate(async () => {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const blob = new Blob([bytes], { type: 'image/png' });
      const file = new File([blob], 'test.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true });
      document.querySelector('[data-testid="chat-input-toolbar"]')!.dispatchEvent(event);
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
