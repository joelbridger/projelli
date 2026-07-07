import { create } from 'zustand';
import type { AppSurface } from '@/app/lifecycle/useGlobalEventBus';
import type { ClientMapHubTab } from '@/platform/matter/matterStore';

export type MattersSurfaceMode = 'client-map' | 'all-clients';

export interface AppNavigationSnapshot {
  sidebarActiveTab: AppSurface;
  activeMatterId: string | null;
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

function sameSnapshot(a: AppNavigationSnapshot, b: AppNavigationSnapshot): boolean {
  return (
    a.sidebarActiveTab === b.sidebarActiveTab &&
    a.activeMatterId === b.activeMatterId &&
    a.clientMapHubId === b.clientMapHubId &&
    a.clientMapHubTab === b.clientMapHubTab &&
    a.documentsView === b.documentsView &&
    a.activeTabPath === b.activeTabPath &&
    a.mattersSurfaceMode === b.mattersSurfaceMode
  );
}

export const useAppNavigationStore = create<AppNavigationState>()((set, get) => ({
  stack: [],
  push: (snapshot) => {
    set((state) => {
      const last = state.stack[state.stack.length - 1];
      if (last && sameSnapshot(last, snapshot)) return state;
      return { stack: [...state.stack, snapshot] };
    });
  },
  pop: () => {
    const stack = get().stack;
    const snapshot = stack[stack.length - 1] ?? null;
    if (!snapshot) return null;
    set({ stack: stack.slice(0, -1) });
    return snapshot;
  },
  clear: () => set({ stack: [] }),
}));

