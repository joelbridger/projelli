/**
 * useStillImporting — QA-90 round 3 regression.
 *
 * Bug: the hook returned a plain boolean defaulting to `false` during the
 * brief async window between mount and the first `get_setup_progress` /
 * `onedrive_status` round-trip resolving. A question asked in that window
 * (Ask opened, question typed and sent before the status fetch lands) read
 * as a confident "nothing is importing" — so a zero-hit answer got the
 * generic "nothing found" decline instead of the honest still-importing one.
 *
 * Fix: a tri-state (`'unknown' | 'importing' | 'idle'`). `'unknown'` covers
 * that window and is treated the same as `'importing'` by
 * `isImportStatusUnsettled` — the predicate `useAsk.ts`'s retrieval-evidence
 * gate now uses instead of a plain boolean.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const { isTauriMock, listenMock, getSetupProgressMock, oneDriveStatusMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(() => true),
  listenMock: vi.fn(),
  getSetupProgressMock: vi.fn(),
  oneDriveStatusMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: isTauriMock }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]): unknown => listenMock(...args),
}));

vi.mock('@/platform/utils/setup-progress-commands', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/utils/setup-progress-commands')>();
  return { ...original, getSetupProgress: (...args: unknown[]): unknown => getSetupProgressMock(...args) };
});

vi.mock('@/platform/utils/onedrive-commands', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/utils/onedrive-commands')>();
  return { ...original, oneDriveStatus: (...args: unknown[]): unknown => oneDriveStatusMock(...args) };
});

import { useStillImporting, isImportStatusUnsettled } from './useStillImporting';
import { EMPTY_SETUP_PROGRESS, SETUP_PROGRESS_CHANGED_EVENT } from '@/platform/utils/setup-progress-commands';
import { ONEDRIVE_SYNC_EVENT, type OneDriveSyncProgress } from '@/platform/utils/onedrive-commands';

/** A never-resolving promise — simulates a fetch that hasn't landed yet. */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => {
    /* never resolves */
  });
}

/**
 * QA-90 (round 1/2) live-event coverage, reconciled here (round 3) after the
 * tri-state fix superseded the old boolean-era `tests/unit/ask/
 * useStillImporting.test.ts` — rather than duplicate the hook's coverage
 * across two files with two different (and now conflicting) contracts, the
 * still-valid live-event assertions live here, updated to tri-state.
 */
let capturedListeners: Record<string, (event?: { payload: unknown }) => void> = {};

function fireOneDrive(payload: OneDriveSyncProgress) {
  capturedListeners[ONEDRIVE_SYNC_EVENT]?.({ payload });
}

function snapshot(overrides: {
  emailSyncing?: boolean;
  crmSyncing?: boolean;
  oneDriveSyncing?: boolean;
  fileIndexIndexing?: boolean;
} = {}) {
  return {
    ...EMPTY_SETUP_PROGRESS,
    email: { ...EMPTY_SETUP_PROGRESS.email, syncing: overrides.emailSyncing ?? false },
    crm: { ...EMPTY_SETUP_PROGRESS.crm, syncing: overrides.crmSyncing ?? false },
    oneDrive: { ...EMPTY_SETUP_PROGRESS.oneDrive, syncing: overrides.oneDriveSyncing ?? false },
    fileIndex: { ...EMPTY_SETUP_PROGRESS.fileIndex, indexing: overrides.fileIndexIndexing ?? false },
  };
}

beforeEach(() => {
  isTauriMock.mockReturnValue(true);
  capturedListeners = {};
  listenMock.mockReset().mockImplementation(
    (eventName: string, handler: (event?: { payload: unknown }) => void) => {
      capturedListeners[eventName] = handler;
      return Promise.resolve(() => {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test-only cleanup of a mock event-listener registry
        delete capturedListeners[eventName];
      });
    },
  );
  getSetupProgressMock.mockReset();
  oneDriveStatusMock.mockReset();
});

