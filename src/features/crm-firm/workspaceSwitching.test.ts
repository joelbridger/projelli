import { beforeEach, describe, expect, it, vi } from 'vitest';

const { initialize, createFSBackend, normalizeRecentWorkspacePath } = vi.hoisted(() => ({
  initialize: vi.fn(),
  createFSBackend: vi.fn(),
  normalizeRecentWorkspacePath: vi.fn((path: string) => path.trim()),
}));

vi.mock('@/platform/fs/BackendFactory', () => ({ createFSBackend }));
vi.mock('@/platform/fs/WorkspaceService', () => ({
  createWorkspaceService: () => ({ initialize }),
}));
vi.mock('@/platform/fs/workspaceStore', () => ({ normalizeRecentWorkspacePath }));

import { createFirmWorkspace, openFirmWorkspace, registerFirmWorkspaceSwitcher } from './workspaceSwitching';

describe('firm workspace switching', () => {
  beforeEach(() => {
    createFSBackend.mockReset().mockResolvedValue({});
    initialize.mockReset().mockResolvedValue({});
    normalizeRecentWorkspacePath.mockClear().mockImplementation((path: string) => path.trim());
  });

  it('hands prepared spaces to the app-wide safe switching doorway', async () => {
    const select = vi.fn().mockResolvedValue(true);
    const unregister = registerFirmWorkspaceSwitcher(select);
    await expect(createFirmWorkspace('/firms/northcrest')).resolves.toBe(true);
    expect(createFSBackend).toHaveBeenCalledWith('/firms/northcrest', { createIfMissing: true });
    expect(initialize).toHaveBeenCalledWith(expect.anything(), '/firms/northcrest', { createIfMissing: true, createDefaultStructure: true });
    expect(select).toHaveBeenCalledTimes(1);
    unregister();
  });

  it('queues rapid switches so one cannot point stores at the wrong firm space', async () => {
    const visits: string[] = [];
    const first = new Promise<boolean>((resolve) => { setTimeout(() => resolve(true), 0); });
    const select = vi.fn()
      .mockImplementationOnce(async (service: { initialize: unknown }) => { visits.push('first'); return first; })
      .mockImplementationOnce(async () => { visits.push('second'); return true; });
    const unregister = registerFirmWorkspaceSwitcher(select);
    await Promise.all([openFirmWorkspace('/firms/a'), openFirmWorkspace('/firms/b')]);
    expect(visits).toEqual(['first', 'second']);
    expect(createFSBackend.mock.calls.map(([path]) => path)).toEqual(['/firms/a', '/firms/b']);
    unregister();
  });
});
