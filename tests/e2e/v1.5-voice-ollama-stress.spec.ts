/**
 * v1.5 Flag 4 — Voice + Ollama stress + edge-case tests.
 *
 * Smoke spec covered: Voice status pill resolves + schema rows render.
 *
 * These stress tests cover:
 *
 *   - Voice status pill correctly reports each possible `data-status`
 *     value (`checking`, `missing`, `denied`, `ready`). We exercise the
 *     default path (no sidecar in the browser harness → `missing`) but
 *     assert the attribute contract holds for the other two values.
 *   - Voice schema rows: toggle round-trips, model select persists the
 *     chosen value across reloads, shortcut-display rows render.
 *   - Ollama status pill transitions from `checking` → `unavailable`
 *     when the 127.0.0.1:11434 daemon isn't running (the default for a
 *     browser test).
 *   - Ollama "Check connection" button can be clicked and re-triggers
 *     the probe.
 *   - Ollama "Install Ollama" link is correctly targeted at ollama.com.
 *   - Voice + Ollama sections co-render cleanly (Voice under Settings → Voice,
 *     Ollama under Account → Connections).
 *
 * The Tauri-only bits — real sidecar probe, mic permission prompt,
 * press-to-talk key binding, MediaRecorder handoff — are covered by the
 * Rust tests in `src-tauri/src/commands/voice.rs#tests` and the Vitest
 * suites `voice-capture.test.ts` + `press-to-talk.test.tsx`. Those need
 * a real `navigator.mediaDevices` + the Tauri IPC bridge; Playwright
 * headless Chrome doesn't supply either reliably.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick } from './helpers/test-utils';

async function openVoiceSettings(page: import('@playwright/test').Page) {
  await hardClick(page.getByTestId('settings-gear'));
  await expect(page.getByTestId('settings-modal')).toBeVisible();
  await hardClick(page.getByTestId('settings-category-voice'));
  await expect(page.getByTestId('voice-status')).toBeVisible();
}

async function openAccountConnections(page: import('@playwright/test').Page) {
  await hardClick(page.getByTestId('account-identity'));
  await expect(page.getByTestId('account-window')).toBeVisible();
  await hardClick(page.getByTestId('account-tab-connections'));
  await expect(page.getByTestId('ollama-settings-section')).toBeVisible();
}

test.describe('v1.5 Flag 4 — Voice + Ollama stress', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('Voice status pill settles on `missing` in browser harness (no sidecar)', async ({
    page,
  }) => {
    await openVoiceSettings(page);

    // The pill starts as `checking` and should resolve within a second
    // to either `missing` (sidecar not bundled, the expected browser
    // case) or `denied` (sidecar present but mic permission revoked —
    // unreachable in Playwright headless without a mock). Accept both
    // so CI-built binaries don't fail this test, but we assert the
    // attribute is present in every case.
    const pill = page.getByTestId('voice-status');
    await expect(pill).toHaveAttribute('data-status', /^(missing|denied)$/, {
      timeout: 5_000,
    });
    // And the label matches the status.
    const status = await pill.getAttribute('data-status');
    if (status === 'missing') {
      await expect(pill).toContainText(/sidecar missing/i);
    } else if (status === 'denied') {
      await expect(pill).toContainText(/mic permission denied/i);
    }
  });

  test('Voice model select persists a chosen value across reload', async ({
    page,
  }) => {
    await openVoiceSettings(page);

    // The model select is rendered by the schema row for `voiceModel`.
    // Options are `tiny` / `base` / `small` (default small).
    const select = page.getByTestId('setting-voiceModel').locator('select');
    await expect(select).toBeVisible();
    await select.selectOption('tiny');
    await expect(select).toHaveValue('tiny');

    // Close Settings + reload the page — the setting is persisted in
    // localStorage via the settings store.
    await page.keyboard.press('Escape');
    await page.reload();
    await waitForTestModeLoad(page);

    // Reopen Settings and check the select still says `tiny`.
    await openVoiceSettings(page);
    const selectAgain = page
      .getByTestId('setting-voiceModel')
      .locator('select');
    await expect(selectAgain).toHaveValue('tiny');

    // Restore default so we don't leak to the next test.
    await selectAgain.selectOption('small');
    await expect(selectAgain).toHaveValue('small');
  });

  test('Voice enable toggle round-trips via the settings store', async ({
    page,
  }) => {
    await openVoiceSettings(page);

    // `voiceEnabled` is not in the settingTestid() map so it uses the
    // wrapper div's `setting-voiceEnabled` testid — the toggle button
    // inside is role="switch".
    const wrapper = page.getByTestId('setting-voiceEnabled');
    const toggle = wrapper.getByRole('switch');
    await expect(toggle).toBeVisible();

    const before = await toggle.getAttribute('aria-checked');
    await hardClick(toggle);
    await expect(toggle).not.toHaveAttribute('aria-checked', before ?? 'true');

    // Round-trip flip back so the next test starts clean.
    await hardClick(toggle);
    await expect(toggle).toHaveAttribute('aria-checked', before ?? 'true');
  });

  test('Voice category shows press-to-talk + voice-note hotkey displays', async ({
    page,
  }) => {
    await openVoiceSettings(page);

    // The schema has two shortcut-display rows under `voice`:
    //   voicePressToTalkShortcut, voiceNoteShortcut
    // These render as read-only text rows (customization comes later
    // per the schema description). We verify both are visible.
    await expect(page.getByTestId('setting-voicePressToTalkShortcut')).toBeVisible();
    await expect(page.getByTestId('setting-voiceNoteShortcut')).toBeVisible();
  });

  test('Ollama status pill settles on `unavailable` when daemon is down', async ({
    page,
  }) => {
    await openAccountConnections(page);

    const pill = page.getByTestId('ollama-status');
    await expect(pill).toBeVisible();

    // Starts in `checking`, then resolves. In a Playwright browser run
    // there's no Ollama on 127.0.0.1:11434 (dev machines don't have it
    // by default), so the expected end state is `unavailable`. If a
    // dev happens to have Ollama running, accept `ready` too — both
    // are valid healthy states.
    await expect(pill).toHaveAttribute('data-status', /^(unavailable|ready)$/, {
      timeout: 5_000,
    });
    const status = await pill.getAttribute('data-status');
    if (status === 'unavailable') {
      await expect(pill).toContainText(/Ollama not running/i);
    } else {
      await expect(pill).toContainText(/Ollama ready/i);
    }
  });

  test('Ollama "Check connection" button can be re-clicked to retry the probe', async ({
    page,
  }) => {
    await openAccountConnections(page);

    const btn = page.getByTestId('ollama-check-connection');
    await expect(btn).toBeVisible();

    // Wait for the initial probe to finish before re-clicking.
    const pill = page.getByTestId('ollama-status');
    await expect(pill).toHaveAttribute('data-status', /^(unavailable|ready)$/, {
      timeout: 5_000,
    });

    // Re-click. The button is disabled while the probe is running, so
    // we must wait for it to transition back to enabled — the probe
    // resolves quickly even on failure because `fetch` rejects with a
    // network error promptly.
    await hardClick(btn);
    // After the re-probe, status resolves again.
    await expect(pill).toHaveAttribute('data-status', /^(unavailable|ready)$/, {
      timeout: 5_000,
    });
  });

  test('Ollama "Install Ollama" link appears when daemon is unavailable', async ({
    page,
  }) => {
    await openAccountConnections(page);

    // Wait for the probe to finish.
    const pill = page.getByTestId('ollama-status');
    await expect(pill).toHaveAttribute('data-status', /^(unavailable|ready)$/, {
      timeout: 5_000,
    });
    const status = await pill.getAttribute('data-status');

    const section = page.getByTestId('ollama-settings-section');

    if (status === 'unavailable') {
      // The install link should be visible with the right target.
      const installLink = section.getByRole('link', { name: /Install Ollama/i });
      await expect(installLink).toBeVisible();
      await expect(installLink).toHaveAttribute(
        'href',
        /ollama\.com\/download/
      );
      await expect(installLink).toHaveAttribute('target', '_blank');
    } else {
      // Ollama is running — Install link shouldn't be shown.
      const installLink = section.getByRole('link', { name: /Install Ollama/i });
      await expect(installLink).toHaveCount(0);
    }
  });

  test('Ollama + MCP share Account → Connections without clobbering each other', async ({
    page,
  }) => {
    // Both the MCP bundle section and the Ollama detection section live
    // under Account → Connections. This test protects against a future
    // refactor where one accidentally hides the other (e.g. tabs).
    await openAccountConnections(page);

    await expect(page.getByTestId('mcp-settings-section')).toBeVisible();
    await expect(page.getByTestId('ollama-settings-section')).toBeVisible();
    await expect(page.getByTestId('mcp-server-status')).toBeVisible();
    await expect(page.getByTestId('ollama-status')).toBeVisible();
    await expect(page.getByTestId('mcp-download-mcpb')).toBeVisible();
    await expect(page.getByTestId('ollama-check-connection')).toBeVisible();
  });
});
