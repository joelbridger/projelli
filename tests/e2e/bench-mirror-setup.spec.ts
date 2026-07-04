/**
 * Browser mirror of the Windows bench smoke checklist's "Phase 1 — setup"
 * checks (scripts/bench-smoke/checks/setup.mjs, see
 * docs/qa/E2E-SMOKE-MIRROR.md for the full check-id -> spec mapping).
 *
 * These three checks are the ones the bench harness runs against a real,
 * already-open advisor workspace. In the browser dev build there is no real
 * workspace/OAuth to open, so this spec uses the existing
 * `?testMode=true&seedDemo=1` dev fixture (src/app/lifecycle/seedDemoClients.ts)
 * instead — the same fixture every other Client-Map e2e spec in this repo
 * already relies on.
 */

import { test, expect, type Page } from '@playwright/test';
import { hardClick, waitForTestModeLoad } from './helpers/test-utils';

const BRENNAN_ID = 'matter_demo_brennan';
const OKAFOR_ID = 'matter_demo_okafor';

async function gotoSeededWorkspace(page: Page) {
  await page.goto('/?testMode=true&seedDemo=1');
  await waitForTestModeLoad(page);
}

/** Open a matter's hub from the Clients list and switch to the given sub-tab. */
async function openHubSubtab(page: Page, matterId: string, subtab: 'overview' | 'documents') {
  await hardClick(page.getByTestId('spine-nav-matters'));
  const subtabBar = page.getByTestId('hub-subtab-bar');
  const matterRow = page.getByTestId(`matter-row-${matterId}`);
  await expect(subtabBar.or(matterRow)).toBeVisible({ timeout: 15_000 });
  if (await matterRow.isVisible().catch(() => false)) {
    await hardClick(matterRow);
    await expect(subtabBar).toBeVisible({ timeout: 15_000 });
  }
  await hardClick(page.getByTestId(`hub-subtab-${subtab}`));
  await expect(page.getByTestId(`hub-subtab-panel-${subtab}`)).toBeVisible({ timeout: 10_000 });
}

/** Seed the global file tree with one file per client, each nested under
 *  that client's own `folderPaths` entry (matching seedDemoClients.ts), via
 *  the existing `__setTestFileTree` test hook (useTestModeWorkspace.ts) —
 *  no product source changed. */
async function seedPerClientFiles(page: Page) {
  await page.evaluate(() => {
    const setTree = (
      window as unknown as {
        __setTestFileTree?: (tree: unknown) => void;
      }
    ).__setTestFileTree;
    if (!setTree) throw new Error('window.__setTestFileTree missing — is testMode=true?');
    setTree([
      {
        id: '/test-workspace/Brennan Household',
        name: 'Brennan Household',
        path: '/test-workspace/Brennan Household',
        type: 'folder',
        children: [
          {
            id: '/test-workspace/Brennan Household/Brennan Only Memo.docx',
            name: 'Brennan Only Memo.docx',
            path: '/test-workspace/Brennan Household/Brennan Only Memo.docx',
            type: 'file',
            extension: 'docx',
          },
        ],
      },
      {
        id: '/test-workspace/Okafor Household',
        name: 'Okafor Household',
        path: '/test-workspace/Okafor Household',
        type: 'folder',
        children: [
          {
            id: '/test-workspace/Okafor Household/Okafor Only Memo.docx',
            name: 'Okafor Only Memo.docx',
            path: '/test-workspace/Okafor Household/Okafor Only Memo.docx',
            type: 'file',
            extension: 'docx',
          },
        ],
      },
    ]);
  });
}

test.describe('Bench mirror: Phase 1 setup', () => {
  test('workspace-binding: Clients list renders the seeded book of business', async ({ page }) => {
    await gotoSeededWorkspace(page);
    await hardClick(page.getByTestId('spine-nav-matters'));

    await expect(page.getByTestId(`matter-row-${BRENNAN_ID}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`matter-row-${OKAFOR_ID}`)).toBeVisible();
  });

  test('per-client-files-visible: Documents tab is scoped to the selected client only', async ({ page }) => {
    await gotoSeededWorkspace(page);
    await seedPerClientFiles(page);

    // Brennan's Documents tab shows Brennan's file, never Okafor's.
    await openHubSubtab(page, BRENNAN_ID, 'documents');
    await expect(page.getByText('Brennan Only Memo.docx')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Okafor Only Memo.docx')).not.toBeVisible();

    // Okafor's Documents tab shows the reverse — no leakage either direction.
    await hardClick(page.getByTestId('spine-nav-matters'));
    await hardClick(page.getByTestId(`matter-row-${OKAFOR_ID}`));
    await hardClick(page.getByTestId('hub-subtab-documents'));
    await expect(page.getByText('Okafor Only Memo.docx')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Brennan Only Memo.docx')).not.toBeVisible();
  });

  test('index-health: Client Map shows cited facts with no build/update error', async ({ page }) => {
    await gotoSeededWorkspace(page);
    await openHubSubtab(page, BRENNAN_ID, 'overview');

    // Real cited-source chips (ClientMapPanel.tsx's SourceChip,
    // data-testid="clientmap-source-link") from the seeded Brennan client
    // map's document/email SourceRefs — the honest signal that the map built
    // successfully with real citations, not a rebuild/provider error.
    await expect(page.getByTestId('clientmap-source-link').first()).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText('needs to rebuild')).not.toBeVisible();
    await expect(page.getByText('Could not build client map')).not.toBeVisible();
    await expect(page.getByText('Could not check for client map updates')).not.toBeVisible();
  });
});
