import { useEffect, useRef } from 'react';
import type { AppSurface } from '@/app/lifecycle/useGlobalEventBus';
import type { WorkspaceService } from '@/modules/workspace/WorkspaceService';
import type { FileNode } from '@/types/workspace';

export interface KeyboardShortcutDeps {
  // State values
  sidebarActiveTab: AppSurface;
  openTabs: Array<{ path: string; name: string; content: string; isDirty: boolean }>;
  activeTabPath: string | null;
  isSplit: boolean;

  // Setters
  setShowSettingsModal: (v: boolean) => void;
  setShowCommandPalette: (v: boolean) => void;
  setShowQuickOpen: (v: boolean) => void;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setShowShortcutsOverlay: (v: boolean) => void;
  setFileTree: (tree: FileNode[]) => void;
  setDocumentsView: (v: 'browser' | 'editor') => void;
  setSidebarActiveTab: (tab: AppSurface) => void;

  // Handlers / functions
  handleSaveFile: (path: string, content: string) => Promise<void>;
  closeTab: (path: string) => void;
  toggleOutline: () => void;
  splitPane: (direction: 'horizontal' | 'vertical') => void;
  closeSplit: () => void;
  openAIAssistantTab: () => void;
  handleRestoreFromTrash: (id: string) => Promise<void>;
  handleFileOpen: (path: string, name: string) => Promise<void>;
  handleCreateDefaultDocument: (parentPath?: string) => Promise<void>;

  // Refs
  workspaceServiceRef: React.MutableRefObject<WorkspaceService | null>;
  undoStackRef: React.MutableRefObject<Array<'rename' | 'delete'>>;
  deleteHistoryRef: React.MutableRefObject<Array<string>>;
  renameHistoryRef: React.MutableRefObject<Array<{ fromPath: string; toPath: string }>>;
}

