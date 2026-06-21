import { describe, expect, it, vi } from 'vitest';
import { TrashService, type FileOps } from '@/platform/history/TrashService';
import type { FileNode } from '@/platform/types/workspace';

class MemoryFileOps implements FileOps {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();
  readonly moves: Array<{ from: string; to: string }> = [];
  readonly writes: Array<{ path: string; content: string }> = [];
  readonly deletes: string[] = [];

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`Not found: ${path}`);
    return content;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    this.writes.push({ path, content });
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
    this.folders.delete(path);
    this.deletes.push(path);
  }

  async move(from: string, to: string): Promise<void> {
    this.moves.push({ from, to });
    // BUG-030: restore now uses a byte-safe move (incl. to a de-duplicated
    // `_restored_` name) instead of a text read/write that corrupted binaries.
    const content = this.files.get(from);
    if (content === undefined) throw new Error(`Not found: ${from}`);
    this.files.set(to, content);
    this.files.delete(from);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.folders.add(path);
  }

  async list(_path: string): Promise<FileNode[]> {
    return [];
  }

  async stat(path: string): Promise<{ type: 'file' | 'folder'; size: number }> {
    const content = this.files.get(path);
    if (content !== undefined) return { type: 'file', size: content.length };
    if (this.folders.has(path)) return { type: 'folder', size: 0 };
    throw new Error(`Not found: ${path}`);
  }
}

describe('TrashService', () => {
  it('restores a colliding file to a renamed copy and clears payload plus metadata', async () => {
    const fileOps = new MemoryFileOps();
    fileOps.folders.add('/workspace');
    fileOps.files.set('motion.txt', 'original deleted content');

    const service = new TrashService(fileOps, '/workspace');
    await service.initialize();

    const entry = await service.moveToTrash('motion.txt');
    fileOps.files.set('motion.txt', 'replacement content');

    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const restoredPath = await service.restore(entry.id);
    vi.restoreAllMocks();

    expect(restoredPath).toBe('motion_restored_1700000000000.txt');
    expect(fileOps.files.get('motion.txt')).toBe('replacement content');
    expect(fileOps.files.get(restoredPath)).toBe('original deleted content');
    expect(fileOps.files.has(entry.trashPath)).toBe(false);
    expect(service.get(entry.id)).toBeUndefined();
    expect(service.list()).toEqual([]);
    // BUG-030: restore is a byte-safe MOVE (preserves binary files), not a
    // text read/write copy.
    expect(fileOps.moves).toContainEqual({ from: entry.trashPath, to: restoredPath });
    expect(fileOps.writes).not.toContainEqual(
      expect.objectContaining({ path: restoredPath }),
    );
  });

  it('empties only the items whose on-disk delete succeeds, keeping failures visible (BUG-031)', async () => {
    const fileOps = new MemoryFileOps();
    fileOps.folders.add('/workspace');
    fileOps.files.set('a.txt', 'A');
    fileOps.files.set('b.txt', 'B');
    const service = new TrashService(fileOps, '/workspace');
    await service.initialize();
    const a = await service.moveToTrash('a.txt');
    const b = await service.moveToTrash('b.txt');

    // Make the delete of B's trash payload fail (e.g. locked / permission).
    const origDelete = fileOps.delete.bind(fileOps);
    vi.spyOn(fileOps, 'delete').mockImplementation(async (path: string) => {
      if (path === b.trashPath) throw new Error('locked');
      return origDelete(path);
    });

    const removed = await service.emptyTrash();
    vi.restoreAllMocks();

    // Only A was actually deleted; B stays in the trash so it isn't hidden on disk.
    expect(removed).toBe(1);
    expect(service.get(a.id)).toBeUndefined();
    expect(service.get(b.id)).toBeDefined();
    expect(service.list().map((i) => i.id)).toEqual([b.id]);
  });
});
