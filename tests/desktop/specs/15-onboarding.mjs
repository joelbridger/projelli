/**
 * 15-onboarding — first-run JourneyHost onboarding path (new 8-chapter flow).
 *
 * This intentionally does NOT use app.bootToWorkspace(), because that helper
 * seeds localStorage and bypasses the first-run onboarding gate. The journey
 * starts from a fresh desktop profile and walks the full 8-chapter flow.
 *
 * Ch3 requires a native folder picker (Tauri plugin-dialog) which WebDriver
 * cannot interact with. The spec clicks ch3-choose-folder to open it, then
 * waits: if the native dialog is resolved by the test environment it will
 * proceed; otherwise the spec notes the limitation and continues from the
 * fallback path (chapter-continue without a chosen folder is blocked by
 * Ch3's canAdvance gate, so the spec skips to the workspace selector step).
 */

export default {
  name: '15-onboarding',
  async run({ session }) {
    await session.newSession();

    // The underlying first-run workspace selector should paint immediately.
    await session.testid('workspace-selector-dialog', 30_000);

    // App mounts JourneyHost over the workspace selector after a short
    // first-run delay. Ch1 is the welcome chapter.
    await session.testid('ch1-root', 45_000);

    // Ch1 — Welcome: click Continue
    await session.clickTestid('chapter-continue', 15_000);

    // Ch2 — About You: pick profession + enter name, then continue
    await session.testid('ch2-root', 15_000);
    await session.clickTestid('ch2-profession-legal', 15_000);
    // Type a display name into ch2-display-name
    const nameInput = await session.testid('ch2-display-name', 10_000);
    if (nameInput) {
      await nameInput.type('Test Attorney');
    }
    await session.clickTestid('chapter-continue', 15_000);

    // Ch3 — Files Stay Home: open folder picker (may block on native dialog)
    await session.testid('ch3-root', 15_000);
    await session.clickTestid('ch3-choose-folder', 10_000);
    // On a real desktop, the native folder picker opens here. We check if the
    // chosen-path indicator appears (it does when a folder is selected). If
    // not, we proceed to the workspace selector fallback below.
    const folderChosen = await session.hasTestid('ch3-chosen-path', 8_000);
    if (folderChosen) {
      await session.clickTestid('chapter-continue', 15_000);

      // Ch4 — Meet the AI: informational, just continue
      await session.testid('ch4-root', 15_000);
      await session.clickTestid('chapter-continue', 15_000);

      // Ch5 — Choose Your Brain: click "Set up later" then wrap continue
      await session.testid('ch5-root', 15_000);
      await session.clickTestid('ch5-card-later', 15_000);
      await session.testid('ch5-wrap-continue', 15_000);
      await session.clickTestid('ch5-wrap-continue', 15_000);

      // Ch6 — Email: skip connecting
      await session.testid('ch6-root', 20_000);
      await session.clickTestid('ch6-connect-later', 15_000);

      // Ch7 — Solo or Firm: solo is default, just continue
      await session.testid('ch7-root', 15_000);
      await session.clickTestid('chapter-continue', 15_000);

      // Ch8 — See It Work (final chapter): verify samples toggle, then finish
      await session.testid('ch8-root', 15_000);
      await session.testid('ch8-samples-toggle', 15_000);
      await session.clickTestid('chapter-continue', 15_000);

      // After onboarding completes, the overlay closes and the user is left
      // at their workspace (or the workspace selector if no folder was open).
      if (await session.hasTestid('spine-nav', 10_000)) {
        await session.testid('status-bar', 15_000);
        return;
      }
    }

    // If we reach here, either Ch3's native picker blocked or we ended up
    // back at the workspace selector. That is the expected outcome on a real
    // desktop first run when Tauri's native folder picker can't be automated.
    await session.testid('workspace-selector-dialog', 30_000);
    await session.testid('open-existing-workspace', 15_000);
    await session.testid('new-workspace', 15_000);

    if (await session.hasTestid('spine-nav', 5_000)) {
      await session.testid('status-bar', 15_000);
      await session.testid('documents-toolbar', 15_000);
      return;
    }

    throw new Error(
      'BLOCKED: Ch3 requires Tauri native folder selection (ch3-choose-folder -> OS dialog) ' +
      'which WebDriver cannot interact with. ' +
      'The real controls data-testid="open-existing-workspace" and data-testid="new-workspace" ' +
      'are visible but call the OS folder picker. ' +
      'Use app.seedReadyState()/app.bootToWorkspace() for specs that need a workspace.',
    );
  },
};
