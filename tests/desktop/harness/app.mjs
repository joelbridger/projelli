/**
 * app.mjs — high-level Keepance-specific helpers built on the WebDriver Session.
 *
 * These encode the app's real entry flows so specs stay short and read like a
 * user story. The localStorage seeding mirrors the proven probe: it bypasses
 * onboarding + the feature tour and pre-seeds the recent-workspace entry so we
 * never need the native folder picker.
 */

/**
 * Seed localStorage so the app skips onboarding + the tour and knows about a
 * recent workspace at `workspacePath`. Call BEFORE refresh.
 */
export async function seedReadyState(session, workspacePath, { workspaceName = 'wd-workspace' } = {}) {
  await session.execute(
    `
      localStorage.setItem('lantern_onboarding_complete', 'true');
      localStorage.setItem('lantern_profession', 'legal');
      localStorage.setItem('keepance_feature_tour_dismissed', 'true');
      localStorage.setItem('keepance_feature_tour_completed', 'true');
      // The feature tour is actually gated by the Zustand settings store
      // (featuresTourCompleted), persisted under 'lantern:settings' — NOT the
      // legacy keepance_feature_tour_* keys above (those are dead: nothing in
      // src ever reads them under any name). Ensure the store flag so the
      // tour never auto-mounts (otherwise it can appear after the shell loads and
      // intercept the first nav click). MERGE rather than overwrite: some specs
      // pre-seed lantern:settings with their own values (e.g. a workflow's
      // templateModelOverrides pinning Ollama) before calling seedReadyState.
      try {
        const existing = localStorage.getItem('lantern:settings');
        const parsed = existing ? JSON.parse(existing) : { state: {}, version: 0 };
        parsed.state = parsed.state || {};
        parsed.state.featuresTourCompleted = true;
        if (parsed.state._migrated === undefined) parsed.state._migrated = true;
        if (parsed.version === undefined) parsed.version = 0;
        localStorage.setItem('lantern:settings', JSON.stringify(parsed));
      } catch (_e) {
        localStorage.setItem('lantern:settings', JSON.stringify({
          state: { featuresTourCompleted: true, _migrated: true },
          version: 0,
        }));
      }
      localStorage.setItem('lantern_recent_workspaces', JSON.stringify([{
        path: arguments[0],
        name: arguments[1],
        lastOpened: new Date().toISOString()
      }]));
    `,
    [workspacePath, workspaceName],
  );
}

/**
 * Boot the real app to an open workspace and wait for the main shell.
 * Returns once spine-nav + status-bar + the Documents shell are visible.
 *
 * @param {import('./webdriver.mjs').Session} session
 * @param {object} opts
 * @param {string} opts.workspacePath  the temp workspace dir on disk (real Tauri FS)
 * @param {string} [opts.workspaceName]
 */
export async function bootToWorkspace(session, { workspacePath, workspaceName = 'wd-workspace' }) {
  await session.newSession();

  // The first screen is the welcome/workspace selector. Confirm we are really in
  // the desktop webview before doing anything else.
  await session.testid('welcome-dialog-pitch', 30_000);
  const hasTauri = await session.execute('return Boolean(window.__TAURI__);');
  if (!hasTauri) throw new Error('window.__TAURI__ missing; not the desktop webview.');

  await seedReadyState(session, workspacePath, { workspaceName });
  await session.refresh();

  // Open the seeded recent workspace through the real UI.
  await session.clickTestid('recent-workspaces-toggle', 30_000);
  const recent = await session.find(
    'xpath',
    `//button[.//div[normalize-space()=${xpathLiteral(workspaceName)}]]`,
    20_000,
  );
  await session.click(recent);

  // Main shell.
  await session.testid('spine-nav', 45_000);
  await session.testid('status-bar', 15_000);
  await session.maybeClickTestid('feature-tour-skip');
  return session;
}

/**
 * Navigate to a surface by its (historical) label, mapped onto the 3-tab IA.
 *
 * The rail now has only Client Map (matters) · Ask (search) · Workflows. The
 * demoted surfaces are reached elsewhere: Settings / Activity Log / Privacy
 * Center via the gear (Activity Log + Privacy Center are nested Settings
 * sections); Documents / Email are per-client (open a client, then its hub
 * shortcut row). Old labels are accepted and translated so existing specs keep
 * working where the destination is globally reachable.
 */
export async function gotoSurface(session, label) {
  // The 3 rail tabs (accept old + new labels).
  const railTestid = {
    Matters: 'spine-nav-matters',
    'Client Map': 'spine-nav-matters',
    Search: 'spine-nav-search',
    Ask: 'spine-nav-search',
    Workflows: 'spine-nav-workflows',
  }[label];
  if (railTestid) {
    // Wave B / S1: the sidebar auto-collapses to the icon rail on the Client
    // Map list, which renders `spine-nav-collapsed-*` instead of
    // `spine-nav-*`. Match either — only one is ever mounted at a time.
    const collapsedTestid = railTestid.replace('spine-nav-', 'spine-nav-collapsed-');
    const btn = await session.find(
      'xpath',
      `//*[@data-testid=${xpathLiteral(railTestid)} or @data-testid=${xpathLiteral(collapsedTestid)}]`,
      15_000,
    );
    await session.click(btn);
    return;
  }

  // Settings opens full-page via the gear.
  if (label === 'Settings') {
    const gear = await session.find('xpath', `//*[@data-testid='settings-gear']`, 15_000);
    await session.click(gear);
    return;
  }

  // Activity Log / Privacy Center are nested sections inside Settings (the gear).
  const nestedTestid = {
    'Activity Log': 'settings-category-activity-log',
    'Privacy Center': 'settings-category-privacy-center',
  }[label];
  if (nestedTestid) {
    const gear = await session.find('xpath', `//*[@data-testid='settings-gear']`, 15_000);
    await session.click(gear);
    const section = await session.find('xpath', `//*[@data-testid=${xpathLiteral(nestedTestid)}]`, 15_000);
    await session.click(section);
    return;
  }

  // Fallback: a visible nav button (e.g. Documents/Email are per-client and have
  // no global nav button in the 3-tab IA — callers should open a client first).
  const btn = await session.find('xpath', `//nav//button[normalize-space()=${xpathLiteral(label)}]`, 15_000);
  await session.click(btn);
}

/** Escape a string for use as an XPath string literal (handles quotes). */
export function xpathLiteral(s) {
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('"')) return `"${s}"`;
  return 'concat(' + s.split("'").map((p) => `'${p}'`).join(", \"'\", ") + ')';
}
