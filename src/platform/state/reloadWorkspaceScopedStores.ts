/**
 * reloadWorkspaceScopedStores — swap the per-workspace stores to a new workspace
 * (QA-93).
 *
 * The matter store and client-map store persist per workspace (see
 * `workspaceScope.ts`). This is the ONE place their in-memory slice is swapped to
 * a different workspace's data. It's driven off the workspace root changing (a
 * `useWorkspaceStore` subscription in `useWorkspaceLifecycle`), so the swap is
 * ATOMIC with the root change for EVERY entry path — Open Existing, Recent
 * Projects, and boot auto-resume all funnel through the same `setRootPath`.
 *
 * Lives in its own module (imports the stores; nothing imports it back) so the
 * stores can depend on `workspaceScope.ts` without an import cycle.
 */

import { setActiveWorkspaceScopeRoot } from '@/platform/state/workspaceScope';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { useClientGroupStore } from '@/platform/matter/clientGroupStore';

/**
 * Point the matter + client-map stores at `root` and reload their in-memory
 * state from that workspace's scoped persistence (running the one-time global
 * migration on a workspace's first open). Pass `null` to fall back to the
 * legacy global keys (no workspace open).
 *
 * Order matters: the scope is set first, THEN the matter store rehydrates, THEN
 * the client-map store (its migration filters by `getMatters()`, which must
 * already reflect the new workspace). `rehydrate()` applies synchronously for
 * our synchronous localStorage adapters, so `getMatters()` is up to date by the
 * time the client-map rehydrate reads it. Ephemeral cross-workspace nav is
 * cleared AFTER rehydrate so a stale client-hub id from the previous workspace
 * can't linger — and cleared after (not before) so it never persists the old
 * workspace's matters into the new scope's key.
 */
export function reloadWorkspaceScopedStores(root: string | null): void {
  setActiveWorkspaceScopeRoot(root);
  void useMatterStore.persist.rehydrate();
  void useClientMapStore.persist.rehydrate();
  // Client groups are per-workspace too (ids-only rail grouping); reload them to
  // the new workspace's scope so a group never bleeds across workspaces.
  void useClientGroupStore.persist.rehydrate();
  useMatterStore.setState({
    statusByMatterId: {},
    clientMapHubId: null,
    clientMapHubTab: null,
    pendingMeetingOpen: null,
  });
}
