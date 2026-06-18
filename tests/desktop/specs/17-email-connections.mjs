/**
 * 17-email-connections — L2-real desktop coverage for local email surfaces.
 *
 * The browser mail fixture is intentionally off in the real Tauri app. This
 * covers what is observable locally: empty Email state, compose dialog behavior,
 * Account -> Connections rendering, per-provider panel isolation, and the
 * OAuth handoff boundary. Real OAuth + import belongs to the live L3 harnesses
 * (`gmail_live_import` / `outlook_live_import`), so this spec blocks honestly
 * once the app reaches the browser sign-in handoff.
 */

function textButtonXpath(app, text) {
  return `//button[normalize-space()=${app.xpathLiteral(text)}]`;
}

export default {
  name: '17-email-connections',
  async run({ session, workspace, app }) {
    await app.bootToWorkspace(session, { workspacePath: workspace });

    await app.gotoSurface(session, 'Email');
    await session.testid('no-accounts-state', 30_000);
    await session.waitForBodyText('No email connected', { timeoutMs: 15_000 });
    await session.waitForBodyText('Connect your email', { timeoutMs: 15_000 });

    await session.clickTestid('compose-btn', 15_000);
    await session.testid('compose-close', 15_000);
    await session.testid('compose-no-accounts', 15_000);
    await session.typeTestid('compose-to', 'test@example.com', 10_000);
    await session.typeTestid('compose-subject', 'Layer 2 desktop compose smoke', 10_000);
    await session.typeTestid('compose-body', 'This draft stays local and is never sent.', 10_000);
    await session.execute(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`,
    );
    await session.waitFor(
      async (s) => !(await s.hasTestid('compose-close', 500)),
      { timeoutMs: 10_000, intervalMs: 500, label: 'compose modal closed by Escape' },
    );

    await session.clickTestid('account-identity', 15_000);
    await session.testid('account-window', 15_000);
    await session.clickTestid('account-tab-connections', 15_000);

    await session.waitForBodyText('Microsoft 365 email', { timeoutMs: 20_000 });
    await session.waitForBodyText('Gmail (native)', { timeoutMs: 20_000 });
    await session.find('xpath', textButtonXpath(app, 'Connect Microsoft 365'), 15_000);
    await session.find('xpath', textButtonXpath(app, 'Connect Gmail'), 15_000);

    const microsoftConnect = await session.find('xpath', textButtonXpath(app, 'Connect Microsoft 365'), 15_000);
    await session.click(microsoftConnect);
    const handoff = await session.waitFor(
      async (s) => {
        const text = await s.bodyText();
        if (text.includes('Waiting for sign-in in your browser')) return 'waiting';
        if (text.includes('Something went wrong:')) return 'error';
        return false;
      },
      { timeoutMs: 10_000, intervalMs: 500, label: 'Microsoft 365 OAuth handoff or error' },
    );

    if (handoff === 'error') {
      throw new Error(
        'BLOCKED: Microsoft 365 OAuth did not reach the browser handoff in this local desktop run; needs live OAuth desktop configuration/sign-in. Real auth and import are covered by the L3 `outlook_live_import` harness.',
      );
    }

    // Provider isolation: starting Microsoft OAuth must not flip Gmail's panel
    // into its waiting/connected state. The real panels keep separate provider
    // progress, and Gmail should remain independently connectable here.
    await session.find('xpath', textButtonXpath(app, 'Connect Gmail'), 10_000);
    const body = await session.bodyText();
    if (body.includes('Waiting for Google sign-in in your browser')) {
      throw new Error('Gmail panel leaked Microsoft OAuth waiting state.');
    }

    throw new Error(
      'BLOCKED: needs live OAuth credentials/browser sign-in and the L3 live harnesses (`gmail_live_import` / `outlook_live_import`) to complete provider auth and real mail import.',
    );
  },
};
