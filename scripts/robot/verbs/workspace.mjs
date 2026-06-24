// scripts/robot/verbs/workspace.mjs
// Verb: open_workspace — from the launcher screen, open a recent workspace by
// name and dismiss the first-run feature tour, so the main UI (spine nav, client
// list, ask) is reachable. If a workspace is already open it is a no-op (but it
// still dismisses the tour, which otherwise overlays and blocks clicks).
//
// Returns: { ok, name, alreadyOpen? }

const DEFAULT_NAME = 'Northcrest Wealth Partners';

/** Dismiss the first-run feature tour overlay if present (it blocks clicks). */
async function dismissFeatureTour(page) {
  const skip = await page.$('[data-testid="feature-tour-skip"]');
  if (skip) {
    await skip.click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

export async function openWorkspace(page, args = {}) {
  const name = args.name || DEFAULT_NAME;

  // Already inside a workspace? The spine nav is the tell.
  if (await page.$('[data-testid="spine-nav"]')) {
    await dismissFeatureTour(page);
    return { ok: true, alreadyOpen: true, name };
  }

  // Otherwise we must be on the workspace-selector (launcher) screen.
  if (!(await page.$('[data-testid="workspace-selector-dialog"]'))) {
    return { ok: false, error: 'neither in a workspace nor on the selector screen', name };
  }

  // Expand recents (idempotent) then click the row whose text contains `name`.
  await page.click('[data-testid="recent-workspaces-toggle"]', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  const row = page.locator('[data-testid="recent-workspace-row"]').filter({ hasText: name }).first();
  await row.click({ timeout: 8000 });

  // Wait for the main UI to mount, then clear the feature tour.
  const ready = await page
    .waitForSelector('[data-testid="spine-nav"]', { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(1500);
  await dismissFeatureTour(page);

  return { ok: ready, name };
}
