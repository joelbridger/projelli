/**
 * History button hidden for non-versioned file types (UX-24)
 *
 * `shouldVersionFile()` only returns true for md/txt/json/source/aichat/
 * whiteboard files. For binary document types (xlsx/docx/pptx) the history
 * item should not appear in the overflow menu.
 *
 * History now lives inside the unified "…" overflow rather than as a
 * standalone inline button. Tests open the overflow before asserting.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick } from './helpers/test-utils';

async function openFile(
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

test.describe('History button visibility (UX-24)', () => {
  test('shows History in the overflow for a versioned .md file', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await openFile(page, {
      path: '/test-workspace/versioned.md',
      name: 'versioned.md',
      content: '# hello',
    });

    // Open the overflow menu to reveal secondary controls.
    await hardClick(page.getByTestId('toolbar-overflow'));
    await expect(page.getByTestId('toolbar-history')).toBeVisible();
  });

  test('hides History from the overflow for a non-versioned .xlsx file', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // Use a minimal data URL; we don't need a real xlsx — the History
    // item's render path only cares about the extension.
    await openFile(page, {
      path: '/test-workspace/non-versioned.xlsx',
      name: 'non-versioned.xlsx',
      content: 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,',
    });

    // Open the overflow menu and verify History is absent.
    await hardClick(page.getByTestId('toolbar-overflow'));
    await expect(page.getByTestId('toolbar-history')).toHaveCount(0);
  });
});
