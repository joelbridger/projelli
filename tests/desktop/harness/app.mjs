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
      localStorage.setItem('keepance_onboarding_complete', 'true');
      localStorage.setItem('keepance_profession', 'legal');
      localStorage.setItem('keepance_feature_tour_dismissed', 'true');
      localStorage.setItem('keepance_feature_tour_completed', 'true');
      localStorage.setItem('keepance_recent_workspaces', JSON.stringify([{
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
 * Navigate the left spine to a surface by its visible label
 * (Matters, Search, Documents, Email, Workflows, Activity Log, Privacy Center, Settings).
 */
export async function gotoSurface(session, label) {
  const btn = await session.find('xpath', `//nav//button[normalize-space()=${xpathLiteral(label)}]`, 15_000);
  await session.click(btn);
}

/** Escape a string for use as an XPath string literal (handles quotes). */
export function xpathLiteral(s) {
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('"')) return `"${s}"`;
  return 'concat(' + s.split("'").map((p) => `'${p}'`).join(", \"'\", ") + ')';
}
