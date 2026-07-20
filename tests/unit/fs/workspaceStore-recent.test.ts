import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dedupeRecentWorkspaces,
  normalizeRecentWorkspacePath,
  useWorkspaceStore,
} from '@/platform/fs/workspaceStore';

const RECENT_KEY = 'lantern_recent_workspaces';
const mockIsTauriEnvironment = vi.hoisted(() => vi.fn(() => false));
// The recent-workspace existence probe now uses the native `check_path`
// command (not the scope-gated fs plugin), so we mock `invoke` and return the
// `{ exists }` shape check_path produces.
const mockInvoke = vi.hoisted(() =>
  vi.fn(async (_cmd: string, _args?: { path?: string }) => ({ exists: true })),
);

vi.mock('@/platform/fs/BackendFactory', () => ({
  isTauriEnvironment: mockIsTauriEnvironment,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: { path?: string }) => mockInvoke(cmd, args),
}));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockIsTauriEnvironment.mockReturnValue(false);
  mockInvoke.mockResolvedValue({ exists: true });
  useWorkspaceStore.setState({
    rootPath: null,
    fileTree: [],
    selectedPath: null,
    expandedPaths: new Set(),
    selectedPaths: new Set(),
    lastSelectedPath: null,
    recentWorkspaces: [],
    recentWorkspacesLoaded: false,
  });
});

describe('recent workspace path cleanup', () => {
  it('normalizes Windows separators and drive casing', () => {
    expect(normalizeRecentWorkspacePath('c:\\Users\\Jameson\\Lantern\\')).toBe('C:/Users/Jameson/Lantern');
  });

  it('dedupes recent workspaces by normalized Windows path', () => {
    const deduped = dedupeRecentWorkspaces([
      {
        path: 'C:/Users/Jameson/Lantern',
        name: 'older',
        lastOpened: new Date('2026-06-23T10:00:00Z'),
      },
      {
        path: 'c:\\users\\jameson\\Lantern\\',
        name: 'newer',
        lastOpened: new Date('2026-06-24T10:00:00Z'),
      },
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toMatchObject({
      path: 'C:/users/jameson/Lantern',
      name: 'newer',
    });
  });

  it('normalizes and dedupes saved recents when loading old localStorage data', () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify([
      {
        path: 'C:/Users/Jameson/Lantern',
        name: 'older',
        lastOpened: '2026-06-23T10:00:00Z',
      },
      {
        path: 'c:\\users\\jameson\\Lantern\\',
        name: 'newer',
        lastOpened: '2026-06-24T10:00:00Z',
      },
    ]));

    useWorkspaceStore.getState().loadRecentWorkspaces();

    const recents = useWorkspaceStore.getState().recentWorkspaces;
    expect(recents).toHaveLength(1);
    expect(recents[0]).toMatchObject({
      path: 'C:/users/jameson/Lantern',
      name: 'newer',
    });

    const persisted = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Array<{ path: string }>;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.path).toBe('C:/users/jameson/Lantern');
  });

  it('removes a recent workspace by normalized path', () => {
    const store = useWorkspaceStore.getState();

    store.addRecentWorkspace({
      path: 'C:/Users/Jameson/Lantern',
      name: 'Lantern',
      lastOpened: new Date('2026-06-24T10:00:00Z'),
    });

    useWorkspaceStore.getState().removeRecentWorkspace('c:\\users\\jameson\\Lantern');

    expect(useWorkspaceStore.getState().recentWorkspaces).toEqual([]);
    expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')).toEqual([]);
  });

  it('prunes dead recent folders when the desktop filesystem reports them missing', async () => {
    mockIsTauriEnvironment.mockReturnValue(true);
    mockInvoke.mockImplementation(async (_cmd: string, args?: { path?: string }) => ({
      exists: args?.path !== 'C:/Missing',
    }));
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

describe('recentWorkspacesLoaded', () => {
  // Regression: callers that decide boot behavior off recentWorkspaces (e.g.
  // auto-resuming the last workspace) can't tell "not loaded yet" apart from
  // "genuinely no recent workspaces" from recentWorkspaces.length alone,
  // because the array starts empty and is only populated once
  // loadRecentWorkspaces() runs. This flag must end up true either way.
  it('starts false and becomes true after loadRecentWorkspaces(), even with nothing stored', () => {
    expect(useWorkspaceStore.getState().recentWorkspacesLoaded).toBe(false);

    useWorkspaceStore.getState().loadRecentWorkspaces();

    expect(useWorkspaceStore.getState().recentWorkspacesLoaded).toBe(true);
    expect(useWorkspaceStore.getState().recentWorkspaces).toEqual([]);
  });

  it('becomes true after loadRecentWorkspaces() when there is stored data', () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify([
      { path: 'C:/Alive', name: 'Alive', lastOpened: '2026-06-24T10:00:00Z' },
    ]));

    useWorkspaceStore.getState().loadRecentWorkspaces();

    expect(useWorkspaceStore.getState().recentWorkspacesLoaded).toBe(true);
    expect(useWorkspaceStore.getState().recentWorkspaces).toHaveLength(1);
  });

  it('becomes true even when the stored blob is corrupt JSON', () => {
    localStorage.setItem(RECENT_KEY, '{not valid json');

    useWorkspaceStore.getState().loadRecentWorkspaces();

    expect(useWorkspaceStore.getState().recentWorkspacesLoaded).toBe(true);
  });
});
