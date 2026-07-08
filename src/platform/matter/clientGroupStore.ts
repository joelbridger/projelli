/**
 * Client groups store (feedback line 13).
 *
 * A local-first way to gather clients into named groups in the rail. Groups
 * live ALONGSIDE the matter store — their own zustand store, their own
 * localStorage key (`SK_CLIENT_GROUPS`) — and hold only matter **ids**, never
 * matter content. So:
 *   - nothing new ever leaves the machine (ids are already local),
 *   - there is NO wire-schema change (the matter contract is untouched),
 *   - a client can belong to many groups (membership is a plain id list),
 *   - a group can be empty and is still deletable.
 *
 * Stale ids (e.g. a group referencing a matter that only exists in another
 * workspace, or a since-deleted client) are harmless: the rail filters members
 * against the live matter list at render time, so a stale id simply doesn't
 * render. `removeMatterFromAllGroups` lets the client-delete flow prune ids
 * eagerly too.
 *
 * Data-safe by construction: `sanitizeClientGroups` coerces any corrupt or
 * legacy persisted blob back to a valid list (worst case: an empty list) so a
 * bad payload can never throw during hydration.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { SK_CLIENT_GROUPS } from '@/config/identity';
import { workspaceScopeSuffix } from '@/platform/state/workspaceScope';

export interface ClientGroup {
  id: string;
  name: string;
  /** Matter ids in this group. A matter id may appear in many groups. */
  matterIds: string[];
  createdAt: string;
}

