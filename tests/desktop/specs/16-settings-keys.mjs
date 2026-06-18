const WORKSPACE_NAME = 'settings-keys-workspace';
const INVALID_WIZARD_KEY = 'definitely-not-a-real-anthropic-key';
const SEEDED_BAD_KEY = 'sk-ant-api03-desktop-persistence-bad-key';

export default {
  name: '16-settings-keys',
  async run({ session, workspace, app }) {
    await bootToWorkspaceWithOptionalKeyFixture(session, workspace, app);

    await app.gotoSurface(session, 'Settings');
    await session.testid('settings-content', 30_000);
    await session.clickTestid('settings-category-ai-privacy', 15_000);
    await session.testid('section-ai-privacy', 15_000);
    await session.testid('subheader-ai', 15_000);
    await session.testid('setting-manageApiKeys', 15_000);

    await openApiKeyManager(session, app);
    await session.testid('api-key-manager', 15_000);
    await session.testid('api-key-manager-empty', 15_000);

    await session.clickTestid('api-key-manager-add', 10_000);
    await session.testid('api-key-wizard', 15_000);
    await session.testid('api-key-wizard-provider-anthropic', 10_000);
    await session.testid('api-key-wizard-step-1', 10_000);

    await clickButton(session, app, 'Next', 'api-key-wizard');
    await session.testid('api-key-wizard-step-2', 10_000);
    await clickButton(session, app, 'Next', 'api-key-wizard');
    await session.testid('api-key-wizard-step-3', 10_000);
    await session.typeTestid('api-key-wizard-input', INVALID_WIZARD_KEY, 10_000);
    await session.clickTestid('api-key-wizard-submit', 10_000);

    await session.testid('api-key-wizard-step-3', 10_000);
    await session.waitForBodyText('Anthropic (Claude) keys usually start with "sk-ant-"', { timeoutMs: 10_000 });
    if (await session.hasTestid('api-key-wizard-result-ok', 1_000)) {
      throw new Error('Invalid Anthropic key was incorrectly shown as verified.');
    }
    if (await session.hasTestid('api-key-wizard-result-network', 1_000)) {
      throw new Error('Malformed Anthropic key should fail inline before live network validation.');
    }
    await closeDialog(session, app, 'api-key-wizard');

    await openApiKeyManager(session, app);
    await session.testid('api-key-manager-empty', 15_000);
    await closeDialog(session, app, 'api-key-manager');

    await seedSavedAnthropicKey(session, SEEDED_BAD_KEY);
    await session.refresh();
    await openSeededRecentWorkspace(session, workspace, app);

    await app.gotoSurface(session, 'Settings');
    await session.clickTestid('settings-category-ai-privacy', 15_000);
    await session.testid('setting-manageApiKeys', 15_000);
    await openApiKeyManager(session, app);

    await session.testid('api-key-manager-list', 15_000);
    await session.testid('api-key-manager-row-anthropic', 15_000);
    await session.testid('api-key-manager-status-unverified', 10_000);
    await session.testid('api-key-manager-check-anthropic', 10_000);
    await session.testid('api-key-manager-remove-anthropic', 10_000);
    await session.waitForBodyText('Anthropic (Claude)', { timeoutMs: 10_000 });

    await session.clickTestid('api-key-manager-check-anthropic', 10_000);
    await session.testid('api-key-manager-status-invalid', 15_000);

    await closeDialog(session, app, 'api-key-manager');
    await assertNoLocalStorageSecret(session);
    await session.close();

    // Reopen the same isolated desktop profile. The non-secret metadata stays
    // in localStorage, but the actual key must round-trip through the OS
    // keychain and still be readable by the manager after relaunch.
    await session.newSession();
    await session.testid('welcome-dialog-pitch', 30_000);
    await openSeededRecentWorkspace(session, workspace, app);
    await app.gotoSurface(session, 'Settings');
    await session.clickTestid('settings-category-ai-privacy', 15_000);
    await session.testid('setting-manageApiKeys', 15_000);
    await openApiKeyManager(session, app);

    await session.testid('api-key-manager-list', 15_000);
    await session.testid('api-key-manager-row-anthropic', 15_000);
    await session.testid('api-key-manager-status-unverified', 10_000);
    await assertNoLocalStorageSecret(session);

    await session.execute('window.confirm = () => true;');
    await session.clickTestid('api-key-manager-remove-anthropic', 10_000);
    await session.testid('api-key-manager-empty', 15_000);
    await closeDialog(session, app, 'api-key-manager');
  },
};

