import { useEffect, useLayoutEffect, useRef } from 'react';
import type { AppSurface } from '@/platform/types/navigation';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { FileNode } from '@/platform/types/workspace';
import { useCommandRegistry } from '@/app/commands/registry/useCommandRegistry';
import {
  dispatchKeyboardShortcut,
  getShortcutCommandDescriptors,
} from '@/app/commands/registry/shortcutDispatcher';
import type { CommandRuntime } from '@/app/commands/registry/types';
import { useAppSurfaceRegistry } from '@/app/shell/runtime/useAppSurfaceRegistry';

export interface KeyboardShortcutDeps {
  sidebarActiveTab: AppSurface;
  openTabs: Array<{
    path: string;
    name: string;
    content: string;
    isDirty: boolean;
  }>;
  activeTabPath: string | null;
  isSplit: boolean;
  setShowSettingsModal: (value: boolean) => void;
  setShowCommandPalette: (value: boolean) => void;
  setShowQuickOpen: (value: boolean) => void;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setShowShortcutsOverlay: (value: boolean) => void;
  setFileTree: (tree: FileNode[]) => void;
  setDocumentsView: (value: 'browser' | 'editor') => void;
  setSidebarActiveTab: (surface: AppSurface) => void;
  handleSaveFile: (path: string, content: string) => Promise<void>;
  closeTab: (path: string) => void;
  toggleOutline: () => void;
  splitPane: (direction: 'horizontal' | 'vertical') => void;
  closeSplit: () => void;
  openAIAssistantTab: () => void;
  handleRestoreFromTrash: (id: string) => Promise<void>;
  handleFileOpen: (path: string, name: string) => Promise<unknown>;
  handleCreateDefaultDocument: (parentPath?: string) => Promise<void>;
  workspaceServiceRef: React.MutableRefObject<WorkspaceService | null>;
  undoStackRef: React.MutableRefObject<Array<'rename' | 'delete'>>;
  deleteHistoryRef: React.MutableRefObject<string[]>;
  renameHistoryRef: React.MutableRefObject<
    Array<{ fromPath: string; toPath: string }>
  >;
}

/** One generic dispatcher for command and app-surface shortcut metadata. */
export function useKeyboardShortcuts(deps: KeyboardShortcutDeps): void {
  const { descriptors: commands } = useCommandRegistry();
  const { descriptors: surfaces } = useAppSurfaceRegistry();
  const current: {
    runtime: CommandRuntime;
    descriptors: ReturnType<typeof getShortcutCommandDescriptors>;
  } = {
    runtime: {
      openTabs: deps.openTabs,
      activeTabPath: deps.activeTabPath,
      isSplit: deps.isSplit,
      sidebarActiveTab: deps.sidebarActiveTab,
      handleSaveFile: deps.handleSaveFile,
      closeTab: deps.closeTab,
      toggleOutline: deps.toggleOutline,
      splitPane: deps.splitPane,
      closeSplit: deps.closeSplit,
      handleCreateDefaultDocument: deps.handleCreateDefaultDocument,
      setSidebarCollapsed: deps.setSidebarCollapsed,
      openAIAssistantTab: deps.openAIAssistantTab,
      setShowSettingsModal: deps.setShowSettingsModal,
      setShowCommandPalette: deps.setShowCommandPalette,
      setShowQuickOpen: deps.setShowQuickOpen,
      setShowShortcutsOverlay: deps.setShowShortcutsOverlay,
      setFileTree: deps.setFileTree,
      setSidebarActiveTab: deps.setSidebarActiveTab,
      handleRestoreFromTrash: deps.handleRestoreFromTrash,
      handleFileOpen: deps.handleFileOpen,
      workspaceServiceRef: deps.workspaceServiceRef,
      undoStackRef: deps.undoStackRef,
      deleteHistoryRef: deps.deleteHistoryRef,
      renameHistoryRef: deps.renameHistoryRef,
    },
    descriptors: getShortcutCommandDescriptors(commands, surfaces),
  };
  const ref = useRef(current);

  useLayoutEffect(() => {
    ref.current = current;
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const current = ref.current;
      void dispatchKeyboardShortcut(
        event,
        current.runtime,
        current.descriptors
      );
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
}
