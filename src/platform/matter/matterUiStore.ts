/**
 * matterUiStore — per-matter UI memory.
 *
 * MERGED into the unified matter store (2026-06-17 reorg). The state + actions
 * now live as the `snapshots` slice of `useMatterStore`; this module keeps the
 * UI types and the pure `isWorkingSurface` helper, and re-exports the store as
 * `useMatterUiStore` so existing importers are unchanged. Persistence is
 * unchanged: the merged store's multi-key adapter still writes localStorage
 * `keepance:matter-ui-snapshots`.
 *
 * Remembers, for each matter, the last "working" surface the user was on
 * (Search / Documents / Email / Workflows / Activity Log) and the document tab
 * they had focused there. When the user jumps away to another matter and comes
 * back, App restores this snapshot so they land right where they left off.
 */
import { useMatterStore } from '@/platform/matter/matterStore';

/** The surfaces worth remembering per matter (a real working context). */
export type MatterWorkingSurface = 'search' | 'files' | 'email' | 'workflows' | 'audit';

const WORKING_SURFACES: ReadonlySet<string> = new Set([
  'search',
  'files',
  'email',
  'workflows',
  'audit',
]);

/** True when a surface is worth remembering as a matter's working context. */
export function isWorkingSurface(surface: string): surface is MatterWorkingSurface {
  return WORKING_SURFACES.has(surface);
}

export interface MatterUiSnapshot {
  /** The last working surface the user was on for this matter. */
  surface: MatterWorkingSurface;
  /** The document tab focused on that surface (null when none / not Documents). */
  activeTabPath: string | null;
}

/** Alias to the unified matter store — the `snapshots` slice lives there. */
export const useMatterUiStore = useMatterStore;
