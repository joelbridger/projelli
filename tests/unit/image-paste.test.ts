/**
 * Q13 (Wave 1.4) — image paste unit tests.
 *
 * Verifies the pure helpers used by the smart-paste extension:
 *   - SHA-256 hash stability (same bytes → same 12-hex prefix)
 *   - MIME → extension mapping
 *   - Workspace-relative media path formatting
 *   - `processImageFile` end-to-end — dedupe on same hash, 20MB cap,
 *     MIME fallthrough, no-workspace toast, success inserts Markdown.
 */

import { describe, it, expect, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  buildImageMediaPath,
  formatYearMonth,
  hashImageBytes,
  IMAGE_PASTE_MAX_BYTES,
  mimeToExtension,
  processImageFile,
} from '@/features/documents/editor/smartPaste';

// Minimal 1×1 transparent PNG (the canonical "png-shaped bytes" test
// blob). These bytes are checked byte-for-byte by our hash test.
const TINY_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
  0x00, 0x00, 0x00, 0x0d, // IHDR length
  0x49, 0x48, 0x44, 0x52, // "IHDR"
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00,
  0x1f, 0x15, 0xc4, 0x89, // IHDR CRC
  0x00, 0x00, 0x00, 0x0a, // IDAT length
  0x49, 0x44, 0x41, 0x54,
  0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
  0x0d, 0x0a, 0x2d, 0xb4, // IDAT CRC
  0x00, 0x00, 0x00, 0x00, // IEND length
  0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

describe('mimeToExtension', () => {
  it('maps known image types', () => {
    expect(mimeToExtension('image/png')).toBe('png');
    expect(mimeToExtension('image/jpeg')).toBe('jpg');
    expect(mimeToExtension('image/jpg')).toBe('jpg');
    expect(mimeToExtension('image/gif')).toBe('gif');
    expect(mimeToExtension('image/webp')).toBe('webp');
  });
  it('is case-insensitive', () => {
    expect(mimeToExtension('IMAGE/PNG')).toBe('png');
    expect(mimeToExtension('Image/Jpeg')).toBe('jpg');
  });
  it('returns null for unhandled types', () => {
    expect(mimeToExtension('image/bmp')).toBeNull();
    expect(mimeToExtension('image/svg+xml')).toBeNull();
    expect(mimeToExtension('text/plain')).toBeNull();
    expect(mimeToExtension('')).toBeNull();
  });
});

describe('formatYearMonth', () => {
  it('pads month and uses local calendar', () => {
    expect(formatYearMonth(new Date(2026, 0, 15))).toBe('2026-01');
    expect(formatYearMonth(new Date(2026, 11, 1))).toBe('2026-12');
  });
});

describe('buildImageMediaPath', () => {
  it('formats workspace-relative path', () => {
    expect(
      buildImageMediaPath({
        hash: 'abcdef012345',
        extension: 'png',
        yearMonth: '2026-04',
      }),
    ).toBe('media/2026-04/image-abcdef012345.png');
  });
});

describe('hashImageBytes', () => {
  it('returns 12 hex chars', async () => {
    const hash = await hashImageBytes(TINY_PNG_BYTES.buffer as ArrayBuffer);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });
  it('is stable for the same bytes', async () => {
    const a = await hashImageBytes(TINY_PNG_BYTES.buffer as ArrayBuffer);
    const b = await hashImageBytes(
      new Uint8Array(TINY_PNG_BYTES).buffer as ArrayBuffer,
    );
    expect(a).toBe(b);
  });
  it('differs for different bytes', async () => {
    const a = await hashImageBytes(TINY_PNG_BYTES.buffer as ArrayBuffer);
    const other = new Uint8Array(TINY_PNG_BYTES);
    other[0] = 0x00; // mutate the magic byte
    const b = await hashImageBytes(other.buffer as ArrayBuffer);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------
// processImageFile integration
// ---------------------------------------------------------------------

function createView(doc = ''): { view: EditorView; parent: HTMLDivElement } {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
    }),
    parent,
  });
  return { view, parent };
}

function makeImageFile(bytes: Uint8Array, type = 'image/png', name = 'clip.png'): File {
  const file = new File([bytes], name, { type });
  // jsdom's File doesn't implement `.arrayBuffer()`. Provide a faithful
  // shim that returns a fresh, standalone ArrayBuffer carrying the same
  // bytes we fed in. We have to allocate a new ArrayBuffer rather than
  // returning a slice of `bytes.buffer` because crypto.subtle.digest
  // rejects views whose byteOffset is non-zero in some Node versions.
  const fresh = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(fresh).set(bytes);
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => fresh,
  });
  return file;
}

