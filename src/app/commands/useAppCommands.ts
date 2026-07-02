import { useMemo } from 'react';
import { getDefaultCommands, type PaletteCommand } from '@/app/shell/common/CommandPalette';
import type { AppSurface } from '@/app/lifecycle/useGlobalEventBus';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import type { PromptOptions } from '@/platform/hooks/usePromptDialog';
import { useEditorStore } from '@/platform/state/editorStore';

type OpenTab = ReturnType<typeof useEditorStore.getState>['openTabs'][number];

/**
 * Adds a `https://` scheme to bare-domain input (e.g. "example.com") so
 * `new URL()` downstream doesn't throw on otherwise-reasonable input.
 */
export function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Returns an error message for the prompt dialog, or undefined if valid. */
export function validateBrowserUrl(value: string): string | undefined {
  if (!value.trim()) return 'Enter a URL.';
  try {
    new URL(normalizeBrowserUrl(value));
    return undefined;
  } catch {
    return 'Enter a valid URL, e.g. https://example.com.';
  }
}

export interface AppCommandDeps {
  openTabs: OpenTab[];
  activeTabPath: string | null;
  handleSaveFile: (path: string, content: string) => Promise<void>;
  closeTab: (path: string) => void;
  toggleOutline: () => void;
  isSplit: boolean;
  splitPane: (direction: 'horizontal' | 'vertical') => void;
  closeSplit: () => void;
  handleOpenBrowserTab: (url: string, title?: string) => void;
  handleCreateDefaultDocument: (parentPath?: string) => Promise<void>;
  sidebarActiveTab: AppSurface;
  setSidebarCollapsed: (updater: (v: boolean) => boolean) => void;
  setShowWorkspaceSelector: (v: boolean) => void;
  /** Opens the AI Assistant as a main-panel tab. The reimagined 3.0 sidebar has
   *  no 'ai-assistant' surface, so the old setSidebarActiveTab('ai-assistant')
   *  was a no-op (it set a sidebar tab that does not exist). */
  openAIAssistantTab: () => void;
  setShowSettingsModal: (v: boolean) => void;
  prompt: (message: string, defaultValue?: string, options?: Omit<PromptOptions, 'defaultValue'>) => Promise<string | null>;
}

export function useAppCommands(deps: AppCommandDeps): PaletteCommand[] {
  const {
    openTabs,
    activeTabPath,
    handleSaveFile,
    closeTab,
    toggleOutline,
    isSplit,
    splitPane,
    closeSplit,
    handleOpenBrowserTab,
    handleCreateDefaultDocument,
    sidebarActiveTab,
    setSidebarCollapsed,
    setShowWorkspaceSelector,
    openAIAssistantTab,
    setShowSettingsModal,
    prompt,
  } = deps;

  return useMemo<PaletteCommand[]>(() => {
    const baseCommands = getDefaultCommands({});
    const appCommands: PaletteCommand[] = [
      {
        // WS-A / A5: canonical "New Document" — creates the user's default new
        // document type (Word .docx unless changed in Settings).
        id: 'file.new-document',
        label: 'New Document',
        shortcut: 'Ctrl+N',
        category: 'file',
        action: () => {
          void handleCreateDefaultDocument();
        },
      },
      {
        id: 'file.save',
        label: 'Save File',
        shortcut: 'Ctrl+S',
        category: 'file',
        action: async () => {
          const activeTab = openTabs.find((t) => t.path === activeTabPath);
          if (activeTab && activeTab.isDirty) {
            await handleSaveFile(activeTab.path, activeTab.content);
          }
        },
      },
      {
        id: 'file.close',
        label: 'Close Tab',
        shortcut: 'Ctrl+W',
        category: 'file',
        action: () => {
          if (activeTabPath) {
            closeTab(activeTabPath);
          }
        },
      },
      {
        id: 'view.outline',
        label: 'Toggle Outline Panel',
        shortcut: 'Ctrl+Shift+O',
        category: 'view',
        action: toggleOutline,
      },
      {
        // F-509 — discoverable home for the now-functional Ctrl+B toggle.
        id: 'view.sidebar',
        label: 'Toggle Sidebar',
        shortcut: 'Ctrl+B',
        category: 'view',
        action: () => setSidebarCollapsed((v) => !v),
      },
      {
        id: 'view.tabOverflow',
        label: 'Toggle Tab Overflow (Scroll / Wrap)',
        category: 'view',
        action: () => {
          const current = useSettingsStore.getState().getSetting<string>('tabOverflow');
          useSettingsStore.getState().setSetting('tabOverflow', current === 'scroll' ? 'wrap' : 'scroll');
        },
      },
      {
        id: 'view.split',
        label: isSplit ? 'Close Split' : 'Split Editor',
        shortcut: 'Ctrl+\\',
        category: 'view',
        action: () => {
          if (isSplit) {
            closeSplit();
          } else {
            splitPane('horizontal');
          }
        },
      },
      {
        id: 'workspace.change',
        label: 'Change Workspace',
        category: 'workspace',
        action: () => setShowWorkspaceSelector(true),
      },
      {
        id: 'view.aiAssistant',
        label: 'Open AI Assistant',
        shortcut: 'Ctrl+Shift+A',
        category: 'view',
        action: () => openAIAssistantTab(),
      },
      {
        id: 'open-settings',
        label: 'Open Settings',
        shortcut: 'Ctrl+,',
        category: 'general',
        // Fix 5: no-op when Settings tab is already the active surface.
        action: () => { if (sidebarActiveTab !== 'settings') setShowSettingsModal(true); },
      },
      {
        id: 'browser.open',
        label: 'Open Browser Tab',
        category: 'view',
        action: async () => {
          const url = await prompt('Enter URL:', '', {
            title: 'Open Browser Tab',
            placeholder: 'https://example.com',
            validate: validateBrowserUrl,
          });
          if (url) {
            handleOpenBrowserTab(normalizeBrowserUrl(url));
          }
        },
      },
    ];
    return [...appCommands, ...baseCommands];
  }, [openTabs, activeTabPath, handleSaveFile, closeTab, toggleOutline, isSplit, splitPane, closeSplit, handleOpenBrowserTab, handleCreateDefaultDocument, sidebarActiveTab, setSidebarCollapsed, setShowWorkspaceSelector, openAIAssistantTab, setShowSettingsModal, prompt]);
}
