/**
 * useRagStatus — verifies the hook returns the latest progress snapshot
 * received on the `rag-indexing-progress` Tauri event, and gracefully
 * stays in `idle` when the Tauri event API isn't available (browser /
 * test mode without explicit mocking).
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the listener so we can fire synthetic events at the hook.
let capturedListener:
  | ((event: { payload: unknown }) => void)
  | null = null;
let unlistenCalled = false;
let listenShouldThrow = false;
let isTauriShouldReturn = true;

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => isTauriShouldReturn,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_eventName: string, handler: (e: { payload: unknown }) => void) => {
    if (listenShouldThrow) throw new Error('listen failed');
    capturedListener = handler;
    return () => {
      unlistenCalled = true;
    };
  }),
}));

import { useRagStatus } from '@/hooks/useRagStatus';

describe('useRagStatus', () => {
  beforeEach(() => {
    capturedListener = null;
    unlistenCalled = false;
    listenShouldThrow = false;
    isTauriShouldReturn = true;
  });

  afterEach(() => {
    capturedListener = null;
  });

  it('returns idle initial snapshot', () => {
    const { result } = renderHook(() => useRagStatus());
    expect(result.current.status).toBe('idle');
    expect(result.current.processed).toBe(0);
    expect(result.current.total).toBe(0);
    expect(result.current.currentPath).toBeNull();
  });

  it('updates when a progress event fires', async () => {
    const { result } = renderHook(() => useRagStatus());
    // Wait for the async listen subscription to register.
    await waitFor(() => expect(capturedListener).not.toBeNull());

    act(() => {
      capturedListener?.({
        payload: {
          status: 'indexing',
          processed: 47,
          total: 312,
          currentPath: '/w/notes/foo.md',
        },
      });
    });

    expect(result.current.status).toBe('indexing');
    expect(result.current.processed).toBe(47);
    expect(result.current.total).toBe(312);
    expect(result.current.currentPath).toBe('/w/notes/foo.md');
  });

  it('reflects the cancelled status on cancel events', async () => {
    const { result } = renderHook(() => useRagStatus());
    await waitFor(() => expect(capturedListener).not.toBeNull());
    act(() => {
      capturedListener?.({
        payload: {
          status: 'cancelled',
          processed: 12,
          total: 100,
          currentPath: null,
        },
      });
    });
    expect(result.current.status).toBe('cancelled');
    expect(result.current.processed).toBe(12);
  });

  it('reflects the done status with currentPath cleared', async () => {
    const { result } = renderHook(() => useRagStatus());
    await waitFor(() => expect(capturedListener).not.toBeNull());
    act(() => {
      capturedListener?.({
        payload: {
          status: 'done',
          processed: 312,
          total: 312,
          currentPath: null,
        },
      });
    });
    expect(result.current.status).toBe('done');
    expect(result.current.currentPath).toBeNull();
  });

  it('stays in idle when not in a Tauri context', () => {
    isTauriShouldReturn = false;
    const { result } = renderHook(() => useRagStatus());
    expect(result.current.status).toBe('idle');
    // No listener subscribed.
    expect(capturedListener).toBeNull();
  });

  it('stays in idle when the listen import throws', async () => {
    listenShouldThrow = true;
    const { result } = renderHook(() => useRagStatus());
    expect(result.current.status).toBe('idle');
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderHook(() => useRagStatus());
    await waitFor(() => expect(capturedListener).not.toBeNull());
    unmount();
    expect(unlistenCalled).toBe(true);
  });
});
