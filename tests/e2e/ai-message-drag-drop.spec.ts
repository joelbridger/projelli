/**
 * AI message drag-to-tree (UX-28)
 *
 * AIChatViewer renders a small drag handle next to every assistant bubble
 * whose dragstart handler stuffs the message content into a custom MIME
 * (`application/x-keepance-chat-message`) plus text/plain.
 *
 * The FileTree's drop handler intercepts that MIME and invokes
 * `onDropAIMessage`. Folder drops call `targetFolder = node.path`; file
 * drops pass `existingFilePath = node.path` so the handler in App.tsx can
 * append rather than create.
 *
 * The full end-to-end drag simulation is hard to do deterministically in
 * Playwright when the source component mounts inside a Zustand-subscribed
 * tree that's sensitive to re-render ordering. So we exercise each layer
 * separately:
 *
 *   - Filename derivation: tests/unit/derive-filename.test.ts (7 cases).
 *   - FileTree drop wiring: this spec dispatches a synthetic DragEvent
 *     carrying the AI MIME onto a folder row and verifies the hook fires.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick } from './helpers/test-utils';

type FileNode = {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
};

const TREE: FileNode[] = [
  {
    id: 'docs',
    name: 'docs',
    path: '/ws/docs',
    type: 'folder',
    children: [
      { id: 'existing', name: 'existing.md', path: '/ws/docs/existing.md', type: 'file' },
    ],
  },
  { id: 'root-file', name: 'root.md', path: '/ws/root.md', type: 'file' },
];

test.describe('FileTree AI-message drop (UX-28)', () => {
  test('dropping an AI message on a folder row invokes the handler with the folder path', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // Seed tree + root, expand the docs folder so the child row renders.
    await page.evaluate((tree) => {
      const ws = (window as any).__workspaceStore?.getState?.();
      if (ws?.setRootPath) ws.setRootPath('/ws');
      if (ws?.setFileTree) ws.setFileTree(tree);
      if (ws?.setExpandedPaths) ws.setExpandedPaths(new Set(['/ws/docs']));
    }, TREE);

    await hardClick(page.getByTestId('sidebar-tab-files'));

    // Target the folder row by its data-folder-path marker (stable attribute
    // added in UX-19 and reused here in UX-28).
    const folderRow = page.locator('[data-folder-path="/ws/docs"]').first();
    await expect(folderRow).toBeVisible();

    // Dispatch synthetic drop events on that row. The AI message MIME is
    // the authoritative payload the FileTree drop handler looks for.
    const result = await folderRow.evaluate((el: HTMLElement) => {
      const payload = '# Test message\n\nBody here.';
      const dt = new DataTransfer();
      dt.setData('application/x-keepance-chat-message', payload);
      dt.setData('text/plain', payload);

      // dragover is what lights up the drop target; drop is what fires.
      el.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, cancelable: true }));
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, cancelable: true }));
      return true;
    });
    expect(result).toBe(true);

    // The handler eventually writes a file into /ws/docs and opens it in a
    // tab. Wait for a tab matching /ws/docs/… to appear.
    await expect.poll(async () =>
      page.evaluate(() => {
        const editor = (window as any).__editorStore?.getState?.();
        return (editor?.openTabs ?? []).some(
          (t: { path: string }) => t.path.startsWith('/ws/docs/') && t.path.endsWith('.md')
        );
      })
    , { timeout: 5000 }).toBe(true);
  });

  test('dropping an AI message on an existing file appends content', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await page.evaluate(async (tree) => {
      const ws = (window as any).__workspaceStore?.getState?.();
      if (ws?.setRootPath) ws.setRootPath('/ws');
      if (ws?.setFileTree) ws.setFileTree(tree);
      if (ws?.setExpandedPaths) ws.setExpandedPaths(new Set(['/ws/docs']));
      // Seed the mock FS with an initial file so the append path has
      // something to read. The test-mode mock service stores ArrayBuffer.
      const mock = (window as any).__mockWorkspaceFs;
      if (mock?.seed) {
        const bytes = new TextEncoder().encode('original content');
        const buf = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buf).set(bytes);
        mock.seed('/ws/docs/existing.md', buf);
      }
    }, TREE);

    await hardClick(page.getByTestId('sidebar-tab-files'));

    // Target the existing file row (not the folder). treeitem role + name
    // text lets us pin it without depending on another testid.
    const fileRow = page.getByRole('treeitem', { name: /existing\.md/ });
    await expect(fileRow).toBeVisible();

    await fileRow.evaluate((el: HTMLElement) => {
      const payload = '# New section';
      const dt = new DataTransfer();
      dt.setData('application/x-keepance-chat-message', payload);
      dt.setData('text/plain', payload);
      el.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, cancelable: true }));
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, cancelable: true }));
    });

    // The handler appends with a `---` separator and re-opens the file. We
    // assert the existing path remains and that the tab content now
    // includes both the original body and the new payload.
    await expect.poll(async () =>
      page.evaluate(() => {
        const editor = (window as any).__editorStore?.getState?.();
        const tab = (editor?.openTabs ?? []).find(
          (t: { path: string }) => t.path === '/ws/docs/existing.md'
        );
        if (!tab) return null;
        return {
          hasOriginal: tab.content.includes('original content'),
          hasSeparator: tab.content.includes('---'),
          hasNew: tab.content.includes('New section'),
        };
      })
    , { timeout: 5000 }).toEqual({ hasOriginal: true, hasSeparator: true, hasNew: true });
  });
});
