import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { deletePath, indexFile } = vi.hoisted(() => ({
  deletePath: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  indexFile: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock('@/platform/utils/tauri-commands', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/platform/utils/tauri-commands')>();
  return {
    ...original,
    ragDeletePath: deletePath,
    ragIndexFile: indexFile,
  };
});

import {
  MemoryService,
  resetMeetingFileVisibilityResolver,
  resetRetrievalBackend,
  setMeetingFileVisibilityResolver,
  setRetrievalBackend,
} from './MemoryService';
import type { RagHit } from '@/platform/utils/tauri-commands';

function hit(path: string, text: string, sourceType?: 'meeting'): RagHit {
  return {
    path,
    sourceId: path,
    chunkText: text,
    score: 1,
    paragraphIndex: 0,
    matterId: 'matter-1',
    ...(sourceType ? { sourceType } : {}),
  };
}

describe('meeting visibility at the memory boundary', () => {
  beforeEach(() => {
    deletePath.mockClear();
    indexFile.mockClear();
  });

  afterEach(() => {
    resetMeetingFileVisibilityResolver();
    resetRetrievalBackend();
  });

  it('drops and removes stale hidden meeting rows while leaving ordinary files', async () => {
    const hidden = '/ws/client/Meetings/m1/notes.docx';
    const ordinary = '/ws/client/tax.pdf';
    setMeetingFileVisibilityResolver(async (paths) =>
      new Map(
        paths.map((path) => [
          path,
          path === hidden ? 'hidden' : 'not-meeting',
        ] as const)
      )
    );
    setRetrievalBackend(async () => [
      hit(hidden, 'private meeting text'),
      hit(ordinary, 'ordinary client text'),
    ]);

    const result = await MemoryService.retrieve(
      'question',
      5,
      { kind: 'matter', matterId: 'matter-1' }
    );

    expect(result.map((candidate) => candidate.chunkText)).toEqual([
      'ordinary client text',
    ]);
    expect(deletePath).toHaveBeenCalledWith(hidden);
  });

  it('rechecks the current viewer on every retrieval', async () => {
    const notes = '/ws/client/Meetings/m1/notes.docx';
    let currentViewer: 'owner' | 'excluded' = 'owner';
    setMeetingFileVisibilityResolver(async (paths) =>
      new Map(
        paths.map((path) => [
          path,
          currentViewer === 'owner' ? 'visible' : 'hidden',
        ] as const)
      )
    );
    setRetrievalBackend(async () => [hit(notes, 'private meeting text')]);

    await expect(
      MemoryService.retrieve('q', 5, { kind: 'allMatters' })
    ).resolves.toHaveLength(1);
    currentViewer = 'excluded';
    await expect(
      MemoryService.retrieve('q', 5, { kind: 'allMatters' })
    ).resolves.toEqual([]);
    expect(deletePath).toHaveBeenCalledWith(notes);
  });

  it('refuses indexing until exact meeting visibility is visible', async () => {
    const notes = '/ws/client/Meetings/m1/notes.docx';
    let visible = false;
    setMeetingFileVisibilityResolver(async (paths) =>
      new Map(paths.map((path) => [path, visible ? 'visible' : 'hidden']))
    );

    await MemoryService.indexFile(notes, 'matter-1');
    expect(indexFile).not.toHaveBeenCalled();
    expect(deletePath).toHaveBeenCalledWith(notes);

    visible = true;
    await MemoryService.indexFile(notes, 'matter-1');
    expect(indexFile).toHaveBeenCalledWith(
      notes,
      'matter-1',
      'none',
      'meeting'
    );
  });

  it('treats durable meeting provenance as hidden when wiring is missing, but leaves ordinary rows alone', async () => {
    const notes = '/ws/client/Meetings/m1/notes.docx';
    const ordinary = '/ws/client/tax.pdf';
    resetMeetingFileVisibilityResolver();
    setRetrievalBackend(async () => [
      hit(notes, 'stale private notes', 'meeting'),
      hit(ordinary, 'ordinary client text'),
    ]);

    await expect(
      MemoryService.retrieve('q', 5, { kind: 'allMatters' })
    ).resolves.toEqual([hit(ordinary, 'ordinary client text')]);
    expect(deletePath).toHaveBeenCalledWith(notes);
  });

  it('refuses the dedicated meeting index doorway when visibility wiring is missing', async () => {
    const notes = '/ws/client/Meetings/m1/notes.docx';
    resetMeetingFileVisibilityResolver();

    await MemoryService.indexMeetingFile(notes, 'matter-1');

    expect(indexFile).not.toHaveBeenCalled();
    expect(deletePath).toHaveBeenCalledWith(notes);
  });

  it('fails closed when the meeting resolver is unavailable', async () => {
    const notes = '/ws/client/Meetings/m1/transcript.json';
    setMeetingFileVisibilityResolver(async () => {
      throw new Error('viewer changed');
    });
    setRetrievalBackend(async () => [hit(notes, 'hidden transcript')]);

    await expect(
      MemoryService.retrieve('q', 5, { kind: 'allMatters' })
    ).resolves.toEqual([]);
    expect(deletePath).toHaveBeenCalledWith(notes);
  });
});
