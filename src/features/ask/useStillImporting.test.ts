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
import { renderHook, waitFor } from '@testing-library/react';

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
import { EMPTY_SETUP_PROGRESS } from '@/platform/utils/setup-progress-commands';

/** A never-resolving promise — simulates a fetch that hasn't landed yet. */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => {
    /* never resolves */
  });
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
  listenMock.mockReset().mockResolvedValue(vi.fn());
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
});

describe('isImportStatusUnsettled', () => {
  it('treats both unknown and importing as ambiguous, and idle as settled', () => {
    expect(isImportStatusUnsettled('unknown')).toBe(true);
    expect(isImportStatusUnsettled('importing')).toBe(true);
    expect(isImportStatusUnsettled('idle')).toBe(false);
  });
});
