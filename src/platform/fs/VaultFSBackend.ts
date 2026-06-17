/**
 * VaultFSBackend — transparent decorator that routes file reads/writes through
 * the Tauri vault commands (`vault_read_file` / `vault_write_file`).
 *
 * Every method in `FSBackend` that touches file contents is intercepted:
 *   - `read` / `readBinary`  →  `vault_read_file`  →  decrypt in Rust → bytes
 *   - `write` / `writeBinary` →  `vault_write_file` →  encrypt in Rust
 *
 * Everything else (`list`, `exists`, `delete`, `move`, `copy`, `rename`,
 * `mkdir`, `stat`, `isSymlink`, `resolveSymlink`, `getRootPath`, `setRootPath`)
 * delegates to the wrapped `inner` backend unchanged.  The one exception:
 *   - `list` delegates to `inner` but FILTERS OUT `.keepance-vault.json` and
 *     any `.kpv-tmp-*` entries so internal vault files never appear in the UI.
 *
 * ## Bytes over Tauri IPC
 *
 * Tauri 2 serializes Rust `Vec<u8>` to JSON as `number[]` (an array of
 * integers 0–255).  The TTS service confirms this pattern:
 *   `invoke<number[]>('tts_speak', …)` → `new Uint8Array(bytes)`
 *
 * Write path: `string` → `TextEncoder` → `Uint8Array` → IPC as `bytes`
 *   (Tauri deserializes `Uint8Array`/`number[]` into `Vec<u8>` on the Rust side)
 *
 * Read path: IPC returns `number[]` → `new Uint8Array(…)` → either
 *   `.buffer` (for `readBinary`) or `TextDecoder.decode` (for `read`).
 *
 * ## Path handling
 *
 * The vault commands take an absolute `workspace` root and a `relPath`.
 * The paths passed to `FSBackend` methods are already relative to the
 * workspace root (same convention as `TauriFSBackend`), so we forward them
 * directly as `relPath` without additional transformation.
 */

import { invoke } from '@tauri-apps/api/core';
import type { FSBackend, FileStat } from './types';
import type { FileNode } from '@/platform/types/workspace';

/** Vault metadata filename — never surfaced to callers via list(). */
const VAULT_METADATA = '.keepance-vault.json';

/** Prefix for atomic-write temporary files — also hidden from list(). */
const KPV_TMP_PREFIX = '.kpv-tmp-';

/**
 * VaultFSBackend wraps an `inner` FSBackend and transparently encrypts/decrypts
 * file contents via the Tauri vault commands.  All structure operations
 * (rename, move, delete, mkdir, stat, etc.) pass through to `inner` unchanged.
 */
export class VaultFSBackend implements FSBackend {
  private readonly inner: FSBackend;
  private readonly workspace: string;

  /**
   * @param inner     The underlying backend (typically `TauriFSBackend`).
   * @param workspace Absolute path to the workspace root.  Passed verbatim to
   *                  vault commands.  If not supplied the constructor falls back
   *                  to `inner.getRootPath()`.
   */
  constructor(inner: FSBackend, workspace?: string) {
    this.inner = inner;
    this.workspace = workspace ?? inner.getRootPath();
  }

  // ── Content reads/writes — routed through vault commands ────────────────────

  /**
   * Decrypt file via vault_read_file and return as UTF-8 string.
   *
   * IPC note: vault_read_file returns number[] (Tauri Vec<u8> serialization).
   * We convert to Uint8Array before decoding.
   */
  async read(path: string): Promise<string> {
    const bytes = await invoke<number[]>('vault_read_file', {
      workspace: this.workspace,
      relPath: path,
    });
    return new TextDecoder().decode(new Uint8Array(bytes));
  }

  /**
   * Decrypt file via vault_read_file and return as ArrayBuffer.
   *
   * IPC note: same number[] → Uint8Array conversion; callers receive the
   * underlying ArrayBuffer.
   */
  async readBinary(path: string): Promise<ArrayBuffer> {
    const bytes = await invoke<number[]>('vault_read_file', {
      workspace: this.workspace,
      relPath: path,
    });
    return new Uint8Array(bytes).buffer;
  }

  /**
   * Encode string to UTF-8 bytes and encrypt via vault_write_file.
   *
   * IPC note: Tauri deserializes the Uint8Array into Vec<u8> on the Rust side.
   */
  async write(path: string, content: string): Promise<void> {
    const bytes = new TextEncoder().encode(content);
    return invoke('vault_write_file', {
      workspace: this.workspace,
      relPath: path,
      bytes,
    });
  }

  /**
   * Encrypt raw bytes via vault_write_file.
   *
   * The ArrayBuffer is wrapped in a Uint8Array for IPC (same as TauriFSBackend's
   * writeBinary which uses `new Uint8Array(content)` before sending).
   */
  async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
    const bytes = new Uint8Array(content);
    return invoke('vault_write_file', {
      workspace: this.workspace,
      relPath: path,
      bytes,
    });
  }

  // ── list — passthrough with vault-internal entries filtered out ──────────────

  /**
   * List directory contents, hiding vault-private entries from callers.
   *
   * Filtered entries:
   *   - `.keepance-vault.json`  (vault metadata)
   *   - Any name starting with `.kpv-tmp-` (atomic-write temporary files)
   */
  async list(path: string): Promise<FileNode[]> {
    const nodes = await this.inner.list(path);
    return nodes.filter(
      (n) =>
        n.name !== VAULT_METADATA &&
        !n.name.startsWith(KPV_TMP_PREFIX),
    );
  }

  // ── All other methods — direct delegation to inner ───────────────────────────

  async exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }

  async delete(path: string): Promise<void> {
    return this.inner.delete(path);
  }

  async move(from: string, to: string): Promise<void> {
    return this.inner.move(from, to);
  }

  async copy(from: string, to: string): Promise<void> {
    return this.inner.copy(from, to);
  }

  async rename(path: string, newName: string): Promise<void> {
    return this.inner.rename(path, newName);
  }

  async mkdir(path: string): Promise<void> {
    return this.inner.mkdir(path);
  }

  async stat(path: string): Promise<FileStat> {
    return this.inner.stat(path);
  }

  async isSymlink(path: string): Promise<boolean> {
    return this.inner.isSymlink(path);
  }

  async resolveSymlink(path: string): Promise<string> {
    return this.inner.resolveSymlink(path);
  }

  getRootPath(): string {
    return this.inner.getRootPath();
  }

  async setRootPath(path: string): Promise<void> {
    return this.inner.setRootPath(path);
  }
}
