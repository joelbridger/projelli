/**
 * 15-onboarding — real first-run OnboardingV2 path.
 *
 * Updated 2026-06-30: the old 9-step GuidedOnboarding was retired in favor of
 * the 4-step OnboardingV2 (intro -> AI -> connect -> firm setup), which
 * FirstRunOverlay now renders unconditionally.
 *
 * This intentionally does NOT use app.bootToWorkspace(), because that helper
 * seeds localStorage and bypasses the first-run onboarding gate. The journey
 * starts from a fresh desktop profile, completes onboarding without resolving
 * the AI step (mirrors "decide later"), then verifies the real headless
 * blocker: workspace creation/opening requires Tauri's native folder picker,
 * which WebDriver cannot select from.
 */

export default {
  name: '15-onboarding',
  async run({ session }) {
    await session.newSession();

    // The underlying first-run workspace selector should paint immediately.
    await session.testid('workspace-selector-dialog', 30_000);
    await session.testid('welcome-dialog-pitch', 30_000);

    // App mounts OnboardingV2 over the workspace selector after a short
    // first-run delay. "onboarding-v2" is the stable shell root for every
    // scene; "onboarding-v2-intro" is the first scene's content.
    await session.testid('onboarding-v2', 45_000);
    await session.testid('onboarding-v2-intro', 15_000);
    await session.waitForBodyText('A private AI that knows your clients.', { timeoutMs: 15_000 });
    await session.testid('onboarding-v2-go', 15_000);
    await session.clickTestid('onboarding-v2-go', 15_000);

    // Scene 1 — Connect your AI. Leave it unresolved (no key, no local
    // download) so Continue marks AI setup deferred, mirroring the old
    // spec's "decide later" path.
    await session.testid('onboarding-v2-ai', 15_000);
    await session.waitForBodyText('1. Connect your AI', { timeoutMs: 15_000 });
    await session.testid('ai-card-cloud', 15_000);
    await session.testid('ai-card-local', 15_000);
    await session.clickTestid('onboarding-v2-continue', 15_000);

    // Scene 2 — Securely connect your data. The real connector cards mount;
    // leave everything unconnected and continue.
    await session.testid('onboarding-v2-connect', 15_000);
    await session.waitForBodyText('2. Securely connect your data', { timeoutMs: 15_000 });
    await session.testid('connect-m365', 15_000);
    await session.testid('connect-onedrive', 15_000);
    await session.testid('connect-wealthbox', 15_000);
    await session.clickTestid('onboarding-v2-continue', 15_000);

    // Scene 3 — Setting up your firm (live setup-progress bars). The last
    // scene's Continue button reads "Continue to the app" and completes
    // onboarding directly (no separate "Done" step).
    await session.testid('onboarding-v2-firm', 15_000);
    await session.waitForBodyText('3. Setting up your firm', { timeoutMs: 15_000 });
    await session.clickTestid('onboarding-v2-continue', 15_000);

    // On a real desktop first run, completing onboarding leaves the user at the
    // workspace selector until they choose or create a folder. Both available
    // controls call @tauri-apps/plugin-dialog.open(), which opens a native
    // folder picker outside the WebDriver-controlled webview. Other desktop
    // specs use app.seedReadyState()/app.bootToWorkspace() to bypass this.
    await session.testid('workspace-selector-dialog', 30_000);
    await session.testid('open-existing-workspace', 15_000);
    await session.testid('new-workspace', 15_000);

    if (await session.hasTestid('spine-nav', 5_000)) {
      await session.testid('status-bar', 15_000);
      await session.testid('documents-toolbar', 15_000);
      return;
    }

    throw new Error(
      'BLOCKED: needs a headless way to satisfy Tauri native folder selection after first-run onboarding. ' +
      'The real controls data-testid="open-existing-workspace" and data-testid="new-workspace" call the OS folder picker, ' +
      'which WebDriver cannot choose from; app.seedReadyState()/app.bootToWorkspace() is the bypass used by non-onboarding specs.',
    );
  },
};
