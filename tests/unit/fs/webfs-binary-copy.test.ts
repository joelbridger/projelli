/**
 * BUG-033 regression — WebFSBackend.copy / .move must preserve raw bytes.
 *
 * The browser FS backend previously copied/moved FILES by round-tripping
 * through read() (decodes as UTF-8 text) and write() (re-encodes text). For a
 * binary file (PDF / DOCX / image / Office) that text round-trip mangles every
 * byte that isn't valid UTF-8 — the copied/moved file is corrupt.
 *
 * The fix routes file copy/move through readBinary() / writeBinary() so bytes
 * are preserved verbatim. This test drives the real WebFSBackend against an
 * in-memory File System Access API mock whose files store raw bytes and whose
 * .text() decodes them as UTF-8 (exactly like a real browser) — so it goes RED
 * on the old text round-trip and GREEN on the byte-safe path.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { WebFSBackend } from '@/platform/fs/WebFSBackend';

// --- Minimal in-memory File System Access API mock ----------------------------
// Files store raw bytes. write(string) encodes UTF-8; write(ArrayBuffer/Uint8Array)
// stores bytes verbatim. getFile().text() decodes UTF-8 (lossy for binary);
// getFile().arrayBuffer() returns the raw bytes. This mirrors real browser
// behaviour and is what makes the binary-corruption bug observable.

class MemFileHandle {
  kind = 'file' as const;
  bytes = new Uint8Array(0);
  constructor(public name: string) {}

  async getFile() {
    const bytes = this.bytes;
    return {
      size: bytes.length,
      lastModified: 0,
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () => bytes.slice().buffer,
    };
  }

  async createWritable() {
    const self = this;
    let buf = new Uint8Array(0);
    return {
      write: async (chunk: unknown) => {
        // Mirror a real createWritable().write(): accepts string | BufferSource.
        if (typeof chunk === 'string') {
          buf = new TextEncoder().encode(chunk);
        } else if (ArrayBuffer.isView(chunk)) {
          const view = chunk as ArrayBufferView;
          buf = new Uint8Array(
            view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
          );
        } else if (
          chunk instanceof ArrayBuffer ||
          Object.prototype.toString.call(chunk) === '[object ArrayBuffer]'
        ) {
          buf = new Uint8Array((chunk as ArrayBuffer).slice(0));
        } else {
          throw new Error(
            `unsupported write chunk type: ${Object.prototype.toString.call(chunk)}`,
          );
        }
      },
      close: async () => {
        self.bytes = buf;
      },
    };
  }
}

class MemDirHandle {
  kind = 'directory' as const;
  children = new Map<string, MemFileHandle | MemDirHandle>();
  constructor(public name: string) {}

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    let entry = this.children.get(name);
    if (!entry) {
      if (!opts?.create) throw new Error(`NotFound: ${name}`);
      entry = new MemFileHandle(name);
      this.children.set(name, entry);
    }
    if (entry.kind !== 'file') throw new Error(`TypeMismatch: ${name}`);
    return entry as unknown as FileSystemFileHandle;
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let entry = this.children.get(name);
    if (!entry) {
      if (!opts?.create) throw new Error(`NotFound: ${name}`);
      entry = new MemDirHandle(name);
      this.children.set(name, entry);
    }
    if (entry.kind !== 'directory') throw new Error(`TypeMismatch: ${name}`);
    return entry as unknown as FileSystemDirectoryHandle;
  }

  async removeEntry(name: string) {
    if (!this.children.has(name)) throw new Error(`NotFound: ${name}`);
    this.children.delete(name);
  }

  async *entries(): AsyncGenerator<[string, MemFileHandle | MemDirHandle]> {
    for (const [name, handle] of this.children) yield [name, handle];
  }
}

// Bytes that are NOT valid standalone UTF-8 (0xFF/0xFE never appear; 0xC0 0x80
// is an overlong encoding) — these are exactly what a text round-trip destroys.
const PNG_LIKE_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0xff, 0xc0, 0x00, 0x11, 0x08, 0xff, 0xfe, 0xc0, 0x80, 0x00,
]);

describe('BUG-033 — WebFSBackend preserves binary bytes on copy/move', () => {
  let backend: WebFSBackend;
  let root: MemDirHandle;

  beforeEach(async () => {
    backend = new WebFSBackend();
    root = new MemDirHandle('workspace');
    backend.setRootHandle(root as unknown as FileSystemDirectoryHandle);
    await backend.writeBinary('/workspace/original.png', PNG_LIKE_BYTES.slice().buffer);
  });

  it('copy() keeps every byte of a binary file intact', async () => {
    await backend.copy('/workspace/original.png', '/workspace/copy.png');

    const copied = new Uint8Array(await backend.readBinary('/workspace/copy.png'));
    expect(Array.from(copied)).toEqual(Array.from(PNG_LIKE_BYTES));

    // Original must still be present and intact after a copy.
    const orig = new Uint8Array(await backend.readBinary('/workspace/original.png'));
    expect(Array.from(orig)).toEqual(Array.from(PNG_LIKE_BYTES));
  });

  it('move() keeps every byte and removes the source', async () => {
    await backend.move('/workspace/original.png', '/workspace/moved.png');

    const moved = new Uint8Array(await backend.readBinary('/workspace/moved.png'));
    expect(Array.from(moved)).toEqual(Array.from(PNG_LIKE_BYTES));

    expect(await backend.exists('/workspace/original.png')).toBe(false);
    expect(await backend.exists('/workspace/moved.png')).toBe(true);
  });

  it('still copies plain text files correctly', async () => {
    await backend.write('/workspace/note.txt', 'hello world');
    await backend.copy('/workspace/note.txt', '/workspace/note-copy.txt');
    expect(await backend.read('/workspace/note-copy.txt')).toBe('hello world');
  });
});
