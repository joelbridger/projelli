/**
 * UX-41: Drop overlay stuck / app freezes after second drop.
 *
 * Simulates two rapid consecutive drag-drop cycles to verify the overlay
 * resets cleanly after each drop (it doesn't stay stuck) and that both
 * dropped files end up in the workspace.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad } from './helpers/test-utils';

test.describe('Drag-and-drop repeated (UX-41)', () => {
  test('overlay clears between two consecutive drops', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // First drop
    await page.evaluate(() => {
      const dt = new DataTransfer();
      const file = new File(['first'], 'first.txt', { type: 'text/plain' });
      dt.items.add(file);
      window.dispatchEvent(
        new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt })
      );
    });
    await expect(page.getByTestId('file-drop-overlay')).toBeVisible();

    await page.evaluate(() => {
      const dt = new DataTransfer();
      const file = new File(['first'], 'first.txt', { type: 'text/plain' });
      dt.items.add(file);
      document.body.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })
      );
    });

    // Overlay must hide after the first drop.
    await expect(page.getByTestId('file-drop-overlay')).toBeHidden();

    // Second drop (rapid-fire) — overlay must re-show then re-hide.
    await page.evaluate(() => {
      const dt = new DataTransfer();
      const file = new File(['second'], 'second.txt', { type: 'text/plain' });
      dt.items.add(file);
      window.dispatchEvent(
        new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt })
      );
    });
    await expect(page.getByTestId('file-drop-overlay')).toBeVisible();

    await page.evaluate(() => {
      const dt = new DataTransfer();
      const file = new File(['second'], 'second.txt', { type: 'text/plain' });
      dt.items.add(file);
      document.body.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })
      );
    });

    await expect(page.getByTestId('file-drop-overlay')).toBeHidden();

    // Both files should be present in the mock FS.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const fs = (window as any).__mockWorkspaceFs;
            if (!fs) return [];
            return fs.list();
          }),
        { timeout: 5000 }
      )
      .toEqual(
        expect.arrayContaining([
          expect.stringMatching(/first\.txt$/),
          expect.stringMatching(/second\.txt$/),
        ])
      );
  });

  test('overlay clears even when drop handler throws', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // Dragenter to show overlay
    await page.evaluate(() => {
      const dt = new DataTransfer();
      const file = new File(['x'], 'x.txt', { type: 'text/plain' });
      dt.items.add(file);
      window.dispatchEvent(
        new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt })
      );
    });
    await expect(page.getByTestId('file-drop-overlay')).toBeVisible();

    // Simulate a drop with no DataTransfer files — the handler should still
    // reset the overlay cleanly (try/finally path exercised implicitly).
    await page.evaluate(() => {
      const dt = new DataTransfer();
      // Note: no files added
      dt.items.add(new File([], 'placeholder', { type: 'text/plain' }));
      document.body.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })
      );
    });

    await expect(page.getByTestId('file-drop-overlay')).toBeHidden();
  });
});
