import { create } from 'zustand';
import type { AppSurface } from '@/platform/types/navigation';
import type { ClientMapHubTab } from '@/platform/matter/matterStore';
import type { FollowerStatus, MatterScopeSelection } from '@/platform/client-context';

export type MattersSurfaceMode = 'client-map' | 'all-clients';
const MAX_STACK = 50;

export interface AppNavigationSnapshot {
  rootPath: string | null;
  sidebarActiveTab: AppSurface;
  activeMatterId: string | null;
  selectionScope?: MatterScopeSelection;
  selectionFollowerStatus?: FollowerStatus;
  clientMapHubId: string | null;
  clientMapHubTab: ClientMapHubTab | null;
  documentsView: 'browser' | 'editor';
  activeTabPath: string | null;
  mattersSurfaceMode: MattersSurfaceMode;
}

interface AppNavigationState {
  stack: AppNavigationSnapshot[];
  push: (snapshot: AppNavigationSnapshot) => void;
  pop: () => AppNavigationSnapshot | null;
  clear: () => void;
}

function sameSnapshot(
  a: AppNavigationSnapshot,
  b: AppNavigationSnapshot
): boolean {
  return (
    a.rootPath === b.rootPath &&
    a.sidebarActiveTab === b.sidebarActiveTab &&
    a.activeMatterId === b.activeMatterId &&
    a.selectionScope?.kind === b.selectionScope?.kind &&
    (a.selectionScope && 'matterId' in a.selectionScope ? a.selectionScope.matterId : null) ===
      (b.selectionScope && 'matterId' in b.selectionScope ? b.selectionScope.matterId : null) &&
    a.selectionFollowerStatus === b.selectionFollowerStatus &&
    a.clientMapHubId === b.clientMapHubId &&
    a.clientMapHubTab === b.clientMapHubTab &&
    a.documentsView === b.documentsView &&
    a.activeTabPath === b.activeTabPath &&
    a.mattersSurfaceMode === b.mattersSurfaceMode
  );
}

function matterExists(
  id: string | null,
  matters: Array<{ id: string; archived?: boolean }>
): boolean {
  return (
    id === null ||
    matters.some((matter) => matter.id === id && matter.archived !== true)
  );
}

export function sanitizeNavigationSnapshotForCurrentMatters(
  snapshot: AppNavigationSnapshot,
  matters: Array<{ id: string; archived?: boolean }>,
  currentRootPath: string | null
): AppNavigationSnapshot | null {
  if (snapshot.rootPath !== currentRootPath) return null;

  const hadClientTarget =
    snapshot.activeMatterId !== null || snapshot.clientMapHubId !== null;
  const activeMatterId = matterExists(snapshot.activeMatterId, matters)
    ? snapshot.activeMatterId
    : null;
  const clientMapHubId = matterExists(snapshot.clientMapHubId, matters)
    ? snapshot.clientMapHubId
    : null;
  const lostClientMapTarget =
    hadClientTarget &&
    activeMatterId === null &&
    clientMapHubId === null &&
    snapshot.mattersSurfaceMode === 'client-map';

  const selectionScope = snapshot.selectionScope &&
    (snapshot.selectionScope.kind === 'matter' || snapshot.selectionScope.kind === 'matter-only') &&
    !matterExists(snapshot.selectionScope.matterId, matters)
      ? ({ kind: 'all-matters' } as const)
      : snapshot.selectionScope;

  return {
    ...snapshot,
    activeMatterId,
    ...(selectionScope ? { selectionScope } : {}),
    clientMapHubId,
    clientMapHubTab: clientMapHubId ? snapshot.clientMapHubTab : null,
    mattersSurfaceMode: lostClientMapTarget
      ? 'all-clients'
      : snapshot.mattersSurfaceMode,
  };
}

export const useAppNavigationStore = create<AppNavigationState>()(
  (set, get) => ({
    stack: [],
    push: (snapshot) => {
      set((state) => {
        const last = state.stack[state.stack.length - 1];
        if (last && sameSnapshot(last, snapshot)) return state;
        return { stack: [...state.stack, snapshot].slice(-MAX_STACK) };
      });
    },
    pop: () => {
      const stack = get().stack;
      const snapshot = stack[stack.length - 1] ?? null;
      if (!snapshot) return null;
      set({ stack: stack.slice(0, -1) });
      return snapshot;
    },
    clear: () => {
      set({ stack: [] });
    },
  })
);
