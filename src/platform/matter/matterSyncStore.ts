/**
 * matterSyncStore — live per-matter sync status (ephemeral).
 *
 * MERGED into the unified matter store (2026-06-17 reorg). The state + actions
 * now live as the `statusByMatterId` slice of `useMatterStore`; this module keeps
 * the status type + the `useMatterSyncStatus` selector and re-exports the store
 * as `useMatterSyncStore` so existing importers are unchanged.
 *
 * This slice is intentionally NOT persisted: status is a live runtime signal
 * that resets on each app launch (the merged store omits it from `partialize`).
 * Default for any matterId not yet touched is 'idle', which the sync badge
 * renders as nothing. The sync client (Task 4) sets statuses via setStatus().
 */

import { useMatterStore } from '@/platform/matter/matterStore';

export type MatterSyncStatus =
  | 'idle'
  | 'connecting'
  | 'catching-up'
  | 'live'
  | 'offline'
  | 'error';

export type MatterSyncQuarantineReason = 'decrypt_failed' | 'epoch_superseded' | 'yjs_apply_failed';

/** Alias to the unified matter store — the `statusByMatterId` slice lives there. */
export const useMatterSyncStore = useMatterStore;

// ── Reactive selectors ────────────────────────────────────────────────────────

/**
 * Subscribe to the sync status for a specific matter.
 * Returns 'idle' when no status has been set yet (default).
 */
export function useMatterSyncStatus(matterId: string): MatterSyncStatus {
  return useMatterStore((s) => s.statusByMatterId[matterId] ?? 'idle');
}
