/**
 * vault-fs.mockipc.test.ts
 *
 * IPC boundary tests for the encrypted file-IO commands (vault_read_file /
 * vault_write_file) as invoked by `VaultFSBackend` and the low-level
 * `vaultReadFile` / `vaultWriteFile` functions in `vaultClient.ts`.
 *
 * Uses Tauri's `mockIPC` to intercept the real `invoke()` call without a Rust
 * build or an actual encrypted vault on disk.
 *
 * ## Real command names + arg shapes (confirmed from source)
 *
 *   VaultFSBackend.read(path)
 *     invoke<number[]>('vault_read_file', { workspace: string, relPath: string })
 *     Returns number[] (Tauri Vec<u8> JSON serialization) which the backend
 *     converts to a string via new Uint8Array(bytes) + TextDecoder.
 *
 *   VaultFSBackend.write(path, content)
 *     invoke('vault_write_file', { workspace: string, relPath: string, bytes: Uint8Array })
 *     bytes = TextEncoder.encode(content)
 *
 *   VaultFSBackend.readBinary(path)
 *     Same invoke as read() but returns ArrayBuffer instead of string.
 *
 *   VaultFSBackend.writeBinary(path, content)
 *     Same invoke as write() but bytes = new Uint8Array(content).
 *
 *   vaultReadFile(workspace, relPath) in vaultClient.ts
 *     invoke<Uint8Array>('vault_read_file', { workspace, relPath })
 *
 *   vaultWriteFile(workspace, relPath, bytes) in vaultClient.ts
 *     invoke('vault_write_file', { workspace, relPath, bytes })
 *
 * ## Why these tests would FAIL on wrong wiring
 *   - Wrong command name (e.g. 'vault_read' vs 'vault_read_file'): the mockIPC
 *     handler throws "unexpected command" and the test fails.
 *   - Wrong arg key (e.g. 'path' vs 'relPath', 'root' vs 'workspace'): the
 *     `toMatchObject` / `toEqual` assertions fail.
 *   - Wrong bytes type sent to write (e.g. passing a string instead of
 *     Uint8Array): the assertion on `bytes.constructor.name` fails.
 *   - Wrong decode of the number[] read reply: the decoded string would not
 *     match the expected value.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import type { FSBackend, FileStat } from '@/platform/fs/types';
import type { FileNode } from '@/platform/types/workspace';

// ── Minimal stub inner FSBackend (for VaultFSBackend constructor) ─────────────

class StubFSBackend implements FSBackend {
  private root: string;
  constructor(root = '/workspace/test') { this.root = root; }
  async read(_: string): Promise<string> { return ''; }
  async readBinary(_: string): Promise<ArrayBuffer> { return new ArrayBuffer(0); }
  async write(_p: string, _c: string): Promise<void> {}
  async writeBinary(_p: string, _c: ArrayBuffer): Promise<void> {}
  async exists(_: string): Promise<boolean> { return false; }
  async delete(_: string): Promise<void> {}
  async move(_f: string, _t: string): Promise<void> {}
  async copy(_f: string, _t: string): Promise<void> {}
  async rename(_p: string, _n: string): Promise<void> {}
  async mkdir(_: string): Promise<void> {}
  async list(_: string): Promise<FileNode[]> { return []; }
  async stat(path: string): Promise<FileStat> {
    return { path, name: path, type: 'file', size: 0, modifiedAt: new Date(), createdAt: new Date(), isSymlink: false };
  }
  async isSymlink(_: string): Promise<boolean> { return false; }
  async resolveSymlink(p: string): Promise<string> { return p; }
  getRootPath(): string { return this.root; }
  async setRootPath(p: string): Promise<void> { this.root = p; }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface Captured {
  cmd: string;
  args: unknown;
}

const WORKSPACE = '/workspace/test';

// ── VaultFSBackend: vault_read_file ──────────────────────────────────────────

describe('IPC boundary: VaultFSBackend vault_read_file', () => {
  let vault: import('@/platform/fs/VaultFSBackend').VaultFSBackend;

  beforeEach(async () => {
    mockIPC(() => undefined); // placeholder
    const { VaultFSBackend } = await import('@/platform/fs/VaultFSBackend');
    vault = new VaultFSBackend(new StubFSBackend(WORKSPACE), WORKSPACE);
  });

  afterEach(() => {
    clearMocks();
  });

  it('read() invokes vault_read_file with { workspace, relPath }', async () => {
    const captured: Captured[] = [];
    const fakeBytes = Array.from(new TextEncoder().encode('hello from vault'));

    mockIPC((cmd, args) => {
      captured.push({ cmd, args });
      if (cmd === 'vault_read_file') return fakeBytes;
      throw new Error(`unexpected command: ${cmd}`);
    });

    const result = await vault.read('docs/contract.txt');

    const readCall = captured.find((c) => c.cmd === 'vault_read_file');
    expect(readCall, 'vault_read_file was not invoked').toBeDefined();

    // Exact arg shape -- wrong key names ('path' or 'root') would fail here.
    expect(readCall!.args).toEqual({
      workspace: WORKSPACE,
      relPath: 'docs/contract.txt',
    });

    // The backend must decode the number[] reply into the original string.
    expect(result).toBe('hello from vault');
  });

  it('read() fails if the command name is wrong (test validity)', async () => {
    const captured: Captured[] = [];
    const fakeBytes = [104, 105]; // 'hi'

    mockIPC((cmd, args) => {
      captured.push({ cmd, args });
      // Accept both correct and incorrect names so we can inspect what was sent.
      return fakeBytes;
    });

    await vault.read('some/file.txt');

    // Real wrapper sends 'vault_read_file'. If it sent 'vault_read' instead,
    // the test below would find a call to 'vault_read' and NOT find one to
    // 'vault_read_file' -- causing the assertions to fail.
    const correctCmd = captured.find((c) => c.cmd === 'vault_read_file');
    const wrongCmd = captured.find((c) => c.cmd === 'vault_read');
    expect(correctCmd).toBeDefined();
    expect(wrongCmd).toBeUndefined();
  });

  it('read() decodes number[] (Vec<u8> IPC serialization) into UTF-8 string', async () => {
    // Tauri 2 serializes Rust Vec<u8> as number[] over IPC.
    // VaultFSBackend must bridge: number[] -> Uint8Array -> TextDecoder -> string.
    const original = 'Confidential: client data here.';
    const numberArray = Array.from(new TextEncoder().encode(original));

    mockIPC((cmd) => {
      if (cmd === 'vault_read_file') return numberArray;
      throw new Error(`unexpected command: ${cmd}`);
    });

    const decoded = await vault.read('secret.txt');
    expect(decoded).toBe(original);
  });

  it('readBinary() invokes vault_read_file with the same shape and returns ArrayBuffer', async () => {
    const captured: Captured[] = [];
    const rawBytes = [1, 2, 3, 255, 0];

    mockIPC((cmd, args) => {
      captured.push({ cmd, args });
      if (cmd === 'vault_read_file') return rawBytes;
      throw new Error(`unexpected command: ${cmd}`);
    });

    const result = await vault.readBinary('data.bin');

    const readCall = captured.find((c) => c.cmd === 'vault_read_file');
    expect(readCall).toBeDefined();
    expect(readCall!.args).toEqual({
      workspace: WORKSPACE,
      relPath: 'data.bin',
    });

    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result)).toEqual(new Uint8Array(rawBytes));
  });
});

// ── VaultFSBackend: vault_write_file ─────────────────────────────────────────

describe('IPC boundary: VaultFSBackend vault_write_file', () => {
  let vault: import('@/platform/fs/VaultFSBackend').VaultFSBackend;

  beforeEach(async () => {
    mockIPC(() => undefined);
    const { VaultFSBackend } = await import('@/platform/fs/VaultFSBackend');
    vault = new VaultFSBackend(new StubFSBackend(WORKSPACE), WORKSPACE);
  });

  afterEach(() => {
    clearMocks();
  });

  it('write() invokes vault_write_file with { workspace, relPath, bytes }', async () => {
    const captured: Captured[] = [];

    mockIPC((cmd, args) => {
      captured.push({ cmd, args });
      if (cmd === 'vault_write_file') return undefined;
      throw new Error(`unexpected command: ${cmd}`);
    });

    await vault.write('notes/memo.txt', 'top secret memo');

    const writeCall = captured.find((c) => c.cmd === 'vault_write_file');
    expect(writeCall, 'vault_write_file was not invoked').toBeDefined();

    // Must include all three keys with correct names.
    const args = writeCall!.args as Record<string, unknown>;
    expect(args['workspace']).toBe(WORKSPACE);
    expect(args['relPath']).toBe('notes/memo.txt');

    // bytes must be a Uint8Array (not a string, not a plain array).
    const bytes = args['bytes'] as Uint8Array;
    expect(bytes.constructor.name).toBe('Uint8Array');

    // The bytes must be the UTF-8 encoding of the content.
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe('top secret memo');
  });

  it('write() fails if the command name is wrong (test validity)', async () => {
    const captured: Captured[] = [];

    mockIPC((cmd, args) => {
      captured.push({ cmd, args });
      return undefined;
    });

    await vault.write('a.txt', 'content');

    const correctCmd = captured.find((c) => c.cmd === 'vault_write_file');
    const wrongCmd = captured.find((c) => c.cmd === 'vault_write');
    expect(correctCmd).toBeDefined();
    expect(wrongCmd).toBeUndefined();
  });

  it('write() encodes string to UTF-8 Uint8Array before IPC (not raw string)', async () => {
    const captured: Captured[] = [];

    mockIPC((cmd, args) => {
      captured.push({ cmd, args });
      if (cmd === 'vault_write_file') return undefined;
      throw new Error(`unexpected command: ${cmd}`);
    });

    const content = 'Mueller & Soeren -- contract';
    await vault.write('utf8.txt', content);

    const writeCall = captured.find((c) => c.cmd === 'vault_write_file');
    const bytes = (writeCall!.args as Record<string, unknown>)['bytes'] as Uint8Array;

    // Must be a Uint8Array, not a plain string sent over the wire.
    expect(typeof bytes).not.toBe('string');
    expect(bytes.constructor.name).toBe('Uint8Array');
    expect(new TextDecoder().decode(bytes)).toBe(content);
  });

  it('writeBinary() invokes vault_write_file with the raw bytes as Uint8Array', async () => {
    const captured: Captured[] = [];

    mockIPC((cmd, args) => {
      captured.push({ cmd, args });
      if (cmd === 'vault_write_file') return undefined;
      throw new Error(`unexpected command: ${cmd}`);
    });

    const rawBuffer = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]).buffer;
    await vault.writeBinary('binary.bin', rawBuffer);

    const writeCall = captured.find((c) => c.cmd === 'vault_write_file');
    expect(writeCall).toBeDefined();
    expect((writeCall!.args as Record<string, unknown>)['workspace']).toBe(WORKSPACE);
    expect((writeCall!.args as Record<string, unknown>)['relPath']).toBe('binary.bin');

    const bytes = (writeCall!.args as Record<string, unknown>)['bytes'] as Uint8Array;
    expect(Array.from(bytes)).toEqual([0xDE, 0xAD, 0xBE, 0xEF]);
  });

  it('write + read round-trip via mockIPC: full JS<->Rust boundary characterization', async () => {
    // Store bytes from the write call, then return them on the read call.
    // This simulates the full round-trip at the IPC boundary without any Rust.
    let storedBytes: number[] | null = null;

    mockIPC((cmd, args) => {
      if (cmd === 'vault_write_file') {
        const a = args as Record<string, unknown>;
        storedBytes = Array.from(a['bytes'] as Uint8Array);
        return undefined;
      }
      if (cmd === 'vault_read_file') {
        if (storedBytes === null) throw new Error('nothing stored yet');
        return storedBytes; // return as number[] (Tauri IPC format)
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    const original = 'Round-trip test: privileged data';
    await vault.write('roundtrip.txt', original);
    const decoded = await vault.read('roundtrip.txt');

    expect(decoded).toBe(original);
    // Also confirm the stored IPC bytes are correct UTF-8.
    expect(new TextDecoder().decode(new Uint8Array(storedBytes!))).toBe(original);
  });
});

// ── vaultClient.ts low-level wrappers ────────────────────────────────────────

// vaultReadFile and vaultWriteFile in vaultClient.ts have an assertTauri()
// guard (same pattern as tauri-commands.ts keychainSet/Get/Delete).
// We must set `globalThis.isTauri = true` AND call mockIPC so invoke() works.

describe('IPC boundary: vaultClient.ts vaultReadFile / vaultWriteFile', () => {
  beforeEach(() => {
    mockIPC(() => undefined);
    // assertTauri() calls isTauri() which checks (globalThis || window).isTauri.
    (globalThis as unknown as Record<string, unknown>)['isTauri'] = true;
  });

  afterEach(() => {
    clearMocks();
    delete (globalThis as unknown as Record<string, unknown>)['isTauri'];
  });

  it('vaultReadFile sends vault_read_file with { workspace, relPath } and returns reply', async () => {
    const captured: Captured[] = [];
    const fakeResult = new Uint8Array([10, 20, 30]);

    mockIPC((cmd, args) => {
      captured.push({ cmd, args });
      if (cmd === 'vault_read_file') return fakeResult;
      throw new Error(`unexpected command: ${cmd}`);
    });

    const { vaultReadFile } = await import('@/platform/firm/vault/vaultClient');
    const result = await vaultReadFile(WORKSPACE, 'matters/case1.docx');

    const readCall = captured.find((c) => c.cmd === 'vault_read_file');
    expect(readCall, 'vault_read_file was not invoked').toBeDefined();
    expect(readCall!.args).toEqual({
      workspace: WORKSPACE,
      relPath: 'matters/case1.docx',
    });

    // The wrapper returns whatever invoke() returns (no transformation).
    expect(result).toBe(fakeResult);
  });

  it('vaultWriteFile sends vault_write_file with { workspace, relPath, bytes } and resolves', async () => {
    const captured: Captured[] = [];
    const bytes = new Uint8Array([1, 2, 3]);

    mockIPC((cmd, args) => {
      captured.push({ cmd, args });
      if (cmd === 'vault_write_file') return undefined;
      throw new Error(`unexpected command: ${cmd}`);
    });

    const { vaultWriteFile } = await import('@/platform/firm/vault/vaultClient');
    await vaultWriteFile(WORKSPACE, 'matters/case1.docx', bytes);

    const writeCall = captured.find((c) => c.cmd === 'vault_write_file');
    expect(writeCall, 'vault_write_file was not invoked').toBeDefined();
    expect(writeCall!.args).toEqual({
      workspace: WORKSPACE,
      relPath: 'matters/case1.docx',
      bytes,
    });
  });

  it('vaultReadFile: wrong relPath key would miss the arg assertion', async () => {
    // This documents that the test would fail if the wrapper sent 'path' instead
    // of 'relPath' -- proving the test actually validates the arg key names.
    const captured: Captured[] = [];

    mockIPC((cmd, args) => {
      captured.push({ cmd, args });
      if (cmd === 'vault_read_file') return [];
      throw new Error(`unexpected command: ${cmd}`);
    });

    const { vaultReadFile } = await import('@/platform/firm/vault/vaultClient');
    await vaultReadFile(WORKSPACE, 'test.txt');

    const readCall = captured.find((c) => c.cmd === 'vault_read_file');
    const args = readCall!.args as Record<string, unknown>;

    // 'relPath' must be present; 'path' must NOT be present (wrong key name).
    expect(args['relPath']).toBe('test.txt');
    expect(args['path']).toBeUndefined();
  });
});
