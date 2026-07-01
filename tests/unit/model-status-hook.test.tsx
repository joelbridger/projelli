/**
 * useModelStatus — drives the one-time embedding-model download UI.
 * Contract under test:
 *  - outside Tauri: stays 'idle', never invokes anything
 *  - in Tauri with status 'absent': kicks modelEnsure once
 *  - progress events update the snapshot
 *  - retry() re-invokes modelEnsure
 *  - no progress event for >90s mid-transfer → stalled flag
 *  - retry() after an error clears message + stalled (the error card's
 *    Resume button depends on that clearing)
 *  - unmount unsubscribes the listener and stops the stall watchdog
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture listeners so we can fire synthetic events at the hook.
const listeners: Array<(e: { payload: unknown }) => void> = [];
const invokeMock = vi.fn();
let isTauriShouldReturn = true;
let unlistenCalled = false;

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => isTauriShouldReturn,
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_name: string, cb: (e: { payload: unknown }) => void) => {
    listeners.push(cb);
    return () => {
      unlistenCalled = true;
    };
  },
}));

import { useModelStatus } from '@/platform/hooks/useModelStatus';

describe('useModelStatus', () => {
  beforeEach(() => {
    listeners.length = 0;
    invokeMock.mockReset();
    isTauriShouldReturn = true;
    unlistenCalled = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays idle and invokes nothing outside Tauri', async () => {
    isTauriShouldReturn = false;
    const { result } = renderHook(() => useModelStatus());
    // Give the effect's async import chain a chance to run.
    await act(async () => {});
    expect(result.current.state).toBe('idle');
    expect(result.current.stalled).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(listeners.length).toBe(0);
  });

  it('kicks model_ensure when status is absent and tracks progress events', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'model_status') return 'absent';
      if (cmd === 'model_ensure') return 'ready';
      return undefined;
    });

    const { result } = renderHook(() => useModelStatus());

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('model_ensure'),
    );

    act(() => {
      for (const cb of listeners) {
        cb({
          payload: {
            state: 'downloading',
            file: 'onnx/model.onnx',
            bytesDone: 100 * 1024 * 1024,
            bytesTotal: 465 * 1024 * 1024,
            message: null,
          },
        });
      }
    });

    expect(result.current.state).toBe('downloading');
    expect(result.current.bytesDone).toBe(100 * 1024 * 1024);
    expect(result.current.bytesTotal).toBe(465 * 1024 * 1024);
  });

  it('reports ready without ensure when already cached', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'model_status') return 'ready';
      return undefined;
    });
    const { result } = renderHook(() => useModelStatus());
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(invokeMock).not.toHaveBeenCalledWith('model_ensure');
  });

  it('reports error from the status probe without auto-retrying', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'model_status') return 'error';
      return undefined;
    });
    const { result } = renderHook(() => useModelStatus());
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(invokeMock).not.toHaveBeenCalledWith('model_ensure');
  });

  it('retry() re-invokes model_ensure', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'model_status') return 'absent';
      if (cmd === 'model_ensure') return 'ready';
      return undefined;
    });
    const { result } = renderHook(() => useModelStatus());
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('model_ensure'),
    );
    invokeMock.mockClear();
    act(() => result.current.retry());
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('model_ensure'),
    );
  });

  it('flags a stall when no progress event arrives for 90s while downloading', async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === 'model_status') return 'downloading';
        return undefined;
      });
      const { result } = renderHook(() => useModelStatus());
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(result.current.state).toBe('downloading');
      expect(result.current.stalled).toBe(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(result.current.stalled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears message and stalled when retry() follows an error', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'model_status') return 'absent';
      if (cmd === 'model_ensure') return 'ready';
      return undefined;
    });
    const { result } = renderHook(() => useModelStatus());
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('model_ensure'),
    );

    act(() => {
      for (const cb of listeners) {
        cb({
          payload: {
            state: 'error',
            file: null,
            bytesDone: 0,
            bytesTotal: null,
            message: 'network unreachable',
          },
        });
      }
    });
    expect(result.current.state).toBe('error');
    expect(result.current.message).toBe('network unreachable');

    act(() => result.current.retry());
    expect(result.current.state).toBe('checking');
    expect(result.current.message).toBeNull();
    expect(result.current.stalled).toBe(false);
  });

  it('unsubscribes and stops the stall watchdog on unmount', async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === 'model_status') return 'downloading';
        return undefined;
      });
      const { result, unmount } = renderHook(() => useModelStatus());
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(listeners.length).toBe(1);
      // Watchdog interval armed while the transfer is active.
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      unmount();
      expect(unlistenCalled).toBe(true);
      // Interval cleared: no watchdog tick can fire after unmount.
      expect(vi.getTimerCount()).toBe(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(200_000); });
      expect(result.current.stalled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
