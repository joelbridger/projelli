/**
 * Matter store (WS-B/C app) — Zustand + persist.
 *
 * The single source of truth for matter state. It carries FOUR slices that used
 * to be four separate stores (merged 2026-06-17 for the 3.0 reorg):
 *   1. matters     — the user's matters + the active matter (persisted under
 *                    `keepance:matters`). One client matter = one confidentiality
 *                    boundary, mapped to one or more workspace folders.
 *   2. snapshots   — per-matter UI working-surface memory (persisted under
 *                    `keepance:matter-ui-snapshots`).
 *   3. cache       — AI at-a-glance summary cache (persisted under
 *                    `keepance:matter-at-a-glance`).
 *   4. statusByMatterId — live per-matter sync status; EPHEMERAL, never persisted.
 *
 * Persistence preserves all three legacy localStorage keys byte-compatibly via a
 * custom multi-key `storage` adapter (Zustand `persist` is one-key-per-store, so
 * partialize alone cannot keep three keys — see `multiKeyMatterStorage` below and
 * the hydration contract in `tests/unit/matter/matterStoreMerge.test.ts`).
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
 *
 * The legacy hook names (`useMatterUiStore`, `useMatterSyncStore`,
 * `useMatterAtAGlanceStore`) remain importable from their original module paths
 * as thin aliases to `useMatterStore` (see those files) so importers are
 * unchanged; they will be folded away in the feature-folder migration.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { Matter, MatterScope } from '@/types/matter';
import { resolveMatterId, findMatter } from '@/platform/rag/matterResolver';
import { getProfession } from '@/platform/profile/professionStore';
import { getSampleMatterName } from '@/onboarding/samples/sampleMatterDemo';
import type { MatterUiSnapshot } from '@/platform/matter/matterUiStore';
import type { MatterAtAGlanceEntry } from '@/platform/matter/matterAtAGlanceStore';
import type { MatterSyncStatus } from '@/platform/matter/matterSyncStore';
import type { MatterAtAGlanceResult } from '@/features/matters/logic/matterAtAGlance';

/**
 * Stable id for the built-in sample matter ("Garcia v. Meridian Properties LLC").
 * Exported so `sampleMatterDemo.ts` and UI code share the same constant without
 * importing the full store.
 */
export const SAMPLE_MATTER_ID = 'matter_sample_garcia_v_meridian';

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
  /** Mark this as the built-in sample matter seeded during onboarding. */
  isSample?: boolean;
  /** Optionally supply a deterministic id (used for the sample matter). */
  id?: string;
}

interface MatterState {
  // ── matters slice (persisted → keepance:matters) ──────────────────────────
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

  // ── UI slice (persisted → keepance:matter-ui-snapshots) ───────────────────
  /** Per-matter memory of the last working surface + focused tab. */
  snapshots: Record<string, MatterUiSnapshot>;
  saveSnapshot: (matterId: string, snapshot: MatterUiSnapshot) => void;
  getSnapshot: (matterId: string) => MatterUiSnapshot | undefined;
  clearSnapshot: (matterId: string) => void;

  // ── At-a-glance slice (persisted → keepance:matter-at-a-glance) ───────────
  /** AI-generated at-a-glance summaries, keyed by matter id. */
  cache: Record<string, MatterAtAGlanceEntry>;
  setEntry: (matterId: string, result: MatterAtAGlanceResult) => void;
  getEntry: (matterId: string) => MatterAtAGlanceEntry | undefined;
  invalidate: (matterId: string) => void;
  clearAll: () => void;

  // ── Sync slice (EPHEMERAL — never persisted) ──────────────────────────────
  /** Live sync status keyed by LOCAL matter id (not firmMatterId). */
  statusByMatterId: Record<string, MatterSyncStatus>;
  setStatus: (matterId: string, status: MatterSyncStatus) => void;
  clearMatter: (matterId: string) => void;
  clear: () => void;
}

// ─────────────────────────────────────────────────────────────────────
// Multi-key persistence
// ─────────────────────────────────────────────────────────────────────

/** The persisted shape — what `partialize` emits and the storage adapter splits. */
interface PersistedMatterState {
  matters: Matter[];
  activeMatterId: string | null;
  snapshots: Record<string, MatterUiSnapshot>;
  cache: Record<string, MatterAtAGlanceEntry>;
}

const MATTERS_KEY = 'keepance:matters';
const UI_KEY = 'keepance:matter-ui-snapshots';
const GLANCE_KEY = 'keepance:matter-at-a-glance';
const MATTERS_VERSION = 4;

function readLegacyEnvelope(
  key: string,
): { state?: Record<string, unknown>; version?: number } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as { state?: Record<string, unknown>; version?: number };
  } catch {
    return null;
  }
}

/**
 * Multi-key persistence: this single store fans out to the THREE legacy
 * localStorage keys so existing users' data hydrates and is written back
 * unchanged (plan risk R4 — no key rename, no destructive migration).
 * `partialize` controls WHAT persists; this storage controls WHERE — splitting
 * the partialized state into the three keys on write and reassembling on read.
 * The sync slice is never partialized, so it never reaches here.
 */
