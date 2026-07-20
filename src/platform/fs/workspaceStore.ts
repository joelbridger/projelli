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
    // Probe with the native `check_path` command, NOT the fs plugin's
    // `exists()`. Recent workspaces are roots OTHER than the one currently open,
    // so they are not in the runtime fs scope; a plugin `exists()` on them would
    // be refused by the ACL and that rejection silently swallowed (the folder
    // would look "present" and never get pruned). `check_path` is a plain
    // `std::fs` probe in Rust that is not scope-gated. (c34 narrowing.)
    const { invoke } = await import('@tauri-apps/api/core');
    const checks = await Promise.all(workspaces.map(async (workspace) => {
      try {
        const result = await invoke<{ exists: boolean }>('check_path', { path: workspace.path });
        return result.exists ? workspace : null;
      } catch {
        // A probe that itself failed (not a clean "missing") must not drop a
        // recent — keep it rather than risk pruning a live workspace.
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
  /**
   * F2.5b — a monotonic counter bumped on every ACTUAL workspace-root change.
   * An in-flight Ask send captures this at send start and re-checks it just
   * before dispatching, so an A→B→A round-trip (which the final root string
   * would compare equal) is still caught — the counter can only move forward.
   */
  rootGeneration: number;
  fileTree: FileNode[];
  selectedPath: string | null;
  expandedPaths: Set<string>;

  // Multi-select state
  selectedPaths: Set<string>;
  lastSelectedPath: string | null; // For Shift+click range selection

  // Recent workspaces
  recentWorkspaces: RecentWorkspace[];
  /**
   * True once loadRecentWorkspaces() has run at least once this session
   * (regardless of whether it found anything). recentWorkspaces starts as
   * `[]` and is only populated by an async-relative-to-mount effect, so
   * `recentWorkspaces.length === 0` alone can't distinguish "not loaded
   * yet" from "genuinely no recent workspaces" — callers that need to make
   * a boot-time decision (e.g. auto-resuming the last workspace) must wait
   * for this flag before trusting recentWorkspaces.
   */
  recentWorkspacesLoaded: boolean;

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
  rootGeneration: 0,
  fileTree: [],
  selectedPath: null,
  expandedPaths: new Set(),
  selectedPaths: new Set(),
  lastSelectedPath: null,
  recentWorkspaces: [],
  recentWorkspacesLoaded: false,

  setRootPath: (path) => {
    // Bump the generation ONLY on a real change (F2.5b), so an in-flight Ask send
    // can detect any workspace switch — including an A→B→A round-trip — since the
    // counter is monotonic and never returns to a prior value.
    set((state) =>
      state.rootPath === path
        ? { rootPath: path }
        : { rootPath: path, rootGeneration: state.rootGeneration + 1 },
    );
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
        console.log(`[RecentWorkspaces] Saved ${String(updated.length)} recent workspaces, latest: ${workspace.name}`);
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
    console.log(`[RecentWorkspaces] Loading from localStorage, found: ${String(stored !== null)}`);
    if (stored) {
      try {
        const workspaces = JSON.parse(stored) as Array<{ path: string; name: string; lastOpened: string }>;
        const restored = dedupeRecentWorkspaces(workspaces.map((w) => ({
          ...w,
          lastOpened: new Date(w.lastOpened),
        })));
        set({ recentWorkspaces: restored, recentWorkspacesLoaded: true });
        try {
          persistRecentWorkspaces(restored);
        } catch (error) {
          console.error('Failed to save recent workspaces:', error);
        }
        void pruneMissingRecentWorkspaces(restored)
          .then((pruned) => {
            if (pruned.length === restored.length) return;
            set({ recentWorkspaces: pruned });
            try {
              persistRecentWorkspaces(pruned);
            } catch (error) {
              console.error('Failed to save recent workspaces:', error);
            }
          })
          .catch((error: unknown) => {
            console.error('Failed to prune missing recent workspaces:', error);
          });
      } catch (error) {
        console.error('Failed to load recent workspaces:', error);
        set({ recentWorkspacesLoaded: true });
      }
    } else {
      set({ recentWorkspacesLoaded: true });
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
