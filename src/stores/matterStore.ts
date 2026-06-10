/**
 * Matter store (WS-B/C app) — Zustand + persist.
 *
 * Holds the user's matters (one client matter = one confidentiality boundary,
 * mapped to one or more workspace folders) and the ACTIVE matter that scopes
 * chat retrieval. Persisted to localStorage under `keepance:matters`.
 *
 * The active matter drives two things:
 *   1. Indexing — files under a matter's folders are tagged with that matter
 *      id so the RAG store can prefilter by matter.
 *   2. Retrieval — chat searches are scoped to the active matter, so one
 *      client's data never surfaces in another's matter.
 *
 * `activeMatterId` is `null` by default. When `null`, the chat uses the
 * explicit cross-matter ("all matters") scope — the user has not narrowed to
 * a single client, which is the deliberate cross-matter capability.
 *
 * Non-reactive accessors (`getMatters`, `resolveMatterIdForPath`) are exported
 * so the indexer hook can resolve a path -> matter without subscribing to the
 * store inside a React render.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { Matter, MatterScope } from '@/types/matter';
import { resolveMatterId, findMatter } from '@/modules/memory/matterResolver';

/** Generate a stable matter id. Uses crypto.randomUUID when available. */
function newMatterId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `matter_${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through to the Math.random path */
  }
  return `matter_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Normalise an absolute folder path: backslashes -> slashes, strip trailing slash. */
