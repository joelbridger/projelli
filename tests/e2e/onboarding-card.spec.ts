/**
 * Onboarding API key setup card tests (UX-04)
 *
 * When a user lands in a workspace without any AI keys configured, the main
 * panel should surface a prominent "Next step: add your AI key" card. The
 * card must:
 *   1. Appear in the main panel when: rootPath is set AND no API keys exist
 *      AND no tab is open AND it hasn't been dismissed this session.
 *   2. Clicking "Add API key" jumps to AI Assistant → Keys sub-tab.
 *   3. Clicking the dismiss X hides the card for the rest of the session
 *      (sessionStorage-backed, so page reload brings it back).
 *
 * Uses ?testMode=true which seeds a mock workspace but no API keys.
 */

import { test, expect } from '@playwright/test';
import {
  waitForTestModeLoad,
  hardClick,
} from './helpers/test-utils';

test.describe('API key setup card (UX-04)', () => {
  test.beforeEach(async ({ page }) => {
    // Start from a clean slate: no API keys, no dismissal flag. Each fresh
    // browser context already starts clean, but be explicit.
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await page.evaluate(() => {
      // Remove any leftover keys from previous tests in the same worker
      ['anthropic', 'openai', 'google'].forEach((p) => {
        localStorage.removeItem(`apiKey_${p}`);
      });
      sessionStorage.removeItem('keepance:apiKeyCardDismissed');
    });
    // Soft reload to make the app pick up the cleared state
    await page.reload();
    await waitForTestModeLoad(page);

    // Test mode pre-opens two demo tabs; close them so the MainPanel is in
    // its "no file open" slot where the API key card renders.
    await page.evaluate(() => {
      const store = (window as unknown as {
        __editorStore?: { getState: () => { openTabs: { path: string }[]; closeTab: (p: string) => void } };
      }).__editorStore;
      if (!store) return;
      const state = store.getState();
      const paths = state.openTabs.map((t) => t.path);
      for (const p of paths) {
        state.closeTab(p);
      }
    });
  });

  test('card is visible in the main panel when no API keys are set', async ({ page }) => {
    const card = page.getByTestId('api-key-setup-card');
    await expect(card).toBeVisible();

    // The card's primary CTA
    const cta = page.getByTestId('api-key-setup-card-cta');
    await expect(cta).toBeVisible();
    await expect(cta).toBeEnabled();
    await expect(cta).toHaveText(/Add API key/);
  });

  test('clicking "Add API key" opens AI Assistant on the Keys sub-tab', async ({ page }) => {
    const cta = page.getByTestId('api-key-setup-card-cta');
    await hardClick(cta);

    // Sidebar should switch to AI Assistant
    const aiSidebarTab = page.getByTestId('sidebar-tab-ai-assistant');
    await expect(aiSidebarTab).toHaveAttribute('aria-selected', 'true');

    // The Keys sub-tab inside AI Assistant should now be active
    const keysSubTab = page.getByTestId('ai-tab-keys');
    await expect(keysSubTab).toBeVisible();
    // The help button only renders on the Keys sub-tab, so its visibility
    // pins that we're on the right sub-tab.
    await expect(page.getByTestId('api-key-help-button')).toBeVisible();
  });

  test('dismissing the card hides it for the rest of the session', async ({ page }) => {
    const card = page.getByTestId('api-key-setup-card');
    await expect(card).toBeVisible();

    const dismiss = page.getByTestId('api-key-setup-card-dismiss');
    await hardClick(dismiss);

    // Card should disappear immediately
    await expect(card).not.toBeVisible();

    // Navigating away and back should NOT bring it back (session-scoped)
    const searchTab = page.getByTestId('sidebar-tab-search');
    await hardClick(searchTab);
    const filesTab = page.getByTestId('sidebar-tab-files');
    await hardClick(filesTab);
    await expect(card).not.toBeVisible();

    // Verify the sessionStorage flag was set
    const flag = await page.evaluate(() =>
      sessionStorage.getItem('keepance:apiKeyCardDismissed')
    );
    expect(flag).toBe('true');
  });
});
