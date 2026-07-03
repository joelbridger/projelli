import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withOneDriveTimeout,
  OneDriveTimeoutError,
  ONEDRIVE_SYNC_TIMEOUT_MS,
} from '@/platform/connectors/onedrive/onedriveTimeout';

describe('withOneDriveTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with an OneDriveTimeoutError when the underlying invoke() never settles (the bench-pass-3 silent hang)', async () => {
    // Simulates the regression: an awaited Tauri command (onedrive_list_folders
    // / onedrive_sync) that never resolves or rejects, leaving runSync() stuck
    // forever with no spinner update and no error.
    const neverSettles = new Promise<string[]>(() => {
      /* intentionally never resolves */
    });

    const raced = withOneDriveTimeout(neverSettles, 'sync', ONEDRIVE_SYNC_TIMEOUT_MS);
    const assertion = expect(raced).rejects.toMatchObject({ name: 'OneDriveTimeoutError' });

    await vi.advanceTimersByTimeAsync(ONEDRIVE_SYNC_TIMEOUT_MS + 1);
    await assertion;
  });

  it('passes a value through untouched when it settles in time', async () => {
    await expect(
      withOneDriveTimeout(Promise.resolve(['folder']), 'folder discovery', ONEDRIVE_SYNC_TIMEOUT_MS)
    ).resolves.toEqual(['folder']);
  });

  it('propagates the underlying rejection (not a timeout) when the call fails fast', async () => {
    await expect(
      withOneDriveTimeout(
        Promise.reject(new Error('refresh failed: invalid_grant')),
        'sync',
        ONEDRIVE_SYNC_TIMEOUT_MS
      )
    ).rejects.toThrow('refresh failed: invalid_grant');
  });

  it('clears the timer once settled so no dangling timeout remains', async () => {
    await withOneDriveTimeout(Promise.resolve('ok'), 'sync', 1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('OneDriveTimeoutError carries the stage in its message', () => {
    const err = new OneDriveTimeoutError('folder discovery', 600_000);
    expect(err.name).toBe('OneDriveTimeoutError');
    expect(err.message).toContain('folder discovery');
  });
});
