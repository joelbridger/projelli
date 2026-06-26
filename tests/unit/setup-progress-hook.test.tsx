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
import { EMPTY_SETUP_PROGRESS } from '@/platform/utils/setup-progress-commands';

// --- module-scoped test state driven into the mocks ---
let isTauriShouldReturn = true;
let capturedListener: (() => void) | null = null;
let unlistenCalled = false;
let getCallCount = 0;
let lastReportArgs: unknown = null;
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

describe('useSetupProgress', () => {
  beforeEach(() => {
    isTauriShouldReturn = true;
    capturedListener = null;
    unlistenCalled = false;
    getCallCount = 0;
    lastReportArgs = null;
    snapshotToReturn = makeSnapshot();
  });

  afterEach(() => {
    capturedListener = null;
  });

  it('fetches the backend snapshot on mount', async () => {
    snapshotToReturn = makeSnapshot({
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

    // The next fetch returns a different snapshot.
    snapshotToReturn = makeSnapshot({ overall: 'inProgress' });
    capturedListener?.();

    await waitFor(() => expect(result.current?.overall).toBe('inProgress'));
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
