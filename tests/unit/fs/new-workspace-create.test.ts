/**
 * BUG-002 — "New Workspace" creation must actually CREATE the folder.
 *
 * Root cause: the create-new flow went `createFSBackend() -> setRootPath() ->
 * initialize()`, but `TauriFSBackend.setRootPath()` threw
 * "Workspace path does not exist" BEFORE `initialize()` could create the
 * structure — a chicken-and-egg that, on Windows, manifested as a silently
 * frozen first-run screen.
 *
 * The fix threads a `createIfMissing` flag: the create-new flow creates the
 * directory (recursively, idempotently); the open-existing flow stays strict
 * and still errors on a missing/mistyped path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const exists = vi.fn(async (_path: string) => true);
const mkdir = vi.fn(async (_path: string, _opts?: unknown) => undefined);

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: (...args: unknown[]) => exists(...(args as [string])),
  mkdir: (...args: unknown[]) => mkdir(...(args as [string, unknown])),
}));

import { TauriFSBackend } from '@/platform/fs/TauriFSBackend';
import { FileOperationError } from '@/platform/fs/types';

beforeEach(() => {
  exists.mockReset().mockResolvedValue(true);
  mkdir.mockReset().mockResolvedValue(undefined);
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
});

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe('TauriFSBackend.setRootPath — create-new vs open-existing', () => {
  it('create-new flow: creates the directory when it is missing (no throw)', async () => {
    // Simulate the chosen folder not existing yet.
    exists.mockResolvedValue(false);
    const backend = new TauriFSBackend();

    await expect(
      backend.setRootPath('/home/jane/New Workspace', { createIfMissing: true })
    ).resolves.toBeUndefined();

    // It must create the folder recursively rather than fail.
    expect(mkdir).toHaveBeenCalledWith('/home/jane/New Workspace', { recursive: true });
    expect(backend.getRootPath()).toBe('/home/jane/New Workspace');
  });

  it('open-existing flow stays strict: throws on a missing path, never creates', async () => {
    exists.mockResolvedValue(false);
    const backend = new TauriFSBackend();

    await expect(
      backend.setRootPath('/home/jane/Typo')
    ).rejects.toBeInstanceOf(FileOperationError);
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('create-new flow is idempotent (covers a Windows fs.exists quirk): mkdir recursive on an existing dir does not throw', async () => {
    // fs.exists wrongly reports a real folder as missing — recursive mkdir is a
    // safe no-op, so creation still succeeds.
    exists.mockResolvedValue(false);
    mkdir.mockResolvedValue(undefined); // recursive mkdir succeeds on existing dir
    const backend = new TauriFSBackend();

    await expect(
      backend.setRootPath('C\\\\Users\\\\Jane\\\\Advisor', { createIfMissing: true })
    ).resolves.toBeUndefined();
    expect(mkdir).toHaveBeenCalledTimes(1);
  });

  it('preserves a Windows backslash path exactly when creating', async () => {
    exists.mockResolvedValue(false);
    const backend = new TauriFSBackend();

    await backend.setRootPath('C:\\Users\\Jane\\New WS', { createIfMissing: true });

    expect(mkdir).toHaveBeenCalledWith('C:\\Users\\Jane\\New WS', { recursive: true });
    expect(backend.getRootPath()).toBe('C:\\Users\\Jane\\New WS');
  });
});
