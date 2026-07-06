/**
 * workspaceScope — the active workspace's identity for PER-WORKSPACE persistence
 * (QA-93).
 *
 * matter/client-map state used to persist under APP-GLOBAL localStorage keys, so
 * switching workspaces left the OLD workspace's clients visible in the new one
 * (and made whole-practice Ask count the wrong book). The fix scopes those two
 * stores' persistence per workspace: their storage adapters append this module's
 * suffix to their base key, and a reload on workspace switch swaps the in-memory
 * slice to the new workspace's data.
 *
 * This module holds ONLY the active-root string + the derived suffix — no store
 * imports — so the matter/client-map stores can depend on it without an import
 * cycle. The reload orchestrator lives in `reloadWorkspaceScopedStores.ts`, which
 * imports the stores (nothing imports it back).
 *
 * Workspace IDENTITY = `pathComparisonKey(rootPath)` — the app's OWN canonical
 * path-comparison key (separator + dot-segment normalized, trailing slash
 * stripped, and on Windows only the drive/UNC volume root case-folded; directory
 * segments stay case-sensitive). Deriving the scope id from the SAME policy the
 * matter-isolation checks (`sameOrInside`/`isPathInFolder`) use means the SAME
 * workspace opened with a differently-spelled-but-equal path maps to one scope,
 * WITHOUT the naive `toLowerCase()` that would wrongly collapse `/Practice/Acme`
 * and `/Practice/acme` (two different client boundaries) into one key. The
 * raw-path-in-key precedent is `editorStore`'s `workspace_tabs_<rootPath>` and
 * swallow-p0's per-workspace `pendingMailRetagStore`.
 *
 * When NO workspace scope is active (app boot before a workspace opens; unit
 * tests that never call the reload), the suffix is `''` → the base (legacy
 * global) keys, so pre-QA-93 behavior and the matter-store hydration safety-net
 * tests are unchanged.
 */

import { pathComparisonKey } from '@/platform/fs/appPath';

/** The currently-active workspace root, or null when no workspace scope is set
 *  (boot before a workspace opens, or tests). Module-level, never persisted. */
let activeWorkspaceRoot: string | null = null;

/** Read the active workspace scope root (null = no scope / legacy global keys). */
export function getActiveWorkspaceScopeRoot(): string | null {
  return activeWorkspaceRoot;
}

/** Set the active workspace scope root. Called only by the reload orchestrator
 *  at a workspace switch — the storage adapters read it on the next rehydrate. */
export function setActiveWorkspaceScopeRoot(root: string | null): void {
  activeWorkspaceRoot = root;
}

/** Derive the stable workspace-identity id from a root path. Exported for the
 *  reload orchestrator + tests; see the module doc for the identity rules. */
export function workspaceScopeId(root: string): string {
  return pathComparisonKey(root);
}

/** The localStorage-key suffix for the active scope. `''` when no scope is
 *  active (legacy global keys), else `::ws:<id>`. Appended to each scoped
 *  store's base key. */
export function workspaceScopeSuffix(): string {
  if (!activeWorkspaceRoot) return '';
  return `::ws:${workspaceScopeId(activeWorkspaceRoot)}`;
}
