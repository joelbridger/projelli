import { create } from 'zustand';
import type { FileNode, RecentWorkspace } from '@/types/workspace';

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
    set((state) => ({
      recentWorkspaces: [
        workspace,
        ...state.recentWorkspaces.filter((w) => w.path !== workspace.path),
      ].slice(0, 10),
    }));
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
