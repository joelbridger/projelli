/**
 * QA-5 (P1) regression guard — creating a client via "+ New client" must scope
 * it to its own workspace folder by default.
 *
 * The bug: the create dialog passed no folderPaths, so a brand-new client was
 * linked to ZERO folders — its documents/imports landed unscoped and its own
 * Documents view showed "No documents yet" even though the files existed
 * (QA-1 first-run evidence: 16-client-created.jpeg → 25-files-list.jpeg empty →
 * 31-client-folders.jpeg root cause: no folder checked). The fix derives a
 * per-client folder at creation (matching how seeded clients are structured).
 *
 * This drives the REAL "+ New client" dialog and asserts the persisted matter
 * ends up with a non-empty, workspace-scoped folderPaths — guarding the dialog
 * wiring, not just the pure helper.
 */
import { test, expect, type Page } from '@playwright/test';
import { waitForTestModeLoad, hardClick } from './helpers/test-utils';

const MATTERS_KEY = 'lantern:matters';

async function readMatters(page: Page): Promise<Array<{ client: string; folderPaths: string[] }>> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), MATTERS_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { state?: { matters?: Array<{ client: string; folderPaths: string[] }> } };
  return parsed.state?.matters ?? [];
}

test.describe('Bench mirror: QA-5 — new client gets its own scoped folder', () => {
  test('creating a client via "+ New client" links a per-client workspace folder', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // Open the canonical create dialog from the client rail's "+ New client".
    await hardClick(page.getByTestId('spine-new-client').first());
    await expect(page.getByTestId('matter-manager-dialog')).toBeVisible({ timeout: 10_000 });

    const clientName = 'The Delgado Household';
    await page.getByTestId('matter-new-client').fill(clientName);
    await hardClick(page.getByTestId('matter-create-button'));

    // The created client must be scoped to its OWN folder under the workspace —
    // not the empty folderPaths that caused the "No documents yet" bug.
    await expect
      .poll(async () => {
        const created = (await readMatters(page)).find((m) => m.client === clientName);
        return created?.folderPaths ?? null;
      }, { timeout: 10_000 })
      .toEqual(['/test-workspace/The Delgado Household']);
  });
});
