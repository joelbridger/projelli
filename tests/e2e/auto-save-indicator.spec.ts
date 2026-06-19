/**
 * Auto-save indicator states (UX-17)
 *
 * The indicator is a state machine:
 *   idle         — no file open → "Saved" label
 *   dirty        — active tab has unsaved changes → "Unsaved changes"
 *   saving       — save in flight → spinner + "Saving…"
 *   saved-recent — clean with recent save → "Saved · Ns ago"
 *   error        — save failed → destructive label + Retry button
 *
 * We exercise idle (no tab) and dirty (opening + editing a tab) here.
 * Saving/error paths are driven by the parent save handler and are
 * covered by unit-level tests of the component in later waves.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad } from './helpers/test-utils';

async function openTextFile(
  page: import('@playwright/test').Page,
  args: { path: string; name: string; content: string }
) {
  await page.evaluate((a) => {
    const fn = (window as unknown as {
      __openTestFile?: (p: string, n: string, c: string) => void;
    }).__openTestFile;
    if (!fn) throw new Error('__openTestFile missing');
    fn(a.path, a.name, a.content);
  }, args);
}

test.describe('Auto-save indicator (UX-17)', () => {
  test('shows "Saved" (idle state) when no file is open', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    const indicator = page.getByTestId('auto-save-indicator');
    await expect(indicator).toBeVisible();

    const state = await indicator.getAttribute('data-state');
    // idle when no tab; saved-recent if test-mode auto-opens a file.
    expect(['idle', 'saved-recent']).toContain(state);
  });

  test('cycles to "Unsaved changes" when a tab is dirty', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await openTextFile(page, {
      path: '/test-workspace/autosave-dirty.md',
      name: 'autosave-dirty.md',
      content: '# Autosave dirty test',
    });

    // Seed a dirty tab via the editor store (avoids brittle CodeMirror typing).
    await page.evaluate(() => {
      const editor = (window as any).__editorStore?.getState?.();
      const current = (window as any).__editorStore?.getState?.();
      const tab = current?.openTabs?.find((t: any) => t.path === '/test-workspace/autosave-dirty.md');
      if (tab) {
        current.updateContent(tab.path, `${tab.content}\n\nEdited.`);
      }
    });

    const indicator = page.getByTestId('auto-save-indicator');
    await expect(indicator).toHaveAttribute('data-state', 'dirty');
    await expect(indicator).toContainText('Unsaved');
  });
});
