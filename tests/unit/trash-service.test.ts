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
    if (to.includes('_restored_')) {
      throw new Error('collision restore must not depend on move');
    }
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
    expect(fileOps.deletes).toContain(entry.trashPath);
    expect(fileOps.moves).not.toContainEqual({ from: entry.trashPath, to: restoredPath });
  });
});
