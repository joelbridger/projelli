/**
 * MemoryService — verifies the `memory.enabled` short-circuit.
 *
 * When the toggle is off, `retrieve` returns `[]` WITHOUT invoking the
 * underlying Tauri command (which would throw outside the desktop env).
 * Indexing also short-circuits to a resolved promise so the watcher can
 * fire safely with the toggle off.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Tauri command surface BEFORE importing the service.
vi.mock('@/utils/tauri-commands', () => {
  return {
    ragRetrieve: vi.fn(async () => []),
    ragIndexFile: vi.fn(async () => {}),
    ragIndexWorkspace: vi.fn(async () => {}),
    ragCancelIndexing: vi.fn(async () => {}),
    ragDeletePath: vi.fn(async () => {}),
    ragSetWorkspace: vi.fn(async () => {}),
  };
});

import * as tauri from '@/utils/tauri-commands';
import {
  MemoryService,
  isMemoryEnabled,
  resetMemoryEnabledReader,
  setMemoryEnabledReader,
} from '@/modules/memory/MemoryService';

describe('MemoryService toggle', () => {
  beforeEach(() => {
    resetMemoryEnabledReader();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMemoryEnabledReader();
  });

  it('defaults to enabled (true) when no reader is installed', () => {
    expect(isMemoryEnabled()).toBe(true);
  });

  it('treats reader-throws as enabled (defensive)', () => {
    setMemoryEnabledReader(() => {
      throw new Error('settings not hydrated');
    });
    expect(isMemoryEnabled()).toBe(true);
  });

  it('forwards retrieve to the Tauri command when enabled', async () => {
    setMemoryEnabledReader(() => true);
    (tauri.ragRetrieve as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { path: '/a.md', chunkText: 'hello', score: 0.9, paragraphIndex: 0 },
    ]);
    const hits = await MemoryService.retrieve('hello', 5);
    // WS-B/C: retrieve defaults to an explicit cross-matter scope (no silent
    // "everything" — the command requires a named scope).
    // WS-PRIV: includePrivileged defaults to false (privileged content excluded).
    expect(tauri.ragRetrieve).toHaveBeenCalledWith(
      'hello',
      5,
      { kind: 'allMatters' },
      false,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.chunkText).toBe('hello');
  });

  it('forwards an explicit matter scope to the Tauri command', async () => {
    setMemoryEnabledReader(() => true);
    (tauri.ragRetrieve as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    await MemoryService.retrieve('hello', 5, { kind: 'matter', matterId: 'm-1' });
    expect(tauri.ragRetrieve).toHaveBeenCalledWith(
      'hello',
      5,
      { kind: 'matter', matterId: 'm-1' },
      false,
    );
  });

  it('short-circuits retrieve with [] when disabled (no Tauri call)', async () => {
    setMemoryEnabledReader(() => false);
    const hits = await MemoryService.retrieve('hello', 5);
    expect(hits).toEqual([]);
    expect(tauri.ragRetrieve).not.toHaveBeenCalled();
  });

  it('returns [] for empty query without invoking the embedder', async () => {
    setMemoryEnabledReader(() => true);
    expect(await MemoryService.retrieve('', 5)).toEqual([]);
    expect(await MemoryService.retrieve('   ', 5)).toEqual([]);
    expect(tauri.ragRetrieve).not.toHaveBeenCalled();
  });

  it('returns [] for topK <= 0 without invoking the embedder', async () => {
    setMemoryEnabledReader(() => true);
    expect(await MemoryService.retrieve('hi', 0)).toEqual([]);
    expect(await MemoryService.retrieve('hi', -1)).toEqual([]);
    expect(tauri.ragRetrieve).not.toHaveBeenCalled();
  });

  it('forwards indexFile to the Tauri command when enabled', async () => {
    setMemoryEnabledReader(() => true);
    await MemoryService.indexFile('/w/a.md');
    // WS-B/C: indexing always tags the chunk with a matter id; with no matter
    // resolver installed the default is the "unassigned" sentinel.
    // WS-PRIV: a 3rd arg carries privilege; with no privilege resolver the default is "none".
    expect(tauri.ragIndexFile).toHaveBeenCalledWith('/w/a.md', 'unassigned', 'none');
  });

  it('short-circuits indexFile when disabled', async () => {
    setMemoryEnabledReader(() => false);
    await MemoryService.indexFile('/w/a.md');
    expect(tauri.ragIndexFile).not.toHaveBeenCalled();
  });

  it('short-circuits indexWorkspace when disabled', async () => {
    setMemoryEnabledReader(() => false);
    await MemoryService.indexWorkspace();
    expect(tauri.ragIndexWorkspace).not.toHaveBeenCalled();
  });

  it('still forwards setWorkspace when disabled (metadata, not data)', async () => {
    setMemoryEnabledReader(() => false);
    await MemoryService.setWorkspace('/w');
    expect(tauri.ragSetWorkspace).toHaveBeenCalledWith('/w');
  });

  it('still forwards cancelIndexing when disabled', async () => {
    setMemoryEnabledReader(() => false);
    await MemoryService.cancelIndexing();
    expect(tauri.ragCancelIndexing).toHaveBeenCalled();
  });

  it('short-circuits deletePath when disabled', async () => {
    setMemoryEnabledReader(() => false);
    await MemoryService.deletePath('/w/a.md');
    expect(tauri.ragDeletePath).not.toHaveBeenCalled();
  });
});
