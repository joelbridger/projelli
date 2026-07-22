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
import {
  useMatterStore,
  hydrateMattersFromWorkspaceDisk,
} from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { useClientGroupStore } from '@/platform/matter/clientGroupStore';
import { replaceCanonicalHouseholdDirectory } from '@/platform/client-context';

/**
 * Point the matter + client-map stores at `root` and reload their in-memory
 * state from that workspace's scoped persistence (running the one-time global
 * migration on a workspace's first open). Pass `null` to fall back to the
 * legacy global keys (no workspace open).
 *
 * Order matters: the scope is set first, THEN the old workspace's provider
 * directory is invalidated, THEN the matter store rehydrates, THEN the
 * client-map store (its migration filters by `getMatters()`, which must
 * already reflect the new workspace). `rehydrate()` applies synchronously for
 * our synchronous localStorage adapters, so `getMatters()` is up to date by the
 * time the client-map rehydrate reads it. Ephemeral cross-workspace nav is
 * cleared AFTER rehydrate so a stale client-hub id from the previous workspace
 * can't linger — and cleared after (not before) so it never persists the old
 * workspace's matters into the new scope's key.
 */
export function reloadWorkspaceScopedStores(root: string | null): void {
  setActiveWorkspaceScopeRoot(root);
  // The provider directory belongs to the workspace that was just left. Mark
  // it unavailable before the new workspace's saved selection is classified.
  // The client bar republishes the new workspace directory after its local
  // matter/CRM data renders. Until then the authority stays blocked and keeps
  // the new workspace's restart hint, rather than rejecting it against stale
  // clients from the previous workspace.
  replaceCanonicalHouseholdDirectory('wealthbox', null);
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
  // 2026-07 durability fix: the localStorage rehydrate above only loaded the
  // FAST CACHE. The workspace's own `.lantern/matters.json` is the source of
  // truth — load it (async; disk wins when present, and a cache-only legacy
  // install gets its records committed to disk once). Ordering with any
  // subsequent persist write is handled by the matter store's serial disk
  // queue + hydrate gate, so this can never race a write into clobbering the
  // file. The active WorkspaceService is already pointed at `root` on every
  // entry path (it is set before `setRootPath` fires this reload).
  // eslint-disable-next-line lantern-async/no-silent-failure -- the hydrate runs on the matter store's serial disk queue, which catches + logs every failure; the returned promise never rejects
  if (root) void hydrateMattersFromWorkspaceDisk(root);
}
