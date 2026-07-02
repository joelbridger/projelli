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

/**
 * Dismiss known blocking dialogs that have no data-testid, so a later click
 * elsewhere on the page doesn't time out against an opaque overlay.
 *
 * Currently just the RightCapital-export consent gate ("Use exported reports
 * from RightCapital?"), which the app shows once it notices such a file among
 * the workspace documents — it can appear well after `open` (once indexing
 * surfaces the file), not just at initial load, so callers should re-check
 * this defensively before any interaction, not only right after opening.
 * "Yes, my firm permits this" matches what a real advisor would click to keep
 * the demo's full functionality (RightCapital content stays usable for Ask).
 */
export async function dismissKnownBlockingDialogs(page) {
  const confirm = page.getByRole('button', { name: 'Yes, my firm permits this' });
  if (await confirm.count().catch(() => 0)) {
    await confirm.first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

/**
 * Wait for the PDF-indexing pass (indexWorkspacePdfs — separate from, and
 * slower than, the main DOCX/XLSX index+retag) to finish. It re-runs from
 * scratch on EVERY workspace boot, including a `reset({mode:'snapshot'})`
 * restore of an already-fully-indexed archive — restoring the .lantern
 * folder does not skip it. Several of the demo's real citation sources are
 * PDFs (e.g. Hollings Family's RightCapital plan); asking before this
 * finishes is flaky in a silent way — the model's answer text is right, but
 * the citation can't resolve against a not-yet-indexed PDF, so the UI falls
 * back to an uncited "general guidance" answer with no error at all. Done =
 * the `rag-pdf-progress` banner line disappears.
 */
export async function waitForPdfIndexing(page, { timeoutMs = 1_800_000, pollMs = 10_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const progress = await page.locator('[data-testid="rag-pdf-progress"]').textContent().catch(() => null);
    if (!progress) return { ok: true };
    await page.waitForTimeout(pollMs);
  }
  return { ok: false, reason: 'pdf-index-wait timeout (rag-pdf-progress banner never cleared)' };
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
    await dismissKnownBlockingDialogs(page);
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
  await dismissKnownBlockingDialogs(page);

  const proj = await currentWorkspaceName(page);
  return { ok: ready && proj.includes(name), name, currentWorkspace: proj };
}
