/**
 * useAsk — still-importing gate reads the LIVE import status (round 2,
 * coordinator review).
 *
 * Bug: `handleAsk` is a long-running async closure — retrieval alone can
 * await a real (if normally fast) local search. The retrieval-evidence gate
 * used to read the `importStatus` const closed over from the render that
 * created THIS call of `handleAsk`, not the current status by the time the
 * gate actually runs. If the import status resolved from 'unknown'/'importing'
 * to 'idle' WHILE retrieval was still in flight, the gate would still see the
 * STALE (unsettled) snapshot and wrongly emit the still-importing decline for
 * an ordinary zero-hit answer.
 *
 * Fix: the gate reads `importStatusRef.current` (updated every render) instead
 * of the closed-over `importStatus`, so it always sees the freshest known
 * status at the moment it actually runs.
 */
import '@/i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ImportStatus } from './useStillImporting';
import { SK_ASK_FILES_ONLY } from '@/config/identity';
import type { RagHit } from '@/platform/utils/tauri-commands';

const { useStillImportingMock, retrieveMock, isMemoryEnabledMock } = vi.hoisted(() => ({
  useStillImportingMock: vi.fn<() => ImportStatus>(),
  retrieveMock: vi.fn(),
  isMemoryEnabledMock: vi.fn(() => true),
}));

vi.mock('./useStillImporting', async (importOriginal) => {
  const original = await importOriginal<typeof import('./useStillImporting')>();
  return { ...original, useStillImporting: (): ImportStatus => useStillImportingMock() };
});

vi.mock('@/platform/rag/MemoryService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/rag/MemoryService')>();
  return {
    ...original,
    isMemoryEnabled: (): boolean => isMemoryEnabledMock(),
    MemoryService: {
      ...original.MemoryService,
      retrieve: (...args: unknown[]): unknown => retrieveMock(...args),
    },
  };
});

import { useAsk } from './useAsk';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import { STILL_IMPORTING_DECLINE, NO_EVIDENCE_DECLINE } from './askPrompt';

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  useStillImportingMock.mockReset().mockReturnValue('idle');
  retrieveMock.mockReset();
  isMemoryEnabledMock.mockReset().mockReturnValue(true);
  // Each test's `useAsk({})` derives the SAME global chatId (no active
  // matter) — clear the persisted chat store so one test's turns don't leak
  // into the next as pre-existing history.
  useAIChatStore.getState().clearAllSessions();
  // Files-only mode declines deterministically on zero hits (no model call),
  // which keeps this test from needing to mock AI provider resolution/send.
  localStorage.setItem(SK_ASK_FILES_ONLY, '1');
});

describe('useAsk — retrieval-evidence gate reads live status, not a stale send-time snapshot', () => {
  it('does NOT emit the still-importing decline when status settles to idle WHILE retrieval is still in flight', async () => {
    useStillImportingMock.mockReturnValue('unknown');
    const retrieval = deferred<RagHit[]>();
    retrieveMock.mockReturnValue(retrieval.promise);

    const { result, rerender } = renderHook(() => useAsk({}));

    act(() => {
      // handleAsk has its own top-level try/catch and never rejects; the test
      // observes completion via `result.current.status`/`turns`, not the
      // returned promise.
      // eslint-disable-next-line lantern-async/no-silent-failure -- handleAsk has its own try/catch and never rejects
      void result.current.handleAsk('what is the retirement timeline');
    });

    await waitFor(() => {
      expect(retrieveMock).toHaveBeenCalledTimes(1);
    });

    // The import status resolves to idle WHILE the retrieval above is still
    // awaiting — re-render so the hook picks up the new mocked status and
    // the ref-updating effect runs.
    useStillImportingMock.mockReturnValue('idle');
    rerender();

    await act(async () => {
      retrieval.resolve([]);
      await retrieval.promise;
    });

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(result.current.turns).toHaveLength(1);
    expect(result.current.turns[0]?.answer).toBe(NO_EVIDENCE_DECLINE);
    expect(result.current.turns[0]?.answer).not.toBe(STILL_IMPORTING_DECLINE);
  });

  it('DOES emit the still-importing decline when status is still unsettled at gate time (existing behavior)', async () => {
    useStillImportingMock.mockReturnValue('importing');
    retrieveMock.mockResolvedValue([]);

    const { result } = renderHook(() => useAsk({}));

    act(() => {
      // handleAsk has its own top-level try/catch and never rejects; the test
      // observes completion via `result.current.status`/`turns`, not the
      // returned promise.
      // eslint-disable-next-line lantern-async/no-silent-failure -- handleAsk has its own try/catch and never rejects
      void result.current.handleAsk('what is the retirement timeline');
    });

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(result.current.turns).toHaveLength(1);
    expect(result.current.turns[0]?.answer).toBe(STILL_IMPORTING_DECLINE);
  });
});
