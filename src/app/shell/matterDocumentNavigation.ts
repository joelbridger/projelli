import { openSourceDocument, type DocumentReader } from '@/features/matters/clientMap/openSource';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { AppSurface } from '@/app/lifecycle/useGlobalEventBus';
import type { MattersSurfaceMode } from '@/platform/state/appNavigationStore';

interface MatterDocumentsHandlers {
  setDocumentsView: (view: 'browser' | 'editor') => void;
  setSidebarActiveTab: (tab: AppSurface) => void;
  setMattersSurfaceMode?: ((mode: MattersSurfaceMode) => void) | undefined;
  pushNavigationSnapshot?: (() => void) | undefined;
}

export function showMatterDocuments({
  matterId,
  documentOpened,
  handlers,
}: {
  matterId: string;
  documentOpened: boolean;
  handlers: MatterDocumentsHandlers;
}): void {
  const matterState = useMatterStore.getState();
  matterState.setActiveMatter(matterId);
  matterState.setClientMapHubId(matterId);
  matterState.setClientMapHubTab('documents');
  handlers.setMattersSurfaceMode?.('client-map');
  handlers.setDocumentsView(documentOpened ? 'editor' : 'browser');
  handlers.setSidebarActiveTab('matters');
}

export async function openMatterDocumentSource({
  matterId,
  ref,
  snippet,
  service,
  handlers,
}: {
  matterId: string;
  ref: string;
  snippet?: string;
  service: DocumentReader | null;
  handlers: MatterDocumentsHandlers;
}): Promise<boolean> {
  handlers.pushNavigationSnapshot?.();
  showMatterDocuments({ matterId, documentOpened: false, handlers });
  const opened = await openSourceDocument(ref, matterId, service, snippet);
  if (opened) {
    handlers.setDocumentsView('editor');
  }
  return opened;
}