describe('processImageFile', () => {
  it('writes the image and inserts markdown at the cursor', async () => {
    const { view } = createView('before ');
    const writeImage = vi.fn(async (_args: { path: string; bytes: ArrayBuffer }) => {});
    const resolved = vi.fn();
    const file = makeImageFile(TINY_PNG_BYTES);
    await processImageFile({
      file,
      view,
      writeImage,
      hasWorkspace: () => true,
      now: () => new Date(2026, 3, 16),
      onImagePasteResolved: resolved,
    });
    expect(writeImage).toHaveBeenCalledTimes(1);
    const call = writeImage.mock.calls[0]![0];
    expect(call.path).toMatch(/^media\/2026-04\/image-[0-9a-f]{12}\.png$/);
    expect(view.state.doc.toString()).toBe(`before ![](${call.path})`);
    expect(resolved).toHaveBeenCalledWith({
      path: call.path,
      bytes: expect.any(ArrayBuffer),
    });
  });

  it('skips image paste when no workspace is open, with toast', async () => {
    const { view } = createView();
    const writeImage = vi.fn(async (_args: { path: string; bytes: ArrayBuffer }) => {});
    const showToast = vi.fn();
    await processImageFile({
      file: makeImageFile(TINY_PNG_BYTES),
      view,
      writeImage,
      hasWorkspace: () => false,
      showToast,
    });
    expect(writeImage).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'No workspace — paste an image only when a workspace is open.',
    );
    expect(view.state.doc.toString()).toBe('');
  });

  it('refuses images larger than 20 MB with a toast', async () => {
    const { view } = createView();
    const writeImage = vi.fn(async (_args: { path: string; bytes: ArrayBuffer }) => {});
    const showToast = vi.fn();
    // Construct a small File then fake its reported `size` so we don't
    // have to materialise 20 MB of bytes in memory.
    const file = makeImageFile(TINY_PNG_BYTES, 'image/png', 'huge.png');
    Object.defineProperty(file, 'size', {
      value: IMAGE_PASTE_MAX_BYTES + 1,
    });
    await processImageFile({
      file,
      view,
      writeImage,
      hasWorkspace: () => true,
      showToast,
    });
    expect(writeImage).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('Image too large (20MB max).');
  });

  it('bails for unsupported MIME types without toasting', async () => {
    const { view } = createView();
    const writeImage = vi.fn(async (_args: { path: string; bytes: ArrayBuffer }) => {});
    const showToast = vi.fn();
    const file = makeImageFile(TINY_PNG_BYTES, 'image/svg+xml', 'x.svg');
    await processImageFile({
      file,
      view,
      writeImage,
      hasWorkspace: () => true,
      showToast,
    });
    expect(writeImage).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('dedupe: the same bytes resolve to the same path (writer responsible for skip)', async () => {
    const { view } = createView();
    const writeImage = vi.fn(async (_args: { path: string; bytes: ArrayBuffer }) => {});
    const call = async () =>
      processImageFile({
        file: makeImageFile(TINY_PNG_BYTES),
        view,
        writeImage,
        hasWorkspace: () => true,
        now: () => new Date(2026, 3, 16),
      });
    await call();
    await call();
    expect(writeImage).toHaveBeenCalledTimes(2);
    const first = writeImage.mock.calls[0]![0].path;
    const second = writeImage.mock.calls[1]![0].path;
    expect(first).toBe(second);
  });

  it('surfaces a toast when the writer throws', async () => {
    const { view } = createView();
    const writeImage = vi.fn(async () => {
      throw new Error('disk full');
    });
    const showToast = vi.fn();
    await processImageFile({
      file: makeImageFile(TINY_PNG_BYTES),
      view,
      writeImage,
      hasWorkspace: () => true,
      showToast,
    });
    expect(showToast).toHaveBeenCalledWith('Failed to save image.');
    expect(view.state.doc.toString()).toBe('');
  });

  it('does nothing when writeImage is not provided', async () => {
    const { view } = createView('x');
    const showToast = vi.fn();
    await processImageFile({
      file: makeImageFile(TINY_PNG_BYTES),
      view,
      hasWorkspace: () => true,
      showToast,
    });
    expect(showToast).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe('x');
  });
});
