// CRM sync progress store — mirrors mailStore.ts for the Wealthbox connector.
//
// Holds the latest crm-sync-progress event payload so any component can read
// the current sync status without subscribing to Tauri events directly.

import { create } from 'zustand';
import type { CrmSyncProgress } from '@/platform/utils/wealthbox-commands';

interface CrmState {
  /** Latest CRM sync progress, or null before any sync has started. */
  progress: CrmSyncProgress | null;
  setProgress: (p: CrmSyncProgress) => void;
}

export const useCrmStore = create<CrmState>((set) => ({
  progress: null,
  setProgress: (p) => { set({ progress: p }); },
}));
