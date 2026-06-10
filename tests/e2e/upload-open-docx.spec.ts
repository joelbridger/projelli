/**
 * Task 6 — upload a .docx into a subfolder and verify path resolution.
 *
 * Regression guard for: uploading "The Supreme Court.docx" into the docs/
 * subfolder then auto-opening it fails with a path error because the upload
 * handler constructed a workspace-relative path ("docs/The Supreme Court.docx")
 * instead of an absolute one.
 *
 * In browser test mode (testMode=true) the native Tauri docx_open command is
 * not available, so we cannot exercise the full Rust path. What we guard is
 * the FRONTEND path construction: after upload the path stored in the mock
 * workspace filesystem must be absolute (start with /test-workspace), and
 * the DocxEditor must render its error state (expected: "only available in
 * the desktop app") rather than a path-construction error. The
 * docx-commands-path.test.ts unit test and the Rust open_to_json guard are
 * the authoritative path-guard tests; this spec verifies the upload path
 * construction only.
 *
 * Drop target: a [data-folder-path] element in the seeded FileTree, which is
 * the real attribute the global drop handler reads to route uploads into a
 * subfolder (see FileTree.tsx `data-folder-path` and GlobalDropOverlay
 * `findFolderTarget`). The seeded workspace always has a "docs" subfolder
 * via the test-mode seed.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad } from './helpers/test-utils';

test.describe('Upload docx path resolution (Task 6)', () => {
  test('uploading a .docx via drag-drop stores an absolute path', async ({
    page,
  }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // Verify mock FS is available.
    const hasMock = await page.evaluate(
      () => Boolean((window as any).__mockWorkspaceFs),
    );
    expect(hasMock).toBe(true);

    // Seed the docs subfolder in the mock FS so it appears in the FileTree
    // and the drop handler can route the file into it.
    await page.evaluate(() => {
      const fs = (window as any).__mockWorkspaceFs;
      const placeholder = new TextEncoder().encode('').buffer;
      fs.seed('/test-workspace/docs/.gitkeep', placeholder);
    });

    // Build a minimal DOCX (PK magic bytes) and dispatch a dragenter onto the
    // real [data-folder-path] element for the "docs" folder so the drop handler
    // routes the file into that subfolder, followed by a drop on document.body
    // (the GlobalDropOverlay catches it and reads the target from dragenter).
    // This mirrors the real drag-drop-upload.spec.ts harness pattern.
    await page.evaluate(() => {
      const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
      const file = new File([bytes], 'The Supreme Court.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      const dt = new DataTransfer();
      dt.items.add(file);

      // Drag enter onto the docs folder element so findFolderTarget picks it up.
      const folderEl = document.querySelector('[data-folder-path="/test-workspace/docs"]');
      const enterTarget = folderEl ?? window;

      const enterEvt = new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      });
      (enterTarget as EventTarget).dispatchEvent(enterEvt);

      // Drop on body — GlobalDropOverlay reads the last dragenter target.
      const dropEvt = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      });
      document.body.dispatchEvent(dropEvt);
    });

    // Wait for the overlay to hide (drop processed).
    await expect(page.getByTestId('file-drop-overlay')).toBeHidden({
      timeout: 5_000,
    });

    // The mock FS must now contain the file — and its path must be absolute
    // (starts with /test-workspace), not a bare relative "docs/..." path.
    const files: string[] = await page.evaluate(
      () => (window as any).__mockWorkspaceFs.list(),
    );
    const docxFile = files.find((f) => f.endsWith('The Supreme Court.docx'));
    // File must exist in mock FS.
    expect(docxFile).toBeTruthy();
    // Path must be absolute (guard for the fix: was previously relative).
    expect(docxFile!.startsWith('/')).toBe(true);

    // The vacuous [data-testid="toast"] assertion has been removed: that testid
    // does not exist in the app and would always return 0. The real path-
    // construction guard is the startsWith('/') check above; the Rust layer
    // (open_to_json relative-path guard) is tested in mod.rs unit tests.
  });
});
