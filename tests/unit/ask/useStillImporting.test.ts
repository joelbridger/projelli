/**
 * useStillImporting (QA-90) — verifies the hook reads the real backend
 * setup-progress signal (refetching on the `setup-progress-changed` event)
 * plus OneDrive's own live sync event, and reports "importing" only while a
 * content source is actually active. No-ops cleanly outside Tauri.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupProgress } from '@/platform/utils/setup-progress-commands';
import { EMPTY_SETUP_PROGRESS } from '@/platform/utils/setup-progress-commands';
import type { OneDriveSyncProgress } from '@/platform/utils/onedrive-commands';

let isTauriShouldReturn = true;
let capturedListeners: Record<string, (event?: { payload: unknown }) => void> = {};
let snapshotToReturn: SetupProgress = { ...EMPTY_SETUP_PROGRESS };

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => isTauriShouldReturn,
  invoke: async (cmd: string) => {
    if (cmd === 'get_setup_progress') return snapshotToReturn;
    return undefined;
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (eventName: string, handler: (event?: { payload: unknown }) => void) => {
    capturedListeners[eventName] = handler;
    return () => {
      delete capturedListeners[eventName];
    };
  }),
}));

import { useStillImporting } from '@/features/ask/useStillImporting';

function fireOneDrive(payload: OneDriveSyncProgress) {
  capturedListeners['onedrive-sync-progress']?.({ payload });
}

describe('useStillImporting — QA-90', () => {
  beforeEach(() => {
    isTauriShouldReturn = true;
    capturedListeners = {};
    snapshotToReturn = { ...EMPTY_SETUP_PROGRESS };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns false outside Tauri (browser/dev mode)', () => {
    isTauriShouldReturn = false;
    const { result } = renderHook(() => useStillImporting());
    expect(result.current).toBe(false);
  });

  it('returns false once the initial backend snapshot resolves with nothing importing', async () => {
    snapshotToReturn = { ...EMPTY_SETUP_PROGRESS };
    const { result } = renderHook(() => useStillImporting());
    await waitFor(() => { expect(result.current).toBe(false); });
  });

  it('returns true once the initial backend snapshot shows email syncing', async () => {
    snapshotToReturn = {
      ...EMPTY_SETUP_PROGRESS,
      email: { connected: true, accounts: [], syncing: true, messagesImported: 5 },
    };
    const { result } = renderHook(() => useStillImporting());
    await waitFor(() => { expect(result.current).toBe(true); });
  });

  it('flips to true after a setup-progress-changed refetch reveals CRM syncing', async () => {
    const { result } = renderHook(() => useStillImporting());
    await waitFor(() => { expect(result.current).toBe(false); });

    snapshotToReturn = {
      ...EMPTY_SETUP_PROGRESS,
      crm: { connected: true, syncing: true, householdsProcessed: 1, recordsIndexed: 3 },
    };
    act(() => {
      capturedListeners['setup-progress-changed']?.();
    });

    await waitFor(() => { expect(result.current).toBe(true); }, { timeout: 1000 });
  });

  it('flips to true on a live OneDrive "syncing" event, and back to false on "done"', async () => {
    const { result } = renderHook(() => useStillImporting());
    await waitFor(() => { expect(result.current).toBe(false); });

    act(() => {
      fireOneDrive({ status: 'syncing', seen: 2, imported: 1 });
    });
    await waitFor(() => { expect(result.current).toBe(true); });

    act(() => {
      fireOneDrive({ status: 'done', seen: 5, imported: 5 });
    });
    await waitFor(() => { expect(result.current).toBe(false); });
  });
});
