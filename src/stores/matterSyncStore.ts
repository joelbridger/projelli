/**
 * matterSyncStore — runtime-only Zustand store for live sync status.
 *
 * Tracks the per-matter sync connection status that MatterSyncClient sets.
 * This store is intentionally NOT persisted: status is a live runtime signal
 * that resets on each app launch. Default for any matterId not yet touched is
 * 'idle', which the sync badge renders as nothing.
 *
 * The sync client (Task 4) sets these statuses via setStatus(). This store
 * just provides the shape the badge (MatterScopeSelector) and dialog
 * (MatterManagerDialog) read from.
 */

import { create } from 'zustand';

export type MatterSyncStatus =
  | 'idle'
  | 'connecting'
  | 'catching-up'
  | 'live'
  | 'offline'
  | 'error';

interface MatterSyncState {
  /** Status keyed by LOCAL matter id (not firmMatterId). */
  statusByMatterId: Record<string, MatterSyncStatus>;

  /** Set the status for a matter. */
  setStatus: (matterId: string, status: MatterSyncStatus) => void;
  /** Clear status for a specific matter (e.g. on unshare). */
  clearMatter: (matterId: string) => void;
  /** Clear all statuses (e.g. on sign-out). */
  clear: () => void;
}

export const useMatterSyncStore = create<MatterSyncState>()((set) => ({
  statusByMatterId: {},

  setStatus: (matterId, status) =>
    set((state) => ({
      statusByMatterId: { ...state.statusByMatterId, [matterId]: status },
    })),

  clearMatter: (matterId) =>
    set((state) => {
      const next = { ...state.statusByMatterId };
      delete next[matterId];
      return { statusByMatterId: next };
    }),

  clear: () => set({ statusByMatterId: {} }),
}));

// ── Reactive selectors ────────────────────────────────────────────────────────

/**
 * Subscribe to the sync status for a specific matter.
 * Returns 'idle' when no status has been set yet (default).
 */
export function useMatterSyncStatus(matterId: string): MatterSyncStatus {
  return useMatterSyncStore((s) => s.statusByMatterId[matterId] ?? 'idle');
}
