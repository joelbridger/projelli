import type { AppSurface } from '@/app/lifecycle/useGlobalEventBus';
import type { Matter } from '@/platform/types/matter';
import { showMatterDocuments } from '@/app/shell/matterDocumentNavigation';
import type { MattersSurfaceMode } from '@/platform/state/appNavigationStore';
import { workspacePath } from '@/platform/fs/appPath';
import { useEditorStore } from '@/platform/state/editorStore';

/**
 * After Ask's "Save to Document" creates the .docx, actually SHOW it (the file
 * used to open into hidden editor state while the screen stayed on Ask, which
 * read as "nothing happened"). With an active client, land on that client's
 * Documents tab; otherwise the plain files surface. Lives outside
 * AppSurfaceRouter.tsx so the component file only exports components
 * (react-refresh rule) and the routing stays unit-testable.
 */
export async function routeSavedAskDocument({
  activeMatter,
  savedDocument,
  setDocumentsView,
  setSidebarActiveTab,
  setMattersSurfaceMode,
  pushNavigationSnapshot,
}: {
  activeMatter: Matter | null;
  savedDocument?: {
    path: string;
    name: string;
    content: string;
  };
  setDocumentsView: (view: 'browser' | 'editor') => void;
  setSidebarActiveTab: (tab: AppSurface) => void;
  setMattersSurfaceMode?: (mode: MattersSurfaceMode) => void;
  pushNavigationSnapshot?: () => void;
}): Promise<void> {
  if (!activeMatter) {
    if (savedDocument) {
      useEditorStore
        .getState()
        .openFile(savedDocument.path, savedDocument.name, savedDocument.content);
    }
    setDocumentsView('editor');
    pushNavigationSnapshot?.();
    setSidebarActiveTab('files');
    return;
  }

  const routed = await showMatterDocuments({
    matterId: activeMatter.id,
    documentOpened: true,
    handlers: {
      setDocumentsView,
      setSidebarActiveTab,
      setMattersSurfaceMode,
      pushNavigationSnapshot,
    },
  });
  if (routed && savedDocument) {
    useEditorStore
      .getState()
      .openFile(savedDocument.path, savedDocument.name, savedDocument.content);
  }
}

export function resolveSavedDocumentDirectory({
  rootPath,
  activeMatter,
}: {
  rootPath: string;
  activeMatter: Matter | null;
}): string {
  if (!activeMatter) return rootPath;
  const clientRoot = activeMatter.folderPaths.find(
    (path) => typeof path === 'string' && path.trim().length > 0
  );
  if (!clientRoot) {
    throw new Error('This client does not have a document folder yet.');
  }
  return workspacePath(clientRoot, 'Documents');
}

export function resolveSavedDocumentPath({
  rootPath,
  activeMatter,
  fileName,
}: {
  rootPath: string;
  activeMatter: Matter | null;
  fileName: string;
}): string {
  return workspacePath(
    resolveSavedDocumentDirectory({ rootPath, activeMatter }),
    fileName
  );
}
