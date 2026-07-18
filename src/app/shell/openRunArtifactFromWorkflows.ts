import type { AppSurface } from '@/app/lifecycle/useGlobalEventBus';
import { showMatterDocuments } from '@/app/shell/matterDocumentNavigation';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { MattersSurfaceMode } from '@/platform/state/appNavigationStore';
import type { Matter } from '@/platform/types/matter';

function normalizePath(path: string): string {
  return path.replace(/\/+$/g, '');
}

export function inferMatterIdForWorkflowArtifactPath(
  artifactPath: string,
  matters: Matter[]
): string | null {
  const normalizedArtifact = normalizePath(artifactPath);
  const matches = matters
    .filter((matter) => !matter.archived)
    .flatMap((matter) =>
      matter.folderPaths
        .filter((folderPath) => folderPath.trim().length > 0)
        .map((folderPath) => ({
          matterId: matter.id,
          folderPath: normalizePath(folderPath),
        }))
    )
    .filter(
      ({ folderPath }) =>
        normalizedArtifact === folderPath ||
        normalizedArtifact.startsWith(`${folderPath}/`)
    )
    .sort((a, b) => b.folderPath.length - a.folderPath.length);

  return matches[0]?.matterId ?? null;
}

export async function openRunArtifactFromWorkflows({
  path,
  name,
  handleFileOpen,
  setSidebarActiveTab,
  setDocumentsView,
  setMattersSurfaceMode,
  pushNavigationSnapshot,
}: {
  path: string;
  name: string;
  handleFileOpen: (path: string, name: string) => Promise<boolean>;
  setSidebarActiveTab: (tab: AppSurface) => void;
  setDocumentsView: (view: 'browser' | 'editor') => void;
  setMattersSurfaceMode?: (mode: MattersSurfaceMode) => void;
  pushNavigationSnapshot?: () => void;
}): Promise<boolean> {
  const opened = await handleFileOpen(path, name);
  if (opened) {
    const matterId = inferMatterIdForWorkflowArtifactPath(
      path,
      useMatterStore.getState().matters
    );
    if (matterId) {
      const routed = await showMatterDocuments({
        matterId,
        documentOpened: true,
        handlers: {
          setDocumentsView,
          setSidebarActiveTab,
          setMattersSurfaceMode,
          pushNavigationSnapshot,
        },
      });
      return routed;
    }
    setSidebarActiveTab('files');
  }
  return opened;
}
