/**
 * matterAtAGlanceStore — AI at-a-glance summary cache.
 *
 * MERGED into the unified matter store (2026-06-17 reorg). The state + actions
 * now live as the `cache` slice of `useMatterStore`; this module keeps the entry
 * type and re-exports the store as `useMatterAtAGlanceStore` so existing
 * importers are unchanged. Persistence is unchanged: the merged store's
 * multi-key adapter still writes localStorage `lantern:matter-at-a-glance`.
 *
 * Keyed by matter id; stores the generated result and timestamp so the hub does
 * not regenerate on every open. A manual Refresh invalidates the entry for the
 * current matter, forcing a new generation.
 */

import { useMatterStore } from '@/platform/matter/matterStore';
import type { MatterAtAGlanceResult } from '@/platform/matter/matterAtAGlance';

export interface MatterAtAGlanceEntry {
  result: MatterAtAGlanceResult;
  /** ISO timestamp of when the entry was cached. */
  cachedAt: string;
}

/** Alias to the unified matter store — the `cache` slice lives there. */
export const useMatterAtAGlanceStore = useMatterStore;
