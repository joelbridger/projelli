/**
 * useSetupProgress — verifies the hook fetches the unified backend snapshot,
 * refetches when a `setup-progress-changed` event fires, overlays the
 * frontend-only Client Map counts, reports those counts down to the backend,
 * and no-ops cleanly outside a Tauri context. Also unit-tests the pure
 * `computeClientMapProgress` helper.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupProgress } from '@/platform/utils/setup-progress-commands';
import {
  EMPTY_SETUP_PROGRESS,
  deriveOverall,
  retryFailedModelDownloads,
} from '@/platform/utils/setup-progress-commands';

// --- module-scoped test state driven into the mocks ---
let isTauriShouldReturn = true;
let capturedListener: (() => void) | null = null;
let unlistenCalled = false;
let getCallCount = 0;
let lastReportArgs: unknown = null;
let invokedCommands: string[] = [];
let snapshotToReturn: SetupProgress = makeSnapshot();

function makeSnapshot(overrides: Partial<SetupProgress> = {}): SetupProgress {
  return { ...EMPTY_SETUP_PROGRESS, ...overrides };
}

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => isTauriShouldReturn,
  invoke: async (cmd: string, args?: unknown) => {
    if (cmd === 'get_setup_progress') {
      getCallCount += 1;
      return snapshotToReturn;
    }
    if (cmd === 'setup_report_client_map') {
      lastReportArgs = args;
      return undefined;
    }
    invokedCommands.push(cmd);
    return undefined;
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_eventName: string, handler: () => void) => {
    capturedListener = handler;
    return () => {
      unlistenCalled = true;
    };
  }),
}));

import { useSetupProgress, computeClientMapProgress } from '@/platform/hooks/useSetupProgress';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';
import type { ClientMap } from '@/platform/clientMap/types';

function matter(id: string, extra: Partial<Matter> = {}): Matter {
  return { id, name: id, ...extra } as Matter;
}
function builtMap(): ClientMap {
  return { lastBuiltAt: '2026-06-26T00:00:00.000Z' } as ClientMap;
}
function unbuiltMap(): ClientMap {
  return { lastBuiltAt: '' } as ClientMap;
}

describe('computeClientMapProgress', () => {
  it('is all zeros with no matters', () => {
    expect(computeClientMapProgress([], {})).toEqual({
      total: 0,
      built: 0,
      building: 0,
      pending: 0,
    });
  });

  it('counts built vs pending', () => {
    const matters = [matter('a'), matter('b'), matter('c')];
    const maps = { a: builtMap(), b: unbuiltMap() }; // c has no map at all
    expect(computeClientMapProgress(matters, maps)).toEqual({
      total: 3,
      built: 1,
      building: 0,
      pending: 2,
    });
  });

  it('excludes archived and sample matters', () => {
    const matters = [
      matter('a', { isSample: true }),
      matter('b', { archived: true }),
      matter('c'),
    ];
    const maps = { a: builtMap(), b: builtMap(), c: builtMap() };
    expect(computeClientMapProgress(matters, maps)).toEqual({
      total: 1, // only c
      built: 1,
      building: 0,
      pending: 0,
    });
  });
});

describe('deriveOverall', () => {
  it('is empty for a fresh snapshot', () => {
    expect(deriveOverall(makeSnapshot())).toBe('empty');
  });

  it('is ready with a cloud key and nothing in flight', () => {
    expect(
      deriveOverall(
        makeSnapshot({
          ai: { ...EMPTY_SETUP_PROGRESS.ai, mode: 'cloud', state: 'ready', cloudKeyPresent: true },
        }),
      ),
    ).toBe('ready');
  });

  it('is inProgress when the local model is downloading even with a cloud key', () => {
    expect(
      deriveOverall(
        makeSnapshot({
          ai: {
            ...EMPTY_SETUP_PROGRESS.ai,
            mode: 'cloud',
            state: 'ready',
            cloudKeyPresent: true,
            localLlm: { state: 'downloading', percent: 50 },
          },
        }),
      ),
    ).toBe('inProgress');
  });

  it('is partial after a model download fails', () => {
    expect(
      deriveOverall(
        makeSnapshot({
          ai: {
            ...EMPTY_SETUP_PROGRESS.ai,
            state: 'failed',
            localLlm: { state: 'failed', percent: null },
            searchModel: { state: 'failed', percent: null },
          },
        }),
      ),
    ).toBe('partial');
  });

  it('is inProgress while Client Maps are building', () => {
    expect(
      deriveOverall(makeSnapshot({ clientMap: { total: 3, built: 1, building: 1, pending: 1 } })),
    ).toBe('inProgress');
  });

  it('is partial after file indexing finishes with nothing else', () => {
    expect(
      deriveOverall(
        makeSnapshot({ fileIndex: { indexing: false, processed: 312, total: 312, percent: 100 } }),
      ),
    ).toBe('partial');
  });

  it('is partial when clients exist but no AI brain', () => {
    expect(
      deriveOverall(makeSnapshot({ clientMap: { total: 2, built: 0, building: 0, pending: 2 } })),
    ).toBe('partial');
  });
});

describe('retryFailedModelDownloads', () => {
  beforeEach(() => {
    isTauriShouldReturn = true;
    invokedCommands = [];
  });

  it('retries each failed model slot', async () => {
    await retryFailedModelDownloads(
      makeSnapshot({
        ai: {
          ...EMPTY_SETUP_PROGRESS.ai,
          state: 'failed',
          localLlm: { state: 'failed', percent: null },
          searchModel: { state: 'failed', percent: null },
        },
      }),
    );

    expect(invokedCommands).toEqual(['local_llm_model_ensure', 'model_ensure']);
  });

  it('does nothing outside Tauri', async () => {
    isTauriShouldReturn = false;
    await retryFailedModelDownloads(
      makeSnapshot({
        ai: {
          ...EMPTY_SETUP_PROGRESS.ai,
          state: 'failed',
          localLlm: { state: 'failed', percent: null },
          searchModel: { state: 'failed', percent: null },
        },
      }),
    );

    expect(invokedCommands).toEqual([]);
  });
});

describe('useSetupProgress', () => {
  beforeEach(() => {
    isTauriShouldReturn = true;
    capturedListener = null;
    unlistenCalled = false;
    getCallCount = 0;
    lastReportArgs = null;
    invokedCommands = [];
    snapshotToReturn = makeSnapshot();
  });

  afterEach(() => {
    capturedListener = null;
    useMatterStore.setState({ matters: [] });
  });

  it('recomputes overall after overlaying Client Map counts (empty -> partial)', async () => {
    // Backend snapshot is stale ("empty") — it hasn't seen the maps yet. The
    // hook overlays the frontend Client Map counts AND recomputes overall, so it
    // must NOT return the stale "empty" alongside a non-zero clientMap.
    snapshotToReturn = makeSnapshot({ overall: 'empty' });
    useMatterStore.setState({ matters: [matter('a')] }); // one real client
    const { result } = renderHook(() => useSetupProgress());

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.clientMap.total).toBe(1);
    expect(result.current?.overall).toBe('partial');
  });

  it('fetches the backend snapshot on mount', async () => {
    snapshotToReturn = makeSnapshot({
      ai: { ...EMPTY_SETUP_PROGRESS.ai, mode: 'cloud', state: 'ready', cloudKeyPresent: true },
      crm: { connected: true, syncing: false, householdsProcessed: 40, recordsIndexed: 1200 },
      overall: 'ready',
    });
    const { result } = renderHook(() => useSetupProgress());

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(getCallCount).toBe(1);
    expect(result.current?.overall).toBe('ready');
    expect(result.current?.crm.householdsProcessed).toBe(40);
  });

  it('overlays the frontend Client Map counts onto the snapshot', async () => {
    // Backend snapshot carries stale client-map numbers; the hook overlays the
    // (empty) frontend store truth on top.
    snapshotToReturn = makeSnapshot({
      clientMap: { total: 99, built: 99, building: 0, pending: 0 },
    });
    const { result } = renderHook(() => useSetupProgress());

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.clientMap).toEqual({ total: 0, built: 0, building: 0, pending: 0 });
  });

  it('reports Client Map counts down to the backend', async () => {
    renderHook(() => useSetupProgress());
    await waitFor(() => expect(lastReportArgs).not.toBeNull());
    expect(lastReportArgs).toEqual({ total: 0, built: 0, building: 0 });
  });

  it('refetches when a setup-progress-changed event fires', async () => {
    const { result } = renderHook(() => useSetupProgress());
    await waitFor(() => expect(result.current).not.toBeNull());
    await waitFor(() => expect(capturedListener).not.toBeNull());
    expect(result.current?.overall).toBe('empty');

    // The next fetch returns a genuinely different (consistent) snapshot.
    snapshotToReturn = makeSnapshot({
      email: { connected: true, accounts: [], syncing: true, messagesImported: 5 },
    });
    capturedListener?.();

    await waitFor(() => expect(result.current?.overall).toBe('inProgress'));
    expect(result.current?.email.messagesImported).toBe(5);
    expect(getCallCount).toBeGreaterThanOrEqual(2);
  });

  it('returns null and does not fetch outside a Tauri context', () => {
    isTauriShouldReturn = false;
    const { result } = renderHook(() => useSetupProgress());
    expect(result.current).toBeNull();
    expect(getCallCount).toBe(0);
    expect(capturedListener).toBeNull();
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderHook(() => useSetupProgress());
    await waitFor(() => expect(capturedListener).not.toBeNull());
    unmount();
    expect(unlistenCalled).toBe(true);
  });
});
