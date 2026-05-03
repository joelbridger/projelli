// Tests for WorkspaceHost.
//
// Coverage:
//  - listFiles / readFile / writeFile route to the WorkspaceService methods
//  - listFiles defaults to '/' when path arg omitted
//  - throws not-found when no workspace is active
//  - rejects empty / non-string paths with invalid-args
//  - rejects writeFile content that isn't a string
//  - underlying service errors (including SecurityError from PathValidator
//    when the path tries to traverse outside the workspace) surface as
//    invalid-args
//  - handlesMethod is true only for the 3 workspace methods
//  - setWorkspaceAccessor swaps the accessor at runtime

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { WorkspaceHost, WorkspaceHostError } from '@/modules/plugins/hosts/WorkspaceHost';
import type { WorkspaceService } from '@/modules/workspace/WorkspaceService';
import type { FileNode } from '@/types/workspace';

interface FakeService {
  list: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
}

function fakeWorkspace(): FakeService {
  return {
    list: vi.fn(async (_path: string): Promise<FileNode[]> => [
      { id: '1', name: 'note.md', path: '/note.md', type: 'file' },
    ]),
    readFile: vi.fn(async (_path: string): Promise<string> => 'file contents'),
    writeFile: vi.fn(async (_path: string, _content: string): Promise<void> => undefined),
  };
}

let svc: FakeService;
let host: WorkspaceHost;

beforeEach(() => {
  svc = fakeWorkspace();
  host = new WorkspaceHost({ getWorkspace: () => svc as unknown as WorkspaceService });
});

describe('WorkspaceHost.handle', () => {
  it('listFiles delegates to WorkspaceService.list with the supplied path', async () => {
    const result = await host.handle({
      pluginId: 'p',
      method: 'workspace.listFiles',
      args: ['/notes'],
    });
    expect(svc.list).toHaveBeenCalledWith('/notes');
    expect(Array.isArray(result)).toBe(true);
  });

  it('listFiles defaults to "/" when path omitted', async () => {
    await host.handle({ pluginId: 'p', method: 'workspace.listFiles', args: [] });
    expect(svc.list).toHaveBeenCalledWith('/');
  });

  it('readFile delegates to WorkspaceService.readFile', async () => {
    const result = await host.handle({
      pluginId: 'p',
      method: 'workspace.readFile',
      args: ['/note.md'],
    });
    expect(svc.readFile).toHaveBeenCalledWith('/note.md');
    expect(result).toBe('file contents');
  });

  it('writeFile delegates to WorkspaceService.writeFile', async () => {
    await host.handle({
      pluginId: 'p',
      method: 'workspace.writeFile',
      args: ['/note.md', 'new contents'],
    });
    expect(svc.writeFile).toHaveBeenCalledWith('/note.md', 'new contents');
  });

  it('throws not-found when no workspace is active', async () => {
    const noopHost = new WorkspaceHost({ getWorkspace: () => null });
    await expect(
      noopHost.handle({ pluginId: 'p', method: 'workspace.readFile', args: ['/x'] }),
    ).rejects.toThrow(WorkspaceHostError);
  });

  it('rejects empty / non-string paths with invalid-args', async () => {
    await expect(
      host.handle({ pluginId: 'p', method: 'workspace.readFile', args: [''] }),
    ).rejects.toThrow(WorkspaceHostError);
    await expect(
      host.handle({ pluginId: 'p', method: 'workspace.readFile', args: [42] }),
    ).rejects.toThrow(WorkspaceHostError);
  });

  it('rejects writeFile content that is not a string', async () => {
    await expect(
      host.handle({
        pluginId: 'p',
        method: 'workspace.writeFile',
        args: ['/note.md', { not: 'a string' }],
      }),
    ).rejects.toThrow(WorkspaceHostError);
  });

  it('rejects listFiles when path is not a string', async () => {
    await expect(
      host.handle({ pluginId: 'p', method: 'workspace.listFiles', args: [42] }),
    ).rejects.toThrow(WorkspaceHostError);
  });

  it('surfaces SecurityError from path traversal as invalid-args', async () => {
    svc.readFile.mockRejectedValue(
      Object.assign(new Error('Path escapes workspace boundary: ../../../etc/passwd'), {
        name: 'SecurityError',
      }),
    );
    await expect(
      host.handle({
        pluginId: 'p',
        method: 'workspace.readFile',
        args: ['../../../etc/passwd'],
      }),
    ).rejects.toMatchObject({
      code: 'invalid-args',
      message: expect.stringContaining('escapes workspace'),
    });
  });

  it('surfaces FileOperationError as invalid-args', async () => {
    svc.readFile.mockRejectedValue(new Error('Failed to read file: /missing.md'));
    await expect(
      host.handle({ pluginId: 'p', method: 'workspace.readFile', args: ['/missing.md'] }),
    ).rejects.toMatchObject({ code: 'invalid-args' });
  });

  it('throws on unknown methods', async () => {
    await expect(
      host.handle({ pluginId: 'p', method: 'workspace.delete', args: ['/x'] }),
    ).rejects.toThrow(WorkspaceHostError);
  });
});

describe('WorkspaceHost.handlesMethod', () => {
  it('returns true only for the 3 workspace methods', () => {
    expect(host.handlesMethod('workspace.listFiles')).toBe(true);
    expect(host.handlesMethod('workspace.readFile')).toBe(true);
    expect(host.handlesMethod('workspace.writeFile')).toBe(true);
    expect(host.handlesMethod('workspace.delete')).toBe(false);
    expect(host.handlesMethod('editor.getContent')).toBe(false);
  });
});

describe('WorkspaceHost.setWorkspaceAccessor', () => {
  it('swaps the accessor at runtime', async () => {
    const otherSvc = fakeWorkspace();
    otherSvc.readFile.mockResolvedValue('different contents');
    host.setWorkspaceAccessor(() => otherSvc as unknown as WorkspaceService);
    const result = await host.handle({
      pluginId: 'p',
      method: 'workspace.readFile',
      args: ['/x'],
    });
    expect(result).toBe('different contents');
  });
});