/** Generate a stable, collision-resistant group id. */
function newGroupId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `cgroup_${crypto.randomUUID()}`;
    }
    // eslint-disable-next-line lantern-async/no-silent-failure -- crypto may be unavailable; intentionally fall through to the Math.random id below.
  } catch {
    /* crypto.randomUUID threw — fall through to the Math.random path */
  }
  return `cgroup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Keep only unique, non-empty string ids, preserving first-seen order. */
function dedupeIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Coerce persisted/unknown data into a valid `ClientGroup[]`. Drops entries
 * with no id or a blank name; defaults a missing `matterIds` to `[]` and a
 * missing `createdAt` to the empty string. Keeps only the FIRST group per id so
 * a corrupt blob with duplicate ids can never render duplicate rail
 * handles/keys or make a rename/delete hit two groups at once. Never throws.
 */
export function sanitizeClientGroups(input: unknown): ClientGroup[] {
  if (!Array.isArray(input)) return [];
  const out: ClientGroup[] = [];
  const seenIds = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Partial<ClientGroup>;
    const id = typeof rec.id === 'string' ? rec.id.trim() : '';
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    if (!id || !name || seenIds.has(id)) continue;
    seenIds.add(id);
    out.push({
      id,
      name,
      matterIds: dedupeIds(rec.matterIds),
      createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : '',
    });
  }
  return out;
}

/** The per-workspace localStorage key for client groups (QA-93 scoping): the
 *  base key when no workspace scope is active, else `…::ws:<id>`. Mirrors the
 *  matter + client-map stores so groups never leak across workspaces. */
function scopedGroupsKey(): string {
  return SK_CLIENT_GROUPS + workspaceScopeSuffix();
}

/** Per-workspace persistence for client groups. Sanitizes on read so a corrupt
 *  or duplicate-id blob can never crash hydration or produce duplicate handles. */
const scopedGroupStorage: PersistStorage<{ groups: ClientGroup[] }> = {
  getItem: (): StorageValue<{ groups: ClientGroup[] }> => {
    // ALWAYS return a concrete state (never null): on a workspace switch to a
    // scope with no saved groups, a null return would leave zustand keeping the
    // PREVIOUS workspace's in-memory groups (same gotcha the matter store
    // guards). Returning `{ groups: [] }` makes rehydrate replace them.
    try {
      const raw = localStorage.getItem(scopedGroupsKey());
      const parsed = raw ? (JSON.parse(raw) as { state?: { groups?: unknown } } | null) : null;
      return { state: { groups: sanitizeClientGroups(parsed?.state?.groups) }, version: 0 };
    } catch {
      // Unreadable/corrupt payload → start clean rather than throw.
      return { state: { groups: [] }, version: 0 };
    }
  },
  setItem: (_name, value): void => {
    try {
      localStorage.setItem(scopedGroupsKey(), JSON.stringify({ state: value.state, version: 0 }));
    } catch (err) {
      console.warn('[clientGroups] per-workspace persistence write failed:', err);
    }
  },
  removeItem: (): void => {
    try {
      localStorage.removeItem(scopedGroupsKey());
    } catch (err) {
      console.warn('[clientGroups] per-workspace persistence remove failed:', err);
    }
  },
};

interface ClientGroupState {
  groups: ClientGroup[];
  /** Create a named group. Returns the group, or `null` if the name is blank. */
  createGroup: (name: string) => ClientGroup | null;
  /** Rename a group. A blank name is ignored (no-op). */
  renameGroup: (id: string, name: string) => void;
  /** Delete a group (empty or not). */
  deleteGroup: (id: string) => void;
  /** Add one matter to a group (de-duplicated). */
  addToGroup: (id: string, matterId: string) => void;
  /** Remove one matter from a group. */
  removeFromGroup: (id: string, matterId: string) => void;
  /** Replace a group's whole membership set (de-duplicated). */
  setGroupMembers: (id: string, matterIds: string[]) => void;
  /** Prune a matter id from EVERY group — used when a client is deleted. */
  removeMatterFromAllGroups: (matterId: string) => void;
}

export const useClientGroupStore = create<ClientGroupState>()(
  persist(
    (set, get) => ({
      groups: [],

      createGroup: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return null;
        // Regenerate on the astronomically-unlikely id collision so two groups
        // can never share an id (which would collide their rail handles/keys
        // and make rename/delete hit both).
        const existing = new Set(get().groups.map((g) => g.id));
        let id = newGroupId();
        while (existing.has(id)) id = newGroupId();
        const group: ClientGroup = {
          id,
          name: trimmed,
          matterIds: [],
          createdAt: new Date().toISOString(),
        };
        set({ groups: [...get().groups, group] });
        return group;
      },

      renameGroup: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set({
          groups: get().groups.map((g) =>
            g.id === id ? { ...g, name: trimmed } : g,
          ),
        });
      },

      deleteGroup: (id) => {
        set({ groups: get().groups.filter((g) => g.id !== id) });
      },

      addToGroup: (id, matterId) => {
        const clean = matterId.trim();
        if (!clean) return;
        set({
          groups: get().groups.map((g) =>
            g.id === id
              ? { ...g, matterIds: dedupeIds([...g.matterIds, clean]) }
              : g,
          ),
        });
      },

      removeFromGroup: (id, matterId) => {
        set({
          groups: get().groups.map((g) =>
            g.id === id
              ? { ...g, matterIds: g.matterIds.filter((m) => m !== matterId) }
              : g,
          ),
        });
      },

      setGroupMembers: (id, matterIds) => {
        const clean = dedupeIds(matterIds);
        set({
          groups: get().groups.map((g) =>
            g.id === id ? { ...g, matterIds: clean } : g,
          ),
        });
      },

      removeMatterFromAllGroups: (matterId) => {
        set({
          groups: get().groups.map((g) =>
            g.matterIds.includes(matterId)
              ? { ...g, matterIds: g.matterIds.filter((m) => m !== matterId) }
              : g,
          ),
        });
      },
    }),
    {
      name: SK_CLIENT_GROUPS,
      // Per-workspace storage (QA-93): the key carries the active workspace's
      // suffix so a group created in one workspace never appears in — or is
      // deleted from — another. The adapter also sanitizes on read.
      storage: scopedGroupStorage,
      partialize: (s) => ({ groups: s.groups }),
    },
  ),
);

/** Reactive selector for the group list (shallow-compared). */
export function useClientGroups(): ClientGroup[] {
  return useClientGroupStore(useShallow((s) => s.groups));
}
