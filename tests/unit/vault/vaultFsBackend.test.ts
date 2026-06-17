/**
 * vaultFsBackend.test.ts
 *
 * Unit tests for src/platform/fs/VaultFSBackend.ts.
 *
 * Strategy:
 *   - Construct a VaultFSBackend wrapping a FakeFSBackend that records every
 *     call (including raw bytes passed to vault_write_file).
 *   - Mock @tauri-apps/api/core so vault_write_file stores bytes and
 *     vault_read_file returns them, simulating a round-trip.
 *   - Assert:
 *       1. write('a.txt','hello') then read('a.txt') returns 'hello'
 *          (round-trip symmetry through real TextEncoder/TextDecoder).
 *       2. writeBinary / readBinary ArrayBuffer round-trip symmetry.
 *       3. list() filters .keepance-vault.json and .kpv-tmp-* entries.
 *       4. Non-content methods (exists, delete, move, copy, rename, mkdir,
 *          stat, isSymlink, resolveSymlink, getRootPath, setRootPath)
 *          delegate to the inner backend.
 *   - Bytes IPC assertion: vault_write_file receives a Uint8Array;
 *     vault_read_file returns a number[] (as Tauri serializes Vec<u8>).
 *     VaultFSBackend must bridge this correctly.
 *
 * IPC serialization note (Tauri 2):
 *   Vec<u8> returned by Rust over Tauri IPC is serialized as number[] (JSON
 *   array of integers). The TTS service pattern confirms this:
 *     invoke<number[]>('tts_speak', ...) → new Uint8Array(bytes)
 *   So vault_read_file returns number[] and VaultFSBackend must convert it to
 *   Uint8Array before decoding to string, and vault_write_file must receive
 *   a Uint8Array (which Tauri deserializes into Vec<u8> on the Rust side).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FSBackend, FileStat } from '@/platform/fs/types';
import type { FileNode } from '@/platform/types/workspace';

// ── In-memory byte store for the mock ────────────────────────────────────────
// Stores bytes per relPath. On write: records bytes. On read: returns them.
const byteStore: Map<string, number[]> = new Map();

// Track all invoke calls for assertion.
const invokeMock = vi.fn(async (command: string, args: Record<string, unknown>) => {
  if (command === 'vault_write_file') {
    const relPath = args.relPath as string;
    const bytes = args.bytes as Uint8Array;
    // Store as number[] (mirrors Tauri IPC deserialization on read path).
    byteStore.set(relPath, Array.from(bytes));
    return undefined;
  }
  if (command === 'vault_read_file') {
    const relPath = args.relPath as string;
    const stored = byteStore.get(relPath);
    if (stored === undefined) {
      throw new Error(`vault_read_file: no bytes stored for ${relPath}`);
    }
    // Return as number[] — this is how Tauri 2 serializes Vec<u8> over IPC.
    return stored;
  }
  if (command === 'vault_status') {
    return { enabled: false, locked: false, hasEscrow: false, vaultId: null };
  }
  throw new Error(`Unexpected invoke: ${command}`);
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...(a as [string, Record<string, unknown>])),
  isTauri: () => true,
}));

// ── Fake inner FSBackend ──────────────────────────────────────────────────────
// Records all delegated calls. Content methods are NOT expected to be called
// (vault intercepts them). Structure methods ARE expected.
type CallRecord = { method: string; args: unknown[] };

class FakeFSBackend implements FSBackend {
  readonly calls: CallRecord[] = [];
  private root = '/fake/root';

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args });
  }

  async read(path: string): Promise<string> {
    this.record('read', [path]);
    return `inner:${path}`;
  }
  async readBinary(path: string): Promise<ArrayBuffer> {
    this.record('readBinary', [path]);
    return new ArrayBuffer(0);
  }
  async write(path: string, content: string): Promise<void> {
    this.record('write', [path, content]);
  }
  async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
    this.record('writeBinary', [path, content]);
  }
  async exists(path: string): Promise<boolean> {
    this.record('exists', [path]);
    return false;
  }
  async delete(path: string): Promise<void> {
    this.record('delete', [path]);
  }
  async move(from: string, to: string): Promise<void> {
    this.record('move', [from, to]);
  }
  async copy(from: string, to: string): Promise<void> {
    this.record('copy', [from, to]);
  }
  async rename(path: string, newName: string): Promise<void> {
    this.record('rename', [path, newName]);
  }
  async mkdir(path: string): Promise<void> {
    this.record('mkdir', [path]);
  }
  async list(path: string): Promise<FileNode[]> {
    this.record('list', [path]);
    // Return a mix that includes vault-private names for filter testing.
    return [
      { id: 'a.txt', name: 'a.txt', type: 'file', path: 'a.txt' },
      { id: '.keepance-vault.json', name: '.keepance-vault.json', type: 'file', path: '.keepance-vault.json' },
      { id: '.kpv-tmp-abc123', name: '.kpv-tmp-abc123', type: 'file', path: '.kpv-tmp-abc123' },
      { id: 'docs', name: 'docs', type: 'folder', path: 'docs' },
      { id: '.kpv-tmp-xyz', name: '.kpv-tmp-xyz', type: 'file', path: '.kpv-tmp-xyz' },
    ];
  }
  async stat(path: string): Promise<FileStat> {
    this.record('stat', [path]);
    return {
      path,
      name: path,
      type: 'file',
      size: 0,
      modifiedAt: new Date(),
      createdAt: new Date(),
      isSymlink: false,
    };
  }
  async isSymlink(path: string): Promise<boolean> {
    this.record('isSymlink', [path]);
    return false;
  }
  async resolveSymlink(path: string): Promise<string> {
    this.record('resolveSymlink', [path]);
    return path;
  }
  getRootPath(): string {
    return this.root;
  }
  async setRootPath(path: string): Promise<void> {
    this.record('setRootPath', [path]);
    this.root = path;
  }
}

// ── Import after mocks ────────────────────────────────────────────────────────
import { VaultFSBackend } from '@/platform/fs/VaultFSBackend';

const WORKSPACE = '/fake/root';

// ── Setup ─────────────────────────────────────────────────────────────────────
let inner: FakeFSBackend;
let vault: VaultFSBackend;

beforeEach(() => {
  byteStore.clear();
  invokeMock.mockClear();
  inner = new FakeFSBackend();
  vault = new VaultFSBackend(inner, WORKSPACE);
});

// ── read / write round-trip ───────────────────────────────────────────────────

describe('VaultFSBackend — text round-trip', () => {
  it('write then read returns the original string', async () => {
    await vault.write('a.txt', 'hello');
    const result = await vault.read('a.txt');
    expect(result).toBe('hello');
  });

  it('write calls vault_write_file with the correct workspace and relPath', async () => {
    await vault.write('docs/contract.txt', 'content');

    const writeCall = invokeMock.mock.calls.find((c) => c[0] === 'vault_write_file');
    expect(writeCall).toBeDefined();
    expect(writeCall![1]).toMatchObject({
      workspace: WORKSPACE,
      relPath: 'docs/contract.txt',
    });
  });

  it('write sends bytes as Uint8Array to vault_write_file', async () => {
    await vault.write('a.txt', 'hello');

    const writeCall = invokeMock.mock.calls.find((c) => c[0] === 'vault_write_file');
    expect(writeCall).toBeDefined();
    const bytes = writeCall![1].bytes as Uint8Array;
    // In jsdom/vitest the Uint8Array may come from a different realm, so we
    // check via constructor name rather than instanceof.
    expect(bytes.constructor.name).toBe('Uint8Array');
    // Verify the bytes are the UTF-8 encoding of 'hello'.
    const expected = new TextEncoder().encode('hello');
    expect(Array.from(bytes)).toEqual(Array.from(expected));
  });

  it('read calls vault_read_file with the correct workspace and relPath', async () => {
    // Pre-seed the store so read does not throw.
    byteStore.set('memo.txt', Array.from(new TextEncoder().encode('memo content')));

    await vault.read('memo.txt');

    const readCall = invokeMock.mock.calls.find((c) => c[0] === 'vault_read_file');
    expect(readCall).toBeDefined();
    expect(readCall![1]).toMatchObject({
      workspace: WORKSPACE,
      relPath: 'memo.txt',
    });
  });

  it('handles empty string round-trip', async () => {
    await vault.write('empty.txt', '');
    const result = await vault.read('empty.txt');
    expect(result).toBe('');
  });

  it('handles multi-byte UTF-8 round-trip', async () => {
    const content = 'Müller & Søren — договор';
    await vault.write('utf8.txt', content);
    const result = await vault.read('utf8.txt');
    expect(result).toBe(content);
  });
});

// ── binary round-trip ─────────────────────────────────────────────────────────

describe('VaultFSBackend — binary round-trip', () => {
  it('writeBinary then readBinary returns the original ArrayBuffer', async () => {
    const original = new Uint8Array([0x01, 0x02, 0x03, 0xFF, 0x00]).buffer;
    await vault.writeBinary('file.bin', original);
    const result = await vault.readBinary('file.bin');
    expect(new Uint8Array(result)).toEqual(new Uint8Array(original));
  });

  it('writeBinary sends bytes as Uint8Array to vault_write_file', async () => {
    const data = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]).buffer;
    await vault.writeBinary('data.bin', data);

    const writeCall = invokeMock.mock.calls.find((c) => c[0] === 'vault_write_file');
    expect(writeCall).toBeDefined();
    const bytes = writeCall![1].bytes as Uint8Array;
    expect(bytes.constructor.name).toBe('Uint8Array');
    expect(Array.from(bytes)).toEqual([0xDE, 0xAD, 0xBE, 0xEF]);
  });

  it('readBinary returns an ArrayBuffer from number[] IPC response', async () => {
    // Simulate Tauri returning number[] for Vec<u8>.
    byteStore.set('img.png', [0x89, 0x50, 0x4E, 0x47]);
    const result = await vault.readBinary('img.png');
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result)).toEqual(new Uint8Array([0x89, 0x50, 0x4E, 0x47]));
  });
});

// ── list filtering ────────────────────────────────────────────────────────────

describe('VaultFSBackend — list filtering', () => {
  it('delegates list to inner and filters .keepance-vault.json', async () => {
    const nodes = await vault.list('');
    const names = nodes.map((n) => n.name);
    expect(names).not.toContain('.keepance-vault.json');
  });

  it('filters all .kpv-tmp-* entries', async () => {
    const nodes = await vault.list('');
    const names = nodes.map((n) => n.name);
    expect(names).not.toContain('.kpv-tmp-abc123');
    expect(names).not.toContain('.kpv-tmp-xyz');
  });

  it('keeps legitimate files and folders', async () => {
    const nodes = await vault.list('');
    const names = nodes.map((n) => n.name);
    expect(names).toContain('a.txt');
    expect(names).toContain('docs');
  });

  it('calls inner.list for list delegation', async () => {
    await vault.list('some/path');
    const listCall = inner.calls.find((c) => c.method === 'list');
    expect(listCall).toBeDefined();
    expect(listCall!.args[0]).toBe('some/path');
  });
});

// ── delegation of non-content methods ────────────────────────────────────────

describe('VaultFSBackend — inner delegation', () => {
  it('exists delegates to inner', async () => {
    await vault.exists('some/path');
    expect(inner.calls.some((c) => c.method === 'exists' && c.args[0] === 'some/path')).toBe(true);
  });

  it('delete delegates to inner', async () => {
    await vault.delete('old-file.txt');
    expect(inner.calls.some((c) => c.method === 'delete' && c.args[0] === 'old-file.txt')).toBe(true);
  });

  it('move delegates to inner', async () => {
    await vault.move('a.txt', 'b.txt');
    expect(inner.calls.some((c) => c.method === 'move' && c.args[0] === 'a.txt' && c.args[1] === 'b.txt')).toBe(true);
  });

  it('copy delegates to inner', async () => {
    await vault.copy('src.txt', 'dst.txt');
    expect(inner.calls.some((c) => c.method === 'copy' && c.args[0] === 'src.txt' && c.args[1] === 'dst.txt')).toBe(true);
  });

  it('rename delegates to inner', async () => {
    await vault.rename('old.txt', 'new.txt');
    expect(inner.calls.some((c) => c.method === 'rename' && c.args[0] === 'old.txt' && c.args[1] === 'new.txt')).toBe(true);
  });

  it('mkdir delegates to inner', async () => {
    await vault.mkdir('new-dir');
    expect(inner.calls.some((c) => c.method === 'mkdir' && c.args[0] === 'new-dir')).toBe(true);
  });

  it('stat delegates to inner', async () => {
    await vault.stat('file.txt');
    expect(inner.calls.some((c) => c.method === 'stat' && c.args[0] === 'file.txt')).toBe(true);
  });

  it('isSymlink delegates to inner', async () => {
    await vault.isSymlink('link');
    expect(inner.calls.some((c) => c.method === 'isSymlink' && c.args[0] === 'link')).toBe(true);
  });

  it('resolveSymlink delegates to inner', async () => {
    await vault.resolveSymlink('link');
    expect(inner.calls.some((c) => c.method === 'resolveSymlink' && c.args[0] === 'link')).toBe(true);
  });

  it('getRootPath returns inner root path', () => {
    expect(vault.getRootPath()).toBe('/fake/root');
  });

  it('setRootPath delegates to inner', async () => {
    await vault.setRootPath('/new/root');
    expect(inner.calls.some((c) => c.method === 'setRootPath' && c.args[0] === '/new/root')).toBe(true);
  });

  it('does NOT call inner.read when vault.read is called', async () => {
    byteStore.set('a.txt', Array.from(new TextEncoder().encode('data')));
    await vault.read('a.txt');
    expect(inner.calls.some((c) => c.method === 'read')).toBe(false);
  });

  it('does NOT call inner.write when vault.write is called', async () => {
    await vault.write('a.txt', 'data');
    expect(inner.calls.some((c) => c.method === 'write')).toBe(false);
  });
});

// ── IPC bytes symmetry assertion ──────────────────────────────────────────────

describe('VaultFSBackend — IPC bytes serialization', () => {
  it('write encodes string to UTF-8 Uint8Array for IPC; read decodes number[] back to string', async () => {
    // This test explicitly verifies the IPC contract:
    //   - write path: string → TextEncoder → Uint8Array (sent to Rust as bytes)
    //   - read path: number[] (returned by Tauri IPC for Vec<u8>) → Uint8Array → TextDecoder → string
    const original = 'The quick brown fox';

    await vault.write('fox.txt', original);

    // Verify sent bytes are correct UTF-8.
    const writeCall = invokeMock.mock.calls.find((c) => c[0] === 'vault_write_file');
    const sentBytes = writeCall![1].bytes as Uint8Array;
    expect(sentBytes.constructor.name).toBe('Uint8Array');
    expect(new TextDecoder().decode(sentBytes)).toBe(original);

    // The mock stores as number[] (simulating Tauri Vec<u8> → JSON number[]).
    // vault_read_file mock returns number[]; VaultFSBackend must handle that.
    const retrieved = await vault.read('fox.txt');
    expect(retrieved).toBe(original);
  });

  it('the bytes store accumulates correctly across multiple writes', async () => {
    await vault.write('file1.txt', 'first');
    await vault.write('file2.txt', 'second');

    expect(await vault.read('file1.txt')).toBe('first');
    expect(await vault.read('file2.txt')).toBe('second');
  });
});
