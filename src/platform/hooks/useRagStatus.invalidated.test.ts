import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { listeners, listenMock } = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  listenMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (eventName: string, cb: (event: { payload: unknown }) => void) => {
    listenMock(eventName, cb);
    listeners.set(eventName, cb);
    return Promise.resolve(() => listeners.delete(eventName));
  },
}));

import { useRagStatus } from './useRagStatus';
import {
  RAG_CONTENT_INVALIDATED_EVENT,
  RAG_PROGRESS_EVENT,
  type RagIndexingProgress,
} from '@/platform/utils/tauri-commands';

afterEach(() => {
  listeners.clear();
  listenMock.mockClear();
});

describe('useRagStatus invalidation events', () => {
  it('does not let a purge invalidation overwrite an active indexing snapshot', async () => {
    const { result, unmount } = renderHook(() => useRagStatus());

    await waitFor(() => {
      expect(listenMock).toHaveBeenCalledWith(RAG_PROGRESS_EVENT, expect.any(Function));
    });

    const indexing: RagIndexingProgress = {
      status: 'indexing',
      processed: 4,
      total: 12,
      currentPath: '/ws/Clients/Acme/plan.docx',
    };
    act(() => {
      listeners.get(RAG_PROGRESS_EVENT)?.({ payload: indexing });
    });

    expect(result.current.status).toBe('indexing');
    expect(result.current.processed).toBe(4);
    expect(result.current.total).toBe(12);

    act(() => {
      listeners.get(RAG_CONTENT_INVALIDATED_EVENT)?.({
        payload: { source: 'onedrive', deleted: 1 },
      });
    });

    expect(result.current.status).toBe('indexing');
    expect(result.current.processed).toBe(4);
    expect(result.current.total).toBe(12);

    unmount();
  });
});