export function useKeyboardShortcuts(deps: KeyboardShortcutDeps): void {
  const ref = useRef(deps);
  ref.current = deps;

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const {
        sidebarActiveTab,
        openTabs,
        activeTabPath,
        isSplit,
        setShowSettingsModal,
        setShowCommandPalette,
        setShowQuickOpen,
        setSidebarCollapsed,
        setShowShortcutsOverlay,
        setFileTree,
        setDocumentsView,
        setSidebarActiveTab,
        handleSaveFile,
        closeTab,
        toggleOutline,
        splitPane,
        closeSplit,
        openAIAssistantTab,
        handleRestoreFromTrash,
        handleFileOpen,
        handleCreateDefaultDocument,
        workspaceServiceRef,
        undoStackRef,
        deleteHistoryRef,
        renameHistoryRef,
      } = ref.current;

      const isMod = e.ctrlKey || e.metaKey;

      // Open Settings: Ctrl+,
      // Fix 5: no-op if the Settings tab is already the active surface.
      if (isMod && e.key === ',') {
        e.preventDefault();
        if (sidebarActiveTab !== 'settings') {
          setShowSettingsModal(true);
        }
        return;
      }

      // Command Palette: Ctrl+K or Ctrl+Shift+P
      if ((isMod && e.key === 'k') || (isMod && e.shiftKey && e.key === 'p')) {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }

      // UX-27: Quick-open fuzzy file switcher — Ctrl+P / Cmd+P.
      // Must come AFTER the command-palette check so Ctrl+Shift+P keeps
      // routing to the palette.
      if (isMod && !e.shiftKey && e.key === 'p') {
        e.preventDefault();
        setShowQuickOpen(true);
        return;
      }

      // Save: Ctrl+S
      if (isMod && e.key === 's') {
        e.preventDefault();
        const activeTab = openTabs.find((t) => t.path === activeTabPath);
        if (activeTab && activeTab.isDirty) {
          await handleSaveFile(activeTab.path, activeTab.content);
        }
        return;
      }

      // Close tab: Ctrl+W
      if (isMod && e.key === 'w') {
        e.preventDefault();
        if (activeTabPath) {
          closeTab(activeTabPath);
        }
        return;
      }

      // Toggle outline: Ctrl+Shift+O
      if (isMod && e.shiftKey && e.key === 'o') {
        e.preventDefault();
        toggleOutline();
        return;
      }

      // F-509 — Ctrl+B toggles the sidebar. Documented in the shortcuts SSOT
      // (useKeyboardShortcuts.ts 'toggle-sidebar') but implemented nowhere
      // until now. Must come BEFORE the Ctrl+Shift+B branch.
      if (isMod && !e.shiftKey && e.key === 'b') {
        e.preventDefault();
        setSidebarCollapsed((v) => !v);
        return;
      }

      // Split/unsplit: Ctrl+\
      if (isMod && e.key === '\\') {
        e.preventDefault();
        if (isSplit) {
          closeSplit();
        } else {
          splitPane('horizontal');
        }
        return;
      }

      // Open AI Assistant: Ctrl+Shift+A
      //
      // UX-21: opens AI Assistant as a MAIN-PANEL tab (the cramped sidebar
      // was never where chat wanted to live). If a main-panel AI tab is
      // already open we just focus it; otherwise we create a fresh one.
      // The legacy sidebar button still flips the sidebar to the AI pane,
      // so power users who liked the sidebar layout keep their workflow.
      if (isMod && e.shiftKey && e.key === 'a') {
        e.preventDefault();
        openAIAssistantTab();
        return;
      }

      // Keyboard shortcuts overlay: `?` (literal character, matches any
      // layout — on US keyboards it's Shift+/; using e.key === '?' avoids
      // worrying about layout-specific key codes).
      // Do not trigger when focus is inside an editable element.
      if (e.key === '?' && !isMod && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const editable = target?.isContentEditable;
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || editable) {
          return;
        }
        e.preventDefault();
        setShowShortcutsOverlay(true);
        return;
      }

      // UX-16 / UX-29: Ctrl+Z outside any input undoes the most recent
      // destructive action in this session — either a rename OR a delete.
      // We explicitly skip when focus is in an editor-like element so
      // normal text-editing undo behaviour is preserved.
      if (isMod && !e.shiftKey && e.key === 'z') {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const editable = target?.isContentEditable;
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || editable) {
          return;
        }
        if (!workspaceServiceRef.current) return;

        // Pop whichever action was most recent. If the top of the stack
        // refers to a delete that's already gone (e.g. user clicked
        // Undo in the toast), fall through to the next entry.
        const kind = undoStackRef.current.pop();
        if (!kind) return;
        e.preventDefault();

        if (kind === 'delete') {
          const trashId = deleteHistoryRef.current.pop();
          if (!trashId) return;
          try {
            await handleRestoreFromTrash(trashId);
          } catch (err) {
            console.error('Failed to undo delete:', err);
            // Push it back so a subsequent Ctrl+Z can retry.
            deleteHistoryRef.current.push(trashId);
            undoStackRef.current.push('delete');
          }
          return;
        }

        // kind === 'rename'
        const last = renameHistoryRef.current.pop();
        if (!last) return;
        try {
          // Recover the original file name from the original path we stored.
          const originalName = last.fromPath.split('/').pop() ?? '';
          await workspaceServiceRef.current.rename(last.toPath, originalName);
          const fileTree = await workspaceServiceRef.current.getFileTree();
          setFileTree(fileTree);
          // If the file was open in a tab, re-open it under the old name.
          const tab = openTabs.find((t) => t.path === last.toPath);
          if (tab) {
            closeTab(last.toPath);
            await handleFileOpen(last.fromPath, originalName);
          }
        } catch (err) {
          console.error('Failed to undo rename:', err);
          // Push it back so a subsequent Ctrl+Z can retry.
          renameHistoryRef.current.push(last);
          undoStackRef.current.push('rename');
        }
        return;
      }

      // New Document: Ctrl+N (advertised in the command palette — wired here)
      // Skip when focus is inside a text input so browser autocomplete works.
      if (isMod && !e.shiftKey && e.key === 'n') {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const editable = target?.isContentEditable;
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || editable) {
          return;
        }
        e.preventDefault();
        void handleCreateDefaultDocument();
        return;
      }

      // Spine tab jump: Ctrl+1..7
      // 1=matters, 2=search, 3=files, 4=email, 5=workflows, 6=audit, 7=settings
      if (isMod && !e.shiftKey && e.key >= '1' && e.key <= '7') {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const editable = target?.isContentEditable;
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || editable) {
          return;
        }
        e.preventDefault();
        const spineTabMap: Record<string, typeof sidebarActiveTab> = {
          '1': 'matters',
          '2': 'search',
          '3': 'files',
          '4': 'email',
          '5': 'workflows',
          '6': 'audit',
          '7': 'settings',
        };
        const nextTab = spineTabMap[e.key];
        if (nextTab) {
          // Mirror the files special-case: landing on files tab shows the browser
          if (nextTab === 'files') setDocumentsView('browser');
          setSidebarActiveTab(nextTab);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
