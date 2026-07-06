import fs from 'node:fs';
import path from 'node:path';

async function blurActive(session) {
  await session.execute(`
    const active = document.activeElement;
    if (active && typeof active.blur === 'function') active.blur();
    document.body.focus();
  `);
}

async function pressShortcut(session, key, opts = {}) {
  await blurActive(session);
  await session.execute(
    `
      const key = arguments[0];
      const opts = arguments[1] || {};
      const event = new KeyboardEvent('keydown', {
        key,
        ctrlKey: Boolean(opts.ctrlKey),
        metaKey: Boolean(opts.metaKey),
        shiftKey: Boolean(opts.shiftKey),
        altKey: Boolean(opts.altKey),
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    `,
    [key, opts],
  );
}

async function pressInFocusedElement(session, key, opts = {}) {
  await session.execute(
    `
      const key = arguments[0];
      const opts = arguments[1] || {};
      const target = document.activeElement || document.body;
      target.dispatchEvent(new KeyboardEvent('keydown', {
        key,
        ctrlKey: Boolean(opts.ctrlKey),
        metaKey: Boolean(opts.metaKey),
        shiftKey: Boolean(opts.shiftKey),
        altKey: Boolean(opts.altKey),
        bubbles: true,
        cancelable: true,
      }));
    `,
    [key, opts],
  );
}

async function waitForGone(session, testid, timeoutMs = 10_000) {
  await session.waitFor(
    async (s) =>
      !(await s.execute(
        'return Boolean(document.querySelector(`[data-testid="${arguments[0]}"]`));',
        [testid],
      )),
    { timeoutMs, label: `${testid} to close` },
  );
}

async function assertActiveNav(session, testid) {
  await session.waitFor(
    async (s) =>
      (await s.execute(
        'return document.querySelector(`[data-testid="${arguments[0]}"]`)?.getAttribute("aria-current") === "page";',
        [testid],
      )) === true,
    { timeoutMs: 10_000, label: `${testid} active` },
  );
}

async function closeByAriaLabel(session, scopeTestid, label, app) {
  const button = await session.find(
    'xpath',
    `//*[@data-testid=${app.xpathLiteral(scopeTestid)}]//button[@aria-label=${app.xpathLiteral(label)}]`,
    10_000,
  );
  await session.click(button);
}

async function seedShellMatter(session, workspacePath) {
  await session.execute(
    `
      const matter = {
        id: 'matter_shell_global_sweep',
        name: 'Shell Matter',
        client: 'Acme Shell Client',
        folderPaths: [arguments[0] + '/Clients/Acme'],
        mailFolderPaths: [],
        privileged: false,
        createdAt: new Date().toISOString()
      };
      localStorage.setItem('keepance:matters', JSON.stringify({
        state: { matters: [matter], activeMatterId: null },
        version: 4
      }));
      localStorage.setItem('keepance:matter-ui-snapshots', JSON.stringify({
        state: { snapshots: {} },
        version: 0
      }));
      localStorage.setItem('keepance:matter-at-a-glance', JSON.stringify({
        state: { cache: {} },
        version: 0
      }));
    `,
    [workspacePath],
  );
}

async function bootToWorkspaceWithShellMatter(session, { workspacePath, app, workspaceName = 'wd-workspace' }) {
  await session.newSession();
  await session.testid('welcome-dialog-pitch', 30_000);
  const hasTauri = await session.execute('return Boolean(window.__TAURI__);');
  if (!hasTauri) throw new Error('window.__TAURI__ missing; not the desktop webview.');

  await app.seedReadyState(session, workspacePath, { workspaceName });
  await seedShellMatter(session, workspacePath);
  await session.refresh();

  await session.clickTestid('recent-workspaces-toggle', 30_000);
  const recent = await session.find(
    'xpath',
    `//button[.//div[normalize-space()=${app.xpathLiteral(workspaceName)}]]`,
    20_000,
  );
  await session.click(recent);

  await session.testid('spine-nav', 45_000);
  await session.testid('status-bar', 15_000);
  await session.maybeClickTestid('feature-tour-skip');
}

async function openMatterHub(session, app) {
  await app.gotoSurface(session, 'Client Map');
  await assertActiveNav(session, 'spine-nav-matters');

  // Already in a client hub (Client Map hero present)?
  if (await session.hasTestid('hub-panel-clientmap', 2_000)) {
    return;
  }

  await session.waitForBodyText('Shell Matter', { timeoutMs: 15_000 });
  const row = await session.find(
    'xpath',
    `//button[starts-with(@data-testid, "matter-row-")][contains(normalize-space(.), ${app.xpathLiteral('Shell Matter')})]`,
    15_000,
  );
  await session.click(row);
  // The 3-tab IA leads with the Client Map hero; the demoted surfaces live in a
  // slim shortcut row (relocated, not removed).
  await session.testid('hub-panel-clientmap', 15_000);
  await session.testid('hub-shortcut-documents', 15_000);
  await session.testid('hub-shortcut-email', 15_000);
  await session.testid('hub-shortcut-workflows', 15_000);
  await session.testid('hub-shortcut-activity', 15_000);
}

