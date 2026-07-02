/**
 * useTabOpening — owns handleOpenBrowserTab, openAIAssistantTab, and the
 * useOpenEmailListener wiring.
 *
 * Extracted from App.tsx (Wave 5b decomposition). The handler bodies are
 * copied VERBATIM from App.tsx; only the source of referenced values changed
 * (they now come from the options object instead of App's local scope).
 * useOpenEmailListener is wired here so the email-tab open path is
 * unit-testable in isolation.
 */
import { useCallback } from 'react';
import { useEditorStore } from '@/platform/state/editorStore';
import { useOpenEmailListener } from '@/platform/hooks/useOpenEmailListener';
import type { AppSurface } from '@/app/lifecycle/useGlobalEventBus';

type OpenTabFn = ReturnType<typeof useEditorStore.getState>['openTab'];

export interface UseTabOpeningOptions {
  openTab: OpenTabFn;
  setSidebarActiveTab: (tab: AppSurface) => void;
  setDocumentsView: (view: 'browser' | 'editor') => void;
}

export function useTabOpening({
  openTab,
  setSidebarActiveTab,
  setDocumentsView,
}: UseTabOpeningOptions) {
  // Handle opening browser tab
  const handleOpenBrowserTab = useCallback(
    (url: string, title?: string) => {
      // Generate a unique path for the browser tab
      const tabPath = `__browser__${Date.now()}`;
      // Callers are expected to pass an already-validated absolute URL (see
      // useAppCommands.ts's "Open Browser Tab" command), but hostname
      // extraction stays defensive so a malformed url never throws here.
      const tabName = title || (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return url;
        }
      })();

      openTab(tabPath, tabName, '', 'browser', { url });
    },
    [openTab]
  );

  // UX-21: open (or focus) the AI Assistant as a main-panel tab. We look
  // for an existing `ai-assistant` tab first so Ctrl+Shift+A doesn't spam
  // new tabs, then fall back to creating a fresh one. The sidebar AI pane
  // keeps working independently — this is purely additive.
  const openAIAssistantTab = useCallback(() => {
    setDocumentsView('editor');
    setSidebarActiveTab('files');
    const existing = useEditorStore
      .getState()
      .openTabs.find((t) => t.type === 'ai-assistant');
    if (existing) {
      useEditorStore.getState().setActiveTab(existing.path);
      return;
    }
    const tabPath = `__ai_assistant__${Date.now()}`;
    openTab(tabPath, 'AI Assistant', '', 'ai-assistant');
  }, [openTab, setDocumentsView, setSidebarActiveTab]);

  // WS-B/C — open the read-only email viewer when an email citation is clicked
  // in chat. AIChatViewer dispatches `lantern:open-email` for `mail:<id>`
  // sources; this hook turns that into an `email` tab. (Extracted to
  // useOpenEmailListener so the wiring is unit-tested.)
  //
  // Bug 2 fix: wrap openTab so opening an email first navigates to the
  // 'files' sidebar tab (where MainPanel + EmailViewer live). Without this,
  // the tab is added while the full-page EmailWorkspace is active,
  // so the email opens invisibly and the user sees nothing happen.
  useOpenEmailListener(
    useCallback(
      (
        id: string,
        label: string,
        content: string,
        type: 'email',
        meta: { mailSourceId: string },
      ) => {
        // Opening an email shows it in the Documents area editor, not the browser.
        setDocumentsView('editor');
        setSidebarActiveTab('files');
        openTab(id, label, content, type, meta);
      },
      [openTab, setDocumentsView, setSidebarActiveTab],
    ),
  );

  return { handleOpenBrowserTab, openAIAssistantTab };
}
