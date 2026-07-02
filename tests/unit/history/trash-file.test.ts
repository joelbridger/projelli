/**
 * Shared moveToTrash helper — used by the AI's delete_file tool so an
 * AI-deleted file is GENUINELY recoverable (moved to .trash + recorded in the
 * same metadata the Trash panel reads), not hard-deleted while claiming "moved
 * to trash". Mirrors the UI delete's location + metadata format.
 */
import { describe, it, expect } from 'vitest';
import { moveToTrash, type TrashFs } from '@/platform/history/trashFile';

/** A tiny in-memory fs implementing just what moveToTrash needs. */
function memFs(initial: Record<string, string> = {}): TrashFs & { files: Record<string, string>; dirs: Set<string> } {
  const files: Record<string, string> = { ...initial };
  const dirs = new Set<string>();
  return {
    files,
    dirs,
    async exists(path) {
      return path in files || dirs.has(path);
    },
    async mkdir(path) {
      dirs.add(path);
    },
    async move(from, to) {
      if (!(from in files)) throw new Error(`no such file: ${from}`);
      files[to] = files[from]!;
      delete files[from];
    },
    async stat() {
      return { type: 'file', size: 42 };
    },
    async readFile(path) {
      if (!(path in files)) throw new Error(`no such file: ${path}`);
      return files[path]!;
    },
    async writeFile(path, content) {
      files[path] = content;
    },
  };
}

describe('moveToTrash', () => {
  it('moves the file into .trash with a timestamped name and returns the entry', async () => {
    const fs = memFs({ '/ws/notes/old.md': 'goodbye' });
    const item = await moveToTrash(fs, '/ws', '/ws/notes/old.md', { now: 1700, id: 'trash_1' });

    expect(item.originalPath).toBe('/ws/notes/old.md');
    expect(item.trashPath).toBe('/ws/.trash/1700_trash_1_old.md');
    expect(item.name).toBe('old.md');
    expect(fs.files['/ws/.trash/1700_trash_1_old.md']).toBe('goodbye'); // physically present
    expect('/ws/notes/old.md' in fs.files).toBe(false); // gone from original
  });

  it('records the deletion in the shared metadata file (most-recent first, ISO date)', async () => {
    const fs = memFs({ '/ws/a.md': 'A' });
    await moveToTrash(fs, '/ws', '/ws/a.md', { now: 1700, id: 'trash_1' });

    const meta = JSON.parse(fs.files['/ws/.trash/metadata.json']!) as Array<Record<string, unknown>>;
    expect(meta).toHaveLength(1);
    expect(meta[0]?.['id']).toBe('trash_1');
    expect(meta[0]?.['originalPath']).toBe('/ws/a.md');
    expect(meta[0]?.['trashPath']).toBe('/ws/.trash/1700_trash_1_a.md');
    expect(meta[0]?.['deletedAt']).toBe(new Date(1700).toISOString());
  });

  it('appends to existing metadata without clobbering earlier entries', async () => {
    const fs = memFs({ '/ws/a.md': 'A', '/ws/b.md': 'B' });
    await moveToTrash(fs, '/ws', '/ws/a.md', { now: 1700, id: 'trash_1' });
    await moveToTrash(fs, '/ws', '/ws/b.md', { now: 1800, id: 'trash_2' });

    const meta = JSON.parse(fs.files['/ws/.trash/metadata.json']!) as Array<Record<string, unknown>>;
    expect(meta.map((m) => m['id'])).toEqual(['trash_2', 'trash_1']); // newest first
  });

  it('creates the .trash folder when it does not exist yet', async () => {
    const fs = memFs({ '/ws/a.md': 'A' });
    await moveToTrash(fs, '/ws', '/ws/a.md', { now: 1700, id: 'trash_1' });
    expect(fs.dirs.has('/ws/.trash')).toBe(true);
  });

  it('never overwrites an existing trashed file — dedupes the trash path on collision', async () => {
    const fs = memFs({ '/ws/a.md': 'NEW' });
    // Pre-seed the would-be trash path (simulating an earlier same-id collision).
    fs.files['/ws/.trash/1700_trash_1_a.md'] = 'PRE-EXISTING TRASHED FILE';
    fs.dirs.add('/ws/.trash');

    const item = await moveToTrash(fs, '/ws', '/ws/a.md', { now: 1700, id: 'trash_1' });

    expect(item.trashPath).toBe('/ws/.trash/1700_trash_1_1_a.md'); // deduped
    expect(fs.files['/ws/.trash/1700_trash_1_a.md']).toBe('PRE-EXISTING TRASHED FILE'); // untouched
    expect(fs.files['/ws/.trash/1700_trash_1_1_a.md']).toBe('NEW');
  });

  it('records metadata BEFORE moving, so a failed move leaves a self-filtering entry (no hidden loss)', async () => {
    const fs = memFs({ '/ws/a.md': 'A' });
    // Make the move fail; the metadata must already be written and the original intact.
    fs.move = async () => { throw new Error('disk error'); };

    await expect(moveToTrash(fs, '/ws', '/ws/a.md', { now: 1700, id: 'trash_1' })).rejects.toThrow(/disk error/);

    expect(fs.files['/ws/a.md']).toBe('A'); // original file untouched (no data loss)
    const meta = JSON.parse(fs.files['/ws/.trash/metadata.json']!) as unknown[];
    expect(meta).toHaveLength(1); // entry was written; its trashPath is absent → loader self-filters
  });

  it('starts fresh if the existing metadata file is corrupt (does not throw)', async () => {
    const fs = memFs({ '/ws/a.md': 'A', '/ws/.trash/metadata.json': 'not json{' });
    fs.dirs.add('/ws/.trash');
    const item = await moveToTrash(fs, '/ws', '/ws/a.md', { now: 1700, id: 'trash_1' });
    const meta = JSON.parse(fs.files['/ws/.trash/metadata.json']!) as Array<Record<string, unknown>>;
    expect(meta).toHaveLength(1);
    expect(meta[0]?.['id']).toBe(item.id);
  });
});
