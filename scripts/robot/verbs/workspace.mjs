// scripts/robot/verbs/workspace.mjs
// Verb: open_workspace — from the launcher screen, open a recent workspace by
// name and dismiss the first-run feature tour, so the main UI (spine nav, client
// list, ask) is reachable.
//
// Codex review: do NOT report ok:true just because SOME workspace is open — verify
// the OPEN workspace is the requested one (status-bar-project-name), so the robot
// can never claim Northcrest opened when a different workspace is up.
//
// Returns: { ok, name, alreadyOpen?, currentWorkspace, error? }

const DEFAULT_NAME = 'Northcrest Wealth Partners';

async function dismissFeatureTour(page) {
  const skip = await page.$('[data-testid="feature-tour-skip"]');
  if (skip) { await skip.click().catch(() => {}); await page.waitForTimeout(300); }
}

async function currentWorkspaceName(page) {
  return page
    .locator('[data-testid="status-bar-project-name"]')
    .first()
    .textContent({ timeout: 3000 })
    .then((t) => (t || '').trim())
    .catch(() => '');
}

export async function openWorkspace(page, args = {}) {
  const name = args.name || DEFAULT_NAME;

  // Already inside a workspace? Verify it's the RIGHT one.
  if (await page.$('[data-testid="spine-nav"]')) {
    await dismissFeatureTour(page);
    const proj = await currentWorkspaceName(page);
    const matches = proj.includes(name);
    return {
      ok: matches,
      alreadyOpen: true,
      name,
      currentWorkspace: proj,
      ...(matches ? {} : { error: `a different workspace is open: "${proj}"` }),
    };
  }

  // Otherwise we must be on the workspace-selector (launcher) screen.
  if (!(await page.$('[data-testid="workspace-selector-dialog"]'))) {
    return { ok: false, error: 'neither in a workspace nor on the selector screen', name };
  }

  await page.click('[data-testid="recent-workspaces-toggle"]', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  const row = page.locator('[data-testid="recent-workspace-row"]').filter({ hasText: name }).first();
  await row.click({ timeout: 8000 });

  const ready = await page
    .waitForSelector('[data-testid="spine-nav"]', { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(1500);
  await dismissFeatureTour(page);

  const proj = await currentWorkspaceName(page);
  return { ok: ready && proj.includes(name), name, currentWorkspace: proj };
}
