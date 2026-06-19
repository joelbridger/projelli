/**
 * v1.5 multi-feature integration flows.
 *
 * These tests weave together the four flags so we catch regressions that
 * only show up at the seams. They deliberately use testMode (no real
 * provider calls) and drive the UI via the same testids the flag specs
 * use, so any UI rename that breaks a flag spec will also break the
 * relevant integration flow here.
 *
 *   1. Founder flow: Settings → add fact → Workflows → ClientIntakeSynthesizer
 *      (template exists in the picker). The real run needs a live provider
 *      which the harness doesn't have, so we stop at "interview renders".
 *
 *   2. Memory-aware Settings: open Memory settings, add a fact, open
 *      Account → Connections, switch back, verify fact survives.
 *
 *   3. MCP settings co-render with Memory: open Account → Connections,
 *      switch to Memory, add a fact, switch back to Account → Connections,
 *      verify MCP + Ollama sections both still render.
 *
 *   4. Cross-category search: with the settings search box filtering,
 *      switch between categories and confirm the search term persists
 *      across category changes (or does not, depending on design — we
 *      verify the observable behaviour so a change shows up as a failing
 *      test that needs triage).
 *
 *   5. Voice + Memory in the same Settings session: switch categories
 *      repeatedly without losing state. This is the long-tail "Settings
 *      shell" bug: any change to `activeCategory` should not remount
 *      sibling sections in a way that clears their fetch state.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick, openSidebarTab, openAIAssistantPane } from './helpers/test-utils';

async function openSettingsModal(page: import('@playwright/test').Page) {
  await hardClick(page.getByTestId('settings-gear'));
  await expect(page.getByTestId('settings-modal')).toBeVisible();
}

async function showMemorySettings(page: import('@playwright/test').Page) {
  if (!(await page.getByTestId('settings-modal').isVisible().catch(() => false))) {
    await openSettingsModal(page);
  }
  await hardClick(page.getByTestId('settings-category-ai-privacy'));
  await hardClick(page.getByTestId('subheader-memory-heading'));
  await expect(page.getByTestId('settings-facts-section')).toBeVisible();
}

async function showVoiceSettings(page: import('@playwright/test').Page) {
  if (!(await page.getByTestId('settings-modal').isVisible().catch(() => false))) {
    await openSettingsModal(page);
  }
  await hardClick(page.getByTestId('settings-category-voice'));
  await hardClick(page.getByTestId('subheader-voice-input-heading'));
  await expect(page.getByTestId('voice-status')).toBeVisible();
}

async function openAccountConnections(page: import('@playwright/test').Page) {
  if (await page.getByTestId('settings-modal').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-modal')).not.toBeVisible();
  }
  await hardClick(page.getByTestId('account-identity'));
  await expect(page.getByTestId('account-window')).toBeVisible();
  await hardClick(page.getByTestId('account-tab-connections'));
  await expect(page.getByTestId('mcp-settings-section')).toBeVisible();
  await expect(page.getByTestId('ollama-settings-section')).toBeVisible();
}

async function closeAccountWindow(page: import('@playwright/test').Page) {
  if (await page.getByTestId('account-window').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('account-window')).not.toBeVisible();
  }
}

test.describe('v1.5 multi-feature integration flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('founder flow: Settings → add fact → Workflows → ClientIntakeSynthesizer picker opens', async ({
    page,
  }) => {
    // Step 1: open Settings and add a fact that represents "my practice
    // context" — the sort of durable memory an attorney would seed before
    // running a workflow.
    await showMemorySettings(page);
    const input = page.getByTestId('settings-facts-add-input');
    const marker = `founder-flow-${Date.now()}`;
    await input.fill(`${marker} — I'm building a local-first AI workspace`);
    await hardClick(page.getByTestId('settings-facts-add'));
    await expect(page.getByTestId('settings-facts-table')).toContainText(marker);

    // Step 2: close Settings.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-modal')).not.toBeVisible();

    // Step 3: open the Workflows surface. In 3.0 this is already the full picker.
    await openSidebarTab(page, 'workflows');

    const showAll = page.getByRole('button', { name: /Show all/i });
    if (await showAll.isVisible().catch(() => false)) {
      await hardClick(showAll);
    }

    // Step 4: Verify the ClientIntakeSynthesizer template exists in the picker
    // — this is the legal workflow the practice flow description targets.
    await expect(page.getByText('Client Intake Synthesizer')).toBeVisible({
      timeout: 5_000,
    });

    // Step 5: The marker fact should still be in Settings (no "whole-app
    // remount" side effects).
    await openSettingsModal(page);
    await showMemorySettings(page);
    await expect(page.getByTestId('settings-facts-table')).toContainText(marker);
  });

  test('adding a fact survives category switches within Settings', async ({
    page,
  }) => {
    await showMemorySettings(page);

    const input = page.getByTestId('settings-facts-add-input');
    const marker = `cross-cat-${Date.now()}`;
    await input.fill(`${marker} survives category switching`);
    await hardClick(page.getByTestId('settings-facts-add'));
    await expect(page.getByTestId('settings-facts-table')).toContainText(marker);

    // MCP/Ollama moved from Settings to Account → Connections in 3.0.
    await openAccountConnections(page);
    await closeAccountWindow(page);

    await showVoiceSettings(page);

    await showMemorySettings(page);
    await expect(page.getByTestId('settings-facts-table')).toContainText(marker);
  });

  test('Account Connections re-renders correctly after switching to Memory and back', async ({
    page,
  }) => {
    await openAccountConnections(page);

    // Wait for the initial Ollama probe.
    await expect(page.getByTestId('ollama-status')).toHaveAttribute(
      'data-status',
      /^(unavailable|ready)$/,
      { timeout: 5_000 }
    );

    // Switch away to Memory in Settings.
    await closeAccountWindow(page);
    await showMemorySettings(page);

    // Switch back to Connections. The probe should re-run (or the cached
    // result should re-render) and BOTH sections must remount cleanly.
    await openAccountConnections(page);
    await expect(page.getByTestId('mcp-settings-section')).toBeVisible();
    await expect(page.getByTestId('ollama-settings-section')).toBeVisible();
    await expect(page.getByTestId('mcp-server-status')).toBeVisible();
    await expect(page.getByTestId('ollama-status')).toBeVisible();
  });

  test('rapid category switch does not strand the Ollama probe in `checking`', async ({
    page,
  }) => {
    // Scenario: user flicks through 5 categories rapidly. The Ollama
    // section's useEffect fires a probe each time it mounts — if the
    // probe isn't cancelled on unmount, the previous run could setState
    // on the new mount's state. The symptom would be a pill stuck on
    // "checking" until the next mount.
    await openSettingsModal(page);
    await hardClick(page.getByTestId('settings-category-workspace'));
    await hardClick(page.getByTestId('settings-category-ai-privacy'));
    await hardClick(page.getByTestId('subheader-memory-heading'));
    await hardClick(page.getByTestId('settings-category-voice'));
    await closeAccountWindow(page);
    await openAccountConnections(page);

    // Finally land on Account → Connections. The pill must settle to a non-
    // "checking" value within 5s (just like a fresh mount).
    await expect(page.getByTestId('ollama-status')).toHaveAttribute(
      'data-status',
      /^(unavailable|ready)$/,
      { timeout: 5_000 }
    );
  });

  test('AI Assistant and Settings can coexist (open AI pane, then open Settings)', async ({
    page,
  }) => {
    // This guards against a z-index / focus-trap regression where
    // opening Settings while the AI Assistant pane is visible would hide
    // the pane or misdirect focus.
    await openAIAssistantPane(page);

    await openSettingsModal(page);

    // Close Settings with Escape. The AI Assistant pane should still be
    // mounted (sidebar tab state preserved).
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-modal')).not.toBeVisible();
    await expect(page.getByTestId('ai-chat-viewer')).toBeVisible();
  });

  test('add three facts and confirm they all survive Settings close + reopen', async ({
    page,
  }) => {
    // Multi-fact durability check — similar to the stress-test case
    // but specifically framed as an integration flow: do multiple
    // facts correctly round-trip when the user takes a detour to
    // another Settings category?
    await showMemorySettings(page);

    const markers: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const m = `integration-${Date.now()}-${i}`;
      markers.push(m);
      await page.getByTestId('settings-facts-add-input').fill(m);
      await hardClick(page.getByTestId('settings-facts-add'));
      await expect(page.getByTestId('settings-facts-table')).toContainText(m);
    }

    // Visit Account → Connections briefly, then back to Memory.
    await openAccountConnections(page);
    await closeAccountWindow(page);
    await showMemorySettings(page);

    // All three facts still present.
    for (const m of markers) {
      await expect(page.getByTestId('settings-facts-table')).toContainText(m);
    }

    // Close and reopen Settings entirely.
    await page.keyboard.press('Escape');
    await showMemorySettings(page);
    for (const m of markers) {
      await expect(page.getByTestId('settings-facts-table')).toContainText(m);
    }
  });
});
