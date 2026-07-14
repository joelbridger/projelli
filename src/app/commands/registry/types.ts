import type { MutableRefObject, ReactNode } from 'react';
import type { AppSurface } from '@/platform/types/navigation';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { FileNode } from '@/platform/types/workspace';
import type { PromptOptions } from '@/platform/hooks/usePromptDialog';
import type { useEditorStore } from '@/platform/state/editorStore';

export type CommandOpenTab = ReturnType<
  typeof useEditorStore.getState
>['openTabs'][number];

/**
 * Stable capabilities supplied by command consumers. Palette-only and
 * shortcut-only capabilities are optional so one descriptor can serve both
 * entry points without importing the app shell.
 */
export interface CommandRuntime {
  openTabs: CommandOpenTab[];
  activeTabPath: string | null;
  isSplit: boolean;
  sidebarActiveTab: AppSurface;
  handleSaveFile?: (path: string, content: string) => Promise<void>;
  closeTab?: (path: string) => void;
  toggleOutline?: () => void;
  splitPane?: (direction: 'horizontal' | 'vertical') => void;
  closeSplit?: () => void;
  handleOpenBrowserTab?: (url: string, title?: string) => void;
  handleCreateDefaultDocument?: (parentPath?: string) => Promise<void>;
  setSidebarCollapsed?: (updater: (value: boolean) => boolean) => void;
  setShowWorkspaceSelector?: (value: boolean) => void;
  openAIAssistantTab?: () => void;
  setShowSettingsModal?: (value: boolean) => void;
  prompt?: (
    message: string,
    defaultValue?: string,
    options?: Omit<PromptOptions, 'defaultValue'>
  ) => Promise<string | null>;
  setShowCommandPalette?: (value: boolean) => void;
  setShowQuickOpen?: (value: boolean) => void;
  setShowShortcutsOverlay?: (value: boolean) => void;
  setFileTree?: (tree: FileNode[]) => void;
  setSidebarActiveTab?: (surface: AppSurface) => void;
  handleRestoreFromTrash?: (id: string) => Promise<void>;
  handleFileOpen?: (path: string, name: string) => Promise<unknown>;
  workspaceServiceRef?: MutableRefObject<WorkspaceService | null>;
  undoStackRef?: MutableRefObject<Array<'rename' | 'delete'>>;
  deleteHistoryRef?: MutableRefObject<string[]>;
  renameHistoryRef?: MutableRefObject<
    Array<{ fromPath: string; toPath: string }>
  >;
}

/** Feature-owned command metadata and behavior. */
export interface CommandDescriptor {
  id: string;
  labelKey: string;
  /** Keeps existing untranslated palette copy unchanged during this refactor. */
  legacyLabel?: string | ((runtime: CommandRuntime) => string);
  descriptionKey?: string;
  legacyDescription?: string;
  icon?: ReactNode;
  category: string;
  shortcut?: string;
  keywords?: readonly string[];
  /** False for dispatcher-only commands such as opening the palette itself. */
  palette?: boolean;
  /** Existing editor-wide shortcuts opt in; the safe default ignores editors. */
  allowInEditable?: boolean;
  enabled?: (runtime: CommandRuntime) => boolean;
  execute: (runtime: CommandRuntime) => void | Promise<void>;
}

export type CommandRegistration =
  | CommandDescriptor
  | (() => Promise<CommandDescriptor | readonly CommandDescriptor[]>);

/** Data consumed by the command-palette renderer. */
export interface PaletteCommand {
  id: string;
  label: string;
  description?: string | undefined;
  icon?: ReactNode | undefined;
  category: string;
  shortcut?: string | undefined;
  action: () => void | Promise<void>;
  keywords?: string[] | undefined;
}
