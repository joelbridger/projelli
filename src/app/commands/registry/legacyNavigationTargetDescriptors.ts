import { openMatterDocumentSource } from '@/app/shell/matterDocumentNavigation';
import { getActiveWorkspaceService } from '@/app/fileOps/flushDirtyTabs';
import { parseMeetingRef } from '@/features/meetings/meetingSources';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useMatterUiStore } from '@/platform/matter/matterUiStore';
import { useEditorStore } from '@/platform/state/editorStore';
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
  restoreSnapshot: (snapshot, _target, runtime) => {
    if (
      snapshot.activeTabPath &&
      useEditorStore
        .getState()
        .openTabs.some((tab) => tab.path === snapshot.activeTabPath)
    ) {
      useEditorStore.getState().setActiveTab(snapshot.activeTabPath);
      runtime.setDocumentsView('editor');
    } else {
      runtime.setDocumentsView('browser');
    }
    runtime.setSurface('files');
  },
};

const emailTarget: NavigationTargetDescriptor = {
  id: 'email',
  appSurfaceId: 'matters',
  resolve: (target, runtime) => {
    openHub(target, runtime, 'email');
  },
};

const meetingsTarget: NavigationTargetDescriptor = {
  id: 'meetings',
  appSurfaceId: 'matters',
  resolve: (target, runtime) => {
    const source = target.source;
    if (source?.kind === 'meeting' && typeof source.ref === 'string') {
      const parsed = parseMeetingRef(source.ref);
      if (parsed) {
        runtime.pushNavigationSnapshot?.();
        selectMatter(target.matterId);
        const matterState = useMatterStore.getState();
        matterState.setClientMapHubId(target.matterId);
        matterState.setPendingMeetingOpen(parsed);
        runtime.setMattersSurfaceMode?.('client-map');
        runtime.setSurface('matters');
        return;
      }
    }
    openHub(target, runtime, 'meetings');
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

/** Named safe fallback for missing/unknown deep-link aliases. */
export const restoreMatterSnapshotTarget: NavigationTargetDescriptor = {
  id: 'restore-matter-snapshot',
  appSurfaceId: 'matters',
  resolve: (target, runtime) => {
    runtime.pushNavigationSnapshot?.();
    selectMatter(target.matterId);
    const snapshot = useMatterUiStore.getState().getSnapshot(target.matterId);
    if (!snapshot) {
      runtime.setMattersSurfaceMode?.('client-map');
      runtime.setSurface('matters');
      return;
    }
    const snapshotTarget = runtime.registeredTargets?.find(
      (descriptor) => descriptor.id === snapshot.surface
    );
    if (snapshotTarget?.restoreSnapshot) {
      return snapshotTarget.restoreSnapshot(snapshot, target, runtime);
    }
    runtime.setSurface(snapshot.surface);
  },
};

export const legacyNavigationTargetDescriptors: readonly NavigationTargetDescriptor[] =
  [
    homeTarget,
    searchTarget,
    documentsTarget,
    emailTarget,
    meetingsTarget,
    workflowsTarget,
    auditTarget,
    privacyTarget,
    mattersTarget,
  ];
