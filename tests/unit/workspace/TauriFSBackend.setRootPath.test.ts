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

import { TauriFSBackend } from '@/platform/fs/TauriFSBackend';
import { FileOperationError } from '@/platform/fs/types';

beforeEach(() => {
  vi.clearAllMocks();
  // Pretend we're inside Tauri so the backend loads its (mocked) fs module.
  // The jsdom environment already provides `window`; we just add the marker.
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
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
