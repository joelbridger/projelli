/**
 * API Keys Panel tests (UX-08)
 *
 * The Keys sub-tab of the AI Assistant pane must render all three supported
 * providers simultaneously. Each row exposes:
 *   - Provider label (getProviderLabel)
 *   - "Get key" external link (api-key-get-link-<provider>)
 *   - Input + Save button when no key is saved
 *   - Masked display + Test + Clear when saved
 *   - Status chip ("Not tested" / "Valid" / "Invalid")
 *
 * Uses ?testMode=true so we land in the main UI without going through the
 * workspace selector.
 */

import { test, expect } from '@playwright/test';
import {
  waitForTestModeLoad,
  hardClick,
  safeFill,
  openAIAssistantPane,
  switchAITab,
} from './helpers/test-utils';

const PROVIDERS = ['anthropic', 'openai', 'google'] as const;

test.describe('API Keys Panel (UX-08)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    // Clear any leftover keys from prior runs in the same worker.
    await page.evaluate(() => {
      ['anthropic', 'openai', 'google'].forEach((p) => {
        localStorage.removeItem(`apiKey_${p}`);
      });
    });
    await page.reload();
    await waitForTestModeLoad(page);
    await openAIAssistantPane(page);
    await switchAITab(page, 'keys');
  });

  test('all three providers render simultaneously', async ({ page }) => {
    for (const provider of PROVIDERS) {
      const row = page.getByTestId(`api-key-row-${provider}`);
      await expect(row).toBeVisible();
    }
  });

  test('each provider has a "Get key" link', async ({ page }) => {
    for (const provider of PROVIDERS) {
      const link = page.getByTestId(`api-key-get-link-${provider}`);
      await expect(link).toBeVisible();
      await expect(link).toBeEnabled();
      await expect(link).toContainText('Get key');
    }
  });

  test('each provider has an input field before a key is saved', async ({ page }) => {
    for (const provider of PROVIDERS) {
      const input = page.getByTestId(`api-key-input-${provider}`);
      await expect(input).toBeVisible();
      const save = page.getByTestId(`api-key-save-${provider}`);
      await expect(save).toBeVisible();
      await expect(save).toBeDisabled();
    }
  });

  test('entering a key enables the Save button', async ({ page }) => {
    const provider = 'anthropic';
    const input = page.getByTestId(`api-key-input-${provider}`);
    await safeFill(input, 'sk-ant-test-1234567');
    const save = page.getByTestId(`api-key-save-${provider}`);
    await expect(save).toBeEnabled();
  });

  test('saved key shows masked display and Test + Clear buttons', async ({ page }) => {
    // Seed a saved key directly so we don't hit the network during tests.
    await page.evaluate(() => {
      localStorage.setItem('apiKey_anthropic', 'sk-ant-0123456789abcXYZ');
    });
    await page.reload();
    await waitForTestModeLoad(page);
    await openAIAssistantPane(page);
    await switchAITab(page, 'keys');

    const masked = page.getByTestId('api-key-masked-anthropic');
    await expect(masked).toBeVisible();
    // Value should be first 7 chars + dots + last 3 chars. We only pin the
    // structure to stay resilient to small tweaks in the mask helper.
    const maskedValue = await masked.inputValue();
    expect(maskedValue).toContain('sk-ant-');
    expect(maskedValue).toContain('XYZ');
    expect(maskedValue).toContain('•');

    await expect(page.getByTestId('api-key-test-anthropic')).toBeVisible();
    await expect(page.getByTestId('api-key-clear-anthropic')).toBeVisible();
    await expect(page.getByTestId('api-key-status-anthropic')).toBeVisible();
  });

  test('status chip shows "Not tested" by default for saved keys', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('apiKey_openai', 'sk-abcdefghijklmnop');
    });
    await page.reload();
    await waitForTestModeLoad(page);
    await openAIAssistantPane(page);
    await switchAITab(page, 'keys');
    const status = page.getByTestId('api-key-status-openai');
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute('data-status', 'untested');
  });

  test('Clear button removes the saved key and restores the input', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('apiKey_google', 'AIzaSyTESTxxxxxxx');
    });
    await page.reload();
    await waitForTestModeLoad(page);
    await openAIAssistantPane(page);
    await switchAITab(page, 'keys');

    const clear = page.getByTestId('api-key-clear-google');
    await hardClick(clear);

    // Input should reappear, masked display should be gone.
    await expect(page.getByTestId('api-key-input-google')).toBeVisible();
    await expect(page.getByTestId('api-key-masked-google')).toHaveCount(0);
  });
});