export default {
  name: '19-global-shell',
  async run({ session, workspace, app }) {
    fs.writeFileSync(
      path.join(workspace, 'shell-test-alpha.md'),
      '# Shell Test Alpha\n\nThis file is used by the global shell desktop sweep.\n',
    );
    fs.mkdirSync(path.join(workspace, 'Clients', 'Acme'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'Clients', 'Acme', 'notes.txt'), 'Nested status-bar fixture.\n');

    await bootToWorkspaceWithShellMatter(session, { workspacePath: workspace, app });

    // Global shell chrome.
    await session.testid('app-container', 15_000);
    await session.testid('app-header', 15_000);
    await session.testid('spine-nav', 15_000);
    await session.testid('trust-bar', 15_000);
    await session.testid('egress-indicator-compact', 15_000);
    await session.testid('status-bar', 15_000);
    await session.testid('status-bar-project-name', 15_000);
    await session.waitForBodyText('shell-test-alpha.md', { timeoutMs: 20_000 });

    // Trust bar actions stay global and observable.
    const dataMapButton = await session.find(
      'xpath',
      `//*[@data-testid=${app.xpathLiteral('trust-bar')}]//button[@aria-label=${app.xpathLiteral('Open the Data Map')}]`,
      10_000,
    );
    await session.click(dataMapButton);
    await session.testid('data-map-dialog', 10_000);
    await session.testid('data-map-content', 10_000);
    await closeByAriaLabel(session, 'data-map-dialog', 'Close', app);
    await waitForGone(session, 'data-map-dialog');

    const privacyShortcut = await session.find(
      'xpath',
      `//*[@data-testid=${app.xpathLiteral('trust-bar')}]//button[@aria-label=${app.xpathLiteral('Open Privacy Center')}]`,
      10_000,
    );
    await session.click(privacyShortcut);
    // The TrustBar opens the standalone Privacy Center surface (it is no longer a
    // rail tab in the 3-tab IA, so there is no active rail nav to assert).
    await session.testid('privacy-center-report-button', 15_000);

    await openMatterHub(session, app);

    // Sweep the 3 rail destinations (the only ones with an active rail nav).
    const railSurfaces = [
      { label: 'Client Map', nav: 'spine-nav-matters', visible: ['hub-panel-clientmap', 'hub-shortcut-documents', 'hub-shortcut-email', 'hub-shortcut-workflows', 'hub-shortcut-activity'], text: 'Shell Matter' },
      { label: 'Ask', nav: 'spine-nav-search', visible: ['ask-composer-input'], text: 'Every answer cites its source' },
      { label: 'Workflows', nav: 'spine-nav-workflows', visible: ['associate-home', 'associate-toolbar'], text: 'Workflows' },
    ];

    for (const surface of railSurfaces) {
      await app.gotoSurface(session, surface.label);
      await assertActiveNav(session, surface.nav);
      for (const testid of surface.visible) {
        await session.testid(testid, 20_000);
      }
      await session.waitForBodyText(surface.text, { timeoutMs: 20_000 });
    }

    // Activity Log + Privacy Center now live as nested sections inside the
    // full-page Settings (opened via the gear), not as rail tabs.
    await app.gotoSurface(session, 'Activity Log');
    await session.testid('audit-home-search', 20_000);
    await app.gotoSurface(session, 'Privacy Center');
    await session.testid('privacy-center-report-button', 20_000);
    await app.gotoSurface(session, 'Settings');
    await session.testid('settings-page', 20_000);
    await session.testid('settings-content', 20_000);

    // The settings gear should not stack a duplicate modal over the full Settings page.
    await session.clickTestid('settings-gear', 10_000);
    if (await session.hasTestid('settings-modal', 2_000)) {
      throw new Error('Settings gear opened a duplicate settings modal while already on the Settings surface.');
    }

    // Account identity opens an app-level account window without leaving the current surface.
    await session.clickTestid('account-identity', 10_000);
    await session.testid('account-window', 10_000);
    await session.clickTestid('account-tab-connections', 10_000);
    await session.waitFor(
      async (s) =>
        (await s.execute(
          'return document.querySelector(`[data-testid="account-tab-connections"]`)?.getAttribute("aria-selected") === "true";',
        )) === true,
      { timeoutMs: 10_000, label: 'connections account tab active' },
    );
    await closeByAriaLabel(session, 'account-window', 'Close', app);
    await waitForGone(session, 'account-window');

    // Command palette: open with Ctrl+K, filter by a command with no input testid, then run it.
    // (Ctrl+K is global; any rail surface works as the starting point.)
    await app.gotoSurface(session, 'Client Map');
    await pressShortcut(session, 'k', { ctrlKey: true });
    await session.testid('command-palette-dialog', 10_000);
    const paletteInput = await session.find(
      'xpath',
      `//*[@data-testid=${app.xpathLiteral('command-palette-dialog')}]//input[@placeholder=${app.xpathLiteral('Type a command or search...')}]`,
      10_000,
    );
    await session.type(paletteInput, 'settings');
    await session.waitForBodyText('Open Settings', { timeoutMs: 10_000 });
    const openSettingsCommand = await session.find(
      'xpath',
      `//*[@data-testid=${app.xpathLiteral('command-palette-dialog')}]//button[.//div[normalize-space()=${app.xpathLiteral('Open Settings')}]]`,
      10_000,
    );
    await session.click(openSettingsCommand);
    await session.testid('settings-modal', 10_000);
    await closeByAriaLabel(session, 'settings-modal', 'Close settings', app);
    await waitForGone(session, 'settings-modal');

    await pressShortcut(session, 'k', { ctrlKey: true });
    await session.testid('command-palette-dialog', 10_000);
    const noResultInput = await session.find(
      'xpath',
      `//*[@data-testid=${app.xpathLiteral('command-palette-dialog')}]//input[@placeholder=${app.xpathLiteral('Type a command or search...')}]`,
      10_000,
    );
    await session.type(noResultInput, 'zzzz-no-shell-command');
    await session.waitForBodyText('No commands found', { timeoutMs: 10_000 });
    await pressInFocusedElement(session, 'Escape');
    await waitForGone(session, 'command-palette-dialog');

    // Quick Open via Ctrl+P finds and opens a real file from the temp workspace.
    // (Ctrl+P is global; any rail surface works as the starting point.)
    await app.gotoSurface(session, 'Client Map');
    await pressShortcut(session, 'p', { ctrlKey: true });
    await session.testid('quick-open-modal', 10_000);
    await session.typeTestid('quick-open-search', 'shell-test-alpha', 10_000);
    await session.testid('quick-open-result-0', 10_000);
    await session.clickTestid('quick-open-result-0', 10_000);
    await waitForGone(session, 'quick-open-modal');
    await session.waitForBodyText('Shell Test Alpha', { timeoutMs: 20_000 });
    await session.testid('status-bar-active-file', 15_000);

    // Keyboard shortcut reference via "?" filters and shows the no-match state.
    await pressShortcut(session, '?');
    await session.testid('shortcuts-overlay', 10_000);
    await session.typeTestid('shortcuts-overlay-search', 'save', 10_000);
    await session.testid('shortcut-item-save-file', 10_000);
    const shortcutsSearch = await session.testid('shortcuts-overlay-search', 10_000);
    await session.clear(shortcutsSearch);
    await session.type(shortcutsSearch, 'zzzz-no-shortcut');
    await session.testid('shortcuts-overlay-empty', 10_000);
    await pressInFocusedElement(session, 'Escape');
    await waitForGone(session, 'shortcuts-overlay');

    // Sidebar collapse/expand works through both the visible control and Ctrl+B.
    const collapseButton = await session.find(
      'xpath',
      `//button[@aria-label=${app.xpathLiteral('Collapse sidebar')}]`,
      10_000,
    );
    await session.click(collapseButton);
    await session.testid('spine-nav-collapsed-matters', 10_000);
    await session.clickTestid('spine-nav-collapsed-search', 10_000);
    await session.testid('ask-composer-input', 15_000);
    await pressShortcut(session, 'b', { ctrlKey: true });
    await session.testid('spine-nav', 10_000);
    await pressShortcut(session, 'b', { ctrlKey: true });
    await session.testid('spine-nav-collapsed-matters', 10_000);
    await pressShortcut(session, 'b', { ctrlKey: true });
    await session.testid('spine-nav', 10_000);

    // Number shortcuts jump to the 3 IA rail surfaces (Ctrl+1..3).
    const shortcutSurfaces = [
      { key: '1', nav: 'spine-nav-matters', text: 'Shell Matter' },
      { key: '2', nav: 'spine-nav-search', visible: 'ask-composer-input' },
      { key: '3', nav: 'spine-nav-workflows', visible: 'associate-home' },
    ];

    for (const target of shortcutSurfaces) {
      await pressShortcut(session, target.key, { ctrlKey: true });
      await assertActiveNav(session, target.nav);
      if (target.visible) await session.testid(target.visible, 15_000);
      if (target.text) await session.waitForBodyText(target.text, { timeoutMs: 15_000 });
    }

    // AI assistant global shortcut opens a main-panel AI tab. shell-test-alpha.md
    // is already the active file from the Quick Open step above (in the 3-tab IA
    // documents are reached via Quick Open / the client hub, not a rail tab).
    await session.waitForBodyText('Shell Test Alpha', { timeoutMs: 20_000 });
    await session.testid('status-bar-active-file', 15_000);
    await pressShortcut(session, 'a', { ctrlKey: true, shiftKey: true });
    await session.testid('ai-assistant-tab', 15_000);

    // Status-bar license chip is visible globally and opens the same settings modal path.
    await session.testid('status-bar-trial-chip', 10_000);
    await session.clickTestid('status-bar-trial-chip', 10_000);
    await session.testid('settings-modal', 10_000);
    await closeByAriaLabel(session, 'settings-modal', 'Close settings', app);
    await waitForGone(session, 'settings-modal');
  },
};
