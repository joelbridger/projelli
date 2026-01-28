import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface OpenTab {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  groupId?: string | null; // Optional group ID
  lastSaved?: number; // Timestamp of last save
  type?: 'file' | 'browser' | 'whiteboard'; // Tab type (default: 'file' for backward compatibility)
  metadata?: {
    url?: string; // For browser tabs
    favicon?: string; // For browser tabs
  };
}

interface TabGroup {
  id: string;
  name: string;
  collapsed: boolean;
  color?: string;
}

interface PaneLayout {
  id: string;
  direction: 'horizontal' | 'vertical';
  sizes: number[];
  panes: (string | PaneLayout)[];
}

interface EditorState {
  // Open tabs
  openTabs: OpenTab[];
  activeTabPath: string | null;

  // Tab groups
  tabGroups: TabGroup[];
  nextGroupId: number;

  // Split pane state
  isSplit: boolean;
  splitDirection: 'horizontal' | 'vertical';
  secondaryTabPath: string | null;

  // Side panels
  showOutline: boolean;
  showBacklinks: boolean;

  // Pane layout
  layout: PaneLayout | null;

  // Actions
  openFile: (path: string, name: string, content: string) => void;
  openTab: (path: string, name: string, content: string, type?: 'file' | 'browser' | 'whiteboard', metadata?: { url?: string; favicon?: string }) => void;
  closeTab: (path: string) => void;
  closeTabsByPath: (path: string) => void; // Close all tabs for a deleted file
  setActiveTab: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  markSaved: (path: string) => void;
  setLayout: (layout: PaneLayout) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;

  // Split pane actions
  splitPane: (direction: 'horizontal' | 'vertical') => void;
  closeSplit: () => void;
  setSecondaryTab: (path: string | null) => void;

  // Panel actions
  toggleOutline: () => void;
  toggleBacklinks: () => void;

