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
import type { Matter, MatterScope } from '@/platform/types/matter';
import type { AuditEntry } from '@/platform/types/audit';
import { resolveMatterId, findMatter, normalize as normalizeMatterPath } from '@/platform/rag/matterResolver';
import { ragDeleteMatter } from '@/platform/utils/tauri-commands';
import { mailClearMatterFilings } from '@/platform/utils/mail-commands';
import { auditEventToEntry } from '@/platform/audit/AuditService';
import { getProfession } from '@/platform/profile/professionStore';
import { getSampleMatterName } from '@/platform/matter/samples/sampleMatterDemo';
import type { MatterUiSnapshot } from '@/platform/matter/matterUiStore';
import type { MatterAtAGlanceEntry } from '@/platform/matter/matterAtAGlanceStore';
import type { MatterSyncStatus } from '@/platform/matter/matterSyncStore';
import type { MatterAtAGlanceResult } from '@/platform/matter/matterAtAGlance';

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

/** Normalise and dedupe folder paths with the same rules the resolver uses. */
function dedupeFolderPaths(paths: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const normalized = normalizeMatterPath(path);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export interface CreateMatterInput {
  name: string;
  client: string;
  folderPaths?: string[];
  mailFolderPaths?: string[];
  /** Wealthbox household IDs to link at creation time. */
  crmHouseholdKeys?: string[];
  /** Mark this matter's display name/client as CRM-derived (e.g. created purely
   *  from a Wealthbox household), so a Wealthbox disconnect can scrub it. */
  createdFromCrm?: boolean;
  /** Mark the matter privileged at creation time (defaults to false). */
  privileged?: boolean;
  /** Explicitly grant external AI tools (MCP) access at creation time. Defaults to false. */
  mcpAccessGranted?: boolean;
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

  // Wealthbox CRM household mapping.
  addCrmHouseholdKey: (id: string, householdId: string) => void;
  removeCrmHouseholdKey: (id: string, householdId: string) => void;
  /**
   * Remove every trace of Wealthbox from local matters after a disconnect:
   *   - pure-CRM matters (no user files/mail) are deleted;
   *   - CRM-created matters the user has since added content to keep their content
   *     but have their imported name/client scrubbed to a neutral value and CRM
   *     origin cleared;
   *   - user matters merely linked to a household just lose the household keys.
   * The at-a-glance cache is invalidated for every affected matter (its summary
   * may have been built from Wealthbox data). Returns affected matter ids.
   */
  scrubWealthboxFromMatters: () => string[];

  // Privileged Matter Mode: per-matter privileged designation. When the active
  // matter is privileged, network plugins + MCP are disabled (see
  // `modules/privacy/privilegedMatterMode`).
  setMatterPrivileged: (id: string, privileged: boolean) => void;
  /** Explicit per-matter grant for external AI tools connected through MCP. */
  setMatterMcpAccess: (id: string, granted: boolean) => void;

  // Archive / restore. Archiving hides a matter from the active list + scope
  // picker without deleting it (folders/mail/index are preserved). Archiving the
  // ACTIVE matter clears the active selection (falls back to all-matters scope).
  setMatterArchived: (id: string, archived: boolean) => void;

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

  // ── Client Map nav slice (EPHEMERAL — never persisted) ────────────────────
  /**
   * newNav: which client's Client Map "hub" (the per-client hero view) is open
   * on the Client Map surface, or null for the all-clients overview. Ephemeral
   * so it survives the MattersHome unmount/remount that a surface switch causes
   * — the back-nav fix (drill into Documents/Email and return to Client Map and
   * you land back on the same client's hub, not the overview). Only honored when
   * it === activeMatterId, so a stale id left over from a client switch falls
   * back to the overview rather than showing the wrong client.
   */
  clientMapHubId: string | null;
  setClientMapHubId: (id: string | null) => void;
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
const MATTERS_VERSION = 6;

type MatterAuditEmitter = (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;

/**
 * The matter store is not a React component, but MCP access changes still need
 * to reach the app's live Activity Log. App registers its main audit emitter
 * here, mirroring the existing active WorkspaceService accessor pattern.
 */
let activeMatterAuditEmitter: MatterAuditEmitter | null = null;

export function setMatterAuditEmitter(emitter: MatterAuditEmitter | null): void {
  activeMatterAuditEmitter = emitter;
}

function auditMatterMcpAccess(matter: Matter, granted: boolean): void {
  activeMatterAuditEmitter?.(auditEventToEntry({
    type: granted ? 'mcp_matter_access_granted' : 'mcp_matter_access_revoked',
    timestamp: new Date().toISOString(),
    payload: {
      matterId: matter.id,
      matterName: matter.name || matter.client || matter.id,
      detail: granted
        ? 'external AI tools can read this matter through MCP'
        : 'external AI tools can no longer read this matter through MCP',
    },
  }));
}

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
          folderPaths: dedupeFolderPaths(input.folderPaths ?? []),
          mailFolderPaths: Array.from(new Set((input.mailFolderPaths ?? []).filter(Boolean))),
          crmHouseholdKeys: Array.from(new Set((input.crmHouseholdKeys ?? []).filter(Boolean))),
          privileged: input.privileged ?? false,
          mcpAccessGranted: input.mcpAccessGranted ?? false,
          createdAt: new Date().toISOString(),
          ...(input.createdFromCrm ? { createdFromCrm: true } : {}),
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
        set((state) => {
          // Also drop every per-matter slice so a deleted matter leaves no
          // orphaned persisted state behind (stale at-a-glance AI cache, saved
          // UI snapshot, or sync status that would resurface under a recycled id).
          const snapshots = { ...state.snapshots };
          const cache = { ...state.cache };
          const statusByMatterId = { ...state.statusByMatterId };
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete snapshots[id];
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete cache[id];
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete statusByMatterId[id];
          return {
            matters: state.matters.filter((m) => m.id !== id),
            // If the deleted matter was active, fall back to the all-matters scope.
            activeMatterId: state.activeMatterId === id ? null : state.activeMatterId,
            // Close its Client Map hub so a recycled id can't reopen it.
            clientMapHubId: state.clientMapHubId === id ? null : state.clientMapHubId,
            snapshots,
            cache,
            statusByMatterId,
          };
        });
        // Matter-delete semantics (BUG-042, product decision 2026-06-21):
        // delete REMOVES the matter and its grouping + wipes the AI's memory of
        // it, but KEEPS the user's actual files on disk. (Archive is the
        // "hide but keep everything" path; delete is the more final one that
        // never destroys documents — a law practice has retention duties.)
        //
        // To make "wipe from the AI" honest we clear the two durable AI-side
        // traces of the matter, both best-effort + fire-and-forget (no-op
        // outside Tauri, never blocks the delete):
        //   1. The matter's CURRENT RAG chunks (so they stop surfacing under the
        //      now-gone scope). BUG-040. A later re-index of the files re-adds
        //      them as 'unassigned' — correct, because the files are still the
        //      user's and still in the workspace.
        //   2. Every email's durable per-message "filed to this matter" override
        //      (BUG-042). Without this, the next mail sync re-tags those emails
        //      with a matter id that no longer exists (a phantom). They're set to
        //      an explicit "unassigned" tombstone (NOT just deleted) so they
        //      become unassigned and are NEVER silently absorbed into the matter
        //      their folder happens to map to — content filed to one matter must
        //      never cross into another (legal invariant; Codex review #1).
        // To make content truly disappear the user deletes the files themselves.
        void ragDeleteMatter(id).catch((err: unknown) => {
          console.warn('[matterStore] rag purge for deleted matter failed:', err);
        });
        void mailClearMatterFilings(id).catch((err: unknown) => {
          console.warn('[matterStore] mail filing purge for deleted matter failed:', err);
        });
      },

      setFolderPaths: (id, folderPaths) => {
        const normalized = dedupeFolderPaths(folderPaths);
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === id ? { ...m, folderPaths: normalized } : m,
          ),
        }));
      },

      addFolderPath: (id, folderPath) => {
        const norm = normalizeMatterPath(folderPath);
        if (!norm) return;
        set((state) => ({
          matters: state.matters.map((m) => {
            if (m.id !== id) return m;
            return { ...m, folderPaths: dedupeFolderPaths([...m.folderPaths, norm]) };
          }),
        }));
      },

      removeFolderPath: (id, folderPath) => {
        const norm = normalizeMatterPath(folderPath);
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === id
              ? { ...m, folderPaths: m.folderPaths.filter((f) => normalizeMatterPath(f) !== norm) }
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

      addCrmHouseholdKey: (id, householdId) => {
        const key = householdId.trim();
        if (!key) return;
        set((state) => ({
          matters: state.matters.map((m) => {
            if (m.id === id) {
              // Add to the target matter (dedup within it).
              const existing = m.crmHouseholdKeys ?? [];
              return existing.includes(key)
                ? m
                : { ...m, crmHouseholdKeys: [...existing, key] };
            }
            // A household belongs to exactly ONE matter: remove this key from every
            // OTHER matter so re-linking it never leaves it claimed by — and re-indexed
            // + orphaned under — its previous matter. (Pairs with the backend orphan
            // cleanup that purges the old matter's now-stale CRM chunks on next sync.)
            const others = m.crmHouseholdKeys ?? [];
            return others.includes(key)
              ? { ...m, crmHouseholdKeys: others.filter((k) => k !== key) }
              : m;
          }),
        }));
      },

      removeCrmHouseholdKey: (id, householdId) => {
        const key = householdId.trim();
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === id
              ? { ...m, crmHouseholdKeys: (m.crmHouseholdKeys ?? []).filter((k) => k !== key) }
              : m,
          ),
        }));
      },

      scrubWealthboxFromMatters: () => {
        const { matters, deleteMatter, invalidate } = get();
        const affected: string[] = [];
        const toDelete: string[] = [];
        const toScrub: string[] = []; // CRM-created matters the user added content to
        const toUnlink: string[] = []; // user matters merely linked to a household
        for (const m of matters) {
          const keys = m.crmHouseholdKeys ?? [];
          if (keys.length === 0) continue;
          affected.push(m.id);
          const hasContent = m.folderPaths.length > 0 || (m.mailFolderPaths ?? []).length > 0;
          if (!hasContent) {
            toDelete.push(m.id);
          } else if (m.createdFromCrm) {
            toScrub.push(m.id);
          } else {
            toUnlink.push(m.id);
          }
        }
        // Scrub imported name/client + unlink keys (and unlink the linked-only
        // matters) in a single update. A scrubbed CRM-created matter takes a
        // neutral, user-derived name from its first folder so no Wealthbox-derived
        // identity persists; its content is untouched.
        const scrubSet = new Set(toScrub);
        const unlinkSet = new Set(toUnlink);
        if (scrubSet.size > 0 || unlinkSet.size > 0) {
          set((state) => ({
            matters: state.matters.map((m) => {
              if (scrubSet.has(m.id)) {
                const firstFolder = m.folderPaths[0];
                const base = (firstFolder
                  ? firstFolder.split(/[\\/]/).filter(Boolean).pop() ?? ''
                  : '').trim();
                const scrubbedName = base || 'Untitled client';
                return {
                  ...m,
                  name: scrubbedName,
                  client: scrubbedName,
                  crmHouseholdKeys: [],
                  createdFromCrm: false,
                };
              }
              if (unlinkSet.has(m.id)) {
                return { ...m, crmHouseholdKeys: [] };
              }
              return m;
            }),
          }));
        }
        // Delete pure-CRM matters last (deleteMatter also purges their RAG chunks,
        // mail filings, at-a-glance cache, snapshot, and clears the active matter).
        for (const id of toDelete) deleteMatter(id);
        // Invalidate the at-a-glance cache for kept (scrubbed/unlinked) matters —
        // their cached summary may have been computed from Wealthbox data.
        for (const id of toScrub) invalidate(id);
        for (const id of toUnlink) invalidate(id);
        return affected;
      },

      setMatterPrivileged: (id, privileged) => {
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === id ? { ...m, privileged } : m,
          ),
        }));
      },

      setMatterMcpAccess: (id, granted) => {
        const matter = findMatter(id, get().matters);
        if (!matter || !!matter.mcpAccessGranted === granted) return;
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === id ? { ...m, mcpAccessGranted: granted } : m,
          ),
        }));
        auditMatterMcpAccess(matter, granted);
      },

      setMatterArchived: (id, archived) => {
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === id ? { ...m, archived } : m,
          ),
          // Don't leave the active scope pointing at a just-archived matter —
          // fall back to the explicit all-matters scope (same as deleteMatter).
          activeMatterId:
            archived && state.activeMatterId === id ? null : state.activeMatterId,
          // Close its Client Map hub too, so it can't resurface on archive.
          clientMapHubId:
            archived && state.clientMapHubId === id ? null : state.clientMapHubId,
        }));
      },

      setActiveMatter: (id) => {
        // Never activate a missing or archived matter. Doing so would scope AI
        // retrieval to a hidden matter while the scope picker (which only lists
        // non-archived matters) shows "All matters" — a confidentiality hazard
        // in a legal app where the active scope must be obvious. A stale
        // matter-launch event or old persisted id falls back to all-matters.
        set((state) => {
          const nextActive = id === null
            ? null
            : (() => { const m = findMatter(id, state.matters); return m && !m.archived ? id : null; })();
          // Close a Client Map hub the moment the active client changes AWAY from
          // it, so re-selecting the old client later (via the rail switcher) does
          // not resurrect its hub. Re-setting the SAME id (e.g. a matter-launch
          // into the client's Documents) keeps the hub open — that's the back-nav
          // case. openHub() always setActiveMatter() then setClientMapHubId(),
          // so opening a fresh hub still lands correctly.
          const clientMapHubId =
            nextActive !== null && nextActive === state.clientMapHubId
              ? state.clientMapHubId
              : null;
          return { activeMatterId: nextActive, clientMapHubId };
        });
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

      // ── Client Map nav slice (ephemeral) ─────────────────────────────────
      clientMapHubId: null,
      setClientMapHubId: (id) => set({ clientMapHubId: id }),
    }),
    {
      name: 'keepance:matters',
      version: MATTERS_VERSION,
      storage: multiKeyMatterStorage,
      // v1 -> v2: matters gained `mailFolderPaths`. v2 -> v3: matters gained the
      // `privileged` flag. v3 -> v4: matters gained firm linkage fields
      // (firmMatterId, orgId, role, shared). v4 -> v5: matters gained the
      // explicit MCP access grant. v5 -> v6: matters gained `crmHouseholdKeys`
      // for the Wealthbox connector. Backfill defaults so older persisted matters
      // parse cleanly (missing values are tolerated by readers, but normalising
      // here keeps the shape consistent). Only the `matters` slice is versioned;
      // the snapshots/cache slices pass through untouched.
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
        if (version < 5) {
          state.matters = state.matters.map((m) => ({
            ...m,
            mcpAccessGranted: m.mcpAccessGranted ?? false,
          }));
        }
        if (version < 6) {
          // v5 -> v6: matters gained `crmHouseholdKeys` for the Wealthbox
          // connector. Backfill an empty array so older persisted matters parse
          // cleanly; a missing value on disk is treated as an empty list.
          state.matters = state.matters.map((m) => ({
            ...m,
            crmHouseholdKeys: m.crmHouseholdKeys ?? [],
          }));
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
/**
 * The active matter ONLY when it exists and is NOT archived. A stale (deleted)
 * or archived `activeMatterId` resolves to `null`, so no retrieval path can
 * silently scope to a hidden matter while the scope picker (which lists only
 * non-archived matters) shows "All matters". This is the single source every
 * active-matter helper and scope getter funnels through.
 */
export function resolveActiveMatter(
  matters: Matter[],
  activeMatterId: string | null,
): Matter | null {
  const m = findMatter(activeMatterId, matters);
  return m && !m.archived ? m : null;
}

export function getActiveScope(): MatterScope {
  const { activeMatterId, matters } = useMatterStore.getState();
  const m = resolveActiveMatter(matters, activeMatterId);
  return m ? { kind: 'matter', matterId: m.id } : { kind: 'allMatters' };
}

// ─────────────────────────────────────────────────────────────────────
// Reactive selectors
// ─────────────────────────────────────────────────────────────────────

/** Subscribe to the FULL list of matters (incl. archived). RAG path resolution
 *  and any "everything" view must use this so archived matters still resolve. */
export function useMatters(): Matter[] {
  return useMatterStore((s) => s.matters);
}

/** Subscribe to the non-archived matters — the day-to-day list the matter
 *  manager and chat scope picker show by default. */
export function useActiveMatters(): Matter[] {
  return useMatterStore(useShallow((s) => s.matters.filter((m) => !m.archived)));
}

/** Subscribe to the archived matters (for a "show archived" / restore view). */
export function useArchivedMatters(): Matter[] {
  return useMatterStore(useShallow((s) => s.matters.filter((m) => m.archived)));
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
    // Archived/stale active ids resolve to null so AI/search paths that read
    // this hook (Quick Ask, Email Ask) never scope to a hidden matter.
    useShallow((s) => resolveActiveMatter(s.matters, s.activeMatterId)),
  );
}

/**
 * Subscribe to whether the active matter is tagged privileged. Drives the
 * auto-on behaviour of Privileged Matter Mode.
 */
export function useActiveMatterPrivileged(): boolean {
  return useMatterStore((s) => !!resolveActiveMatter(s.matters, s.activeMatterId)?.privileged);
}

/**
 * Subscribe to the active scope object. Returns a fresh object on each call,
 * so we use a shallow selector to keep the snapshot stable.
 */
export function useActiveScope(): MatterScope {
  return useMatterStore(
    useShallow((s): MatterScope => {
      const m = resolveActiveMatter(s.matters, s.activeMatterId);
      return m ? { kind: 'matter', matterId: m.id } : { kind: 'allMatters' };
    }),
  );
}
