import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dedupeRecentWorkspaces,
  normalizeRecentWorkspacePath,
  useWorkspaceStore,
} from '@/platform/fs/workspaceStore';

const RECENT_KEY = 'keepance_recent_workspaces';
const mockIsTauriEnvironment = vi.hoisted(() => vi.fn(() => false));
const mockFsExists = vi.hoisted(() => vi.fn(async (_path?: string) => true));

vi.mock('@/platform/fs/BackendFactory', () => ({
  isTauriEnvironment: mockIsTauriEnvironment,
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: mockFsExists,
}));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockIsTauriEnvironment.mockReturnValue(false);
  mockFsExists.mockResolvedValue(true);
  useWorkspaceStore.setState({
    rootPath: null,
    fileTree: [],
    selectedPath: null,
    expandedPaths: new Set(),
    selectedPaths: new Set(),
    lastSelectedPath: null,
    recentWorkspaces: [],
  });
});

describe('recent workspace path cleanup', () => {
  it('normalizes Windows separators and drive casing', () => {
    expect(normalizeRecentWorkspacePath('c:\\Users\\Jameson\\Keepance\\')).toBe('C:/Users/Jameson/Keepance');
  });

  it('dedupes recent workspaces by normalized Windows path', () => {
    const deduped = dedupeRecentWorkspaces([
      {
        path: 'C:/Users/Jameson/Keepance',
        name: 'older',
        lastOpened: new Date('2026-06-23T10:00:00Z'),
      },
      {
        path: 'c:\\users\\jameson\\keepance\\',
        name: 'newer',
        lastOpened: new Date('2026-06-24T10:00:00Z'),
      },
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toMatchObject({
      path: 'C:/users/jameson/keepance',
      name: 'newer',
    });
  });

  it('normalizes and dedupes saved recents when loading old localStorage data', () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify([
      {
        path: 'C:/Users/Jameson/Keepance',
        name: 'older',
        lastOpened: '2026-06-23T10:00:00Z',
      },
      {
        path: 'c:\\users\\jameson\\keepance\\',
        name: 'newer',
        lastOpened: '2026-06-24T10:00:00Z',
      },
    ]));

    useWorkspaceStore.getState().loadRecentWorkspaces();

    const recents = useWorkspaceStore.getState().recentWorkspaces;
    expect(recents).toHaveLength(1);
    expect(recents[0]).toMatchObject({
      path: 'C:/users/jameson/keepance',
      name: 'newer',
    });

    const persisted = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Array<{ path: string }>;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.path).toBe('C:/users/jameson/keepance');
  });

  it('removes a recent workspace by normalized path', () => {
    const store = useWorkspaceStore.getState();

    store.addRecentWorkspace({
      path: 'C:/Users/Jameson/Keepance',
      name: 'Keepance',
      lastOpened: new Date('2026-06-24T10:00:00Z'),
    });

    useWorkspaceStore.getState().removeRecentWorkspace('c:\\users\\jameson\\keepance');

    expect(useWorkspaceStore.getState().recentWorkspaces).toEqual([]);
    expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')).toEqual([]);
  });

  it('prunes dead recent folders when the desktop filesystem reports them missing', async () => {
    mockIsTauriEnvironment.mockReturnValue(true);
    mockFsExists.mockImplementation(async (path?: string) => path !== 'C:/Missing');
    localStorage.setItem(RECENT_KEY, JSON.stringify([
      {
        path: 'C:/Alive',
        name: 'Alive',
        lastOpened: '2026-06-24T10:00:00Z',
      },
      {
        path: 'C:/Missing',
        name: 'Missing',
        lastOpened: '2026-06-24T09:00:00Z',
      },
    ]));

    useWorkspaceStore.getState().loadRecentWorkspaces();
    expect(useWorkspaceStore.getState().recentWorkspaces.map((w) => w.name)).toEqual(['Alive', 'Missing']);

    await vi.waitFor(() => {
      expect(useWorkspaceStore.getState().recentWorkspaces.map((w) => w.name)).toEqual(['Alive']);
    });

    const persisted = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Array<{ name: string }>;
    expect(persisted.map((w) => w.name)).toEqual(['Alive']);
  });
});
