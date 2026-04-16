/**
 * Full-text content search (UX-26)
 *
 * The Search panel previously only matched filenames. With MiniSearch it
 * now also matches file content. When a content-only hit appears, the
 * result card includes a snippet around the strongest match with the
 * query term highlighted.
 *
 * The tests exercise the panel plus the index behind it. We seed the
 * workspace tree AND the mock FS so `buildWorkspaceIndex` has something
 * real to extract.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick, safeFill } from './helpers/test-utils';

type FileNode = {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  extension?: string;
};

const TREE: FileNode[] = [
  {
    id: 'notes',
    name: 'notes',
    path: '/test-workspace/notes',
    type: 'folder',
    children: [
      {
        id: 'plan',
        name: 'plan.md',
        path: '/test-workspace/notes/plan.md',
        type: 'file',
        extension: 'md',
      },
      {
        id: 'budget',
        name: 'budget.md',
        path: '/test-workspace/notes/budget.md',
        type: 'file',
        extension: 'md',
      },
    ],
  },
];

const CONTENTS: Record<string, string> = {
  '/test-workspace/notes/plan.md':
    '# Quarterly plan\n\nShip onboarding improvements, iterate on pricing, grow the newsletter.',
  '/test-workspace/notes/budget.md':
    '# Budget\n\nQ1 allocations below. Onboarding has a dedicated line for hiring.',
};

async function seed(page: import('@playwright/test').Page) {
  await page.evaluate(({ tree, contents }) => {
    const ws = (window as any).__workspaceStore?.getState?.();
    if (ws?.setRootPath) ws.setRootPath('/test-workspace');
    if (ws?.setFileTree) ws.setFileTree(tree);
    const mock = (window as any).__mockWorkspaceFs;
    if (mock?.seed) {
      for (const [path, text] of Object.entries(contents)) {
        const bytes = new TextEncoder().encode(text);
        const buf = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buf).set(bytes);
        mock.seed(path, buf);
      }
    }
  }, { tree: TREE, contents: CONTENTS });
}

test.describe('Content search (UX-26)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await seed(page);
    await hardClick(page.getByTestId('sidebar-tab-search'));
  });

  test('search input has the expected testid and placeholder', async ({ page }) => {
    const input = page.getByTestId('search-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('placeholder', /filenames and content/i);
  });

  test('filename matches still work', async ({ page }) => {
    const input = page.getByTestId('search-input');
    await safeFill(input, 'plan');
    // plan.md should match on filename. The first result card should
    // reference it.
    await expect(page.getByTestId('search-results')).toBeVisible();
    await expect(page.getByTestId('search-result-0')).toContainText('plan.md');
  });

  test('content-only match returns a snippet and highlight', async ({ page }) => {
    const input = page.getByTestId('search-input');
    // "onboarding" appears in the body of both files but not in any filename.
    await safeFill(input, 'onboarding');
    await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 10_000 });
    // At least one result should include a snippet containing our term.
    const firstSnippet = page.getByTestId('search-result-0-snippet');
    await expect(firstSnippet).toBeVisible();
    await expect(firstSnippet).toContainText(/onboarding/i);
    // The highlight mark should wrap the term.
    await expect(firstSnippet.locator('mark')).toContainText(/onboarding/i);
  });

  test('clicking a content-match result opens the file in a tab', async ({ page }) => {
    const input = page.getByTestId('search-input');
    await safeFill(input, 'onboarding');
    await expect(page.getByTestId('search-result-0')).toBeVisible({ timeout: 10_000 });
    await hardClick(page.getByTestId('search-result-0'));
    // One of plan.md / budget.md should now be an open tab.
    const opened = await page.evaluate(() => {
      const editor = (window as any).__editorStore?.getState?.();
      const paths = (editor?.openTabs ?? []).map((t: { path: string }) => t.path);
      return paths.some((p: string) => p.endsWith('plan.md') || p.endsWith('budget.md'));
    });
    expect(opened).toBe(true);
  });
});