const multiKeyMatterStorage: PersistStorage<PersistedMatterState> = {
  getItem: (): StorageValue<PersistedMatterState> | null => {
    const matters = readLegacyEnvelope(MATTERS_KEY);
    const ui = readLegacyEnvelope(UI_KEY);
    const glance = readLegacyEnvelope(GLANCE_KEY);
    if (!matters && !ui && !glance) return null; // fresh user — use store defaults
    const state: PersistedMatterState = {
      matters: (matters?.state?.['matters'] as Matter[] | undefined) ?? [],
      activeMatterId: (matters?.state?.['activeMatterId'] as string | null | undefined) ?? null,
      snapshots: (ui?.state?.['snapshots'] as Record<string, MatterUiSnapshot> | undefined) ?? {},
      cache: (glance?.state?.['cache'] as Record<string, MatterAtAGlanceEntry> | undefined) ?? {},
    };
    // Return the matters key's stored version so `persist` runs the matters
    // migration (v1→v4) when an older user hydrates. The ui/glance slices have
    // never been versioned and carry no migration of their own.
    return { state, version: matters?.version ?? MATTERS_VERSION };
  },
  setItem: (_name, value): void => {
    const { state } = value;
    const version = value.version ?? MATTERS_VERSION;
    try {
      localStorage.setItem(
        MATTERS_KEY,
        JSON.stringify({
          state: { matters: state.matters, activeMatterId: state.activeMatterId },
          version,
        }),
      );
      localStorage.setItem(
        UI_KEY,
        JSON.stringify({ state: { snapshots: state.snapshots }, version: 0 }),
      );
      localStorage.setItem(
        GLANCE_KEY,
        JSON.stringify({ state: { cache: state.cache }, version: 0 }),
      );
    } catch {
      /* localStorage may be unavailable (strict privacy mode) */
    }
  },
  removeItem: (): void => {
    try {
      localStorage.removeItem(MATTERS_KEY);
      localStorage.removeItem(UI_KEY);
      localStorage.removeItem(GLANCE_KEY);
    } catch {
      /* ignore */
    }
  },
};

export const useMatterStore = create<MatterState>()(
  persist(
    (set, get) => ({
      matters: [],
      activeMatterId: null,

      createMatter: (input) => {
        const matter: Matter = {
          id: input.id ?? newMatterId(),
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
          ...(input.isSample ? { isSample: true } : {}),
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

      // ── UI slice ────────────────────────────────────────────────────────
      snapshots: {},
      saveSnapshot: (matterId, snapshot) => {
        set((state) => ({ snapshots: { ...state.snapshots, [matterId]: snapshot } }));
      },
      getSnapshot: (matterId) => get().snapshots[matterId],
      clearSnapshot: (matterId) => {
        set((state) => {
          if (!(matterId in state.snapshots)) return state;
          const next = { ...state.snapshots };
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete next[matterId];
          return { snapshots: next };
        });
      },

      // ── At-a-glance slice ────────────────────────────────────────────────
      cache: {},
      setEntry: (matterId, result) => {
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
      getEntry: (matterId) => get().cache[matterId],
      invalidate: (matterId) => {
        set((state) => {
          const next = { ...state.cache };
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete next[matterId];
          return { cache: next };
        });
      },
      clearAll: () => {
        set({ cache: {} });
      },

      // ── Sync slice (ephemeral) ───────────────────────────────────────────
      statusByMatterId: {},
      setStatus: (matterId, status) =>
        set((state) => ({
          statusByMatterId: { ...state.statusByMatterId, [matterId]: status },
        })),
      clearMatter: (matterId) =>
        set((state) => {
          const next = { ...state.statusByMatterId };
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete next[matterId];
          return { statusByMatterId: next };
        }),
      clear: () => set({ statusByMatterId: {} }),
    }),
    {
      name: 'keepance:matters',
      version: MATTERS_VERSION,
      storage: multiKeyMatterStorage,
      // v1 -> v2: matters gained `mailFolderPaths`. v2 -> v3: matters gained the
      // `privileged` flag. v3 -> v4: matters gained firm linkage fields
      // (firmMatterId, orgId, role, shared). Backfill defaults so older persisted
      // matters parse cleanly (missing values are tolerated by readers, but
      // normalising here keeps the shape consistent). Only the `matters` slice is
      // versioned; the snapshots/cache slices pass through untouched.
      migrate: (persisted, version) => {
        const state = persisted as Partial<PersistedMatterState> | undefined;
        if (!state || !Array.isArray(state.matters)) return state as PersistedMatterState;
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
        return state as PersistedMatterState;
      },
      partialize: (state) => ({
        // `matters` carries `privileged` per matter, so the privileged
        // designation persists across reloads. snapshots + cache persist to their
        // own legacy keys via the multi-key storage; statusByMatterId is
        // intentionally omitted (ephemeral live-sync signal).
        matters: state.matters,
        activeMatterId: state.activeMatterId,
        snapshots: state.snapshots,
        cache: state.cache,
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
 * Return the sample matter if it already exists in the store, or create it now.
 * The matter name is chosen based on the active profession so a tax preparer
 * sees "Dwyer - 2025 Form 1040" and a consultant sees "Northwind - Go-to-Market
 * Engagement" instead of the legal default.
 *
 * The matter is linked to `workspaceRoot` so RAG retrieval later scopes to the
 * right folder.
 *
 * This is NOT called automatically -- the onboarding flow wires it at the right
 * moment (after sample files have been written).
 *
 * @param workspaceRoot  Absolute path to the user's workspace root; the sample
 *                       files live directly inside this folder.
 */
export function getOrCreateSampleMatter(workspaceRoot: string): Matter {
  const { matters, createMatter } = useMatterStore.getState();
  const existing = findMatter(SAMPLE_MATTER_ID, matters);
  if (existing) return existing;
  const profession = getProfession();
  const name = getSampleMatterName(profession);
  // Derive a sensible client name from the matter name: the part before the
  // first dash or hyphen, trimmed. Keeps the client label short and readable.
  const client = name.split(/\s*[-–]\s*/)[0]?.trim() ?? name;
  return createMatter({
    id: SAMPLE_MATTER_ID,
    name,
    client,
    folderPaths: [workspaceRoot],
    isSample: true,
  });
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
