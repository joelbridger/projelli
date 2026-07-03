/**
 * handleWorkspaceFileChangedEvent — P2 regression: delete→recreate race.
 *
 * Root cause: a file deleted and recreated at the same path within the
 * delete-burst-batcher's debounce window (e.g. an atomic save/replace, or a
 * sync restore) got indexed immediately by the create/modify branch, then
 * had the STALE queued delete fire moments later and remove the fresh
 * chunks — leaving genuinely-present content unsearchable. The fix cancels
 * any delete still queued for a path the instant a create/modify for that
 * same path arrives.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/platform/rag/MemoryService', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/platform/rag/MemoryService')>();
  return {
    ...original,
    MemoryService: {
      ...original.MemoryService,
      indexFile: vi.fn().mockResolvedValue(undefined),
      indexPdfFile: vi.fn().mockResolvedValue({ indexed: true, pageCount: 1 }),
    },
  };
});

import {
  createDeleteBurstBatcher,
  handleWorkspaceFileChangedEvent,
} from './useMemoryWiring';
import { MemoryService } from '@/platform/rag/MemoryService';
import { MCP_SESSION_SCOPE_REL_PATH } from '@/config/identity';

describe('handleWorkspaceFileChangedEvent — delete→recreate race guard (P2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels a queued delete when a create/modify for the same path arrives before the window flushes', async () => {
    const deletePath = vi.fn().mockResolvedValue(undefined);
    const deleteBatcher = createDeleteBurstBatcher(deletePath, {
      windowMs: 250,
    });

    // File is deleted...
    handleWorkspaceFileChangedEvent(
      { kind: 'delete', path: '/ws/report.docx' },
      { deleteBatcher, workspaceService: null }
    );
    // ...then recreated (atomic save/replace, or a sync restore) before the
    // 250ms debounce window has a chance to flush the queued delete.
    handleWorkspaceFileChangedEvent(
      { kind: 'modify', path: '/ws/report.docx' },
      { deleteBatcher, workspaceService: null }
    );

    await vi.advanceTimersByTimeAsync(250);

    // The stale queued delete must never run — it would remove the content
    // that was just (re)indexed, leaving a genuinely-present file unsearchable.
    expect(deletePath).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(MemoryService.indexFile)).toHaveBeenCalledWith(
      '/ws/report.docx'
    );
  });

  it('a delete with no later create/modify for the same path still runs normally', async () => {
    const deletePath = vi.fn().mockResolvedValue(undefined);
    const deleteBatcher = createDeleteBurstBatcher(deletePath, {
      windowMs: 250,
    });

    handleWorkspaceFileChangedEvent(
      { kind: 'delete', path: '/ws/gone.docx' },
      { deleteBatcher, workspaceService: null }
    );

    await vi.advanceTimersByTimeAsync(250);

    expect(deletePath).toHaveBeenCalledWith('/ws/gone.docx');
  });

  it("a create/modify for an UNRELATED path does not cancel a different path's queued delete", async () => {
    const deletePath = vi.fn().mockResolvedValue(undefined);
    const deleteBatcher = createDeleteBurstBatcher(deletePath, {
      windowMs: 250,
    });

    handleWorkspaceFileChangedEvent(
      { kind: 'delete', path: '/ws/a.docx' },
      { deleteBatcher, workspaceService: null }
    );
    handleWorkspaceFileChangedEvent(
      { kind: 'modify', path: '/ws/b.docx' },
      { deleteBatcher, workspaceService: null }
    );

    await vi.advanceTimersByTimeAsync(250);

    expect(deletePath).toHaveBeenCalledWith('/ws/a.docx');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(MemoryService.indexFile)).toHaveBeenCalledWith(
      '/ws/b.docx'
    );
  });

  it('fix/ask-list-hang reconcile: a delete event for an internal .lantern path never enters the delete queue', async () => {
    // The MCP session-scope heartbeat rewrites .lantern/mcp-session-scope.json
    // constantly; a rewrite can surface as a delete+create pair. That must
    // never reach the coalescing batcher (it would consume a debounce window
    // and a breaker "slot" for something that must never be deleted) or
    // trigger indexing — internal plumbing is never a user document.
    const deletePath = vi.fn().mockResolvedValue(undefined);
    const deleteBatcher = createDeleteBurstBatcher(deletePath, {
      windowMs: 250,
    });
    const internalPath = `/ws/${MCP_SESSION_SCOPE_REL_PATH}`;

    handleWorkspaceFileChangedEvent(
      { kind: 'delete', path: internalPath },
      { deleteBatcher, workspaceService: null }
    );
    handleWorkspaceFileChangedEvent(
      { kind: 'modify', path: internalPath },
      { deleteBatcher, workspaceService: null }
    );

    await vi.advanceTimersByTimeAsync(250);

    expect(deletePath).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(MemoryService.indexFile)).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(MemoryService.indexPdfFile)).not.toHaveBeenCalled();
  });

  it('ignores an event with no path', () => {
    const deletePath = vi.fn().mockResolvedValue(undefined);
    const deleteBatcher = createDeleteBurstBatcher(deletePath, {
      windowMs: 250,
    });

    expect(() => {
      handleWorkspaceFileChangedEvent(null, {
        deleteBatcher,
        workspaceService: null,
      });
    }).not.toThrow();
    expect(() => {
      handleWorkspaceFileChangedEvent(undefined, {
        deleteBatcher,
        workspaceService: null,
      });
    }).not.toThrow();
  });
});
