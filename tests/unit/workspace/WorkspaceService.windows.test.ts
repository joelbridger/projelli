import { describe, expect, it, vi } from 'vitest';
import { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { SecurityError } from '@/platform/fs/types';
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

  it.each([
    ['writeFile', 'CON.docx'],
    ['writeFile', 'PRN'],
    ['writeFile', 'NUL'],
    ['writeFile', 'COM1'],
    ['writeFile', 'brief.'],
    ['writeFile', 'brief '],
    ['writeFileBinary', 'CON.docx'],
    ['writeFileBinary', 'PRN'],
    ['writeFileBinary', 'NUL'],
    ['writeFileBinary', 'COM1'],
    ['writeFileBinary', 'brief.'],
    ['writeFileBinary', 'brief '],
    ['mkdir', 'CON.docx'],
    ['mkdir', 'PRN'],
    ['mkdir', 'NUL'],
    ['mkdir', 'COM1'],
    ['mkdir', 'brief.'],
    ['mkdir', 'brief '],
  ] as const)('rejects invalid Windows create name via %s: %s', async (operation, name) => {
    const service = new WorkspaceService();
    const backend = createWindowsMockBackend();
    await service.initialize(backend, 'C:\\Users\\Jane\\Keepance');

    const path = `C:\\Users\\Jane\\Keepance\\Matters\\Acme\\${name}`;
    const action =
      operation === 'writeFile'
        ? service.writeFile(path, 'draft')
        : operation === 'writeFileBinary'
          ? service.writeFileBinary(path, new ArrayBuffer(1))
          : service.mkdir(path);

    await expect(action).rejects.toThrow(SecurityError);
    expect(backend.write).not.toHaveBeenCalled();
    expect(backend.writeBinary).not.toHaveBeenCalled();
    expect(backend.mkdir).not.toHaveBeenCalledWith('Matters/Acme');
  });

  it('rejects a reserved-name destination on copy and move (create paths too)', async () => {
    // Codex review #2 (round 2): copy()/move() also create the destination (and
    // its parents), so the reserved-name guard must cover them, not just
    // writeFile/writeFileBinary/mkdir.
    const service = new WorkspaceService();
    const backend = createWindowsMockBackend();
    await service.initialize(backend, 'C:\\Users\\Jane\\Keepance');
    const root = 'C:\\Users\\Jane\\Keepance';

    await expect(
      service.copy(`${root}\\Clients\\Acme\\brief.docx`, `${root}\\Clients\\CON.docx`),
    ).rejects.toThrow(SecurityError);
    await expect(
      service.copy(`${root}\\Clients\\Acme\\brief.docx`, `${root}\\Clients\\CON\\brief.docx`),
    ).rejects.toThrow(SecurityError);
    await expect(
      service.move(`${root}\\Clients\\Acme\\brief.docx`, `${root}\\Clients\\NUL.docx`),
    ).rejects.toThrow(SecurityError);
    expect(backend.copy).not.toHaveBeenCalled();
    expect(backend.move).not.toHaveBeenCalled();
  });

  it('rejects a reserved device name in a PARENT segment (nested create path)', async () => {
    // Codex review #4: writeFile/mkdir create missing parents, so a reserved
    // segment anywhere in the path (not just the leaf) must be rejected.
    const service = new WorkspaceService();
    const backend = createWindowsMockBackend();
    await service.initialize(backend, 'C:\\Users\\Jane\\Keepance');

    await expect(
      service.writeFile('C:\\Users\\Jane\\Keepance\\Clients\\CON\\brief.docx', 'draft'),
    ).rejects.toThrow(SecurityError);
    await expect(
      service.mkdir('C:\\Users\\Jane\\Keepance\\Clients\\NUL\\Sub'),
    ).rejects.toThrow(SecurityError);
    expect(backend.write).not.toHaveBeenCalled();
    expect(backend.mkdir).not.toHaveBeenCalled();
  });

  it.each([
    ['writeFile', 'CONTRACT.docx'],
    ['writeFile', 'COM10.docx'],
    ['writeFile', 'brief.docx'],
    ['writeFileBinary', 'CONTRACT.docx'],
    ['writeFileBinary', 'COM10.docx'],
    ['writeFileBinary', 'brief.docx'],
    ['mkdir', 'CONTRACT.docx'],
    ['mkdir', 'COM10.docx'],
    ['mkdir', 'brief.docx'],
  ] as const)('accepts ordinary Windows-safe create name via %s: %s', async (operation, name) => {
    const service = new WorkspaceService();
    const backend = createWindowsMockBackend();
    await service.initialize(backend, 'C:\\Users\\Jane\\Keepance');

    const path = `C:\\Users\\Jane\\Keepance\\Matters\\Acme\\${name}`;
    if (operation === 'writeFile') {
      await service.writeFile(path, 'draft');
      expect(backend.write).toHaveBeenCalledWith(`Matters/Acme/${name}`, 'draft');
    } else if (operation === 'writeFileBinary') {
      const bytes = new ArrayBuffer(1);
      await service.writeFileBinary(path, bytes);
      expect(backend.writeBinary).toHaveBeenCalledWith(`Matters/Acme/${name}`, bytes);
    } else {
      await service.mkdir(path);
      expect(backend.mkdir).toHaveBeenCalledWith(`Matters/Acme/${name}`);
    }
  });
});