function normalizeFolder(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

export interface CreateMatterInput {
  name: string;
  client: string;
  folderPaths?: string[];
  mailFolderPaths?: string[];
  /** Mark the matter privileged at creation time (defaults to false). */
  privileged?: boolean;
  /** Optionally link the matter to the firm backend at creation time. */
  firmMatterId?: string;
  orgId?: string;
  role?: 'owner' | 'editor' | 'viewer';
  shared?: boolean;
}

interface MatterState {
  matters: Matter[];
  /** Active matter id, or `null` for the explicit "all matters" scope. */
  activeMatterId: string | null;

  // CRUD
  createMatter: (input: CreateMatterInput) => Matter;
  renameMatter: (id: string, patch: { name?: string; client?: string }) => void;
  deleteMatter: (id: string) => void;
  setFolderPaths: (id: string, folderPaths: string[]) => void;
  addFolderPath: (id: string, folderPath: string) => void;
  removeFolderPath: (id: string, folderPath: string) => void;

  // WS-B/C — mail folder mapping (provider/account[/folder] keys).
  addMailFolderPath: (id: string, mailFolderKey: string) => void;
  removeMailFolderPath: (id: string, mailFolderKey: string) => void;

  // Privileged Matter Mode: per-matter privileged designation. When the active
  // matter is privileged, network plugins + MCP are disabled (see
  // `modules/privacy/privilegedMatterMode`).
  setMatterPrivileged: (id: string, privileged: boolean) => void;

  // Active matter
  setActiveMatter: (id: string | null) => void;

  // Firm linkage (Task 3) — link a local matter to a firm backend matter.
  linkFirmMatter: (
    id: string,
    linkage: { firmMatterId: string; orgId: string; role: 'owner' | 'editor' | 'viewer' },
  ) => void;
  /** Unlink a matter from the firm backend (keep local files intact). */
  unlinkFirmMatter: (id: string) => void;
  /** Update the user's role on a shared matter (e.g. after a members/list refresh). */
  setMatterRole: (id: string, role: 'owner' | 'editor' | 'viewer') => void;
}

export const useMatterStore = create<MatterState>()(
  persist(
    (set) => ({
      matters: [],
      activeMatterId: null,

      createMatter: (input) => {
        const matter: Matter = {
          id: newMatterId(),
          name: input.name.trim(),
          client: input.client.trim(),
          folderPaths: (input.folderPaths ?? []).map(normalizeFolder).filter(Boolean),
          mailFolderPaths: Array.from(new Set((input.mailFolderPaths ?? []).filter(Boolean))),
          privileged: input.privileged ?? false,
          createdAt: new Date().toISOString(),
          ...(input.firmMatterId !== undefined ? { firmMatterId: input.firmMatterId } : {}),
          ...(input.orgId !== undefined ? { orgId: input.orgId } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.shared !== undefined ? { shared: input.shared } : {}),
        };
        set((state) => ({ matters: [...state.matters, matter] }));
        return matter;
      },

      renameMatter: (id, patch) => {
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === id
              ? {
                  ...m,
                  ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
                  ...(patch.client !== undefined ? { client: patch.client.trim() } : {}),
                }
              : m,
          ),
        }));
      },

      deleteMatter: (id) => {
        set((state) => ({
          matters: state.matters.filter((m) => m.id !== id),
          // If the deleted matter was active, fall back to the all-matters scope.
          activeMatterId: state.activeMatterId === id ? null : state.activeMatterId,
        }));
      },

      setFolderPaths: (id, folderPaths) => {
        const normalized = Array.from(
          new Set(folderPaths.map(normalizeFolder).filter(Boolean)),
        );
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === id ? { ...m, folderPaths: normalized } : m,
          ),
        }));
      },

      addFolderPath: (id, folderPath) => {
        const norm = normalizeFolder(folderPath);
        if (!norm) return;
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === id && !m.folderPaths.includes(norm)
              ? { ...m, folderPaths: [...m.folderPaths, norm] }
              : m,
          ),
        }));
      },

      removeFolderPath: (id, folderPath) => {
        const norm = normalizeFolder(folderPath);
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === id
              ? { ...m, folderPaths: m.folderPaths.filter((f) => f !== norm) }
              : m,
          ),
        }));
      },

      addMailFolderPath: (id, mailFolderKey) => {
        const key = mailFolderKey.trim();
        if (!key) return;
        set((state) => ({
          matters: state.matters.map((m) => {
            if (m.id !== id) return m;
            const existing = m.mailFolderPaths ?? [];
            if (existing.includes(key)) return m;
            return { ...m, mailFolderPaths: [...existing, key] };
          }),
        }));
      },

      removeMailFolderPath: (id, mailFolderKey) => {
        const key = mailFolderKey.trim();
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === id
              ? { ...m, mailFolderPaths: (m.mailFolderPaths ?? []).filter((k) => k !== key) }
              : m,
          ),
        }));
      },

      setMatterPrivileged: (id, privileged) => {
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === id ? { ...m, privileged } : m,
          ),
        }));
      },

      setActiveMatter: (id) => {
        set({ activeMatterId: id });
      },

      linkFirmMatter: (id, { firmMatterId, orgId, role }) => {
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === id
              ? { ...m, firmMatterId, orgId, role, shared: true }
              : m,
          ),
        }));
      },

      unlinkFirmMatter: (id) => {
        set((state) => ({
          matters: state.matters.map((m): Matter => {
            if (m.id !== id) return m;
            // Use destructuring to drop the optional fields
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { firmMatterId: _a, orgId: _b, role: _c, ...rest } = m;
            return { ...rest, shared: false };
          }),
        }));
      },

      setMatterRole: (id, role) => {
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === id ? { ...m, role } : m,
          ),
        }));
      },
    }),
    {
      name: 'keepance:matters',
      version: 4,
      // v1 -> v2: matters gained `mailFolderPaths`. v2 -> v3: matters gained the
      // `privileged` flag. v3 -> v4: matters gained firm linkage fields
      // (firmMatterId, orgId, role, shared). Backfill defaults so older persisted
      // matters parse cleanly (missing values are tolerated by readers, but
      // normalising here keeps the shape consistent).
      migrate: (persisted, version) => {
        const state = persisted as Partial<MatterState> | undefined;
        if (!state || !Array.isArray(state.matters)) return state as MatterState;
        if (version < 2) {
          state.matters = state.matters.map((m) => ({
            ...m,
            mailFolderPaths: m.mailFolderPaths ?? [],
          }));
        }
        if (version < 3) {
          state.matters = state.matters.map((m) => ({
            ...m,
            privileged: m.privileged ?? false,
          }));
        }
        if (version < 4) {
          // Firm linkage fields are optional — missing values are treated as
          // undefined (local-only). Guard against stale `shared: true` without
          // `firmMatterId` by normalising shared to false when firmMatterId is absent.
          state.matters = state.matters.map((m) => {
            if (!m.firmMatterId) {
              // Drop any stale shared flag; don't set other firm fields.
              const { shared: _shared, ...rest } = m;
              return { ...rest, shared: false };
            }
            return { ...m, shared: m.shared ?? false };
          });
        }
        return state as MatterState;
      },
      partialize: (state) => ({
        // `matters` carries `privileged` per matter, so the privileged
        // designation persists across reloads.
        matters: state.matters,
        activeMatterId: state.activeMatterId,
      }),
    },
  ),
);

