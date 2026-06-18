/**
 * 15-onboarding — real first-run GuidedOnboarding path.
 *
 * This intentionally does NOT use app.bootToWorkspace(), because that helper
 * seeds localStorage and bypasses the first-run onboarding gate. The journey
 * starts from a fresh desktop profile, completes onboarding without adding an
 * AI key, then verifies the real headless blocker: workspace creation/opening
 * requires Tauri's native folder picker, which WebDriver cannot select from.
 */

export default {
  name: '15-onboarding',
  async run({ session }) {
    await session.newSession();

    // The underlying first-run workspace selector should paint immediately.
    await session.testid('workspace-selector-dialog', 30_000);
    await session.testid('welcome-dialog-pitch', 30_000);

    // App mounts GuidedOnboarding over the workspace selector after a short
    // first-run delay. The frame is the stable first-run root; individual
    // welcome copy is asserted as visible text because older blind specs used a
    // guessed step id here.
    await session.testid('guided-onboarding-frame', 45_000);
    await session.waitForBodyText('Your private intelligence layer', { timeoutMs: 15_000 });
    await session.testid('onboarding-next-welcome', 15_000);
    await session.clickTestid('onboarding-next-welcome', 15_000);

    await session.testid('onboarding-step-profession', 15_000);
    await session.waitForBodyText('What kind of work do you do?', { timeoutMs: 15_000 });
    await session.testid('profession-card-legal', 15_000);
    await session.clickTestid('profession-card-legal', 15_000);
    await session.clickTestid('onboarding-next-profession', 15_000);

    await session.testid('onboarding-step-identity', 15_000);
    await session.testid('onboarding-identity-name', 15_000);
    await session.testid('onboarding-identity-file', 15_000);
    await session.clickTestid('onboarding-identity-next', 15_000);

    await session.testid('onboarding-step-workspace', 15_000);
    await session.testid('workspace-choice-documents', 15_000);
    await session.clickTestid('onboarding-workspace-next', 15_000);

    await session.testid('onboarding-step-trust', 15_000);
    await session.testid('onboarding-trust-open-data-map', 15_000);
    await session.clickTestid('onboarding-data-continue', 15_000);

    await session.testid('onboarding-step-ai-key', 15_000);
    await session.testid('ai-setup-step', 15_000);
    await session.testid('ai-path-own-account', 15_000);
    await session.testid('ai-path-local', 15_000);
    await session.clickTestid('ai-path-later', 15_000);

    await session.testid('onboarding-step-email', 20_000);
    await session.testid('email-tab-m365', 15_000);
    await session.testid('email-connect-later', 15_000);
    await session.clickTestid('onboarding-email-continue', 15_000);

    await session.testid('onboarding-step-firm', 15_000);
    await session.waitForBodyText('How do you practice?', { timeoutMs: 15_000 });
    await session.testid('firm-option-create', 15_000);
    await session.testid('firm-option-join', 15_000);
    await session.testid('firm-option-solo', 15_000);
    await session.testid('onboarding-firm-continue', 15_000);
    await session.clickTestid('firm-solo-skip', 15_000);

    await session.testid('onboarding-step-done', 15_000);
    await session.testid('onboarding-samples-toggle', 15_000);
    await session.testid('onboarding-done-no-ai-note', 15_000);
    await session.clickTestid('onboarding-done-confirm', 15_000);

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
