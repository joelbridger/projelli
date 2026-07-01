/**
 * Status bar breadcrumbs (UX-14)
 *
 * The status bar's workspace/file slot renders each ancestor folder as a
 * clickable breadcrumb segment, separated by chevron icons. Clicking a
 * middle segment expands the file tree to that folder and highlights it.
 *
 * The breadcrumbs only render when `sidebarActiveTab === 'files'`
 * (StatusBar.tsx's `showFileContext` prop, set in App.tsx) — the standalone,
 * non-embedded document-editor surface. In the current 3-tab IA (Client Map
 * / Ask / Workflows) there is no direct spine-nav entry for it; it's reached
 * the same way a real user reaches it — by opening a cited document from the
 * Client Map/Ask (the `lantern:matter-launch` event, `surface: 'files'`,
 * openSource.ts). Poking the editor store directly (the old approach) skips
 * that surface switch entirely, so the breadcrumbs stayed hidden — this test
 * now drives the real event instead.
 */

import { test, expect, type Page } from '@playwright/test';
import { waitForTestModeLoad } from './helpers/test-utils';

const MATTER_ID = 'matter_test_breadcrumbs';
const EV_MATTER_LAUNCH = 'lantern:matter-launch';

async function seedMatterAndReload(page: Page) {
  await page.goto('/?testMode=true');
  await waitForTestModeLoad(page);

  await page.evaluate((matterId) => {
    const ts = new Date().toISOString();
    localStorage.setItem(
      'lantern:matters',
      JSON.stringify({
        state: {
          matters: [
            {
              id: matterId,
              name: 'Breadcrumb Test Matter',
              client: 'Breadcrumb Test Client',
              folderPaths: ['/test-workspace'],
              createdAt: ts,
              updatedAt: ts,
              status: 'active',
            },
          ],
          activeMatterId: matterId,
        },
        version: 2,
      })
    );
    localStorage.setItem('keepance_onboarding_complete', 'true');
  }, MATTER_ID);

  await page.reload();
  await waitForTestModeLoad(page);
}

/** Seed a real file into the mock workspace FS, then open it exactly the way
 * a real citation click does — via the matter-launch event — so the app's
 * actual surface-switching logic runs (see file header). */
async function seedFileAndOpenViaCitation(
  page: Page,
  matterId: string,
  path: string,
  content: string
) {
  await page.evaluate(
    ({ matterId, path, content, eventName }) => {
      const bytes = new TextEncoder().encode(content);
      (window as unknown as {
        __mockWorkspaceFs?: { seed: (p: string, bytes: ArrayBuffer) => void };
      }).__mockWorkspaceFs?.seed(path, bytes.buffer as ArrayBuffer);

      window.dispatchEvent(
        new CustomEvent(eventName, {
          detail: { matterId, surface: 'files', source: { kind: 'document', ref: path } },
        })
      );
    },
    { matterId, path, content, eventName: EV_MATTER_LAUNCH }
  );
}

test.describe('Status bar breadcrumbs (UX-14)', () => {
  test('renders root + file name when no ancestor folders', async ({ page }) => {
    await seedMatterAndReload(page);
    await seedFileAndOpenViaCitation(page, MATTER_ID, '/test-workspace/notes.md', '# hello');

    const breadcrumbs = page.getByTestId('status-bar-breadcrumbs');
    await expect(breadcrumbs).toBeVisible();
    await expect(page.getByTestId('status-bar-breadcrumb-test-workspace')).toBeVisible();
    await expect(page.getByTestId('status-bar-file-name')).toHaveText('notes.md');
  });

  test('nested file path renders clickable intermediate segments', async ({ page }) => {
    await seedMatterAndReload(page);
    await seedFileAndOpenViaCitation(
      page,
      MATTER_ID,
      '/test-workspace/docs/guides/test2.txt',
      'hi'
    );

    const breadcrumbs = page.getByTestId('status-bar-breadcrumbs');
    await expect(breadcrumbs).toBeVisible();
    await expect(page.getByTestId('status-bar-breadcrumb-test-workspace')).toBeVisible();
    await expect(page.getByTestId('status-bar-breadcrumb-docs')).toBeVisible();
    await expect(page.getByTestId('status-bar-breadcrumb-guides')).toBeVisible();
  });
});
