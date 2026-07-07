import { useMatterStore } from '@/platform/matter/matterStore';
import type { AppSurface } from '@/app/lifecycle/useGlobalEventBus';
import type { Matter } from '@/platform/types/matter';

/**
 * After Ask's "Save to Document" creates the .docx, actually SHOW it (the file
 * used to open into hidden editor state while the screen stayed on Ask, which
 * read as "nothing happened"). With an active client, land on that client's
 * Documents tab; otherwise the plain files surface. Lives outside
 * AppSurfaceRouter.tsx so the component file only exports components
 * (react-refresh rule) and the routing stays unit-testable.
 */
export function routeSavedAskDocument({
  activeMatter,
  setDocumentsView,
  setSidebarActiveTab,
}: {
  activeMatter: Matter | null;
  setDocumentsView: (view: 'browser' | 'editor') => void;
  setSidebarActiveTab: (tab: AppSurface) => void;
}) {
  setDocumentsView('editor');
  if (!activeMatter) {
    setSidebarActiveTab('files');
    return;
  }

  const matterState = useMatterStore.getState();
  matterState.setActiveMatter(activeMatter.id);
  matterState.setClientMapHubId(activeMatter.id);
  matterState.setClientMapHubTab('documents');
  setSidebarActiveTab('matters');
}
