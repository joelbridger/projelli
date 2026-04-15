/**
 * Drag-and-drop file upload (UX-19)
 *
 * We dispatch synthetic dragenter/dragover/drop events with a DataTransfer
 * that includes a File. Playwright doesn't wire File objects through
 * page.dispatchEvent seamlessly, so we build the DataTransfer inside the
 * page context via evaluate and dispatch from there.
 *
 * For this test we only verify:
 *   1. The drop overlay appears while files are being dragged.
 *   2. A drop writes the file to the mock workspace (inspectable via
 *      window.__mockWorkspaceFs).
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad } from './helpers/test-utils';

test.describe('Drag-and-drop file upload (UX-19)', () => {
  test('shows drop overlay while dragging, creates file on drop', async ({
    page,
  }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // Sanity: mock workspace FS exposed.
    const hasMock = await page.evaluate(
      () => Boolean((window as any).__mockWorkspaceFs)
    );
    expect(hasMock).toBe(true);

    // Dispatch dragenter with a File in the DataTransfer. The overlay
    // should become visible.
    await page.evaluate(() => {
      const dt = new DataTransfer();
      const file = new File(['hello from test'], 'dropped.txt', {
        type: 'text/plain',
      });
      dt.items.add(file);
      const evt = new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      });
      window.dispatchEvent(evt);
    });

    await expect(page.getByTestId('file-drop-overlay')).toBeVisible();

    // Now dispatch drop with the same payload.
    await page.evaluate(() => {
      const dt = new DataTransfer();
      const file = new File(['hello from test'], 'dropped.txt', {
        type: 'text/plain',
      });
      dt.items.add(file);
      const evt = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      });
      // Target the body so findFolderTarget returns null → workspace root.
      document.body.dispatchEvent(evt);
    });

    // The overlay hides after the drop.
    await expect(page.getByTestId('file-drop-overlay')).toBeHidden();

    // The mock workspace should now have a file under the root.
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
      .toEqual(expect.arrayContaining([expect.stringMatching(/dropped\.txt$/)]));
  });
});
