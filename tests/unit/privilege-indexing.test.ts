/**
 * WS-PRIV — MemoryService carries the resolved privilege into indexing, defaults
 * retrieval to EXCLUDE privileged content, forwards an explicit include flag, and
 * re-tags via the engine.
 *
 * Mirrors matter-indexing.test.ts: the Tauri command wrappers are mocked so we
 * can assert exactly what MemoryService forwards.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ragIndexFile: vi.fn(),
  ragIndexWorkspace: vi.fn(),
  ragIndexPdfChunks: vi.fn(),
  ragSetWorkspace: vi.fn(),
  ragRetrieve: vi.fn(),
  ragCancelIndexing: vi.fn(),
  ragDeletePath: vi.fn(),
  ragRetagPrivilege: vi.fn(),
}));

vi.mock('@/utils/tauri-commands', () => ({
  ragIndexFile: mocks.ragIndexFile,
  ragIndexWorkspace: mocks.ragIndexWorkspace,
  ragIndexPdfChunks: mocks.ragIndexPdfChunks,
  ragSetWorkspace: mocks.ragSetWorkspace,
  ragRetrieve: mocks.ragRetrieve,
  ragCancelIndexing: mocks.ragCancelIndexing,
  ragDeletePath: mocks.ragDeletePath,
  ragRetagPrivilege: mocks.ragRetagPrivilege,
}));

import {
  MemoryService,
  setMemoryEnabledReader,
  resetMemoryEnabledReader,
  setMatterResolver,
  resetMatterResolver,
  setPrivilegeResolver,
  resetPrivilegeResolver,
  resolvePrivilegeForPath,
} from '@/modules/memory/MemoryService';

describe('MemoryService carries privilege + default-excludes it', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMemoryEnabledReader(() => true);
    setMatterResolver(() => 'unassigned');
    mocks.ragIndexFile.mockResolvedValue(undefined);
    mocks.ragIndexPdfChunks.mockResolvedValue(1);
    mocks.ragRetrieve.mockResolvedValue([]);
    mocks.ragRetagPrivilege.mockResolvedValue(2);
  });
  afterEach(() => {
    resetMemoryEnabledReader();
    resetMatterResolver();
    resetPrivilegeResolver();
  });

  it('passes the resolved privilege to rag_index_file', async () => {
    setPrivilegeResolver((p) =>
      p.includes('/Privileged/') ? 'attorney-client' : 'none',
    );
    await MemoryService.indexFile('/ws/Acme/Privileged/strategy.md');
    expect(mocks.ragIndexFile).toHaveBeenCalledWith(
      '/ws/Acme/Privileged/strategy.md',
      'unassigned',
      'attorney-client',
    );
  });

  it('falls back to "none" when the source is not tagged', async () => {
    setPrivilegeResolver(() => 'none');
    await MemoryService.indexFile('/ws/Acme/public.md');
    expect(mocks.ragIndexFile).toHaveBeenCalledWith('/ws/Acme/public.md', 'unassigned', 'none');
  });

  it('resolvePrivilegeForPath swallows resolver errors and returns "none"', () => {
    setPrivilegeResolver(() => {
      throw new Error('boom');
    });
    // A resolver failure must never silently leave content privileged — it
    // resolves to the safe "none" so indexing stays correct.
    expect(resolvePrivilegeForPath('/ws/x.md')).toBe('none');
  });

  it('reindexPaths preserves each file privilege across a matter re-index', async () => {
    setPrivilegeResolver((p) => (p.endsWith('priv.md') ? 'work-product' : 'none'));
    await MemoryService.reindexPaths(['/ws/A/priv.md', '/ws/A/pub.md'], 'matter_a');
    expect(mocks.ragIndexFile).toHaveBeenNthCalledWith(1, '/ws/A/priv.md', 'matter_a', 'work-product');
    expect(mocks.ragIndexFile).toHaveBeenNthCalledWith(2, '/ws/A/pub.md', 'matter_a', 'none');
  });

  it('retrieve EXCLUDES privileged content by default (includePrivileged=false)', async () => {
    await MemoryService.retrieve('q', 5, { kind: 'matter', matterId: 'm1' });
    expect(mocks.ragRetrieve).toHaveBeenCalledWith(
      'q',
      5,
      { kind: 'matter', matterId: 'm1' },
      false,
    );
  });

  it('retrieve forwards an explicit includePrivileged=true', async () => {
    await MemoryService.retrieve('q', 5, { kind: 'matter', matterId: 'm1' }, true);
    expect(mocks.ragRetrieve).toHaveBeenCalledWith(
      'q',
      5,
      { kind: 'matter', matterId: 'm1' },
      true,
    );
  });

  it('retagPrivilege calls the engine re-tag command', async () => {
    const updated = await MemoryService.retagPrivilege('/ws/A/memo.md', 'attorney-client');
    expect(mocks.ragRetagPrivilege).toHaveBeenCalledWith('/ws/A/memo.md', 'attorney-client');
    expect(updated).toBe(2);
  });

  it('does not index or re-tag when memory is disabled', async () => {
    setMemoryEnabledReader(() => false);
    await MemoryService.indexFile('/ws/Acme/x.md');
    const updated = await MemoryService.retagPrivilege('/ws/Acme/x.md', 'work-product');
    expect(mocks.ragIndexFile).not.toHaveBeenCalled();
    expect(mocks.ragRetagPrivilege).not.toHaveBeenCalled();
    expect(updated).toBe(0);
  });
});
