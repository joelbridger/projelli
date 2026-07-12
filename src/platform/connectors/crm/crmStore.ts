// CRM sync progress store — mirrors mailStore.ts for the Wealthbox connector.
//
// Holds the latest crm-sync-progress event payload so any component can read
// the current sync status without subscribing to Tauri events directly.

import { create } from 'zustand';
import type { CrmSyncProgress } from '@/platform/utils/wealthbox-commands';

interface CrmState {
  /** Latest CRM sync progress, or null before any sync has started. */
  progress: CrmSyncProgress | null;
  /** Only events for this run are allowed to change the shared progress view. */
  currentRunId: string | null;
  setProgress: (p: CrmSyncProgress) => void;
  startRun: (runId: string) => void;
  finishRun: (runId: string) => void;
}

export const useCrmStore = create<CrmState>((set) => ({
  progress: null,
  currentRunId: null,
  setProgress: (p) => { set({ progress: p }); },
  startRun: (runId) => { set({ currentRunId: runId, progress: null }); },
  finishRun: (runId) => {
    set((state) => state.currentRunId === runId ? { currentRunId: null } : state);
  },
}));
