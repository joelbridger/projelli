import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSurface } from '@/platform/types/navigation';
import type { PromptOptions } from '@/platform/hooks/usePromptDialog';
import type { useEditorStore } from '@/platform/state/editorStore';
import { useCommandRegistry } from '@/app/commands/registry/useCommandRegistry';
import type {
  CommandRuntime,
  PaletteCommand,
} from '@/app/commands/registry/types';

export {
  normalizeBrowserUrl,
  validateBrowserUrl,
} from '@/app/commands/registry/legacyAppCommandDescriptors';

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
  setSidebarCollapsed: (updater: (value: boolean) => boolean) => void;
  setShowWorkspaceSelector: (value: boolean) => void;
  openAIAssistantTab: () => void;
  setShowSettingsModal: (value: boolean) => void;
  prompt: (
    message: string,
    defaultValue?: string,
    options?: Omit<PromptOptions, 'defaultValue'>
  ) => Promise<string | null>;
}

/** Supplies live app capabilities and flattens feature-owned descriptors. */
export function useAppCommands(deps: AppCommandDeps): PaletteCommand[] {
  const { t } = useTranslation();
  const { descriptors } = useCommandRegistry();

  return useMemo(() => {
    const runtime: CommandRuntime = deps;
    return descriptors
      .filter(
        (descriptor) =>
          descriptor.palette !== false &&
          (!descriptor.enabled || descriptor.enabled(runtime))
      )
      .map((descriptor): PaletteCommand => {
        const legacyLabel =
          typeof descriptor.legacyLabel === 'function'
            ? descriptor.legacyLabel(runtime)
            : descriptor.legacyLabel;
        return {
          id: descriptor.id,
          label: legacyLabel ?? t(descriptor.labelKey),
          ...(descriptor.legacyDescription || descriptor.descriptionKey
            ? {
                description:
                  descriptor.legacyDescription ??
                  t(descriptor.descriptionKey ?? ''),
              }
            : {}),
          ...(descriptor.icon ? { icon: descriptor.icon } : {}),
          category: descriptor.category,
          ...(descriptor.shortcut ? { shortcut: descriptor.shortcut } : {}),
          ...(descriptor.keywords
            ? { keywords: [...descriptor.keywords] }
            : {}),
          action: () => descriptor.execute(runtime),
        };
      });
  }, [deps, descriptors, t]);
}
