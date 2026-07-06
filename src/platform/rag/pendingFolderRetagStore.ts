/**
 * Pending FOLDER re-tag intents (QA-44, R7-3) — Zustand, PERSISTED, scoped PER
 * WORKSPACE. The FILE mirror of {@link usePendingMailRetagStore}.
 *
 * When a mapped folder's files can't be re-tagged to the correct matter (a live
 * re-map whose re-index failed every retry, or a boot in-place retag that failed
 * on some files), those files are still PHYSICALLY tagged with the OLD matter, so
 * they are held out of retrieval (`scopeUpdateStore` `matter:boot-retag`) until a
 * clean re-tag lands. That hold used to live ONLY in memory, so a workspace
 * close/switch dropped it. On reopen nothing re-established it until the boot
 * in-place retag ran — and the boot retag runs LAST in the boot chain (after the
 * full reconcile, PDF pass, and mail backfill), which is minutes on a large
 * workspace. Any client-scoped Ask in that window retrieved the wrong client's
 * files. That is a cross-SESSION wrong-client FILE leak — the same class the mail
 * hold closed in round 4, which files never got.
 *
 * This store is the DURABLE backing for the file hold. Each workspace root maps to
 * the set of held path prefixes (a mapped FOLDER for a pending live re-map, or an
 * exact FILE path for a failed boot retag) whose re-tag has not cleanly landed.
 * The invariant it guarantees:
 *
 *   a file physically tagged to a client the UI no longer maps it to MUST NOT
 *   surface until a re-tag to the correct client SUCCEEDS — across sessions,
 *   regardless of how many re-taps fail, and WITHOUT waiting for the slow boot
 *   retag to reach it.
 *
 * Lifecycle (all in `useMemoryWiring`):
 *   - a live re-map RECORDS its folder here (durable) before the re-tag runs and,
 *     on the re-tag's SUCCESS, releases it; a failed re-tag leaves it recorded;
 *   - the boot in-place retag RECORDS the exact files it failed on and RELEASES
 *     the ones it re-tagged cleanly;
 *   - on workspace OPEN the recorded prefixes for THAT workspace are read back and
 *     the `matter:boot-retag` exclusion is re-established SYNCHRONOUSLY (fail
 *     closed) BEFORE the slow boot chain runs (see `restoreFolderHolds`);
 *   - records are keyed by workspace root, so switching workspaces never bleeds
 *     one workspace's holds into another.
 *
 * The store is deliberately pure (exact-set union/remove): path-containment logic
 * (which held prefixes a re-tagged folder discharges) lives in the wiring, which
 * already owns `pathInAnyFolder`.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PendingFolderRetagState {
  /** workspaceRoot → the held path prefixes (mapped folders or exact files) whose
   *  folder→matter re-tag has not cleanly landed. */
  heldByWorkspace: Record<string, string[]>;
  /** Union `paths` into the workspace's held set (durable). No-op for empties. */
  hold: (workspaceRoot: string, paths: string[]) => void;
  /** Remove exactly `paths` (by string equality) from the workspace's held set,
   *  on a clean re-tag. Removes the workspace key entirely once empty. */
  release: (workspaceRoot: string, paths: string[]) => void;
  /** Drop every hold for a workspace root. */
  clearWorkspace: (workspaceRoot: string) => void;
  /** The held path prefixes recorded for a workspace root (empty when none). */
  forWorkspace: (workspaceRoot: string) => string[];
}

export const usePendingFolderRetagStore = create<PendingFolderRetagState>()(
  persist(
    (set, get) => ({
      heldByWorkspace: {},

      hold: (workspaceRoot, paths) => {
        if (!workspaceRoot || paths.length === 0) return;
        const existing = get().heldByWorkspace[workspaceRoot] ?? [];
        const union = new Set(existing);
        for (const p of paths) union.add(p);
        if (union.size === existing.length) return; // nothing new
        set((state) => ({
          heldByWorkspace: { ...state.heldByWorkspace, [workspaceRoot]: [...union] },
        }));
      },

      release: (workspaceRoot, paths) => {
        if (!workspaceRoot || paths.length === 0) return;
        const existing = get().heldByWorkspace[workspaceRoot];
        if (!existing || existing.length === 0) return;
        const drop = new Set(paths);
        const remaining = existing.filter((p) => !drop.has(p));
        if (remaining.length === existing.length) return; // nothing overlapped
        set((state) => ({
          heldByWorkspace:
            remaining.length === 0
              ? Object.fromEntries(
                  Object.entries(state.heldByWorkspace).filter(([k]) => k !== workspaceRoot),
                )
              : { ...state.heldByWorkspace, [workspaceRoot]: remaining },
        }));
      },

      clearWorkspace: (workspaceRoot) => {
        if (!(workspaceRoot in get().heldByWorkspace)) return;
        set((state) => ({
          heldByWorkspace: Object.fromEntries(
            Object.entries(state.heldByWorkspace).filter(([k]) => k !== workspaceRoot),
          ),
        }));
      },

      forWorkspace: (workspaceRoot) => get().heldByWorkspace[workspaceRoot] ?? [],
    }),
    {
      name: 'lantern:pending-folder-retag',
      version: 1,
    },
  ),
);
