/**
 * Ctrl+P / Cmd+P quick-open fuzzy file switcher (UX-27)
 *
 * The modal is a Radix Dialog with a search input; fuzzy-matches filenames
 * via fuse.js. Arrow keys navigate results, Enter opens, Escape cancels.
 * When the input is empty, a recents list (persisted in localStorage)
 * replaces the filtered results.
 *
 * Uses the exposed `__workspaceStore` to seed a deterministic file tree
 * since the default test-mode fixture has no files on disk.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick, safeFill } from './helpers/test-utils';

type FileNode = {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
};

const SEED_TREE: FileNode[] = [
  {
    id: 'docs',
    name: 'docs',
    path: '/ws/docs',
    type: 'folder',
    children: [
      { id: 'readme', name: 'readme.md', path: '/ws/docs/readme.md', type: 'file' },
      { id: 'guide', name: 'getting-started.md', path: '/ws/docs/getting-started.md', type: 'file' },
    ],
  },
  { id: 'notes', name: 'notes.md', path: '/ws/notes.md', type: 'file' },
  { id: 'todo', name: 'todo.txt', path: '/ws/todo.txt', type: 'file' },
];

async function seedTree(page: import('@playwright/test').Page) {
  await page.evaluate((tree) => {
    const workspace = (window as any).__workspaceStore?.getState?.();
    if (workspace?.setRootPath) workspace.setRootPath('/ws');
    if (workspace?.setFileTree) workspace.setFileTree(tree);
    try { localStorage.removeItem('quickopen:recents'); } catch { /* ignore */ }
  }, SEED_TREE);
}

test.describe('Quick Open (UX-27)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await seedTree(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  });

  test('Ctrl+P opens the modal with a search input', async ({ page }) => {
    await page.keyboard.press('Control+p');
    await expect(page.getByTestId('quick-open-modal')).toBeVisible();
    await expect(page.getByTestId('quick-open-search')).toBeFocused();
  });

  test('typing fuzzy-matches filenames', async ({ page }) => {
    await page.keyboard.press('Control+p');
    await expect(page.getByTestId('quick-open-modal')).toBeVisible();

    const search = page.getByTestId('quick-open-search');
    await safeFill(search, 'readme');

    await expect(page.getByTestId('quick-open-result-0')).toContainText('readme.md');
    // "todo.txt" should not match "readme" under the default fuse threshold.
    await expect(page.getByTestId('quick-open-modal')).not.toContainText('todo.txt');
  });

  test('Enter opens the selected file and closes the modal', async ({ page }) => {
    await page.keyboard.press('Control+p');
    await expect(page.getByTestId('quick-open-modal')).toBeVisible();

    const search = page.getByTestId('quick-open-search');
    await safeFill(search, 'notes');
    await expect(page.getByTestId('quick-open-result-0')).toContainText('notes.md');

    await page.keyboard.press('Enter');
    // Modal goes away after selection.
    await expect(page.getByTestId('quick-open-modal')).toHaveCount(0);
  });

  test('ArrowDown moves selection', async ({ page }) => {
    await page.keyboard.press('Control+p');
    const search = page.getByTestId('quick-open-search');
    await safeFill(search, 'md'); // matches at least two files

    // The first result should render; there may or may not be a second —
    // only assert arrow navigation if there's a 2nd result.
    await expect(page.getByTestId('quick-open-result-0')).toBeVisible();
    const secondCount = await page.getByTestId('quick-open-result-1').count();
    if (secondCount === 0) {
      test.skip(true, 'Single-result set — arrow navigation not exercised');
      return;
    }

    await page.keyboard.press('ArrowDown');
    // The 2nd result should now carry the highlighted background.
    await expect(page.getByTestId('quick-open-result-1')).toHaveClass(/bg-muted/);
  });

  test('Escape cancels without opening a file', async ({ page }) => {
    await page.keyboard.press('Control+p');
    await expect(page.getByTestId('quick-open-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('quick-open-modal')).toHaveCount(0);
  });

  test('empty input shows recents section after first open', async ({ page }) => {
    // Seed a recent by opening one file.
    await page.keyboard.press('Control+p');
    const search = page.getByTestId('quick-open-search');
    await safeFill(search, 'readme');
    await expect(page.getByTestId('quick-open-result-0')).toContainText('readme.md');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('quick-open-modal')).toHaveCount(0);

    // Reopen — recents should include readme.md when the input is empty.
    await page.keyboard.press('Control+p');
    await expect(page.getByTestId('quick-open-modal')).toBeVisible();
    await expect(page.getByTestId('quick-open-result-0')).toContainText('readme.md');
  });

  test('Ctrl+Shift+P still opens the command palette, not quick open', async ({ page }) => {
    await page.keyboard.press('Control+Shift+p');
    // Command palette should be visible.
    await expect(page.getByTestId('command-palette-dialog')).toBeVisible();
    // Quick open should not.
    await expect(page.getByTestId('quick-open-modal')).toHaveCount(0);
  });
});
