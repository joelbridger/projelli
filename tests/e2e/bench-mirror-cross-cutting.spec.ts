/**
 * Browser mirror of the Windows bench smoke checklist's "Cross-cutting"
 * checks (scripts/bench-smoke/checks/crosscutting.mjs — see
 * docs/qa/E2E-SMOKE-MIRROR.md for the full mapping).
 *
 * Theme-cycle mechanics (default-light, the 3-state toggle) already have
 * deep coverage in tests/e2e/theme-system.spec.ts — this spec's light-theme
 * test instead mirrors the bench check's own shape: confirm no dark-theme
 * marker while navigating between the real surfaces (Client Map / Documents
 * / Settings) the bench check visits.
 *
 * The egress-indicator check's bench-side text search
 * ("outside connections are blocked") does not exist anywhere in the current
 * app copy — grepped src/locales/en.json and the TrustBar/EgressIndicator
 * source; that literal string belongs to a different feature entirely (the
 * per-client network-lockdown badge, ConfidentialityModeSettings.tsx). The
 * real, current local-only confirmation text is EgressIndicator's
 * `egress-indicator-label` ("Using local AI" / "Using cloud AI",
 * src/platform/privacy/ui/EgressIndicator.tsx) — asserted here instead.
 *
 * "Cloud AI (your account)" mode still resolves to a LOCAL engine
 * (resolveActiveAskProviderId, src/features/ask/askHelpers.ts: "no cloud key
 * -> the local engine") unless a cloud key is actually present, so a fake
 * Anthropic key is seeded via the same obfuscated-localStorage browser
 * fallback tests/e2e/api-keys-panel.spec.ts uses — never sent anywhere here.
 */

import { test, expect, type Page } from '@playwright/test';
import { hardClick, waitForTestModeLoad } from './helpers/test-utils';

async function isDarkTheme(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.classList.contains('dark') || root.getAttribute('data-theme') === 'dark';
  });
}

test.describe('Bench mirror: Cross-cutting', () => {
  test('cross-cutting-light-theme: no dark-theme marker while navigating Client Map / Documents / Settings', async ({ page }) => {
    await page.goto('/?testMode=true&seedDemo=1');
    await waitForTestModeLoad(page);
    expect(await isDarkTheme(page)).toBe(false);

    await hardClick(page.getByTestId('spine-nav-matters'));
    expect(await isDarkTheme(page)).toBe(false);

    await hardClick(page.getByTestId('matter-row-matter_demo_brennan'));
    await hardClick(page.getByTestId('hub-subtab-documents'));
    expect(await isDarkTheme(page)).toBe(false);

    await hardClick(page.getByTestId('settings-gear'));
    await expect(page.getByTestId('settings-content')).toBeVisible({ timeout: 10_000 });
    expect(await isDarkTheme(page)).toBe(false);
  });

  test('cross-cutting-console-errors: no console errors navigating Client Map / Documents / Settings', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });

    await page.goto('/?testMode=true&seedDemo=1');
    await waitForTestModeLoad(page);

    await hardClick(page.getByTestId('spine-nav-matters'));
    await hardClick(page.getByTestId('matter-row-matter_demo_brennan'));
    await hardClick(page.getByTestId('hub-subtab-documents'));
    await hardClick(page.getByTestId('hub-subtab-overview'));
    await hardClick(page.getByTestId('settings-gear'));
    await expect(page.getByTestId('settings-content')).toBeVisible({ timeout: 10_000 });

    expect(consoleErrors, `Console errors captured: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('cross-cutting-egress-indicator: Local-only mode flips the egress indicator, then reverts', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await page.evaluate(() => {
      localStorage.setItem('bos_key_anthropic', btoa('sk-ant-bench-mirror-fake-key'));
      localStorage.setItem(
        'bos_key_metadata',
        JSON.stringify([{ provider: 'anthropic', keyPrefix: 'sk-ant-b', addedAt: new Date().toISOString() }]),
      );
    });
    await page.reload();
    await waitForTestModeLoad(page);
    await hardClick(page.getByTestId('spine-nav-search'));

    const egressLabel = page.getByTestId('egress-indicator-label');
    await expect(egressLabel).toBeVisible({ timeout: 10_000 });

    await hardClick(page.getByTestId('settings-gear'));
    await hardClick(page.getByTestId('settings-category-ai-privacy'));
    await hardClick(page.getByTestId('confidentiality-mode-local-only'));
    await expect(page.getByTestId('confidentiality-local-active-note')).toBeVisible({ timeout: 10_000 });

    // settings-gear opens the full-page Settings surface here (no close X —
    // see SettingsContent.tsx's 'page' vs 'modal' variant comment); leave it
    // via the spine nav instead of trying to close a dialog.
    await hardClick(page.getByTestId('spine-nav-search'));
    await expect(egressLabel).toHaveText('Using local AI', { timeout: 10_000 });

    // Revert to the recommended default so this test doesn't leak state.
    await hardClick(page.getByTestId('settings-gear'));
    await hardClick(page.getByTestId('settings-category-ai-privacy'));
    await hardClick(page.getByTestId('confidentiality-mode-direct'));

    await hardClick(page.getByTestId('spine-nav-search'));
    await expect(egressLabel).toHaveText('Using cloud AI', { timeout: 10_000 });
  });
});
