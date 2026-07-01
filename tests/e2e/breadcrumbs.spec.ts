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
 * / Ask / Workflows) there is no direct spine-nav entry for it; reach it via
 * `switchToStandaloneEditorSurface` (see helpers/test-utils.ts) the same way
 * a real user would (Ctrl+Shift+A). Poking the editor store directly (the
 * old approach) skips that surface switch entirely, so the breadcrumbs
 * stayed hidden regardless of file content.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, openStandaloneFile } from './helpers/test-utils';

test.describe('Status bar breadcrumbs (UX-14)', () => {
  test('renders root + file name when no ancestor folders', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await openStandaloneFile(page, '/test-workspace/notes.md', 'notes.md', '# hello');

    const breadcrumbs = page.getByTestId('status-bar-breadcrumbs');
    await expect(breadcrumbs).toBeVisible();
    await expect(page.getByTestId('status-bar-breadcrumb-test-workspace')).toBeVisible();
    await expect(page.getByTestId('status-bar-file-name')).toHaveText('notes.md');
  });

  test('nested file path renders clickable intermediate segments', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await openStandaloneFile(
      page,
      '/test-workspace/docs/guides/test2.txt',
      'test2.txt',
      'hi'
    );

    const breadcrumbs = page.getByTestId('status-bar-breadcrumbs');
    await expect(breadcrumbs).toBeVisible();
    await expect(page.getByTestId('status-bar-breadcrumb-test-workspace')).toBeVisible();
    await expect(page.getByTestId('status-bar-breadcrumb-docs')).toBeVisible();
    await expect(page.getByTestId('status-bar-breadcrumb-guides')).toBeVisible();
  });
});