describe('useStillImporting — tri-state (QA-90 round 3)', () => {
  it("returns 'unknown' before either initial status fetch resolves", () => {
    getSetupProgressMock.mockReturnValue(pending());
    oneDriveStatusMock.mockReturnValue(pending());

    const { result } = renderHook(() => useStillImporting());

    expect(result.current).toBe('unknown');
  });

  it("settles to 'idle' once both sources resolve not-importing", async () => {
    getSetupProgressMock.mockResolvedValue(snapshot());
    oneDriveStatusMock.mockResolvedValue({ isSyncing: false, lastReport: null });

    const { result } = renderHook(() => useStillImporting());

    await waitFor(() => {
      expect(result.current).toBe('idle');
    });
  });

  it("settles to 'importing' when the backend snapshot shows file indexing active", async () => {
    getSetupProgressMock.mockResolvedValue(snapshot({ fileIndexIndexing: true }));
    oneDriveStatusMock.mockResolvedValue({ isSyncing: false, lastReport: null });

    const { result } = renderHook(() => useStillImporting());

    await waitFor(() => {
      expect(result.current).toBe('importing');
    });
  });

  it("settles to 'importing' when OneDrive is syncing even though the backend snapshot is idle", async () => {
    getSetupProgressMock.mockResolvedValue(snapshot());
    oneDriveStatusMock.mockResolvedValue({ isSyncing: true, lastReport: null });

    const { result } = renderHook(() => useStillImporting());

    await waitFor(() => {
      expect(result.current).toBe('importing');
    });
  });

  it("stays 'unknown' while the backend snapshot has resolved but OneDrive status has not", async () => {
    getSetupProgressMock.mockResolvedValue(snapshot());
    oneDriveStatusMock.mockReturnValue(pending());

    const { result } = renderHook(() => useStillImporting());

    await waitFor(() => {
      expect(getSetupProgressMock).toHaveBeenCalled();
    });
    // Give the resolved promise a tick to flush into state.
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBe('unknown');
  });

  it("settles a permanently-failing backend fetch to 'idle' instead of staying stuck 'unknown' forever", async () => {
    getSetupProgressMock.mockRejectedValue(new Error('boom'));
    oneDriveStatusMock.mockResolvedValue({ isSyncing: false, lastReport: null });

    const { result } = renderHook(() => useStillImporting());

    await waitFor(() => {
      expect(result.current).toBe('idle');
    });
  });

  it('settles immediately to idle in browser/dev mode (no Tauri backend)', () => {
    isTauriMock.mockReturnValue(false);

    const { result } = renderHook(() => useStillImporting());

    expect(result.current).toBe('idle');
    expect(getSetupProgressMock).not.toHaveBeenCalled();
    expect(oneDriveStatusMock).not.toHaveBeenCalled();
  });

  it("flips to 'importing' after a setup-progress-changed refetch reveals CRM syncing", async () => {
    getSetupProgressMock.mockResolvedValueOnce(snapshot());
    oneDriveStatusMock.mockResolvedValue({ isSyncing: false, lastReport: null });

    const { result } = renderHook(() => useStillImporting());
    await waitFor(() => { expect(result.current).toBe('idle'); });

    getSetupProgressMock.mockResolvedValueOnce(snapshot({ crmSyncing: true }));
    act(() => {
      capturedListeners[SETUP_PROGRESS_CHANGED_EVENT]?.();
    });

    await waitFor(() => { expect(result.current).toBe('importing'); }, { timeout: 1000 });
  });

  it("flips to 'importing' on a live OneDrive \"syncing\" event, and back to 'idle' on \"done\"", async () => {
    getSetupProgressMock.mockResolvedValue(snapshot());
    oneDriveStatusMock.mockResolvedValue({ isSyncing: false, lastReport: null });

    const { result } = renderHook(() => useStillImporting());
    await waitFor(() => { expect(result.current).toBe('idle'); });

    act(() => {
      fireOneDrive({ status: 'syncing', seen: 2, imported: 1 });
    });
    await waitFor(() => { expect(result.current).toBe('importing'); });

    act(() => {
      fireOneDrive({ status: 'done', seen: 5, imported: 5 });
    });
    await waitFor(() => { expect(result.current).toBe('idle'); });
  });

  /**
   * QA-90 round 2 — a OneDrive sync already running BEFORE Ask mounts (or one
   * that emits no further progress after mount) must still be reflected: the
   * event listener alone would miss it, since it only reports transitions
   * after it attaches. The hook seeds its initial value from the backend's
   * own live status instead.
   */
  it('reflects a OneDrive sync that was ALREADY running before mount, with no event fired', async () => {
    getSetupProgressMock.mockResolvedValue(snapshot());
    oneDriveStatusMock.mockResolvedValue({ isSyncing: true, lastReport: null });

    const { result } = renderHook(() => useStillImporting());

    await waitFor(() => { expect(result.current).toBe('importing'); });
    // No fireOneDrive(...) call in this test — proves the seed, not the listener.
  });
});

describe('isImportStatusUnsettled', () => {
  it('treats both unknown and importing as ambiguous, and idle as settled', () => {
    expect(isImportStatusUnsettled('unknown')).toBe(true);
    expect(isImportStatusUnsettled('importing')).toBe(true);
    expect(isImportStatusUnsettled('idle')).toBe(false);
  });
});
