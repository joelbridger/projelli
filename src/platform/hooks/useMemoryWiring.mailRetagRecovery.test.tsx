import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mail = vi.hoisted(() => ({
  setWorkspace: vi.fn(),
  listPending: vi.fn(),
  repairPending: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock('@/platform/utils/mail-commands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/utils/mail-commands')>()),
  mailSetWorkspace: mail.setWorkspace,
  mailListPendingRagRetags: mail.listPending,
  mailRepairPendingRagRetags: mail.repairPending,
  mailBackfillRag: vi.fn().mockResolvedValue(undefined),
  mailRetagFolderMatter: vi.fn().mockResolvedValue(0),
}));

vi.mock('@/platform/utils/tauri-commands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/utils/tauri-commands')>()),
  watchWorkspace: vi.fn().mockResolvedValue(undefined),
  modelStatus: vi.fn().mockResolvedValue('downloading'),
}));

vi.mock('@/platform/rag/MemoryService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/rag/MemoryService')>();
  return {
    ...original,
    MemoryService: {
      ...original.MemoryService,
      setWorkspace: vi.fn().mockResolvedValue(undefined),
    },
  };
});

import {
  shouldExcludeHitFromRetrieval,
  startPendingMailRagRetagRecovery,
  useMemoryWiring,
} from './useMemoryWiring';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import {
  isPendingMailRagRetagLoading,
  setPendingMailRagRetagSources,
} from '@/platform/rag/pendingMailRagRetagHold';
import type { RagHit } from '@/platform/utils/tauri-commands';

const mailHit: RagHit = {
  path: 'mail:one',
  sourceId: 'mail:one',
  sourceType: 'mail',
  chunkText: 'old client row',
  score: 1,
  paragraphIndex: 0,
};

describe('useMemoryWiring mail filing recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useWorkspaceStore.setState({ rootPath: '/ws', rootGeneration: 1 });
    setPendingMailRagRetagSources('/ws', []);
    mail.setWorkspace.mockResolvedValue(undefined);
    mail.listPending.mockResolvedValue([]);
    mail.repairPending.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds all mail synchronously during the restart window, until the first durable marker read finishes', async () => {
    let resolveMarkers: ((value: []) => void) | undefined;
    mail.listPending.mockReturnValue(new Promise<[]>(resolve => {
      resolveMarkers = resolve;
    }));

    const { unmount } = renderHook(() => {
      useMemoryWiring('/ws');
    });

    // The hook has started no async work yet when this is evaluated: the
    // restart-safe hold must already exclude an old row.
    expect(isPendingMailRagRetagLoading()).toBe(true);
    expect(shouldExcludeHitFromRetrieval(mailHit)).toBe(true);

    await act(async () => {
      await Promise.resolve();
    });
    expect(mail.setWorkspace).toHaveBeenCalledWith('/ws');
    expect(shouldExcludeHitFromRetrieval(mailHit)).toBe(true);

    await act(async () => {
      resolveMarkers?.([]);
      await Promise.resolve();
    });
    expect(isPendingMailRagRetagLoading()).toBe(false);
    expect(shouldExcludeHitFromRetrieval(mailHit)).toBe(false);
    unmount();
  });

  it('repairs pending filings immediately and retries without waiting for full indexing', async () => {
    mail.listPending
      .mockResolvedValueOnce([{ messageId: 'one', sourceId: 'mail:one', matterId: 'm1' }])
      .mockResolvedValueOnce([{ messageId: 'one', sourceId: 'mail:one', matterId: 'm1' }])
      .mockResolvedValueOnce([]);
    mail.repairPending
      .mockRejectedValueOnce(new Error('vectors unavailable'))
      .mockResolvedValueOnce(1);

    const stop = startPendingMailRagRetagRecovery(
      { rootPath: '/ws', rootGeneration: 1 },
      { retryDelayMs: 10 },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mail.repairPending).toHaveBeenCalledTimes(1);
    expect(shouldExcludeHitFromRetrieval(mailHit)).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(mail.repairPending).toHaveBeenCalledTimes(2);
    expect(shouldExcludeHitFromRetrieval(mailHit)).toBe(false);
    stop();
  });
});
