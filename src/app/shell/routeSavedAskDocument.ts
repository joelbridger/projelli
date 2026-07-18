import type { AppSurface } from '@/app/lifecycle/useGlobalEventBus';
import { showMatterDocuments } from '@/app/shell/matterDocumentNavigation';
import type { MattersSurfaceMode } from '@/platform/state/appNavigationStore';
import { workspacePath } from '@/platform/fs/appPath';
import { useEditorStore } from '@/platform/state/editorStore';
import {
  expectedScopeFromDecision,
  readSelectionOperationDecision,
  type ExpectedSelectionScope,
} from '@/platform/client-context';

/**
 * After Ask's "Save to Document" creates the .docx, actually SHOW it (the file
 * used to open into hidden editor state while the screen stayed on Ask, which
 * read as "nothing happened"). With an active client, land on that client's
 * Documents tab; otherwise the plain files surface. Lives outside
 * AppSurfaceRouter.tsx so the component file only exports components
 * (react-refresh rule) and the routing stays unit-testable.
 */
export async function routeSavedAskDocument({
  expectedScope,
  savedDocument,
  setDocumentsView,
  setSidebarActiveTab,
  setMattersSurfaceMode,
  pushNavigationSnapshot,
}: {
  expectedScope: ExpectedSelectionScope;
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
  const current = readSelectionOperationDecision({
    operationClass: 'matter-scoped',
    allowAllMatters: true,
    expectedScope,
    requireFollowerAgreement: true,
  });
  if (current.kind === 'refused') {
    if (savedDocument) {
      useEditorStore
        .getState()
        .openFile(savedDocument.path, savedDocument.name, savedDocument.content);
    }
    setDocumentsView('editor');
    pushNavigationSnapshot?.();
    setSidebarActiveTab('files');
    throw new Error(current.message);
  }

  if (current.kind === 'all-matters') {
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
    matterId: current.matter.id,
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

export interface SavedDocumentTarget {
  readonly directory: string;
  readonly path: string;
  readonly expectedScope: ExpectedSelectionScope;
}

export function resolveSavedDocumentTarget({
  rootPath,
  fileName,
}: {
  rootPath: string;
  fileName: string;
}): SavedDocumentTarget {
  const selection = readSelectionOperationDecision({
    operationClass: 'matter-scoped',
    allowAllMatters: true,
    requireFollowerAgreement: true,
  });
  if (selection.kind === 'refused') throw new Error(selection.message);
  const expectedScope = expectedScopeFromDecision(selection);
  if (selection.kind === 'all-matters') {
    return {
      directory: rootPath,
      path: workspacePath(rootPath, fileName),
      expectedScope,
    };
  }
  const clientRoot = selection.matter.folderPaths.find(
    (path) => typeof path === 'string' && path.trim().length > 0
  );
  if (!clientRoot) {
    throw new Error('This client does not have a document folder yet.');
  }
  const directory = workspacePath(clientRoot, 'Documents');
  return {
    directory,
    path: workspacePath(directory, fileName),
    expectedScope,
  };
}

export function assertSavedDocumentTargetCurrent(expectedScope: ExpectedSelectionScope): void {
  const current = readSelectionOperationDecision({
    operationClass: 'matter-scoped',
    allowAllMatters: true,
    expectedScope,
    requireFollowerAgreement: true,
  });
  if (current.kind === 'refused') throw new Error(current.message);
}
