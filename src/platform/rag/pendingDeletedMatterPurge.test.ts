import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { ragDeleteMatterMock, mailClearMatterFilingsMock } = vi.hoisted(() => ({
  ragDeleteMatterMock: vi.fn(),
  mailClearMatterFilingsMock: vi.fn(),
}));

vi.mock('@/platform/utils/tauri-commands', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/utils/tauri-commands')>();
  return {
    ...original,
    ragDeleteMatter: (...args: unknown[]): unknown => ragDeleteMatterMock(...args),
  };
});

vi.mock('@/platform/utils/mail-commands', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/utils/mail-commands')>();
  return {
    ...original,
    mailClearMatterFilings: (...args: unknown[]): unknown => mailClearMatterFilingsMock(...args),
  };
});

import { shouldExcludeHitFromRetrieval } from '@/platform/hooks/useMemoryWiring';
import {
  purgePendingDeletedMattersForWorkspace,
  usePendingDeletedMatterStore,
} from '@/platform/rag/pendingDeletedMatterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import type { RagHit } from '@/platform/utils/tauri-commands';

function hit(matterId: string): RagHit {
  return {
    path: '/ws/Clients/Deleted/plan.docx',
    sourceId: '/ws/Clients/Deleted/plan.docx',
    chunkText: 'stale deleted client memory',
    score: 0.9,
    paragraphIndex: 0,
    matterId,
    privilege: 'none',
  };
}

beforeEach(() => {
  ragDeleteMatterMock.mockReset();
  mailClearMatterFilingsMock.mockReset();
  usePendingDeletedMatterStore.setState({ deletedByWorkspace: {} });
  useWorkspaceStore.setState({ rootPath: '/ws', rootGeneration: 1 });
});

afterEach(() => {
  usePendingDeletedMatterStore.setState({ deletedByWorkspace: {} });
  useWorkspaceStore.setState({ rootPath: null, rootGeneration: 0 });
});

describe('pending deleted matter purge', () => {
  it('fails closed after a delete purge failure, then clears the hold after the next boot purge succeeds', async () => {
    usePendingDeletedMatterStore.getState().record('/ws', 'matter-deleted');

    ragDeleteMatterMock.mockRejectedValueOnce(new Error('rag store temporarily locked'));
    mailClearMatterFilingsMock.mockResolvedValue(3);

    await purgePendingDeletedMattersForWorkspace('/ws');

    expect(shouldExcludeHitFromRetrieval(hit('matter-deleted'))).toBe(true);
    expect(usePendingDeletedMatterStore.getState().forWorkspace('/ws')).toEqual([
      'matter-deleted',
    ]);

    ragDeleteMatterMock.mockResolvedValueOnce(undefined);
    mailClearMatterFilingsMock.mockResolvedValueOnce(3);

    await purgePendingDeletedMattersForWorkspace('/ws');

    expect(shouldExcludeHitFromRetrieval(hit('matter-deleted'))).toBe(false);
    expect(usePendingDeletedMatterStore.getState().forWorkspace('/ws')).toEqual([]);
  });
});
