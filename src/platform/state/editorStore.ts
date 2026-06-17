import { create } from 'zustand';
import { isBinaryFile, arrayBufferToDataUrl, getMimeType } from '@/utils/file-utils';

interface OpenTab {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  groupId?: string | null; // Optional group ID
  lastSaved?: number; // Timestamp of last save
  // UX-21: 'ai-assistant' is a new sentinel type for the AI Assistant
  // main-panel tab. Reusing the existing 'file' → extension routing in
  // MainPanel doesn't work here because the tab has no file on disk.
  // 'email' is the Keepance 3.0 read-only mail viewer (no file on disk; the
  // message id rides in `metadata.mailSourceId`).
  type?: 'file' | 'browser' | 'ai-assistant' | 'workflow-execution' | 'email';
  metadata?: {
    url?: string; // For browser tabs
    favicon?: string; // For browser tabs
    mailSourceId?: string; // For email tabs: the `mail:<id>` source / message id
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

interface PersistedTabState {
  tabs: { path: string; name: string; groupId?: string | null; type?: string; metadata?: object }[];
  activeTabPath: string | null;
  tabGroups: TabGroup[];
  nextGroupId: number;
  isSplit: boolean;
  splitDirection: 'horizontal' | 'vertical';
  secondaryTabPath: string | null;
  showOutline: boolean;
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

  // Pane layout
  layout: PaneLayout | null;

  // UX-36: Tab overflow behavior preference.
  tabOverflow: 'scroll' | 'wrap';
  setTabOverflow: (mode: 'scroll' | 'wrap') => void;

  // Actions
  openFile: (path: string, name: string, content: string) => void;
  openTab: (path: string, name: string, content: string, type?: 'file' | 'browser' | 'ai-assistant' | 'workflow-execution' | 'email', metadata?: { url?: string; favicon?: string; mailSourceId?: string }) => void;
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

  // Tab group actions
  createTabGroup: (name: string, tabPaths?: string[]) => string;
  renameTabGroup: (groupId: string, newName: string) => void;
  deleteTabGroup: (groupId: string) => void;
  toggleGroupCollapsed: (groupId: string) => void;
  moveTabToGroup: (tabPath: string, groupId: string | null) => void;
  ungroupTab: (tabPath: string) => void;
  // R2-P3: reorder groups horizontally. `position` is relative to the
  // target group: 'before' places the source group just to its left,
  // 'after' to its right.
  reorderTabGroups: (sourceId: string, targetId: string, position: 'before' | 'after') => void;
  // R2-P4: merge source group into target. All tabs from source get
  // target's groupId; source group is removed. Target name/position kept.
  mergeTabGroups: (sourceId: string, targetId: string) => void;
  // R3-P1: unified reorder for tab bar. Moves a source (tab or group) to
  // before/after a target (tab or group) in the openTabs array. Groups
  // move as a contiguous block of all their tabs. Refs: tabs by path,
  // groups by groupId.
  reorderInTabBar: (
    source: { type: 'tab' | 'group'; id: string },
    target: { type: 'tab' | 'group'; id: string },
    position: 'before' | 'after',
  ) => void;

  // R2-P2: One-shot flag the file-creation flows set after creating a
  // tab; TabBar watches it and drops that tab straight into inline-rename
  // mode so users can name it without double-clicking.
  pendingRenamePath: string | null;
  setPendingRenamePath: (path: string | null) => void;

  // R3-P2: One-shot flag set whenever a brand-new tab group is created
  // (via drag-to-group, explicit createTabGroup, etc.). TabBar opens the
  // Rename Tab Group dialog so the user can name the group immediately.
  pendingGroupRenameId: string | null;
  setPendingGroupRenameId: (id: string | null) => void;

  // Workspace tab persistence actions
  saveWorkspaceState: (rootPath: string) => void;
  restoreWorkspaceState: (
    rootPath: string,
    readFile: (path: string) => Promise<string>,
    readFileBinary: (path: string) => Promise<ArrayBuffer>
  ) => Promise<void>;
  clearTabState: () => void;
}

export const useEditorStore = create<EditorState>()(
  (set, get) => ({
  openTabs: [],
  activeTabPath: null,
  pendingRenamePath: null,
  setPendingRenamePath: (path) => set({ pendingRenamePath: path }),
  pendingGroupRenameId: null,
  setPendingGroupRenameId: (id) => set({ pendingGroupRenameId: id }),
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

  // UX-36: persisted tab overflow preference. Default: horizontal scroll.
  tabOverflow: (typeof localStorage !== 'undefined'
    ? (localStorage.getItem('keepance:tabOverflow') as 'scroll' | 'wrap') ?? 'scroll'
    : 'scroll') as 'scroll' | 'wrap',
  setTabOverflow: (mode) => {
    set({ tabOverflow: mode });
    try { localStorage.setItem('keepance:tabOverflow', mode); } catch { /* noop */ }
  },

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

  reorderTabGroups: (sourceId, targetId, position) => {
    if (sourceId === targetId) return;
    set((state) => {
      const groups = [...state.tabGroups];
      const sourceIdx = groups.findIndex((g) => g.id === sourceId);
      const targetIdx = groups.findIndex((g) => g.id === targetId);
      if (sourceIdx === -1 || targetIdx === -1) return state;

      const [moved] = groups.splice(sourceIdx, 1);
      if (!moved) return state;
      // After splice, target may have shifted left by 1.
      const adjustedTargetIdx = sourceIdx < targetIdx ? targetIdx - 1 : targetIdx;
      const insertIdx = position === 'before' ? adjustedTargetIdx : adjustedTargetIdx + 1;
      groups.splice(insertIdx, 0, moved);

      // Also reshuffle openTabs so tabs belonging to a group appear in
      // the same visual order as the groups themselves. Ungrouped tabs
      // keep their current positions relative to each other.
      const ungrouped = state.openTabs.filter((t) => !t.groupId);
      const reorderedGroupTabs = groups.flatMap((g) =>
        state.openTabs.filter((t) => t.groupId === g.id),
      );
      return {
        tabGroups: groups,
        openTabs: [...reorderedGroupTabs, ...ungrouped],
      };
    });
  },

  mergeTabGroups: (sourceId, targetId) => {
    if (sourceId === targetId) return;
    set((state) => {
      const target = state.tabGroups.find((g) => g.id === targetId);
      if (!target) return state;
      const updatedTabs = state.openTabs.map((tab) =>
        tab.groupId === sourceId ? { ...tab, groupId: targetId } : tab,
      );
      return {
        openTabs: updatedTabs,
        tabGroups: state.tabGroups.filter((g) => g.id !== sourceId),
      };
    });
  },

  reorderInTabBar: (source, target, position) => {
    if (source.type === target.type && source.id === target.id) return;
    set((state) => {
      // Collect the source block: either a single tab or all tabs in a group.
      const isGroupSource = source.type === 'group';
      const sourceBlock = isGroupSource
        ? state.openTabs.filter((t) => t.groupId === source.id)
        : state.openTabs.filter((t) => t.path === source.id);
      if (sourceBlock.length === 0) return state;

      // Remove the source block from openTabs; preserve the rest's order.
      const remaining = state.openTabs.filter((t) => !sourceBlock.includes(t));

      // Find insertion index based on target type + position.
      let insertIdx = remaining.length; // default = append
      if (target.type === 'tab') {
        const targetIdx = remaining.findIndex((t) => t.path === target.id);
        if (targetIdx === -1) return state;
        insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
      } else {
        // Target is a group; find its span in remaining.
        const indices = remaining
          .map((t, i) => (t.groupId === target.id ? i : -1))
          .filter((i) => i !== -1);
        if (indices.length === 0) return state;
        const firstIdx = Math.min(...indices);
        const lastIdx = Math.max(...indices);
        insertIdx = position === 'before' ? firstIdx : lastIdx + 1;
      }

      const spliced = [...remaining];
      spliced.splice(insertIdx, 0, ...sourceBlock);
      return { openTabs: spliced };
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

  // Workspace tab persistence actions
  saveWorkspaceState: (rootPath) => {
    const state = get();
    const persisted: PersistedTabState = {
      tabs: state.openTabs.map((t) => ({
        path: t.path,
        name: t.name,
        groupId: t.groupId ?? null,
        type: t.type ?? 'file',
        metadata: t.metadata ?? {},
      })),
      activeTabPath: state.activeTabPath,
      tabGroups: state.tabGroups,
      nextGroupId: state.nextGroupId,
      isSplit: state.isSplit,
      splitDirection: state.splitDirection,
      secondaryTabPath: state.secondaryTabPath,
      showOutline: state.showOutline,
    };
    try {
      const json = JSON.stringify(persisted);
      localStorage.setItem(`workspace_tabs_${rootPath}`, json);
      console.log(`[TabPersist] Saved ${persisted.tabs.length} tabs for workspace: ${rootPath}`);
    } catch (error) {
      console.error('Failed to save workspace tab state:', error);
    }
  },

  restoreWorkspaceState: async (rootPath, readFile, readFileBinary) => {
    const key = `workspace_tabs_${rootPath}`;
    const stored = localStorage.getItem(key);
    console.log(`[TabPersist] Restoring tabs for workspace: ${rootPath}, found saved data: ${!!stored}`);
    if (!stored) return;

    let persisted: PersistedTabState;
    try {
      persisted = JSON.parse(stored) as PersistedTabState;
    } catch (error) {
      console.error('Failed to parse workspace tab state:', error);
      return;
    }

    // Re-open each tab by reading content from disk
    const restoredTabs: OpenTab[] = [];
    const castMetadata = (m: object | undefined): OpenTab['metadata'] | undefined =>
      m as OpenTab['metadata'] | undefined;

    for (const tab of persisted.tabs) {
      const meta = castMetadata(tab.metadata);
      try {
        // Browser tabs don't need file content
        if (tab.type === 'browser') {
          restoredTabs.push({
            path: tab.path,
            name: tab.name,
            content: '',
            isDirty: false,
            groupId: tab.groupId ?? null,
            type: 'browser',
            ...(meta ? { metadata: meta } : {}),
          });
          continue;
        }

        // UX-21: AI Assistant main-panel tabs. Content is transient — we
        // don't try to restore old chat state from disk (there's no file
        // on disk in the first place). Restoring the tab gives the user
        // a fresh empty AI surface; prior sessions are lost if the app
        // was closed mid-conversation.
        if (tab.type === 'ai-assistant') {
          restoredTabs.push({
            path: tab.path,
            name: tab.name,
            content: '',
            isDirty: false,
            groupId: tab.groupId ?? null,
            type: 'ai-assistant',
            ...(meta ? { metadata: meta } : {}),
          });
          continue;
        }

        // Email viewer tabs have no on-disk file — the message id rides in
        // metadata.mailSourceId and the viewer re-fetches + decrypts it on
        // mount. Restore the tab when the id is present; otherwise drop it.
        if (tab.type === 'email') {
          if (meta?.mailSourceId) {
            restoredTabs.push({
              path: tab.path,
              name: tab.name,
              content: '',
              isDirty: false,
              groupId: tab.groupId ?? null,
              type: 'email',
              metadata: meta,
            });
          }
          continue;
        }

        // Legacy synthetic workflow-execution tabs (path starts with
        // `__workflow_exec_`) had no on-disk file and were transient. Skip
        // them on restore. Real `.workflow` files persisted with
        // type='workflow-execution' fall through to the regular file-
        // reading branch below so their JSON content is rehydrated.
        if (tab.type === 'workflow-execution' && tab.path.startsWith('__workflow_exec_')) {
          continue;
        }

        // Binary files (images, etc.)
        if (isBinaryFile(tab.name)) {
          const buffer = await readFileBinary(tab.path);
          const mimeType = getMimeType(tab.name);
          const dataUrl = arrayBufferToDataUrl(buffer, mimeType);
          restoredTabs.push({
            path: tab.path,
            name: tab.name,
            content: dataUrl,
            isDirty: false,
            groupId: tab.groupId ?? null,
            type: (tab.type as OpenTab['type']) || 'file',
            ...(meta ? { metadata: meta } : {}),
          });
          continue;
        }

        // Regular text files
        const content = await readFile(tab.path);
        restoredTabs.push({
          path: tab.path,
          name: tab.name,
          content,
          isDirty: false,
          groupId: tab.groupId ?? null,
          type: (tab.type as OpenTab['type']) || 'file',
          ...(meta ? { metadata: meta } : {}),
        });
      } catch {
        // File no longer exists or can't be read — silently skip
        console.debug(`Skipping tab for missing/unreadable file: ${tab.path}`);
      }
    }

    // Guard against race condition: check rootPath still matches
    const { useWorkspaceStore } = await import('@/platform/fs/workspaceStore');
    if (useWorkspaceStore.getState().rootPath !== rootPath) {
      return;
    }

    // Validate activeTabPath and secondaryTabPath still exist in restored tabs
    const restoredPaths = new Set(restoredTabs.map((t) => t.path));
    const activeTabPath = persisted.activeTabPath && restoredPaths.has(persisted.activeTabPath)
      ? persisted.activeTabPath
      : restoredTabs[0]?.path ?? null;
    const secondaryTabPath = persisted.secondaryTabPath && restoredPaths.has(persisted.secondaryTabPath)
      ? persisted.secondaryTabPath
      : null;

    // Clean tab groups to only include groups with existing tabs
    const restoredGroupIds = new Set(restoredTabs.map((t) => t.groupId).filter(Boolean));
    const cleanedTabGroups = persisted.tabGroups.filter((group) => restoredGroupIds.has(group.id));

    set({
      openTabs: restoredTabs,
      activeTabPath,
      tabGroups: cleanedTabGroups,
      nextGroupId: persisted.nextGroupId,
      isSplit: secondaryTabPath ? persisted.isSplit : false,
      splitDirection: persisted.splitDirection,
      secondaryTabPath,
      showOutline: persisted.showOutline,
    });
  },

  clearTabState: () => {
    set({
      openTabs: [],
      activeTabPath: null,
      tabGroups: [],
      nextGroupId: 1,
      isSplit: false,
      splitDirection: 'horizontal',
      secondaryTabPath: null,
      showOutline: false,
      layout: null,
    });
  },
  })
);

// Debounced auto-save subscription
// Watches tab layout changes and persists to localStorage per-workspace
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

useEditorStore.subscribe((state, prevState) => {
  // Only trigger on layout-relevant changes, not content-only changes
  const changed =
    state.openTabs !== prevState.openTabs ||
    state.activeTabPath !== prevState.activeTabPath ||
    state.tabGroups !== prevState.tabGroups ||
    state.isSplit !== prevState.isSplit ||
    state.splitDirection !== prevState.splitDirection ||
    state.secondaryTabPath !== prevState.secondaryTabPath ||
    state.showOutline !== prevState.showOutline;

  if (!changed) {
    return;
  }

  console.log(`[TabPersist] Tab state changed, scheduling save (tabs: ${state.openTabs.length})`);

  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  saveTimeout = setTimeout(async () => {
    try {
      const { useWorkspaceStore } = await import('@/platform/fs/workspaceStore');
      const rootPath = useWorkspaceStore.getState().rootPath;
      console.log(`[TabPersist] Auto-save firing, rootPath: ${rootPath}`);
      if (rootPath) {
        useEditorStore.getState().saveWorkspaceState(rootPath);
      }
    } catch (error) {
      console.error('[TabPersist] Failed to auto-save workspace tab state:', error);
    }
  }, 500);
});

// Clean up old global persist key (one-time migration)
try {
  localStorage.removeItem('editor-storage');
} catch {
  // Ignore
}
