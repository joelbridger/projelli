/**
 * WS-B/C app — indexing carries the resolved matter id.
 *
 * Verifies that MemoryService passes the matter id (resolved from the path via
 * the installed resolver) to the RAG index commands, so every chunk is tagged
 * with the matter it belongs to. Falls back to "unassigned" when no resolver
 * matches the path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Tauri command wrappers so we can assert the args MemoryService
// forwards (the real wrappers throw outside Tauri).
const mocks = vi.hoisted(() => ({
  ragIndexFile: vi.fn(),
  ragIndexWorkspace: vi.fn(),
  ragIndexPdfChunks: vi.fn(),
  ragSetWorkspace: vi.fn(),
  ragRetrieve: vi.fn(),
  ragCancelIndexing: vi.fn(),
  ragDeletePath: vi.fn(),
}));

vi.mock('@/utils/tauri-commands', () => ({
  ragIndexFile: mocks.ragIndexFile,
  ragIndexWorkspace: mocks.ragIndexWorkspace,
  ragIndexPdfChunks: mocks.ragIndexPdfChunks,
  ragSetWorkspace: mocks.ragSetWorkspace,
  ragRetrieve: mocks.ragRetrieve,
  ragCancelIndexing: mocks.ragCancelIndexing,
  ragDeletePath: mocks.ragDeletePath,
}));

import {
  MemoryService,
  setMemoryEnabledReader,
  resetMemoryEnabledReader,
  setMatterResolver,
  resetMatterResolver,
  resolveMatterForPath,
} from '@/modules/memory/MemoryService';

describe('MemoryService indexing carries matter id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMemoryEnabledReader(() => true);
    mocks.ragIndexFile.mockResolvedValue(undefined);
    mocks.ragIndexPdfChunks.mockResolvedValue(1);
  });
  afterEach(() => {
    resetMemoryEnabledReader();
    resetMatterResolver();
  });

  it('passes the resolved matter id to rag_index_file', async () => {
    setMatterResolver((path) =>
      path.includes('/Acme/') ? 'matter_acme' : 'unassigned',
    );
    await MemoryService.indexFile('/ws/Acme/discovery.md');
    expect(mocks.ragIndexFile).toHaveBeenCalledWith(
      '/ws/Acme/discovery.md',
      'matter_acme',
    );
  });

  it('falls back to the unassigned sentinel when no matter matches', async () => {
    setMatterResolver(() => 'unassigned');
    await MemoryService.indexFile('/ws/Scratch/todo.md');
    expect(mocks.ragIndexFile).toHaveBeenCalledWith(
      '/ws/Scratch/todo.md',
      'unassigned',
    );
  });

  it('resolveMatterForPath swallows resolver errors and returns unassigned', () => {
    setMatterResolver(() => {
      throw new Error('boom');
    });
    expect(resolveMatterForPath('/ws/x.md')).toBe('unassigned');
  });

  it('does not index when memory is disabled', async () => {
    setMemoryEnabledReader(() => false);
    await MemoryService.indexFile('/ws/Acme/x.md');
    expect(mocks.ragIndexFile).not.toHaveBeenCalled();
  });

  it('reindexPaths tags every path with the given matter id', async () => {
    await MemoryService.reindexPaths(['/ws/A/1.md', '/ws/A/2.md'], 'matter_a');
    expect(mocks.ragIndexFile).toHaveBeenNthCalledWith(1, '/ws/A/1.md', 'matter_a');
    expect(mocks.ragIndexFile).toHaveBeenNthCalledWith(2, '/ws/A/2.md', 'matter_a');
  });

  it('reindexPaths is best-effort (one failure does not abort the batch)', async () => {
    mocks.ragIndexFile
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValueOnce(undefined);
    await MemoryService.reindexPaths(['/ws/A/bad.md', '/ws/A/ok.md'], 'matter_a');
    expect(mocks.ragIndexFile).toHaveBeenCalledTimes(2);
  });

  it('retrieve forwards the scope to rag_retrieve', async () => {
    mocks.ragRetrieve.mockResolvedValue([]);
    await MemoryService.retrieve('q', 5, { kind: 'matter', matterId: 'm1' });
    expect(mocks.ragRetrieve).toHaveBeenCalledWith('q', 5, {
      kind: 'matter',
      matterId: 'm1',
    });
  });
});
