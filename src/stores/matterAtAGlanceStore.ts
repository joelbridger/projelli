/**
 * matterAtAGlanceStore.ts
 *
 * Zustand + persist cache for AI-generated at-a-glance summaries.
 * Keyed by matter id; stores the generated result and timestamp so the
 * hub does not regenerate on every open. A manual Refresh clears the
 * cache entry for the current matter, forcing a new generation.
 *
 * Persisted to localStorage under 'keepance:matter-at-a-glance'.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MatterAtAGlanceResult } from '@/modules/matter/matterAtAGlance';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MatterAtAGlanceEntry {
  result: MatterAtAGlanceResult;
  /** ISO timestamp of when the entry was cached. */
  cachedAt: string;
}

interface MatterAtAGlanceStore {
  /** Map from matterId to cached entry. */
  cache: Record<string, MatterAtAGlanceEntry>;

  /**
   * Store a generated result for a matter.
   */
  setEntry(matterId: string, result: MatterAtAGlanceResult): void;

  /**
   * Retrieve a cached entry by matter id, or undefined if not cached.
   */
  getEntry(matterId: string): MatterAtAGlanceEntry | undefined;

  /**
   * Invalidate the cache entry for a matter (e.g. on manual Refresh).
   */
  invalidate(matterId: string): void;

  /**
   * Clear all cached entries.
   */
  clearAll(): void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useMatterAtAGlanceStore = create<MatterAtAGlanceStore>()(
  persist(
    (set, get) => ({
      cache: {},

      setEntry(matterId, result) {
        set((state) => ({
          cache: {
            ...state.cache,
            [matterId]: {
              result,
              cachedAt: new Date().toISOString(),
            },
          },
        }));
      },

      getEntry(matterId) {
        return get().cache[matterId];
      },

      invalidate(matterId) {
        set((state) => {
          const next = { ...state.cache };
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete next[matterId];
          return { cache: next };
        });
      },

      clearAll() {
        set({ cache: {} });
      },
    }),
    {
      name: 'keepance:matter-at-a-glance',
      // Only persist the cache map; actions are recreated on hydration.
      partialize: (state) => ({ cache: state.cache }),
    },
  ),
);