// ─────────────────────────────────────────────────────────────────────
// Non-reactive accessors (for the indexer hook and event listeners)
// ─────────────────────────────────────────────────────────────────────

/** Current matters list, read without subscribing. */
export function getMatters(): Matter[] {
  return useMatterStore.getState().matters;
}

/** Current active matter id (or null), read without subscribing. */
export function getActiveMatterId(): string | null {
  return useMatterStore.getState().activeMatterId;
}

/**
 * True when the ACTIVE matter is tagged privileged, read without subscribing.
 * The all-matters scope (no active matter) is not itself privileged. Used by
 * the non-reactive Privileged Matter Mode resolver (e.g. the bridge gate).
 */
export function isActiveMatterPrivileged(): boolean {
  const { matters, activeMatterId } = useMatterStore.getState();
  if (!activeMatterId) return false;
  return !!findMatter(activeMatterId, matters)?.privileged;
}

/**
 * Resolve a file path (or `mail:` id) to its matter id using the current
 * store contents. Returns the `unassigned` sentinel when nothing matches.
 * This is the function the indexer passes to the RAG index commands.
 */
export function resolveMatterIdForPath(path: string): string {
  return resolveMatterId(path, useMatterStore.getState().matters);
}

/**
 * Build the retrieval scope from the active matter. `null` active matter
 * means the explicit cross-matter (`allMatters`) scope. There is never a
 * silent "search everything" — this function makes the choice explicit.
 */
export function getActiveScope(): MatterScope {
  const id = useMatterStore.getState().activeMatterId;
  return id ? { kind: 'matter', matterId: id } : { kind: 'allMatters' };
}

// ─────────────────────────────────────────────────────────────────────
// Reactive selectors
// ─────────────────────────────────────────────────────────────────────

/** Subscribe to the list of matters. */
export function useMatters(): Matter[] {
  return useMatterStore((s) => s.matters);
}

/** Subscribe to the active matter id (or null). */
export function useActiveMatterId(): string | null {
  return useMatterStore((s) => s.activeMatterId);
}

/**
 * Subscribe to the active Matter object (or null when on the all-matters
 * scope, or when the active id no longer resolves to a known matter).
 */
export function useActiveMatter(): Matter | null {
  return useMatterStore(
    useShallow((s) => findMatter(s.activeMatterId, s.matters) ?? null),
  );
}

/**
 * Subscribe to whether the active matter is tagged privileged. Drives the
 * auto-on behaviour of Privileged Matter Mode.
 */
export function useActiveMatterPrivileged(): boolean {
  return useMatterStore((s) => !!findMatter(s.activeMatterId, s.matters)?.privileged);
}

/**
 * Subscribe to the active scope object. Returns a fresh object on each call,
 * so we use a shallow selector to keep the snapshot stable.
 */
export function useActiveScope(): MatterScope {
  return useMatterStore(
    useShallow((s): MatterScope =>
      s.activeMatterId
        ? { kind: 'matter', matterId: s.activeMatterId }
        : { kind: 'allMatters' },
    ),
  );
}
