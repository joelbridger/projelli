/**
 * Guided onboarding AI setup tests.
 *
 * The old main-panel "add your API key" card is no longer part of the
 * reachable 3.0 flow. The live onboarding route is the full-screen guided
 * setup, where the AI setup step offers own-account, local, and later paths.
 */

import { test, expect, type Page } from '@playwright/test';
import { hardClick, safeFill, waitForTestModeLoad } from './helpers/test-utils';

async function openAiSetupStep(page: Page) {
  await page.goto('/?testMode=true&forceOnboarding=true');
  await waitForTestModeLoad(page);

  await expect(page.getByTestId('onboarding-step-welcome')).toBeVisible({ timeout: 15_000 });
  await hardClick(page.getByTestId('onboarding-next-welcome'));

  await expect(page.getByTestId('onboarding-step-profession')).toBeVisible();
  await hardClick(page.getByTestId('profession-card-legal'));
  await hardClick(page.getByTestId('onboarding-next-profession'));

  await expect(page.getByTestId('onboarding-step-identity')).toBeVisible();
  await hardClick(page.getByTestId('onboarding-identity-next'));

  await expect(page.getByTestId('onboarding-step-workspace')).toBeVisible();
  await expect(page.getByTestId('workspace-choice-documents')).toBeVisible();
  await hardClick(page.getByTestId('onboarding-workspace-next'));

  await expect(page.getByTestId('onboarding-step-trust')).toBeVisible();
  await hardClick(page.getByTestId('onboarding-data-continue'));

  await expect(page.getByTestId('onboarding-step-ai-key')).toBeVisible();
  await expect(page.getByTestId('ai-setup-step')).toBeVisible();
}

test.describe('Guided onboarding AI setup', () => {
  test('AI setup step shows the three current setup paths', async ({ page }) => {
    await openAiSetupStep(page);

    await expect(page.getByTestId('ai-path-own-account')).toBeVisible();
    await expect(page.getByTestId('ai-path-own-account')).toContainText('Connect your AI provider account');
    await expect(page.getByTestId('ai-path-local')).toBeVisible();
    await expect(page.getByTestId('ai-path-local')).toContainText('Keep everything on your computer');
    await expect(page.getByTestId('ai-path-later')).toBeVisible();
    await expect(page.getByTestId('ai-path-later')).toContainText('Skip for now');
  });

  test('own-account path exposes provider tabs and key-entry guidance', async ({ page }) => {
    await openAiSetupStep(page);
    await hardClick(page.getByTestId('ai-path-own-account'));

    await expect(page.getByTestId('ai-provider-tab-anthropic')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('ai-provider-tab-openai')).toContainText('OpenAI');
    await expect(page.getByTestId('ai-provider-tab-google')).toContainText('Gemini');
    await expect(page.getByTestId('ai-open-console-anthropic')).toBeVisible();
    await expect(page.getByTestId('ai-get-key-step-anthropic-1')).toBeVisible();

    const save = page.getByTestId('ai-setup-save-key');
    await expect(save).toBeDisabled();
    await safeFill(page.getByTestId('ai-setup-key-input'), 'sk-ant-test-1234567890');
    await expect(save).toBeEnabled();
  });

  test('skip-for-now path advances onboarding without blocking setup', async ({ page }) => {
    await openAiSetupStep(page);
    await hardClick(page.getByTestId('ai-path-later'));

    await expect(page.getByTestId('onboarding-step-email')).toBeVisible();
    const deferred = await page.evaluate(() => localStorage.getItem('keepance_ai_setup_deferred'));
    expect(deferred).toBe('true');
  });
});
