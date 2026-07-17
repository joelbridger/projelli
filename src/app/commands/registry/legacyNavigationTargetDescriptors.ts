import { openMatterDocumentSource } from '@/app/shell/matterDocumentNavigation';
import { getActiveWorkspaceService } from '@/app/fileOps/flushDirtyTabs';
import { useMatterStore } from '@/platform/matter/matterStore';
import type {
  MatterNavigationTarget,
  NavigationTargetDescriptor,
  NavigationTargetRuntime,
} from '@/app/commands/registry/navigationTargetRegistry';

function selectMatter(matterId: string): void {
  useMatterStore.getState().setActiveMatter(matterId);
}

function openHub(
  target: MatterNavigationTarget,
  runtime: NavigationTargetRuntime,
  tab: 'overview' | 'documents' | 'email' | 'meetings' | 'activity',
  beforeSurfaceChange?: () => void
): void {
  runtime.pushNavigationSnapshot?.();
  selectMatter(target.matterId);
  const matterState = useMatterStore.getState();
  matterState.setClientMapHubId(target.matterId);
  matterState.setClientMapHubTab(tab);
  runtime.setMattersSurfaceMode?.('client-map');
  beforeSurfaceChange?.();
  runtime.setSurface('matters');
}

function directSurface(
  id: NavigationTargetDescriptor['id'],
  appSurfaceId: NavigationTargetDescriptor['appSurfaceId']
): NavigationTargetDescriptor {
  return {
    id,
    appSurfaceId,
    resolve: (target, runtime) => {
      runtime.pushNavigationSnapshot?.();
      selectMatter(target.matterId);
      runtime.setSurface(appSurfaceId);
    },
  };
}

const homeTarget = directSurface('home', 'home');
const searchTarget: NavigationTargetDescriptor = {
  id: 'search',
  appSurfaceId: 'search',
  resolve: (target, runtime) => {
    runtime.pushNavigationSnapshot?.();
    selectMatter(target.matterId);
    runtime.setSurface('search');
    if (target.question) {
      runtime.setAskPrefill({
        question: target.question,
        autoSubmit: true,
      });
    }
  },
};
const workflowsTarget = directSurface('workflows', 'workflows');
const privacyTarget = directSurface('privacy', 'privacy');

const documentsTarget: NavigationTargetDescriptor = {
  id: 'files',
  appSurfaceId: 'matters',
  resolve: (target, runtime) => {
    const source = target.source;
    if (source?.kind === 'document' && typeof source.ref === 'string') {
      void openMatterDocumentSource({
        matterId: target.matterId,
        ref: source.ref,
        ...(source.snippet ? { snippet: source.snippet } : {}),
        service: getActiveWorkspaceService(),
        handlers: {
          setDocumentsView: runtime.setDocumentsView,
          setSidebarActiveTab: runtime.setSurface,
          setMattersSurfaceMode: runtime.setMattersSurfaceMode,
          pushNavigationSnapshot: runtime.pushNavigationSnapshot,
        },
      });
      return;
    }
    openHub(target, runtime, 'documents', () => {
      runtime.setDocumentsView('browser');
    });
  },
};

const emailTarget: NavigationTargetDescriptor = {
  id: 'email',
  appSurfaceId: 'matters',
  resolve: (target, runtime) => {
    openHub(target, runtime, 'email');
  },
};

const auditTarget: NavigationTargetDescriptor = {
  id: 'audit',
  appSurfaceId: 'matters',
  resolve: (target, runtime) => {
    openHub(target, runtime, 'activity');
  },
};

const mattersTarget: NavigationTargetDescriptor = {
  id: 'matters',
  appSurfaceId: 'matters',
  resolve: (target, runtime) => {
    openHub(target, runtime, 'overview');
  },
};

export const legacyNavigationTargetDescriptors: readonly NavigationTargetDescriptor[] =
  [
    homeTarget,
    searchTarget,
    documentsTarget,
    emailTarget,
    workflowsTarget,
    auditTarget,
    privacyTarget,
    mattersTarget,
  ];
