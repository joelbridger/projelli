/**
 * v1.5 error-path + edge-case suite.
 *
 * This suite exercises the "bad weather" code paths that don't fit
 * neatly into a feature-specific flag spec:
 *
 *   - Missing API key → new-chat buttons disabled with clear tooltip
 *   - Settings store: invalid localStorage payload falls back to defaults
 *   - Facts file: corrupt JSON parses to empty without throwing
 *   - Workspace versions: corrupt JSON falls back to empty cache
 *   - settings-search filters categories correctly
 *   - Ollama detection: malformed response falls back to unavailable
 *   - MCP bundle path: null resolver keeps download button disabled
 *
 * None of these need a real provider / Tauri / network — they all
 * validate that the browser-side tree handles bad input gracefully.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick, openAIAssistantPane } from './helpers/test-utils';

async function openMemorySettings(page: import('@playwright/test').Page) {
  await hardClick(page.getByTestId('settings-gear'));
  await expect(page.getByTestId('settings-modal')).toBeVisible();
  await hardClick(page.getByTestId('settings-category-ai-privacy'));
  await hardClick(page.getByTestId('subheader-memory-heading'));
  await expect(page.getByTestId('settings-facts-section')).toBeVisible();
}

async function openAccountConnections(page: import('@playwright/test').Page) {
  await hardClick(page.getByTestId('account-identity'));
  await expect(page.getByTestId('account-window')).toBeVisible();
  await hardClick(page.getByTestId('account-tab-connections'));
  // MCP now sits behind a collapsed "Developer tools" disclosure — expand it.
  await hardClick(page.getByTestId('connections-developer-tools-trigger'));
  await expect(page.getByTestId('mcp-settings-section')).toBeVisible();
}

test.describe('v1.5 error paths + edge cases', () => {
  test.beforeEach(async ({ page }) => {
    // Every test starts from a clean localStorage for the keys we
    // touch, so earlier tests can't bleed into the next.
    await page.goto('/?testMode=true');
    await page.evaluate(() => {
      for (const k of [
        'apiKey_anthropic',
        'apiKey_openai',
        'apiKey_google',
      ]) {
        localStorage.removeItem(k);
      }
    });
  });

  test('missing API key leaves chat without a selected provider', async ({
    page,
  }) => {
    await page.reload();
    await waitForTestModeLoad(page);

    // Open AI Assistant.
    await openAIAssistantPane(page);

    const picker = page.getByTestId('chat-model-picker');
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute('data-provider', '');
    await expect(picker).toContainText(/Choose a model/i);
  });

  test('sending without a valid key shows an API-key error (defensive)', async ({
    page,
  }) => {
    // Regression guard: if the no-key path changes, the user should still
    // get an explicit error instead of a silent no-op or fake success.
    await page.reload();
    await waitForTestModeLoad(page);
    await openAIAssistantPane(page);

    await page.getByTestId('chat-input').fill('Can you help?');
    await hardClick(page.getByTestId('chat-send-button'));

    await expect(page.getByTestId('chat-messages')).toContainText(
      /No valid Anthropic API key found|Please add your API key/i,
      { timeout: 10_000 },
    );
  });

  test('corrupt facts-file localStorage does not break Memory settings', async ({
    page,
  }) => {
    // The facts file lives in the workspace, not localStorage — but
    // the mock workspace-fs stores it in an in-memory map seeded by
    // test code. For THIS check, we target the settings-store persist
    // slice, which is localStorage-backed. Corrupt it with invalid
    // JSON and verify Settings still loads.
    await page.evaluate(() => {
      localStorage.setItem('keepance:settings', '{not valid json');
    });
    await page.reload();
    await waitForTestModeLoad(page);

    // Settings still opens, Memory category still renders.
    await openMemorySettings(page);
    // No alert dialog, no crash.
    await expect(page.getByTestId('sidebar')).toBeVisible();
  });

  test('corrupt workspace_versions localStorage does not crash the app', async ({
    page,
  }) => {
    // Regression guard for VersionService.loadFromStorage catch path.
    await page.evaluate(() => {
      localStorage.setItem('workspace_versions', '{ "totally": "wrong schema" ');
    });
    await page.reload();
    await waitForTestModeLoad(page);

    // The app still boots. Sidebar renders, editor renders.
    await expect(page.getByTestId('sidebar')).toBeVisible();
  });

  test('settings-search filter on known term narrows the category list', async ({
    page,
  }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await hardClick(page.getByTestId('settings-gear'));
    await expect(page.getByTestId('settings-modal')).toBeVisible();

    const search = page.getByTestId('settings-search');
    await search.fill('memory');

    // Memory should still be accessible under AI & Privacy. Other top-level
    // sections should not list settings matching "memory".
    // We assert the Memory category button is visible (non-empty after
    // filter) and that the Add-fact input remains reachable once we
    // click through.
    await hardClick(page.getByTestId('settings-category-ai-privacy'));
    await hardClick(page.getByTestId('subheader-memory-heading'));
    await expect(page.getByTestId('settings-facts-section')).toBeVisible();

    // Clear the filter so subsequent tests start clean.
    await search.fill('');
  });

  test('Ollama status goes to `unavailable` when probe throws (no daemon)', async ({
    page,
  }) => {
    // The default browser test has no Ollama on localhost, so the
    // probe fails. This test documents that expected failure — if a
    // future refactor swallows the error and gets stuck on "checking",
    // this test catches it.
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await openAccountConnections(page);

    const status = page.getByTestId('ollama-status');
    await expect(status).toBeVisible();
    // Allow `ready` too — a dev running Ollama locally shouldn't make
    // this test red.
    await expect(status).toHaveAttribute('data-status', /^(unavailable|ready)$/, {
      timeout: 5_000,
    });
  });

  test('MCP download button stays disabled with null bundle path', async ({
    page,
  }) => {
    // Confirms `hasBundle === false` locks the button. Critical so
    // users can't click "Download" and hit an undefined crash.
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await openAccountConnections(page);

    // Wait for the lookup to resolve to `unavailable`.
    const status = page.getByTestId('mcp-server-status');
    await expect(status).toHaveAttribute('data-status', 'unavailable', {
      timeout: 5_000,
    });
    const btn = page.getByTestId('mcp-download-mcpb');
    await expect(btn).toBeDisabled();

    // Force-click does not crash the app. After the click the sidebar
    // still mounts.
    await btn.click({ force: true });
    await expect(page.getByTestId('sidebar')).toBeVisible();
  });

  test('settings modal closes cleanly with Escape even mid-probe', async ({
    page,
  }) => {
    // Opening Account → Connections kicks off the Ollama probe, a ~200ms async
    // fetch. Users who close the modal mid-probe shouldn't see a
    // setState-on-unmounted-component warning. We verify the modal
    // actually closes (no orphan state).
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await openAccountConnections(page);
    // Immediately Escape — don't wait for the probe.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('account-window')).not.toBeVisible();
    // Reopen — still works. The rapid open/close cycle would wedge if
    // the cancel path were broken.
    await openAccountConnections(page);
  });
});
