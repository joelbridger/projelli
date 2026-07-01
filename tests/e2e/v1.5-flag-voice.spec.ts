/**
 * v1.5 Flag 4 — Voice input (M6) + Ollama (Q7) — E2E smoke tests
 *
 * Scope:
 *   1. Settings → Voice category renders with the schema-driven rows
 *      (enable toggle, transcription model select).
 *   2. The VoiceSettingsSection status pill resolves to "Sidecar missing"
 *      in this harness because no binary is bundled at dev/CI time
 *      (the `VOICE_SIDECAR_URL` repo variable isn't pinned yet per M6).
 *   3. The voice-model-select schema row is present.
 *
 * The full voice-capture + press-to-talk flow (MediaRecorder, 16 kHz WAV
 * encoding, Tauri `transcribe_audio` round-trip, insert-at-cursor, save-to-
 * Inbox/) is covered by:
 *   - `tests/unit/voice-capture.test.ts` (14 tests)
 *   - `tests/unit/press-to-talk.test.tsx`
 *   - `src-tauri/src/commands/voice.rs#tests` (8 Rust tests)
 *
 * The PressToTalkIndicator isn't mounted in the browser test build because
 * voice requires the Tauri runtime — confirming its presence under a real
 * desktop install is the dogfood step, not an E2E concern.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick } from './helpers/test-utils';

test.describe('v1.5 Flag 4 — Voice input', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('Settings → Voice category shows the VoiceSettingsSection status pill', async ({ page }) => {
    await hardClick(page.getByTestId('settings-gear'));
    await expect(page.getByTestId('settings-page')).toBeVisible();

    const voiceCat = page.getByTestId('settings-category-voice');
    await expect(voiceCat).toBeVisible();
    await hardClick(voiceCat);

    // The status pill resolves asynchronously via voice_sidecar_available.
    // In dev / browser mode the Tauri invoke bridge returns falsy, so the
    // pill should settle on `missing`. We accept `checking` transiently.
    const status = page.getByTestId('voice-status');
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute(
      'data-status',
      /^(checking|missing|denied|ready)$/
    );

    // Eventually it should land on `missing` in this CI harness (no
    // binary bundled). Allow up to 5s for the async probe to resolve.
    await expect(status).toHaveAttribute('data-status', /^(missing|denied)$/, {
      timeout: 5_000,
    });
  });

  test('Voice schema rows render (enable toggle + model select)', async ({ page }) => {
    await hardClick(page.getByTestId('settings-gear'));
    await hardClick(page.getByTestId('settings-category-voice'));

    // The schema rows use `setting-<key>` testids per SettingsModal's
    // SettingRow helper. We verify the two concrete rows that matter
    // for voice: the enable toggle and the transcription model select.
    await expect(page.getByTestId('setting-voiceEnabled')).toBeVisible();
    await expect(page.getByTestId('setting-voiceModel')).toBeVisible();
  });
});
