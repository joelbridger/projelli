import { useSettingsStore } from '@/platform/settings/settingsStore';
import type {
  CommandDescriptor,
  CommandRuntime,
} from '@/app/commands/registry/types';

/** Adds https:// to a bare domain while preserving explicit schemes. */
export function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
}

/** Returns prompt-dialog copy when a browser URL is not usable. */
export function validateBrowserUrl(value: string): string | undefined {
  if (!value.trim()) return 'Enter a URL.';
  try {
    new URL(normalizeBrowserUrl(value));
    return undefined;
  } catch {
    return 'Enter a valid URL, e.g. https://example.com.';
  }
}

function canRun(
  runtime: CommandRuntime,
  capability: keyof CommandRuntime
): boolean {
  return typeof runtime[capability] === 'function';
}

/**
 * Compatibility descriptors for commands that predate the registry. New
 * features own descriptors beside their implementation and add one registry
 * line instead of editing the command hook or shortcut dispatcher.
 */
export const legacyAppCommandDescriptors: readonly CommandDescriptor[] = [
  {
    id: 'file.new-document',
    labelKey: 'commands.file.new-document',
    legacyLabel: 'New Document',
    shortcut: 'Ctrl+N',
    category: 'file',
    enabled: (runtime) => canRun(runtime, 'handleCreateDefaultDocument'),
    execute: (runtime) => {
      void runtime.handleCreateDefaultDocument?.();
    },
  },
  {
    id: 'file.save',
    labelKey: 'commands.file.save',
    legacyLabel: 'Save File',
    shortcut: 'Ctrl+S',
    category: 'file',
    allowInEditable: true,
    enabled: (runtime) => canRun(runtime, 'handleSaveFile'),
    execute: async (runtime) => {
      const activeTab = runtime.openTabs.find(
        (tab) => tab.path === runtime.activeTabPath
      );
      if (activeTab?.isDirty) {
        await runtime.handleSaveFile?.(activeTab.path, activeTab.content);
      }
    },
  },
  {
    id: 'file.close',
    labelKey: 'commands.file.close',
    legacyLabel: 'Close Tab',
    shortcut: 'Ctrl+W',
    category: 'file',
    allowInEditable: true,
    enabled: (runtime) => canRun(runtime, 'closeTab'),
    execute: (runtime) => {
      if (runtime.activeTabPath) runtime.closeTab?.(runtime.activeTabPath);
    },
  },
  {
    id: 'view.outline',
    labelKey: 'commands.view.outline',
    legacyLabel: 'Toggle Outline Panel',
    shortcut: 'Ctrl+Shift+O',
    category: 'view',
    allowInEditable: true,
    enabled: (runtime) => canRun(runtime, 'toggleOutline'),
    execute: (runtime) => runtime.toggleOutline?.(),
  },
  {
    id: 'view.sidebar',
    labelKey: 'commands.view.sidebar',
    legacyLabel: 'Toggle Sidebar',
    shortcut: 'Ctrl+B',
    category: 'view',
    allowInEditable: true,
    enabled: (runtime) => canRun(runtime, 'setSidebarCollapsed'),
    execute: (runtime) => runtime.setSidebarCollapsed?.((value) => !value),
  },
  {
    id: 'view.tabOverflow',
    labelKey: 'commands.view.tab-overflow',
    legacyLabel: 'Toggle Tab Overflow (Scroll / Wrap)',
    category: 'view',
    execute: () => {
      const current = useSettingsStore
        .getState()
        .getSetting<string>('tabOverflow');
      useSettingsStore
        .getState()
        .setSetting('tabOverflow', current === 'scroll' ? 'wrap' : 'scroll');
    },
  },
  {
    id: 'view.split',
    labelKey: 'commands.view.split',
    legacyLabel: (runtime) =>
      runtime.isSplit ? 'Close Split' : 'Split Editor',
    shortcut: 'Ctrl+\\',
    category: 'view',
    allowInEditable: true,
    enabled: (runtime) =>
      canRun(runtime, 'splitPane') && canRun(runtime, 'closeSplit'),
    execute: (runtime) => {
      if (runtime.isSplit) runtime.closeSplit?.();
      else runtime.splitPane?.('horizontal');
    },
  },
  {
    id: 'workspace.change',
    labelKey: 'commands.workspace.change',
    legacyLabel: 'Change Workspace',
    category: 'workspace',
    enabled: (runtime) => canRun(runtime, 'setShowWorkspaceSelector'),
    execute: (runtime) => runtime.setShowWorkspaceSelector?.(true),
  },
  {
    id: 'view.aiAssistant',
    labelKey: 'commands.view.ai-assistant',
    legacyLabel: 'Open AI Assistant',
    shortcut: 'Ctrl+Shift+A',
    category: 'view',
    allowInEditable: true,
    enabled: (runtime) => canRun(runtime, 'openAIAssistantTab'),
    execute: (runtime) => runtime.openAIAssistantTab?.(),
  },
  {
    id: 'open-settings',
    labelKey: 'commands.general.settings',
    legacyLabel: 'Open Settings',
    shortcut: 'Ctrl+,',
    category: 'general',
    allowInEditable: true,
    enabled: (runtime) => canRun(runtime, 'setShowSettingsModal'),
    execute: (runtime) => {
      if (runtime.sidebarActiveTab !== 'settings') {
        runtime.setShowSettingsModal?.(true);
      }
    },
  },
  {
    id: 'browser.open',
    labelKey: 'commands.view.browser',
    legacyLabel: 'Open Browser Tab',
    category: 'view',
    enabled: (runtime) =>
      canRun(runtime, 'prompt') && canRun(runtime, 'handleOpenBrowserTab'),
    execute: async (runtime) => {
      const url = await runtime.prompt?.('Enter URL:', '', {
        title: 'Open Browser Tab',
        placeholder: 'https://example.com',
        validate: validateBrowserUrl,
      });
      if (url) runtime.handleOpenBrowserTab?.(normalizeBrowserUrl(url));
    },
  },
  {
    id: 'palette.open',
    labelKey: 'commands.system.palette',
    legacyLabel: 'Open Command Palette',
    category: 'system',
    shortcut: 'Ctrl+K',
    palette: false,
    allowInEditable: true,
    enabled: (runtime) => canRun(runtime, 'setShowCommandPalette'),
    execute: (runtime) => runtime.setShowCommandPalette?.(true),
  },
  {
    id: 'palette.open-alternate',
    labelKey: 'commands.system.palette-alternate',
    legacyLabel: 'Open Command Palette',
    category: 'system',
    shortcut: 'Ctrl+Shift+P',
    palette: false,
    allowInEditable: true,
    enabled: (runtime) => canRun(runtime, 'setShowCommandPalette'),
    execute: (runtime) => runtime.setShowCommandPalette?.(true),
  },
  {
    id: 'quick-open.open',
    labelKey: 'commands.system.quick-open',
    legacyLabel: 'Quick Open',
    category: 'system',
    shortcut: 'Ctrl+P',
    palette: false,
    allowInEditable: true,
    enabled: (runtime) => canRun(runtime, 'setShowQuickOpen'),
    execute: (runtime) => runtime.setShowQuickOpen?.(true),
  },
  {
    id: 'shortcuts.open',
    labelKey: 'commands.system.shortcuts',
    legacyLabel: 'Keyboard Shortcuts',
    category: 'system',
    shortcut: '?',
    palette: false,
    enabled: (runtime) => canRun(runtime, 'setShowShortcutsOverlay'),
    execute: (runtime) => runtime.setShowShortcutsOverlay?.(true),
  },
  {
    id: 'history.undo-last-file-operation',
    labelKey: 'commands.file.undo-last-operation',
    legacyLabel: 'Undo Last File Operation',
    category: 'file',
    shortcut: 'Ctrl+Z',
    palette: false,
    enabled: (runtime) =>
      Boolean(
        runtime.workspaceServiceRef?.current &&
        runtime.undoStackRef?.current.length
      ),
    execute: async (runtime) => {
      const service = runtime.workspaceServiceRef?.current;
      const kind = runtime.undoStackRef?.current.pop();
      if (!service || !kind) return;

      if (kind === 'delete') {
        const trashId = runtime.deleteHistoryRef?.current.pop();
        if (!trashId) return;
        try {
          await runtime.handleRestoreFromTrash?.(trashId);
        } catch (error) {
          console.error('Failed to undo delete:', error);
          runtime.deleteHistoryRef?.current.push(trashId);
          runtime.undoStackRef?.current.push('delete');
        }
        return;
      }

      const last = runtime.renameHistoryRef?.current.pop();
      if (!last) return;
      try {
        const originalName = last.fromPath.split('/').pop() ?? '';
        await service.rename(last.toPath, originalName);
        const fileTree = await service.getFileTree();
        runtime.setFileTree?.(fileTree);
        const tab = runtime.openTabs.find((item) => item.path === last.toPath);
        if (tab) {
          runtime.closeTab?.(last.toPath);
          await runtime.handleFileOpen?.(last.fromPath, originalName);
        }
      } catch (error) {
        console.error('Failed to undo rename:', error);
        runtime.renameHistoryRef?.current.push(last);
        runtime.undoStackRef?.current.push('rename');
      }
    },
  },
];
