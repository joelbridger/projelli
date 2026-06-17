import { useMemo } from 'react';
import { getDefaultCommands, type PaletteCommand } from '@/app/shell/common/CommandPalette';
import type { AppSurface } from '@/app/lifecycle/useGlobalEventBus';
import { useSettingsStore } from '@/stores/settingsStore';
import type { PromptOptions } from '@/hooks/usePromptDialog';
import { useEditorStore } from '@/stores/editorStore';

type OpenTab = ReturnType<typeof useEditorStore.getState>['openTabs'][number];

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
  setSidebarActiveTab: (tab: AppSurface) => void;
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
    setSidebarActiveTab,
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
        action: () => setSidebarActiveTab('ai-assistant'),
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
          });
          if (url) {
            handleOpenBrowserTab(url);
          }
        },
      },
    ];
    return [...appCommands, ...baseCommands];
  }, [openTabs, activeTabPath, handleSaveFile, closeTab, toggleOutline, isSplit, splitPane, closeSplit, handleOpenBrowserTab, handleCreateDefaultDocument, sidebarActiveTab]);
}
