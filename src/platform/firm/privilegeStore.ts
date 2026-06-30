/**
 * Privilege store (WS-PRIV) — Zustand + persist.
 *
 * Holds the per-source privilege map (source id → privilege) and the single
 * `includePrivileged` toggle that governs whether the NEXT chat query is allowed
 * to retrieve privileged content. Persisted to localStorage under
 * `keepance:privilege`.
 *
 * Two things this drives:
 *   1. Indexing / re-tagging — when a source is marked privileged, every chunk
 *      for that source is re-tagged in the RAG store (via `rag_retag_privilege`)
 *      so it is excluded from default retrieval. The wiring lives in
 *      `usePrivilegeWiring`, which subscribes to this store.
 *   2. Retrieval — chat retrieval reads `includePrivileged` (default `false`) so
 *      privileged content is excluded by default. Flipping it on is a deliberate,
 *      visible, per-session choice (analogous to the cross-matter "all matters"
 *      capability), and it resets to off on reload.
 *
 * The store is kept PURE (no Tauri calls); side effects are reactions in the
 * wiring hook, mirroring how matter-folder changes drive re-indexing.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  normalizeSourceId,
  resolvePrivilege,
  type PrivilegeMap,
} from '@/platform/rag/privilegeResolver';
import {
  DEFAULT_PRIVILEGE,
  isPrivileged,
  type Privilege,
} from '@/platform/types/privilege';
import { SK_PRIVILEGE } from '@/config/identity';

interface PrivilegeState {
  /** Normalized source id → privilege. Only non-`none` entries are stored. */
  privilegeBySource: PrivilegeMap;
  /**
   * Whether the current chat query may retrieve privileged sources. Default
   * `false` (privileged content excluded). NOT persisted — every reload starts
   * with privileged content excluded, so the opt-in is always a deliberate act.
   */
  includePrivileged: boolean;

  /** Set (or clear) a source's privilege. Setting `none` removes the entry. */
  setPrivilege: (sourceId: string, privilege: Privilege) => void;
  /** Read a source's privilege reactively-free (used by callers via selectors). */
  getPrivilege: (sourceId: string) => Privilege;
  /** Set the include-privileged retrieval toggle. */
  setIncludePrivileged: (include: boolean) => void;
}

export const usePrivilegeStore = create<PrivilegeState>()(
  persist(
    (set, get) => ({
      privilegeBySource: {},
      includePrivileged: false,

      setPrivilege: (sourceId, privilege) => {
        const key = normalizeSourceId(sourceId);
        if (!key) return;
        set((state) => {
          const next = { ...state.privilegeBySource };
          if (privilege === 'none') {
            // Default is implicit; drop the entry so the map stays minimal.
            delete next[key];
          } else {
            next[key] = privilege;
          }
          return { privilegeBySource: next };
        });
      },

      getPrivilege: (sourceId) =>
        resolvePrivilege(sourceId, get().privilegeBySource),

      setIncludePrivileged: (include) => {
        set({ includePrivileged: include });
      },
    }),
    {
      name: SK_PRIVILEGE,
      version: 1,
      // Persist ONLY the privilege map. `includePrivileged` is deliberately not
      // persisted: privileged retrieval must be re-enabled explicitly each session.
      partialize: (state) => ({ privilegeBySource: state.privilegeBySource }),
    },
  ),
);

// ─────────────────────────────────────────────────────────────────────
// Non-reactive accessors (for the indexer hook and event listeners)
// ─────────────────────────────────────────────────────────────────────

/** Current privilege map, read without subscribing. */
export function getPrivilegeMap(): PrivilegeMap {
  return usePrivilegeStore.getState().privilegeBySource;
}

/**
 * Resolve a source id to its privilege, read without subscribing. This is the
 * function the indexer passes to the RAG index commands so every freshly-indexed
 * chunk is tagged with its source's current privilege.
 */
export function resolvePrivilegeForSource(sourceId: string): Privilege {
  return resolvePrivilege(sourceId, usePrivilegeStore.getState().privilegeBySource);
}

/** Current value of the include-privileged retrieval toggle (no subscription). */
export function getIncludePrivileged(): boolean {
  return usePrivilegeStore.getState().includePrivileged;
}

// ─────────────────────────────────────────────────────────────────────
// Reactive selectors
// ─────────────────────────────────────────────────────────────────────

/** Subscribe to a single source's privilege status. */
export function usePrivilegeForSource(sourceId: string | null | undefined): Privilege {
  return usePrivilegeStore((s) =>
    sourceId ? resolvePrivilege(sourceId, s.privilegeBySource) : DEFAULT_PRIVILEGE,
  );
}

/** Subscribe to the include-privileged retrieval toggle. */
export function useIncludePrivileged(): boolean {
  return usePrivilegeStore((s) => s.includePrivileged);
}

/** Subscribe to whether ANY source is currently marked privileged. */
export function useHasAnyPrivileged(): boolean {
  return usePrivilegeStore((s) =>
    Object.values(s.privilegeBySource).some((p) => isPrivileged(p)),
  );
}
