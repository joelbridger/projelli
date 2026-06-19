import { describe, expect, it, vi } from 'vitest';
import { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { FSBackend, FileStat } from '@/platform/fs/types';

function folderStat(path: string): FileStat {
  return {
    path,
    name: path.split(/[\\/]/).pop() || 'Keepance',
    type: 'folder',
    size: 0,
    modifiedAt: new Date(),
    createdAt: new Date(),
    isSymlink: false,
  };
}

function createWindowsMockBackend(): FSBackend {
  const files = new Map<string, string>();
  let rootPath = '';

  return {
    setRootPath: vi.fn(async (path: string) => {
      rootPath = path;
    }),
    getRootPath: vi.fn(() => rootPath),
    exists: vi.fn(async (path: string) => path === '' || files.has(path)),
    stat: vi.fn(async (path: string) => {
      if (path === '') return folderStat(rootPath);
      return folderStat(path);
    }),
    read: vi.fn(async (path: string) => files.get(path) ?? ''),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    write: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    writeBinary: vi.fn(async () => undefined),
    delete: vi.fn(async (path: string) => {
      files.delete(path);
    }),
    move: vi.fn(async (from: string, to: string) => {
      const content = files.get(from);
      if (content !== undefined) {
        files.set(to, content);
        files.delete(from);
      }
    }),
    copy: vi.fn(async (from: string, to: string) => {
      const content = files.get(from);
      if (content !== undefined) {
        files.set(to, content);
      }
    }),
    rename: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    isSymlink: vi.fn(async () => false),
    resolveSymlink: vi.fn(async () => rootPath),
  };
}

describe('WorkspaceService - Windows-style paths on Linux', () => {
  it('passes Windows absolute child paths to the backend as workspace-relative paths', async () => {
    const service = new WorkspaceService();
    const backend = createWindowsMockBackend();

    await service.initialize(backend, 'C:\\Users\\Jane\\Keepance');
    await service.writeFile(
      'c:\\Users\\Jane\\Keepance\\Matters\\Acme\\brief.docx',
      'draft'
    );

    expect(backend.mkdir).toHaveBeenCalledWith('Matters/Acme');
    expect(backend.write).toHaveBeenCalledWith('Matters/Acme/brief.docx', 'draft');
    await expect(
      service.writeFile('C:\\Users\\Jane\\Keepance\\..\\Secret\\brief.docx', 'nope')
    ).rejects.toThrow();
    expect(backend.write).not.toHaveBeenCalledWith('../Secret/brief.docx', 'nope');
  });
});
