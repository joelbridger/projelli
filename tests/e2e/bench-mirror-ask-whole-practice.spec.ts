/**
 * Browser mirror of the Windows bench smoke checklist's Wave 4 Track C check
 * (scripts/bench-smoke/checks/wave4.mjs: wave4-whole-practice-ask — see
 * docs/qa/E2E-SMOKE-MIRROR.md for the full mapping).
 *
 * The scope toggle (src/features/ask/ScopeToggle.tsx) and the cross-client
 * consent gate (src/features/ask/chat/FileAccessConsentBanner.tsx) are both
 * pure client-side UI switches — no AI provider call is needed to reach or
 * assert them, so this is fully drivable without a live/mocked AI backend.
 * Read-only: this spec never grants/denies the consent gate, matching the
 * bench check's own read-only default.
 *
 * The consent gate only ever renders for a CLOUD provider
 * (FileAccessConsentBanner.tsx: `if (!effectiveProvider || ... ||
 * isLocalProviderId(effectiveProvider)) return null`). With no provider key
 * configured, resolveActiveAskProviderId() (src/features/ask/askHelpers.ts)
 * correctly falls back to a LOCAL engine ("no cloud key -> the local
 * engine"), so the gate has nothing to show. A fake Anthropic key is seeded
 * via the same obfuscated-localStorage browser fallback
 * tests/e2e/api-keys-panel.spec.ts already uses (KeychainService.ts's
 * `bos_key_<provider>` / `bos_key_metadata` keys) so the resolver picks a
 * cloud provider — the key is never sent anywhere in this spec.
 */

import { test, expect, type Page } from '@playwright/test';
import { hardClick, waitForTestModeLoad } from './helpers/test-utils';

async function seedFakeAnthropicKey(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem('bos_key_anthropic', btoa('sk-ant-bench-mirror-fake-key'));
    localStorage.setItem(
      'bos_key_metadata',
      JSON.stringify([{ provider: 'anthropic', keyPrefix: 'sk-ant-b', addedAt: new Date().toISOString() }]),
    );
  });
}

test.describe('Bench mirror: Wave 4 Track C — whole-practice Ask + consent gate', () => {
  test('wave4-whole-practice-ask: scope pill switches and the consent gate appears when required', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await seedFakeAnthropicKey(page);
    await page.reload();
    await waitForTestModeLoad(page);

    await hardClick(page.getByTestId('spine-nav-search'));

    const scopeOption = page.getByTestId('scope-option-whole-practice');
    await expect(scopeOption).toBeVisible({ timeout: 10_000 });
    await hardClick(scopeOption);

    const scopePill = page.getByTestId('ask-scope-pill');
    await expect(scopePill).toBeVisible({ timeout: 10_000 });
    await expect(scopePill).toHaveText('Book Overview');

    // Read-only: the consent gate only appears un-asked once per session, so
    // a fresh test-mode session should show it now that whole-practice scope
    // (a cross-client scope) is active. Not granted/denied here.
    await hardClick(page.getByTestId('ask-answer-scope-chip'));
    const answerScopePopover = page.getByTestId('ask-answer-scope-popover');
    await expect(answerScopePopover).toBeVisible({ timeout: 10_000 });
    await expect(answerScopePopover.getByTestId('chat-file-access-consent')).toBeVisible({ timeout: 10_000 });
  });
});
