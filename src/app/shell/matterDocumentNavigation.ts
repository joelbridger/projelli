import { openSourceDocument, type DocumentReader } from '@/features/matters/clientMap/openSource';
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  issueMatterScopeSelection,
  requestMatterScopeSelection,
} from '@/platform/client-context';
import type { AppSurface } from '@/app/lifecycle/useGlobalEventBus';
import type { MattersSurfaceMode } from '@/platform/state/appNavigationStore';

interface MatterDocumentsHandlers {
  setDocumentsView: (view: 'browser' | 'editor') => void;
  setSidebarActiveTab: (tab: AppSurface) => void;
  setMattersSurfaceMode?: ((mode: MattersSurfaceMode) => void) | undefined;
  pushNavigationSnapshot?: (() => void) | undefined;
}

export async function showMatterDocuments({
  matterId,
  documentOpened,
  handlers,
}: {
  matterId: string;
  documentOpened: boolean;
  handlers: MatterDocumentsHandlers;
}): Promise<boolean> {
  const result = await requestMatterScopeSelection(issueMatterScopeSelection(matterId));
  if (result.kind === 'refused') return false;
  handlers.pushNavigationSnapshot?.();
  const matterState = useMatterStore.getState();
  matterState.setClientMapHubId(matterId);
  matterState.setClientMapHubTab('documents');
  handlers.setMattersSurfaceMode?.('client-map');
  handlers.setDocumentsView(documentOpened ? 'editor' : 'browser');
  handlers.setSidebarActiveTab('matters');
  return true;
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
  if (!(await showMatterDocuments({ matterId, documentOpened: false, handlers }))) {
    return false;
  }
  const opened = await openSourceDocument(ref, matterId, service, snippet);
  if (opened) {
    handlers.setDocumentsView('editor');
  }
  return opened;
}
