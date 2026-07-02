import { create } from 'zustand';
import type { FileNode, RecentWorkspace } from '@/platform/types/workspace';
import { isTauriEnvironment } from './BackendFactory';
import { SK_RECENT_WORKSPACES } from '@/config/identity';

const MAX_RECENT_WORKSPACES = 10;

export function normalizeRecentWorkspacePath(path: string): string {
  let normalized = path.trim().replace(/\\/g, '/');
  const isUncPath = normalized.startsWith('//');
  const isWindowsDrivePath = /^[A-Za-z]:(?:\/|$)/.test(normalized);

  if (isUncPath) {
    normalized = `//${normalized.slice(2).replace(/\/+/g, '/')}`;
  } else {
    normalized = normalized.replace(/\/+/g, '/');
  }

  const rootLength = isUncPath ? 2 : isWindowsDrivePath ? 3 : 1;
  while (normalized.length > rootLength && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  if (isWindowsDrivePath) {
    normalized = `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
  }

  return normalized;
}

function recentWorkspacePathKey(path: string): string {
  const normalized = normalizeRecentWorkspacePath(path);
  return /^[A-Za-z]:(?:\/|$)/.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized;
}

export function dedupeRecentWorkspaces(workspaces: RecentWorkspace[]): RecentWorkspace[] {
  const normalized = workspaces
    .map((workspace) => ({
      ...workspace,
      path: normalizeRecentWorkspacePath(workspace.path),
      lastOpened: new Date(workspace.lastOpened),
    }))
    .filter((workspace) => workspace.path.length > 0);

  normalized.sort((a, b) => b.lastOpened.getTime() - a.lastOpened.getTime());

  const byPath = new Map<string, RecentWorkspace>();
  for (const workspace of normalized) {
    const key = recentWorkspacePathKey(workspace.path);
    if (!byPath.has(key)) {
      byPath.set(key, workspace);
    }
  }

  return Array.from(byPath.values()).slice(0, MAX_RECENT_WORKSPACES);
}

async function pruneMissingRecentWorkspaces(workspaces: RecentWorkspace[]): Promise<RecentWorkspace[]> {
  if (!isTauriEnvironment()) return workspaces;

  try {
    const fs = await import('@tauri-apps/plugin-fs');
    const checks = await Promise.all(workspaces.map(async (workspace) => {
      try {
        return (await fs.exists(workspace.path)) ? workspace : null;
      } catch {
        return workspace;
      }
    }));
    return checks.filter((workspace): workspace is RecentWorkspace => workspace !== null);
  } catch {
    return workspaces;
  }
}

function persistRecentWorkspaces(workspaces: RecentWorkspace[]): void {
  localStorage.setItem(SK_RECENT_WORKSPACES, JSON.stringify(workspaces));
}

interface WorkspaceState {
  // Current workspace
  rootPath: string | null;
  fileTree: FileNode[];
  selectedPath: string | null;
  expandedPaths: Set<string>;

  // Multi-select state
  selectedPaths: Set<string>;
  lastSelectedPath: string | null; // For Shift+click range selection

  // Recent workspaces
  recentWorkspaces: RecentWorkspace[];

  // Actions
  setRootPath: (path: string) => void;
  setFileTree: (tree: FileNode[]) => void;
  selectPath: (path: string | null) => void;
  toggleExpanded: (path: string) => void;
  expandAllFolders: () => void;
  setExpandedPaths: (paths: Set<string>) => void;
  loadExpandedPaths: (rootPath: string) => boolean;
  saveExpandedPaths: (rootPath: string) => void;
  addRecentWorkspace: (workspace: RecentWorkspace) => void;
  removeRecentWorkspace: (path: string) => void;
  saveRecentWorkspaces: () => void;
  loadRecentWorkspaces: () => void;
  clearWorkspace: () => void;

  // Multi-select actions
  selectMultiplePaths: (paths: Set<string>) => void;
  togglePathSelection: (path: string) => void;
  addToSelection: (path: string) => void;
  removeFromSelection: (path: string) => void;
  selectRange: (startPath: string, endPath: string) => void;
  clearSelection: () => void;
  isPathSelected: (path: string) => boolean;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  rootPath: null,
  fileTree: [],
  selectedPath: null,
  expandedPaths: new Set(),
  selectedPaths: new Set(),
  lastSelectedPath: null,
  recentWorkspaces: [],

  setRootPath: (path) => {
    set({ rootPath: path });
  },

  setFileTree: (tree) => {
    set({ fileTree: tree });
  },

  selectPath: (path) => {
    set({ selectedPath: path });
  },

  toggleExpanded: (path) => {
    set((state) => {
      const newExpanded = new Set(state.expandedPaths);
      if (newExpanded.has(path)) {
        newExpanded.delete(path);
      } else {
        newExpanded.add(path);
      }
      // Auto-save expansion state after toggle
      if (state.rootPath) {
        const key = `workspace_expanded_${state.rootPath}`;
        localStorage.setItem(key, JSON.stringify(Array.from(newExpanded)));
      }
      return { expandedPaths: newExpanded };
    });
  },

  expandAllFolders: () => {
    set((state) => {
      const allFolderPaths = new Set<string>();

      const collectFolders = (nodes: FileNode[]) => {
        for (const node of nodes) {
          if (node.type === 'folder') {
            allFolderPaths.add(node.path);
            if (node.children) {
              collectFolders(node.children);
            }
          }
        }
      };

      collectFolders(state.fileTree);

      // Save to localStorage
      if (state.rootPath) {
        const key = `workspace_expanded_${state.rootPath}`;
        localStorage.setItem(key, JSON.stringify(Array.from(allFolderPaths)));
      }

      return { expandedPaths: allFolderPaths };
    });
  },

  setExpandedPaths: (paths) => {
    set({ expandedPaths: paths });
  },

  loadExpandedPaths: (rootPath) => {
    const key = `workspace_expanded_${rootPath}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        const paths = JSON.parse(stored) as string[];
        set({ expandedPaths: new Set(paths) });
        return paths.length > 0; // Return true if we loaded paths
      } catch (error) {
        console.error('Failed to load expanded paths:', error);
        return false;
      }
    }
    return false; // No saved state
  },

  saveExpandedPaths: (rootPath) => {
    set((state) => {
      const key = `workspace_expanded_${rootPath}`;
      localStorage.setItem(key, JSON.stringify(Array.from(state.expandedPaths)));
      return state;
    });
  },

  addRecentWorkspace: (workspace) => {
    set((state) => {
      const updated = dedupeRecentWorkspaces([
        workspace,
        ...state.recentWorkspaces,
      ]);
      // Persist to localStorage
      try {
        persistRecentWorkspaces(updated);
        console.log(`[RecentWorkspaces] Saved ${updated.length} recent workspaces, latest: ${workspace.name}`);
      } catch (error) {
        console.error('Failed to save recent workspaces:', error);
      }
      return { recentWorkspaces: updated };
    });
  },

  removeRecentWorkspace: (path) => {
    set((state) => {
      const keyToRemove = recentWorkspacePathKey(path);
      const updated = state.recentWorkspaces.filter(
        (workspace) => recentWorkspacePathKey(workspace.path) !== keyToRemove,
      );
      try {
        persistRecentWorkspaces(updated);
      } catch (error) {
        console.error('Failed to save recent workspaces:', error);
      }
      return { recentWorkspaces: updated };
    });
  },

  saveRecentWorkspaces: () => {
    const state = get();
    try {
      persistRecentWorkspaces(dedupeRecentWorkspaces(state.recentWorkspaces));
    } catch (error) {
      console.error('Failed to save recent workspaces:', error);
    }
  },

  loadRecentWorkspaces: () => {
    const stored = localStorage.getItem(SK_RECENT_WORKSPACES);
    console.log(`[RecentWorkspaces] Loading from localStorage, found: ${!!stored}`);
    if (stored) {
      try {
        const workspaces = JSON.parse(stored) as Array<{ path: string; name: string; lastOpened: string }>;
        const restored = dedupeRecentWorkspaces(workspaces.map((w) => ({
          ...w,
          lastOpened: new Date(w.lastOpened),
        })));
        set({ recentWorkspaces: restored });
        try {
          persistRecentWorkspaces(restored);
        } catch (error) {
          console.error('Failed to save recent workspaces:', error);
        }
        void pruneMissingRecentWorkspaces(restored).then((pruned) => {
          if (pruned.length === restored.length) return;
          set({ recentWorkspaces: pruned });
          try {
            persistRecentWorkspaces(pruned);
          } catch (error) {
            console.error('Failed to save recent workspaces:', error);
          }
        });
      } catch (error) {
        console.error('Failed to load recent workspaces:', error);
      }
    }
  },

  clearWorkspace: () => {
    set({
      rootPath: null,
      fileTree: [],
      selectedPath: null,
      expandedPaths: new Set(),
      selectedPaths: new Set(),
      lastSelectedPath: null,
    });
  },

  // Multi-select actions
  selectMultiplePaths: (paths) => {
    set({ selectedPaths: paths });
  },

  togglePathSelection: (path) => {
    set((state) => {
      const newSelected = new Set(state.selectedPaths);
      if (newSelected.has(path)) {
        newSelected.delete(path);
      } else {
        newSelected.add(path);
      }
      return {
        selectedPaths: newSelected,
        lastSelectedPath: path,
      };
    });
  },

  addToSelection: (path) => {
    set((state) => {
      const newSelected = new Set(state.selectedPaths);
      newSelected.add(path);
      return {
        selectedPaths: newSelected,
        lastSelectedPath: path,
      };
    });
  },

  removeFromSelection: (path) => {
    set((state) => {
      const newSelected = new Set(state.selectedPaths);
      newSelected.delete(path);
      return { selectedPaths: newSelected };
    });
  },

  selectRange: (startPath, endPath) => {
    const state = get();
    const flatList: string[] = [];

    // Flatten the tree to get all visible paths in order
    const flattenTree = (nodes: FileNode[], depth = 0) => {
      for (const node of nodes) {
        flatList.push(node.path);
        if (node.type === 'folder' && state.expandedPaths.has(node.path) && node.children) {
          flattenTree(node.children, depth + 1);
        }
      }
    };

    flattenTree(state.fileTree);

    // Find indices of start and end paths
    const startIndex = flatList.indexOf(startPath);
    const endIndex = flatList.indexOf(endPath);

    if (startIndex === -1 || endIndex === -1) return;

    // Select all paths between start and end (inclusive)
    const minIndex = Math.min(startIndex, endIndex);
    const maxIndex = Math.max(startIndex, endIndex);
    const pathsInRange = flatList.slice(minIndex, maxIndex + 1);

    set({
      selectedPaths: new Set(pathsInRange),
      lastSelectedPath: endPath,
    });
  },

  clearSelection: () => {
    set({
      selectedPaths: new Set(),
      lastSelectedPath: null,
    });
  },

  isPathSelected: (path) => {
    return get().selectedPaths.has(path);
  },
}));
