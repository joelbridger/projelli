/**
 * API key management tests.
 *
 * Lantern 3.0 moved key management out of the old AI Assistant "Keys" tab.
 * The current path is Settings -> AI -> Manage AI Account Keys,
 * backed by the ApiKeyManager dialog and the add-key wizard.
 */

import { test, expect, type Page } from '@playwright/test';
import { hardClick, safeFill, waitForTestModeLoad } from './helpers/test-utils';

const PROVIDERS = ['anthropic', 'openai', 'google'] as const;

async function clearBrowserKeys(page: Page) {
  await page.evaluate((providers) => {
    for (const provider of providers) {
      localStorage.removeItem(`apiKey_${provider}`);
      localStorage.removeItem(`bos_key_${provider}`);
    }
    localStorage.removeItem('bos_key_metadata');
    localStorage.removeItem('lantern_apikeys_migrated_v1');
  }, PROVIDERS);
}

async function seedStoredKey(page: Page, provider: (typeof PROVIDERS)[number], key: string) {
  await page.evaluate(
    ({ provider: p, key: k }) => {
      localStorage.setItem(`bos_key_${p}`, btoa(k));
      const existing = JSON.parse(localStorage.getItem('bos_key_metadata') ?? '[]') as Array<{
        provider: string;
        keyPrefix: string;
        addedAt: string;
      }>;
      const next = existing.filter((entry) => entry.provider !== p);
      next.push({
        provider: p,
        keyPrefix: k.slice(0, 8),
        addedAt: new Date().toISOString(),
      });
      localStorage.setItem('bos_key_metadata', JSON.stringify(next));
    },
    { provider, key }
  );
}

async function openApiKeyManager(page: Page) {
  await hardClick(page.getByTestId('settings-gear'));
  await expect(page.getByTestId('settings-page')).toBeVisible();

  await hardClick(page.getByTestId('settings-category-ai'));
  const apiKeysSetting = page.getByTestId('setting-manageApiKeys');
  await expect(apiKeysSetting).toBeVisible();
  await hardClick(apiKeysSetting.getByRole('button', { name: 'Manage AI Account Keys' }));

  await expect(page.getByTestId('api-key-manager')).toBeVisible();
}

test.describe('API key management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await clearBrowserKeys(page);
    await page.reload();
    await waitForTestModeLoad(page);
  });

  test('Settings exposes the Manage AI Account Keys action', async ({ page }) => {
    await hardClick(page.getByTestId('settings-gear'));
    await expect(page.getByTestId('settings-page')).toBeVisible();

    await hardClick(page.getByTestId('settings-category-ai'));
    const apiKeysSetting = page.getByTestId('setting-manageApiKeys');
    await expect(apiKeysSetting).toBeVisible();
    await expect(apiKeysSetting).toContainText('AI Account Keys');
    await expect(apiKeysSetting.getByRole('button', { name: 'Manage AI Account Keys' })).toBeVisible();
  });

  test('empty manager shows an add-key path', async ({ page }) => {
    await openApiKeyManager(page);

    await expect(page.getByTestId('api-key-manager-empty')).toBeVisible();
    await expect(page.getByTestId('api-key-manager-empty')).toContainText('No provider keys saved yet');
    await expect(page.getByTestId('api-key-manager-add')).toBeVisible();
  });

  test('add-key wizard lists the current provider choices', async ({ page }) => {
    await openApiKeyManager(page);
    await hardClick(page.getByTestId('api-key-manager-add'));

    await expect(page.getByTestId('api-key-wizard')).toBeVisible();
    await expect(page.getByTestId('api-key-wizard-provider-anthropic')).toContainText('Anthropic');
    await expect(page.getByTestId('api-key-wizard-provider-openai')).toContainText('OpenAI');
    await expect(page.getByTestId('api-key-wizard-provider-google')).toContainText('Google AI');
    await expect(page.getByTestId('api-key-wizard-provider-ollama')).toContainText('Ollama');
  });

  test('wizard enables Save key after a key is entered', async ({ page }) => {
    await openApiKeyManager(page);
    await hardClick(page.getByTestId('api-key-manager-add'));

    await hardClick(page.getByRole('button', { name: 'Next' }));
    await expect(page.getByTestId('api-key-wizard-step-2')).toBeVisible();
    await hardClick(page.getByRole('button', { name: 'Next' }));
    await expect(page.getByTestId('api-key-wizard-step-3')).toBeVisible();

    const submit = page.getByTestId('api-key-wizard-submit');
    await expect(submit).toBeDisabled();
    await safeFill(page.getByTestId('api-key-wizard-input'), 'sk-ant-test-1234567890');
    await expect(submit).toBeEnabled();
  });

  test('saved keys render as manager rows with unverified status and actions', async ({ page }) => {
    await clearBrowserKeys(page);
    await seedStoredKey(page, 'anthropic', 'sk-ant-0123456789abcXYZ');
    await page.reload();
    await waitForTestModeLoad(page);

    await openApiKeyManager(page);

    const row = page.getByTestId('api-key-manager-row-anthropic');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Anthropic (Claude)');
    await expect(row).toContainText('sk-ant-0');
    await expect(page.getByTestId('api-key-manager-status-unverified')).toBeVisible();
    await expect(page.getByTestId('api-key-manager-check-anthropic')).toBeVisible();
    await expect(page.getByTestId('api-key-manager-remove-anthropic')).toBeVisible();
  });

  test('Remove deletes a saved key and returns the manager to empty state', async ({ page }) => {
    await clearBrowserKeys(page);
    await seedStoredKey(page, 'google', 'AIzaSyTESTxxxxxxx');
    await page.reload();
    await waitForTestModeLoad(page);

    await openApiKeyManager(page);
    await hardClick(page.getByTestId('api-key-manager-remove-google'));

    // Removal goes through the in-app ConfirmDialog, not native
    // window.confirm() (ApiKeyManager.tsx: native confirm is dead and
    // returns a truthy object in the Tauri WebView2 build) — confirm there.
    const confirmRemove = page
      .getByRole('alertdialog', { name: 'Remove key' })
      .getByRole('button', { name: 'Remove' });
    await hardClick(confirmRemove);

    await expect(page.getByTestId('api-key-manager-row-google')).toHaveCount(0);
    await expect(page.getByTestId('api-key-manager-empty')).toBeVisible();
  });
});