  // Tab group actions
  createTabGroup: (name: string, tabPaths?: string[]) => string;
  renameTabGroup: (groupId: string, newName: string) => void;
  deleteTabGroup: (groupId: string) => void;
  toggleGroupCollapsed: (groupId: string) => void;
  moveTabToGroup: (tabPath: string, groupId: string | null) => void;
  ungroupTab: (tabPath: string) => void;
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set) => ({
  openTabs: [],
  activeTabPath: null,
  layout: null,

  // Tab groups
  tabGroups: [],
  nextGroupId: 1,

  // Split pane state
  isSplit: false,
  splitDirection: 'horizontal',
  secondaryTabPath: null,

  // Side panels
  showOutline: false,
  showBacklinks: false,

  openFile: (path, name, content) => {
    set((state) => {
      // Normalize path to prevent duplicates from inconsistent path formatting
      const normalizedPath = path.replace(/\/+/g, '/').replace(/\/$/, '');
      const existingTab = state.openTabs.find((t) => {
        const existingNormalizedPath = t.path.replace(/\/+/g, '/').replace(/\/$/, '');
        return existingNormalizedPath === normalizedPath;
      });

      if (existingTab) {
        // Update content if it's different (file might have been modified externally)
        const updatedTabs = state.openTabs.map((t) =>
          t.path === existingTab.path ? { ...t, content, isDirty: false } : t
        );
        return { openTabs: updatedTabs, activeTabPath: existingTab.path };
      }

      return {
        openTabs: [...state.openTabs, { path: normalizedPath, name, content, isDirty: false }],
        activeTabPath: normalizedPath,
      };
    });
  },

  openTab: (path, name, content, type = 'file', metadata) => {
    set((state) => {
      // Normalize path to prevent duplicates
      const normalizedPath = path.replace(/\/+/g, '/').replace(/\/$/, '');
      const existingTab = state.openTabs.find((t) => {
        const existingNormalizedPath = t.path.replace(/\/+/g, '/').replace(/\/$/, '');
        return existingNormalizedPath === normalizedPath;
      });

      if (existingTab) {
        // Update existing tab
        const updatedTabs = state.openTabs.map((t) =>
          t.path === existingTab.path
            ? { ...t, content, isDirty: false, type, ...(metadata ? { metadata } : {}) }
            : t
        );
        return { openTabs: updatedTabs, activeTabPath: existingTab.path };
      }

      const newTab: OpenTab = {
        path: normalizedPath,
        name,
        content,
        isDirty: false,
        type,
        ...(metadata ? { metadata } : {})
      };

      return {
        openTabs: [...state.openTabs, newTab],
        activeTabPath: normalizedPath,
      };
    });
  },

  closeTab: (path) => {
    set((state) => {
      const newTabs = state.openTabs.filter((t) => t.path !== path);
      const newActiveTab =
        state.activeTabPath === path
          ? newTabs[newTabs.length - 1]?.path ?? null
          : state.activeTabPath;
      // Also clear secondary tab if it was closed
      const newSecondaryTab =
        state.secondaryTabPath === path ? null : state.secondaryTabPath;

      // Auto-cleanup: Remove empty tab groups
      const tabGroupIds = new Set(newTabs.map(t => t.groupId).filter(Boolean));
      const cleanedTabGroups = state.tabGroups.filter(group => tabGroupIds.has(group.id));

      return {
        openTabs: newTabs,
        activeTabPath: newActiveTab,
        secondaryTabPath: newSecondaryTab,
        isSplit: newSecondaryTab ? state.isSplit : false,
        tabGroups: cleanedTabGroups,
      };
    });
  },

  closeTabsByPath: (path) => {
    set((state) => {
      // Normalize the path to match how paths are stored in tabs
      const normalizedPath = path.replace(/\/+/g, '/').replace(/\/$/, '');

      // Find all tabs that match this path (should only be one, but handle duplicates)
      const tabsToClose = state.openTabs.filter((t) => {
        const tabNormalizedPath = t.path.replace(/\/+/g, '/').replace(/\/$/, '');
        return tabNormalizedPath === normalizedPath;
      });

      // If no tabs match, no changes needed
      if (tabsToClose.length === 0) {
        return state;
      }

      // Remove all matching tabs
      const newTabs = state.openTabs.filter((t) => {
        const tabNormalizedPath = t.path.replace(/\/+/g, '/').replace(/\/$/, '');
        return tabNormalizedPath !== normalizedPath;
      });

      // Determine new active tab
      // If the active tab was closed, switch to the last remaining tab
      const activeWasClosed = tabsToClose.some((t) => t.path === state.activeTabPath);
      const newActiveTab = activeWasClosed
        ? newTabs[newTabs.length - 1]?.path ?? null
        : state.activeTabPath;

      // Clear secondary tab if it was closed
      const secondaryWasClosed = tabsToClose.some((t) => t.path === state.secondaryTabPath);
      const newSecondaryTab = secondaryWasClosed ? null : state.secondaryTabPath;

      return {
        openTabs: newTabs,
        activeTabPath: newActiveTab,
        secondaryTabPath: newSecondaryTab,
        isSplit: newSecondaryTab ? state.isSplit : false,
      };
    });
  },

  setActiveTab: (path) => {
    set({ activeTabPath: path });
  },

  updateContent: (path, content) => {
    set((state) => ({
      openTabs: state.openTabs.map((t) =>
        t.path === path ? { ...t, content, isDirty: true } : t
      ),
    }));
  },

  markSaved: (path) => {
    set((state) => ({
      openTabs: state.openTabs.map((t) =>
        t.path === path ? { ...t, isDirty: false, lastSaved: Date.now() } : t
      ),
    }));
  },

  setLayout: (layout) => {
    set({ layout });
  },

  reorderTabs: (fromIndex, toIndex) => {
    set((state) => {
      const newTabs = [...state.openTabs];
      const [movedTab] = newTabs.splice(fromIndex, 1);
      if (movedTab) {
        newTabs.splice(toIndex, 0, movedTab);
      }
      return { openTabs: newTabs };
    });
  },

  // Split pane actions
  splitPane: (direction) => {
    set((state) => {
      // If we have at least 2 tabs, use the second one; otherwise duplicate the active
      const otherTab = state.openTabs.find((t) => t.path !== state.activeTabPath);
      return {
        isSplit: true,
        splitDirection: direction,
        secondaryTabPath: otherTab?.path ?? state.activeTabPath,
      };
    });
  },

  closeSplit: () => {
    set({
      isSplit: false,
      secondaryTabPath: null,
    });
  },

  setSecondaryTab: (path) => {
    set({ secondaryTabPath: path });
  },

  // Panel actions
  toggleOutline: () => {
    set((state) => ({ showOutline: !state.showOutline }));
  },

  toggleBacklinks: () => {
    set((state) => ({ showBacklinks: !state.showBacklinks }));
  },

  // Tab group actions
  createTabGroup: (name, tabPaths = []) => {
    let newGroupId = '';
    set((state) => {
      const groupId = `group_${state.nextGroupId}`;
      newGroupId = groupId;
      const newGroup: TabGroup = {
        id: groupId,
        name,
        collapsed: false,
      };

      // Update tabs to belong to this group
      const updatedTabs = state.openTabs.map((tab) =>
        tabPaths.includes(tab.path) ? { ...tab, groupId } : tab
      );

      return {
        tabGroups: [...state.tabGroups, newGroup],
        nextGroupId: state.nextGroupId + 1,
        openTabs: updatedTabs,
      };
    });
    return newGroupId;
  },

  renameTabGroup: (groupId, newName) => {
    set((state) => ({
      tabGroups: state.tabGroups.map((group) =>
        group.id === groupId ? { ...group, name: newName } : group
      ),
    }));
  },

  deleteTabGroup: (groupId) => {
    set((state) => {
      // Remove the group and ungroup all its tabs
      const updatedTabs = state.openTabs.map((tab) =>
        tab.groupId === groupId ? { ...tab, groupId: null } : tab
      );

      return {
        tabGroups: state.tabGroups.filter((group) => group.id !== groupId),
        openTabs: updatedTabs,
      };
    });
  },

  toggleGroupCollapsed: (groupId) => {
    set((state) => ({
      tabGroups: state.tabGroups.map((group) =>
        group.id === groupId ? { ...group, collapsed: !group.collapsed } : group
      ),
    }));
  },

  moveTabToGroup: (tabPath, groupId) => {
    set((state) => {
      const updatedTabs = state.openTabs.map((tab) =>
        tab.path === tabPath ? { ...tab, groupId } : tab
      );

      // Auto-cleanup: Remove empty tab groups after move
      const tabGroupIds = new Set(updatedTabs.map(t => t.groupId).filter(Boolean));
      const cleanedTabGroups = state.tabGroups.filter(group => tabGroupIds.has(group.id));

      return {
        openTabs: updatedTabs,
        tabGroups: cleanedTabGroups,
      };
    });
  },

  ungroupTab: (tabPath) => {
    set((state) => {
      const updatedTabs = state.openTabs.map((tab) =>
        tab.path === tabPath ? { ...tab, groupId: null } : tab
      );

      // Auto-cleanup: Remove empty tab groups
      const tabGroupIds = new Set(updatedTabs.map(t => t.groupId).filter(Boolean));
      const cleanedTabGroups = state.tabGroups.filter(group => tabGroupIds.has(group.id));

      return {
        openTabs: updatedTabs,
        tabGroups: cleanedTabGroups,
      };
    });
  },
    }),
    {
      name: 'editor-storage', // localStorage key
      // Only persist tab groups, not open tabs or active state
      partialize: (state) => ({
        tabGroups: state.tabGroups,
        nextGroupId: state.nextGroupId,
      }),
    }
  )
);
