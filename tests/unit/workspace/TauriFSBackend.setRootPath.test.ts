// TauriFSBackend.setRootPath — Windows trailing-separator + access-error handling.
//
//   - Part B.2: a Windows folder with a trailing backslash (`C:\WS\`) must be
//     normalised to `C:\WS` so resolvePath never builds a doubled separator.
//   - Part B.3: when the existence check THROWS (permission denied / offline
//     network or OneDrive location), the error must say so — NOT the misleading
//     "Workspace path does not exist".

import { describe, it, expect, beforeEach, vi } from 'vitest';

const exists = vi.fn();
const mkdir = vi.fn();
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: (...a: unknown[]) => exists(...a),
  mkdir: (...a: unknown[]) => mkdir(...a),
}));

const invoke = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}));

import { TauriFSBackend } from '@/platform/fs/TauriFSBackend';
import { FileOperationError } from '@/platform/fs/types';

beforeEach(() => {
  vi.clearAllMocks();
  // Pretend we're inside Tauri so the backend loads its (mocked) fs module.
  // The jsdom environment already provides `window`; we just add the marker.
  // We do NOT set `__TAURI_INTERNALS__` here, so the runtime fs-scope grant
  // (which is gated on real IPC) is skipped for the existing cases below.
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe('Part B.2 — trailing backslash is stripped', () => {
  it('normalises `C:\\WS\\` to `C:\\WS`', async () => {
    exists.mockResolvedValue(true);
    const backend = new TauriFSBackend();
    await backend.setRootPath('C:\\WS\\');
    expect(backend.getRootPath()).toBe('C:\\WS');
  });

  it('strips a trailing forward slash too', async () => {
    exists.mockResolvedValue(true);
    const backend = new TauriFSBackend();
    await backend.setRootPath('C:/WS/');
    expect(backend.getRootPath()).toBe('C:/WS');
  });

  it('preserves a bare drive root (`C:\\`)', async () => {
    exists.mockResolvedValue(true);
    const backend = new TauriFSBackend();
    await backend.setRootPath('C:\\');
    expect(backend.getRootPath()).toBe('C:\\');
  });
});

// c34: the capability no longer grants whole-disk fs access, so the backend
// must ask the native layer to add THIS workspace to the runtime fs scope
// before it touches it — and it must do so BEFORE its own `exists()` probe, or
// that probe would itself be refused. This case proves the grant is invoked
// with the normalized root and ordered ahead of the first fs call.
describe('c34 — runtime fs-scope grant on workspace open', () => {
  it('invokes workspace_grant_fs_scope with the normalized root before fs.exists', async () => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const order: string[] = [];
    invoke.mockImplementation(async (cmd: unknown) => {
      order.push(`invoke:${String(cmd)}`);
      return undefined;
    });
    exists.mockImplementation(async () => {
      order.push('exists');
      return true;
    });

    const backend = new TauriFSBackend();
    await backend.setRootPath('C:\\WS\\');

    expect(invoke).toHaveBeenCalledWith('workspace_grant_fs_scope', { path: 'C:\\WS' });
    // The grant must precede the first fs-plugin call, or that call is refused.
    expect(order[0]).toBe('invoke:workspace_grant_fs_scope');
    expect(order).toContain('exists');
    expect(order.indexOf('invoke:workspace_grant_fs_scope')).toBeLessThan(order.indexOf('exists'));

    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('a failed grant does not abort the open (the fs error surfaces instead)', async () => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    invoke.mockRejectedValue(new Error('grant boom'));
    exists.mockResolvedValue(true);

    const backend = new TauriFSBackend();
    // The grant rejection is logged, not thrown; the open proceeds and any real
    // access problem is surfaced by the subsequent fs calls (proven elsewhere).
    await expect(backend.setRootPath('C:\\WS')).resolves.toBeUndefined();

    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });
});

describe('Part B.3 — access failure is reported clearly', () => {
  it('throws an access/permission error (not "does not exist") when exists() throws', async () => {
    exists.mockRejectedValue(new Error('forbidden'));
    const backend = new TauriFSBackend();

    let caught: unknown;
    try {
      await backend.setRootPath('C:\\Locked');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FileOperationError);
    const msg = (caught as Error).message;
    expect(msg).toMatch(/permission|access|offline|network/i);
    expect(msg).not.toMatch(/does not exist/i);
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('still reports "does not exist" for a genuinely missing path (open-existing)', async () => {
    exists.mockResolvedValue(false);
    const backend = new TauriFSBackend();
    await expect(backend.setRootPath('C:\\Missing')).rejects.toThrow(/does not exist/i);
  });

  it('creates a missing path when createIfMissing is set', async () => {
    exists.mockResolvedValue(false);
    mkdir.mockResolvedValue(undefined);
    const backend = new TauriFSBackend();
    await backend.setRootPath('C:\\New', { createIfMissing: true });
    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(backend.getRootPath()).toBe('C:\\New');
  });
});

// F2.4: the instance `exists()` method used to swallow ANY thrown error into
// `false`, making a permission failure or an offline network/OneDrive path
// indistinguishable from a genuinely missing file. Same access-error
// distinction as setRootPath above, applied to the plain exists() check.
describe('exists() — access failure is not reported as "not found"', () => {
  async function rootedBackend(): Promise<TauriFSBackend> {
    exists.mockResolvedValueOnce(true); // for setRootPath's own check
    const backend = new TauriFSBackend();
    await backend.setRootPath('C:\\WS');
    return backend;
  }

  it('resolves false for a genuinely missing path (never throws)', async () => {
    const backend = await rootedBackend();
    exists.mockResolvedValue(false);
    await expect(backend.exists('some/file.txt')).resolves.toBe(false);
  });

  it('resolves true when the path exists', async () => {
    const backend = await rootedBackend();
    exists.mockResolvedValue(true);
    await expect(backend.exists('some/file.txt')).resolves.toBe(true);
  });

  it('throws a clear access error (not "false") when the check itself fails', async () => {
    const backend = await rootedBackend();
    exists.mockRejectedValue(new Error('permission denied'));

    let caught: unknown;
    try {
      await backend.exists('Locked/file.txt');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FileOperationError);
    const msg = (caught as Error).message;
    expect(msg).toMatch(/permission|access|offline|network/i);
  });
});
