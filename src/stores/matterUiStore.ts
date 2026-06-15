/**
 * matterUiStore — per-matter UI memory.
 *
 * Remembers, for each matter, the last "working" surface the user was on
 * (Search / Documents / Email / Workflows / Activity Log) and the document tab
 * they had focused there. When the user jumps away to another matter and comes
 * back, App restores this snapshot so they land right where they left off.
 *
 * Notes:
 * - We deliberately do NOT remember the 'matters' (hub/list) or 'settings'
 *   surfaces — those are browse/config views, not a working context. Leaving
 *   them out means opening a matter's hub never clobbers its remembered work.
 * - Search *results* already persist per-matter via aiChatStore (chatId
 *   "ask-<matterId>"), so restoring the Search surface brings them back for free.
 * - Persisted to localStorage so the memory also survives a reload.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

interface MatterUiState {
  snapshots: Record<string, MatterUiSnapshot>;
  saveSnapshot: (matterId: string, snapshot: MatterUiSnapshot) => void;
  getSnapshot: (matterId: string) => MatterUiSnapshot | undefined;
  clearSnapshot: (matterId: string) => void;
}

export const useMatterUiStore = create<MatterUiState>()(
  persist(
    (set, get) => ({
      snapshots: {},
      saveSnapshot: (matterId, snapshot) => {
        set((state) => ({ snapshots: { ...state.snapshots, [matterId]: snapshot } }));
      },
      getSnapshot: (matterId) => get().snapshots[matterId],
      clearSnapshot: (matterId) => {
        set((state) => {
          if (!(matterId in state.snapshots)) return state;
          const next = { ...state.snapshots };
          delete next[matterId];
          return { snapshots: next };
        });
      },
    }),
    { name: 'keepance:matter-ui-snapshots' },
  ),
);
