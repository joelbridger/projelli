/**
 * Scope-update status store (QA-44) — Zustand, NOT persisted.
 *
 * Tracks in-flight and failed RAG "scope updates": the re-tag operations that
 * run when a source's privilege changes, or a folder / mail-folder is re-scoped
 * to a different client. Each such re-tag used to be fire-and-forget with a
 * swallowed `.catch(() => {})`, so a failed re-tag left the search index on the
 * OLD tag while the UI claimed the new rule was live — a silent privilege leak,
 * or content stuck under the wrong client.
 *
 * This store makes those updates:
 *   1. VISIBLE — an advisor sees 'search scope update failed - retrying' instead
 *      of a false 'active' (see `ScopeUpdateBanner`), and
 *   2. FAIL CLOSED for matter re-tags — while a folder's re-tag is pending or
 *      failed, its files are excluded from retrieval (`getExcludedMatterFolders`
 *      feeds `MemoryService`'s retrieval exclusion) so stale content can never
 *      surface under the wrong client until the re-tag actually lands.
 *
 * The store is intentionally pure state; the retry/backoff side effects live in
 * `retagScheduler`, which owns per-workspace timers and drives this store.
 * Privilege fail-closed does NOT rely on this store — `MemoryService.retrieve`
 * re-checks every hit against the persisted privilege store directly, so a
 * privileged source stays excluded even across a reload. This store's exclusion
 * is the matter/client half, which the boot reconcile heals on next open.
 */

import { useMemo } from 'react';
import { create } from 'zustand';

export type ScopeUpdateKind = 'privilege' | 'matter' | 'mail';
export type ScopeUpdateStatus = 'retrying' | 'failed';

export interface ScopeUpdateEntry {
  /** Stable id for this update (e.g. `privilege:<sourceId>`, `matter:<folders>`). */
  id: string;
  kind: ScopeUpdateKind;
  /** Plain-language label for the banner. */
  label: string;
  status: ScopeUpdateStatus;
  /**
   * Workspace-folder paths whose file chunks are stale until this update lands.
   * Present only for matter folder re-tags; empty for privilege (covered by the
   * live-store retrieval re-check) and mail (no path to exclude by).
   */
  excludeFolders: string[];
  /**
   * Matter ids whose MAIL is held out of retrieval until this update lands. Mail
   * hits carry no folder path, so a mail folder re-tag that moves a folder from
   * one client to another instead holds out the OLD client's mail (by its stale
   * matter id) so it cannot surface under the wrong client mid-retag. Empty for
   * file/privilege updates and for a fresh (previously-unassigned) mail mapping.
   */
  excludeMailMatters: string[];
}

interface ScopeUpdateState {
  entries: Record<string, ScopeUpdateEntry>;
  /** Register (or re-register) an update as in flight (status 'retrying'). */
  begin: (entry: {
    id: string;
    kind: ScopeUpdateKind;
    label: string;
    excludeFolders?: string[];
    excludeMailMatters?: string[];
  }) => void;
  /** Mark an update as failed (retries exhausted). Keeps its excludeFolders so
   *  the fail-closed exclusion persists until it eventually succeeds. */
  markFailed: (id: string) => void;
  /** Remove an update (on success, or when its workspace is torn down). */
  remove: (id: string) => void;
  /** Remove several updates at once (workspace switch cleanup). */
  removeMany: (ids: string[]) => void;
  /** Drop every update (test / full reset helper). */
  clearAll: () => void;
}

export const useScopeUpdateStore = create<ScopeUpdateState>((set) => ({
  entries: {},

  begin: ({ id, kind, label, excludeFolders = [], excludeMailMatters = [] }) => {
    set((state) => ({
      entries: {
        ...state.entries,
        [id]: { id, kind, label, status: 'retrying', excludeFolders, excludeMailMatters },
      },
    }));
  },

  markFailed: (id) => {
    set((state) => {
      const current = state.entries[id];
      if (!current) return {};
      return { entries: { ...state.entries, [id]: { ...current, status: 'failed' } } };
    });
  },

  remove: (id) => {
    set((state) => {
      if (!(id in state.entries)) return {};
      return {
        entries: Object.fromEntries(
          Object.entries(state.entries).filter(([key]) => key !== id),
        ),
      };
    });
  },

  removeMany: (ids) => {
    set((state) => {
      const drop = new Set(ids);
      const kept = Object.entries(state.entries).filter(([key]) => !drop.has(key));
      if (kept.length === Object.keys(state.entries).length) return {};
      return { entries: Object.fromEntries(kept) };
    });
  },

  clearAll: () => {
    set({ entries: {} });
  },
}));

// ─────────────────────────────────────────────────────────────────────
// Non-reactive accessors
// ─────────────────────────────────────────────────────────────────────

/**
 * Every workspace-folder path currently excluded from retrieval because its
 * matter re-tag is pending or failed. Read without subscribing — used by the
 * retrieval exclusion predicate. Deduped so overlapping updates don't repeat a
 * folder.
 */
export function getExcludedMatterFolders(): string[] {
  const seen = new Set<string>();
  for (const entry of Object.values(useScopeUpdateStore.getState().entries)) {
    for (const folder of entry.excludeFolders) seen.add(folder);
  }
  return Array.from(seen);
}

/**
 * Every matter id whose MAIL is currently held out of retrieval because a mail
 * folder re-tag moving it to a different client is pending or failed. Read
 * without subscribing — used by the retrieval exclusion predicate to drop mail
 * hits that still carry the OLD client's matter id.
 */
export function getExcludedMailMatters(): string[] {
  const seen = new Set<string>();
  for (const entry of Object.values(useScopeUpdateStore.getState().entries)) {
    for (const matterId of entry.excludeMailMatters) seen.add(matterId);
  }
  return Array.from(seen);
}

// ─────────────────────────────────────────────────────────────────────
// Reactive selectors (for the banner)
// ─────────────────────────────────────────────────────────────────────

/** Subscribe to the list of active scope updates (retrying + failed). Selects
 *  the stable `entries` record and derives the array via `useMemo` so the
 *  `useSyncExternalStore` snapshot stays referentially stable between unrelated
 *  renders (a fresh `Object.values` per call would trip React's snapshot cache). */
export function useScopeUpdateEntries(): ScopeUpdateEntry[] {
  const entries = useScopeUpdateStore((s) => s.entries);
  return useMemo(() => Object.values(entries), [entries]);
}