async function bootToWorkspaceWithOptionalKeyFixture(session, workspace, app) {
  await session.newSession();
  await session.testid('welcome-dialog-pitch', 30_000);
  const hasTauri = await session.execute('return Boolean(window.__TAURI__);');
  if (!hasTauri) throw new Error('window.__TAURI__ missing; not the desktop webview.');

  await app.seedReadyState(session, workspace, { workspaceName: WORKSPACE_NAME });
  await session.refresh();
  await openSeededRecentWorkspace(session, workspace, app);
}

async function openSeededRecentWorkspace(session, workspace, app) {
  await session.clickTestid('recent-workspaces-toggle', 30_000);
  const workspaceBasename = workspace.split('/').filter(Boolean).pop() ?? WORKSPACE_NAME;
  const recent = await findFirstAvailable(
    session,
    [
      `//button[.//div[normalize-space()=${app.xpathLiteral(WORKSPACE_NAME)}]]`,
      `//button[.//div[normalize-space()=${app.xpathLiteral(workspaceBasename)}]]`,
      `//button[@data-testid="recent-workspaces-toggle"]/following::ul[1]//button[1]`,
    ],
    20_000,
  );
  await session.click(recent);
  await session.testid('spine-nav', 45_000);
  await session.testid('status-bar', 15_000);
  await session.maybeClickTestid('feature-tour-skip');

  const body = await session.bodyText();
  if (!body.includes(WORKSPACE_NAME) && !body.includes(workspace)) {
    await session.testid('documents-toolbar', 15_000);
  }
}

async function findFirstAvailable(session, xpaths, timeoutMs) {
  const started = Date.now();
  let lastErr;
  while (Date.now() - started < timeoutMs) {
    for (const xpath of xpaths) {
      try {
        return await session.find('xpath', xpath, 800);
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw new Error(`No recent workspace button found. Last: ${lastErr?.message}`);
}

async function openApiKeyManager(session, app) {
  await session.execute(
    `document.querySelector('[data-testid="setting-manageApiKeys"]')?.scrollIntoView({ block: 'center' });`,
  );
  const button = await session.find(
    'xpath',
    `//*[@data-testid="setting-manageApiKeys"]//button[normalize-space()=${app.xpathLiteral('Manage AI Account Keys')} or .//*[normalize-space()=${app.xpathLiteral('Manage AI Account Keys')}]]`,
    15_000,
  );
  await session.click(button);
}

async function clickButton(session, app, label, dialogTestid) {
  const root = dialogTestid
    ? `//*[@data-testid=${app.xpathLiteral(dialogTestid)}]`
    : '';
  const button = await session.find(
    'xpath',
    `${root}//button[normalize-space()=${app.xpathLiteral(label)} or .//*[normalize-space()=${app.xpathLiteral(label)}]]`,
    10_000,
  );
  await session.click(button);
}

async function closeDialog(session, app, dialogTestid) {
  const close = await session.find(
    'xpath',
    `//*[@data-testid=${app.xpathLiteral(dialogTestid)}]//button[.//span[normalize-space()=${app.xpathLiteral('Close')}]]`,
    10_000,
  );
  await session.click(close);
  await session.waitFor(
    async (s) => !(await s.hasTestid(dialogTestid, 500)),
    { timeoutMs: 10_000, intervalMs: 500, label: `${dialogTestid} closed` },
  );
}

async function seedSavedAnthropicKey(session, key) {
  const result = await session.execute(
    `
      const key = arguments[0];
      const invoke =
        window.__TAURI_INTERNALS__?.invoke ||
        window.__TAURI__?.core?.invoke ||
        window.__TAURI__?.invoke;

      if (typeof invoke !== 'function') {
        return { ok: false, error: 'Tauri invoke bridge missing from the desktop webview' };
      }

      return Promise.resolve(invoke('keychain_set', {
        service: undefined,
        key: 'bos_key_anthropic',
        value: key
      })).then(
        () => {
          localStorage.removeItem('bos_key_anthropic');
          localStorage.setItem('bos_key_metadata', JSON.stringify([{
            provider: 'anthropic',
            keyPrefix: key.slice(0, 8),
            addedAt: new Date().toISOString(),
            lastUsed: new Date().toISOString()
          }]));
          return { ok: true };
        },
        (error) => ({
          ok: false,
          error: error && typeof error === 'object'
            ? JSON.parse(JSON.stringify(error))
            : String(error)
        })
      );
    `,
    [key],
  );

  if (!result?.ok) {
    throw new Error(`Failed to seed Anthropic key through OS keychain: ${JSON.stringify(result?.error)}`);
  }
}

async function assertNoLocalStorageSecret(session) {
  const localStorageSecret = await session.execute(
    `
      return localStorage.getItem('bos_key_anthropic');
    `,
  );
  if (localStorageSecret !== null) {
    throw new Error('Anthropic API key secret was stored in localStorage instead of the OS keychain.');
  }
}
