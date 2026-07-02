/**
 * Q13 (Wave 1.4) — image paste RTL integration test.
 *
 * Mounts the real `MarkdownEditor`, dispatches a synthetic clipboard
 * paste carrying a 1×1 PNG, and verifies that:
 *   - the `writeImage` callback fires with a `media/YYYY-MM/image-<hash>.png`
 *     path and the image bytes;
 *   - the editor's Markdown content ends with `![](media/…)`.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { MarkdownEditor, type MarkdownEditorRef } from '@/features/documents/editor/MarkdownEditor';
import type { WriteImage } from '@/features/documents/editor/smartPaste';

// Minimal 1×1 transparent PNG.
const TINY_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00,
  0x1f, 0x15, 0xc4, 0x89,
  0x00, 0x00, 0x00, 0x0a,
  0x49, 0x44, 0x41, 0x54,
  0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
  0x0d, 0x0a, 0x2d, 0xb4,
  0x00, 0x00, 0x00, 0x00,
  0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

function makeImageFile(bytes: Uint8Array, type = 'image/png'): File {
  const file = new File([bytes], 'clipboard.png', { type });
  const fresh = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(fresh).set(bytes);
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => fresh,
  });
  return file;
}

function dispatchImagePaste(el: Element, file: File): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  const item = {
    kind: 'file',
    type: file.type,
    getAsFile: () => file,
  } as unknown as DataTransferItem;
  // Mimic DataTransferItemList's indexed access + length.
  const items = {
    0: item,
    length: 1,
  } as unknown as DataTransferItemList;
  const dataTransfer = {
    getData: () => '',
    items,
    files: [file] as unknown as FileList,
    types: ['Files'],
  } as unknown as DataTransfer;
  Object.defineProperty(event, 'clipboardData', { value: dataTransfer });
  el.dispatchEvent(event);
}

describe('MarkdownEditor — image paste integration', () => {
  it('writes the image via writeImage and inserts Markdown', async () => {
    const writeImage = vi.fn<WriteImage>(async () => {});
    const editorRef = createRef<MarkdownEditorRef>();

    const { container } = render(
      <MarkdownEditor
        ref={editorRef}
        initialContent=""
        writeImage={writeImage}
        hasWorkspace={() => true}
      />,
    );

    // Wait for CodeMirror to be ready.
    await waitFor(() => {
      expect(editorRef.current?.getView()).toBeTruthy();
    });

    // Pull the contenteditable surface (`.cm-content`) and dispatch the
    // synthetic paste there. CodeMirror's DOM event handlers fire from
    // the editor root.
    const contentDom = container.querySelector('.cm-content');
    expect(contentDom).toBeTruthy();

    const file = makeImageFile(TINY_PNG_BYTES);
    dispatchImagePaste(contentDom!, file);

    await waitFor(() => {
      expect(writeImage).toHaveBeenCalledTimes(1);
    });
    const args = writeImage.mock.calls[0]![0];
    expect(args.path).toMatch(/^media\/\d{4}-\d{2}\/image-[0-9a-f]{12}\.png$/);
    expect(args.bytes).toBeInstanceOf(ArrayBuffer);

    // And the editor now carries the inserted Markdown at the cursor.
    const doc = editorRef.current!.getView()!.state.doc.toString();
    expect(doc).toContain(`![](${args.path})`);
  });

  it('skips image paste when no workspace is open and toasts', async () => {
    const writeImage = vi.fn<WriteImage>(async () => {});
    const showToast = vi.fn();
    const editorRef = createRef<MarkdownEditorRef>();

    const { container } = render(
      <MarkdownEditor
        ref={editorRef}
        initialContent=""
        writeImage={writeImage}
        hasWorkspace={() => false}
        showToast={showToast}
      />,
    );

    await waitFor(() => {
      expect(editorRef.current?.getView()).toBeTruthy();
    });

    const contentDom = container.querySelector('.cm-content');
    dispatchImagePaste(contentDom!, makeImageFile(TINY_PNG_BYTES));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        'No workspace — paste an image only when a workspace is open.',
      );
    });
    expect(writeImage).not.toHaveBeenCalled();
  });
});
