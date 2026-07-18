/**
 * Matter store (WS-B/C app) — Zustand + persist.
 *
 * The single source of truth for matter state. It carries FOUR slices that used
 * to be four separate stores (merged 2026-06-17 for the 3.0 reorg):
 *   1. matters     — the user's matters + the active matter (persisted under
 *                    `lantern:matters`). One client matter = one confidentiality
 *                    boundary, mapped to one or more workspace folders.
 *   2. snapshots   — per-matter UI working-surface memory (persisted under
 *                    `lantern:matter-ui-snapshots`).
 *   3. cache       — AI at-a-glance summary cache (persisted under
 *                    `lantern:matter-at-a-glance`).
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
import {
  resolveMatterId,
  resolveMatterMatchAcrossForms,
  findMatter,
  normalize as normalizeMatterPath,
  normalizeMeetingKey,
  isPathInFolder,
  type MatterMatch,
} from '@/platform/rag/matterResolver';
import { isAbsolutePath, joinWorkspacePath } from '@/platform/fs/appPath';
import {
  workspaceScopeSuffix,
  workspaceScopeId,
  getActiveWorkspaceScopeRoot,
} from '@/platform/state/workspaceScope';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { getActiveWorkspaceService } from '@/platform/fs/activeWorkspaceService';
import { requestNativeNetworkLockdown } from '@/platform/privacy/nativeNetworkLockdownBridge';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import {
  readMattersWorkspaceFile,
  writeMattersWorkspaceFile,
  backupCorruptMattersWorkspaceFile,
} from '@/platform/matter/matterWorkspaceFile';
import {
  purgeDeletedMatterForWorkspace,
  usePendingDeletedMatterStore,
} from '@/platform/rag/pendingDeletedMatterStore';
import { ragDeleteMatter } from '@/platform/utils/tauri-commands';
import { mailClearMatterFilings } from '@/platform/utils/mail-commands';
import { auditEventToEntry } from '@/platform/audit/AuditService';
import { getProfession } from '@/platform/profile/professionStore';
import { getSampleMatterName } from '@/platform/matter/samples/sampleMatterDemo';
import { useClientGroupStore } from '@/platform/matter/clientGroupStore';
import type { MatterUiSnapshot } from '@/platform/matter/matterUiStore';
import {
  readSelectionPersistenceHint,
  rehydrateSelectionFromData,
  selectionWriterRetirementEnabled,
} from '@/platform/client-context/selectionWriterBridge';
import type {
  PersistedSelectionHint,
  RehydratedSelectionInput,
} from '@/platform/client-context/selectionTypes';
import { readSelectionOperationDecision } from '@/platform/client-context/selectionReader';
import type { MatterAtAGlanceEntry } from '@/platform/matter/matterAtAGlanceStore';
import type { MatterSyncStatus } from '@/platform/matter/matterSyncStore';
import type { MatterAtAGlanceResult } from '@/platform/matter/matterAtAGlance';
import { SK_MATTERS, SK_MATTER_UI_SNAPSHOTS, SK_MATTER_AT_A_GLANCE } from '@/config/identity';

/**
 * Stable id for the built-in sample matter ("Garcia v. Meridian Properties LLC").
 * Exported so `sampleMatterDemo.ts` and UI code share the same constant without
 * importing the full store.
 */
export const SAMPLE_MATTER_ID = 'matter_sample_garcia_v_meridian';

/** The Client Map hub's sub-tabs. A one-shot `clientMapHubTab` request lets the
 *  client-list quick-actions open the hub on a SPECIFIC sub-tab. */
export type ClientMapHubTab = 'overview' | 'onboarding' | 'documents' | 'email' | 'meetings' | 'activity';

/** Generate a stable matter id. Uses crypto.randomUUID when available. */
function newMatterId(): string {
  try {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return `matter_${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through to the Math.random path */
  }
  return `matter_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Coerce a single persisted folderPaths entry to a plain string path, or `null`
 * if it can't be. `Matter.folderPaths` is TYPED `string[]`, but persisted data
 * from an older/buggy write (or a folder-picker object that leaked through) can
 * carry a non-string — an object stringifies to the literal `"[object Object]"`,
 * which then becomes a real garbage folder when used as a create target
 * (2026-07-01 QA: "Creating in [object Object]/"). Pull a `.path`/`.folderPath`
 * off an object shape; skip anything else. Never returns a stringified object.
 */
function coerceFolderPathValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const obj = value as { path?: unknown; folderPath?: unknown };
    if (typeof obj.path === 'string') return obj.path;
    if (typeof obj.folderPath === 'string') return obj.folderPath;
  }
  return null;
}

/**
 * Read the currently-open workspace root without subscribing, tolerating the
 * store not existing yet (defensive only — `useWorkspaceStore` is a plain
 * Zustand store created at module load, so `getState()` never actually
 * throws, but this function runs from the matters store's own `persist`
 * migration, which can fire before `workspaceStore` has finished evaluating
 * in an unusual bundling order).
 */
function getWorkspaceRootNonReactive(): string | null {
  try {
    return useWorkspaceStore.getState().rootPath;
  } catch {
    return null;
  }
}

/**
 * The SINGLE choke-point every `folderPaths` write goes through (`createMatter`,
 * `setFolderPaths`, `addFolderPath`, and the v10 persisted migration below).
 *
 * `Matter.folderPaths` is documented as ABSOLUTE workspace paths — the shape
 * `resolveMatterId`/`isPathInFolder` (matterResolver.ts) assume when comparing
 * a matter's folders directly against a raw absolute file path from the live
 * RAG indexer, with NO workspace-root parameter of their own. A relative entry
 * reaching that comparison silently fails to match ANY real file, which is
 * exactly the bug the CRM auto-backfill caused (bench R17): it sources
 * candidate folders from the file tree's own workspace-RELATIVE node paths
 * (see `crmMatterFolderBackfill.ts`) and used to write them straight into
 * `folderPaths` via `addFolderPath` with no resolution step.
 *
 * This function is the fix: a relative entry is resolved to absolute using the
 * currently-open workspace root (the same non-reactive `useWorkspaceStore`
 * accessor pattern the CRM backfill already uses), so every path landing in
 * `folderPaths` is genuinely absolute whenever a workspace is open — which is
 * true for every live call site (`createMatter`/`setFolderPaths`/
 * `addFolderPath` only ever run while the app has a workspace mounted). With NO
 * workspace root known (e.g. this same function called from the persisted-state
 * `migrate` step, which can run before a workspace has been opened for the
 * session), a relative entry is left relative rather than dropped — it is still
 * a valid, shape-clean string, and gets resolved to absolute the next time the
 * matter's folders are touched with a workspace open.
 *
 * Never returns a stringified object: `coerceFolderPathValue` rejects (and the
 * caller drops) anything that isn't a string or a `{ path }`/`{ folderPath }`
 * shape, so a folder-picker object or other non-string value can never survive
 * into `folderPaths` and later stringify to `"[object Object]"`.
 */
/** Resolve an already-normalized path to absolute under `workspaceRoot` when it
 *  isn't absolute already; a `null` root leaves it relative (nothing to
 *  resolve against). Shared by every function below that needs the identical
 *  "already-absolute passes through, else join root" rule. */
function resolveAbsolute(normalized: string, workspaceRoot: string | null): string {
  if (isAbsolutePath(normalized)) return normalized;
  if (!workspaceRoot) return normalized;
  return normalizeMatterPath(joinWorkspacePath(workspaceRoot, normalized));
}

function canonicalizeFolderPath(value: unknown, workspaceRoot: string | null): string | null {
  const raw = coerceFolderPathValue(value);
  if (raw === null) return null;
  const normalized = normalizeMatterPath(raw);
  if (!normalized) return null;
  return resolveAbsolute(normalized, workspaceRoot);
}

/**
 * Normalise, canonicalize (see `canonicalizeFolderPath`), and dedupe folder
 * paths. Accepts `unknown[]` (not just `string[]`) so it doubles as the
 * runtime sanitiser for persisted/legacy data — the exact same function backs
 * both live writes and the persisted-schema migration below, so there is only
 * ONE place that decides what a valid, canonical `folderPaths` entry looks
 * like.
 */
function dedupeFolderPaths(paths: unknown[], workspaceRoot: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of paths) {
    const canonical = canonicalizeFolderPath(value, workspaceRoot);
    if (canonical === null || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

/**
 * QA-24 (P1) — store-level backstop against two matters silently sharing one
 * folder. `deriveNewClientFolderPath` (matterManagerDialogHelpers.ts) already
 * uniquifies a candidate against the caller's OWN snapshot of `matters`, but
 * that snapshot can be stale: a double/triple-clicked "Create client" button
 * fires its handler multiple times before React re-renders, so every
 * invocation reads the SAME snapshot and independently derives the SAME
 * "free" candidate. The per-call check can never catch that race — only a
 * check against the LIVE store state, made at the moment of the actual write,
 * can. This is that check: it re-verifies every incoming folder path against
 * every OTHER matter's current folder paths and appends a numeric suffix on
 * an exact collision, exactly like the dialog's own derivation does, so
 * `createMatter` guarantees uniqueness however (and from wherever) it's
 * called. An exact match is the only thing guarded against — a candidate
 * NESTED inside another matter's folder (e.g. a per-client folder nested
 * under the sample matter's whole-workspace-root folder) is a deliberate,
 * non-colliding pattern and is left alone (see `deriveNewClientFolderPath`'s
 * containment comment for why nesting itself is fine).
 */
function ensureUniqueFolderPaths(candidatePaths: string[], existingMatters: Matter[]): string[] {
  const taken = new Set(
    existingMatters.flatMap((m) => m.folderPaths).map((p) => p.toLowerCase()),
  );
  const result: string[] = [];
  for (const candidate of candidatePaths) {
    let unique = candidate;
    let n = 2;
    while (taken.has(unique.toLowerCase())) {
      unique = `${candidate} ${String(n)}`;
      n += 1;
    }
    taken.add(unique.toLowerCase());
    result.push(unique);
  }
  return result;
}

/** Index `existing` folderPaths by their normalized form, so a live edit
 *  (`addFolderPath`/`setFolderPaths`) can tell whether an incoming value is
 *  genuinely NEW or just the SAME path being passed through again. */
function buildExistingByNormalized(existing: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of existing) map.set(normalizeMatterPath(e), e);
  return map;
}

/**
 * Resolve a single incoming folder value for a LIVE edit to an existing
 * matter (`addFolderPath`/`setFolderPaths`) — the choke-point that never
 * silently re-binds an entry that was already there.
 *
 * If the incoming value normalizes to something already present in
 * `existingByNormalized`, the EXISTING stored value is returned VERBATIM,
 * never re-derived against `workspaceRoot`. Only a genuinely NEW value (one
 * not already present) gets canonicalized fresh.
 *
 * Why this matters (Codex review #7, F2.3): `addFolderPath`/`setFolderPaths`
 * previously ran the WHOLE resulting array back through `dedupeFolderPaths`,
 * which re-canonicalizes EVERY entry against whatever workspace happens to be
 * open at that exact call — including a matter's OTHER, unrelated,
 * already-stored folders. A matter can legitimately carry a legacy relative
 * entry left over from before this fix shipped (see the "no automatic
 * reconciliation" note below); adding a completely unrelated NEW folder while
 * a DIFFERENT workspace happens to be open must never silently rewrite that
 * old entry to the wrong workspace's absolute path — exactly the
 * cross-workspace mis-binding this whole fix exists to prevent, reappearing
 * through the "add a folder" path instead of an explicit reconciliation step.
 */
function resolveFolderPathEntry(
  value: unknown,
  existingByNormalized: ReadonlyMap<string, string>,
  workspaceRoot: string | null,
): string | null {
  const raw = coerceFolderPathValue(value);
  if (raw === null) return null;
  const normalized = normalizeMatterPath(raw);
  if (!normalized) return null;
  const preserved = existingByNormalized.get(normalized);
  if (preserved !== undefined) return preserved;
  return resolveAbsolute(normalized, workspaceRoot);
}

export interface CreateMatterInput {
  name: string;
  client: string;
  folderPaths?: string[];
  mailFolderPaths?: string[];
  /** Wealthbox household IDs to link at creation time. */
  crmHouseholdKeys?: string[];
  /** OneDrive / SharePoint folder ids to link at creation time. */
  onedriveFolderKeys?: string[];
  /** Box folder ids to link at creation time. */
  boxFolderKeys?: string[];
  /** E-signature record keys to link at creation time. */
  esignKeys?: string[];
  /** Jotform form/submission keys to link at creation time. */
  jotformKeys?: string[];
  /** ShareFile folder ids to link at creation time. */
  sharefileFolderKeys?: string[];
  /** Meeting record keys to link at creation time. */
  meetingKeys?: string[];
  /** Zocks record keys to link at creation time. */
  zocksKeys?: string[];
  /** Addepar record keys to link at creation time. */
  addeparKeys?: string[];
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
  // ── matters slice (persisted → lantern:matters) ──────────────────────────
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

  // OneDrive / SharePoint folder mapping.
  addOneDriveFolderKey: (id: string, folderKey: string) => void;
  // Box folder mapping.
  addBoxFolderKey: (id: string, folderKey: string) => void;
  // ShareFile folder mapping.
  addSharefileFolderKey: (id: string, folderKey: string) => void;
  // Addepar household/account mapping.
  addAddeparKey: (id: string, addeparKey: string) => void;

  /** Teach a calendar/meeting mapping: attach a normalized key (attendee
   *  email, client phrase, or event title) to this matter. A key belongs to
   *  exactly one matter — assigning moves it off any other matter. */
  addMeetingKey: (id: string, key: string) => void;
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
    linkage: {
      firmMatterId: string;
      orgId: string;
      role: 'owner' | 'editor' | 'viewer';
    }
  ) => void;
  /** Unlink a matter from the firm backend (keep local files intact). */
  unlinkFirmMatter: (id: string) => void;
  /** Update the user's role on a shared matter (e.g. after a members/list refresh). */
  setMatterRole: (id: string, role: 'owner' | 'editor' | 'viewer') => void;

  // ── UI slice (persisted → lantern:matter-ui-snapshots) ───────────────────
  /** Per-matter memory of the last working surface + focused tab. */
  snapshots: Record<string, MatterUiSnapshot>;
  saveSnapshot: (matterId: string, snapshot: MatterUiSnapshot) => void;
  getSnapshot: (matterId: string) => MatterUiSnapshot | undefined;
  clearSnapshot: (matterId: string) => void;

  // ── At-a-glance slice (persisted → lantern:matter-at-a-glance) ───────────
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
  /**
   * Ephemeral one-shot request to open a SPECIFIC hub sub-tab when the hub next
   * renders — set by the client-list quick-actions (Documents/Email) so they
   * land on the SCOPED per-client sub-tab instead of a global surface (the
   * cross-client leak fix). MatterHub consumes + clears it. Never persisted.
   */
  clientMapHubTab: ClientMapHubTab | null;
  setClientMapHubTab: (tab: ClientMapHubTab | null) => void;
  /** One-shot request target used when a board row opens a client with several requests. */
  clientMapHubRequestId: string | null;
  setClientMapHubRequestId: (requestId: string | null) => void;

  /**
   * Ephemeral one-shot request to open a SPECIFIC meeting (and seek its
   * transcript to a timestamp) when the Meetings sub-tab next renders — set
   * when a `meeting:<dir>#<ms>` Client Map source link or Activity entry is
   * clicked. ClientMeetingsTab/MeetingEntry consume + clear it. Never persisted.
   */
  pendingMeetingOpen: { meetingDir: string; startMs: number } | null;
  setPendingMeetingOpen: (req: { meetingDir: string; startMs: number } | null) => void;
}

// ─────────────────────────────────────────────────────────────────────
// Multi-key persistence
// ─────────────────────────────────────────────────────────────────────

/** The persisted shape — what `partialize` emits and the storage adapter splits. */
interface PersistedMatterState {
  matters: Matter[];
  activeMatterId: string | null;
  /** Restart input only. The client-context classifier never trusts it as an arm. */
  selectionHint?: PersistedSelectionHint;
  snapshots: Record<string, MatterUiSnapshot>;
  cache: Record<string, MatterAtAGlanceEntry>;
}

// Base (unsuffixed) localStorage keys. When a workspace scope is active these
// gain a `::ws:<id>` suffix (QA-93); the unsuffixed keys are ALSO the legacy
// GLOBAL keys (pre-QA-93 single-store data), which the per-workspace migration
// reads NON-destructively as its source.
const MATTERS_BASE_KEY = SK_MATTERS;
const UI_BASE_KEY = SK_MATTER_UI_SNAPSHOTS;
const GLANCE_BASE_KEY = SK_MATTER_AT_A_GLANCE;
const MATTERS_VERSION = 10;
let pendingSelectionRehydration: RehydratedSelectionInput | null = null;

function selectionRehydrationInput(
  state: Pick<PersistedMatterState, 'activeMatterId' | 'selectionHint'>
): RehydratedSelectionInput {
  return state.selectionHint
    ? { kind: 'persisted-hint', value: state.selectionHint }
    : { kind: 'legacy-follower', activeMatterId: state.activeMatterId };
}

function persistenceHintFields():
  | { selectionHint: PersistedSelectionHint }
  | Record<string, never> {
  const selectionHint = readSelectionPersistenceHint();
  return selectionHint ? { selectionHint } : {};
}

/** The three scoped keys for the currently-active workspace scope (suffix is
 *  `''` — i.e. the legacy global keys — when no workspace scope is set). */
function scopedMatterKeys(): { matters: string; ui: string; glance: string } {
  const suffix = workspaceScopeSuffix();
  return {
    matters: MATTERS_BASE_KEY + suffix,
    ui: UI_BASE_KEY + suffix,
    glance: GLANCE_BASE_KEY + suffix,
  };
}

type MatterAuditEmitter = (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
type MatterAuditEmitterAsync = (
  entry: Omit<AuditEntry, 'id' | 'timestamp'>
) => Promise<AuditEntry>;

/**
 * The matter store is not a React component, but MCP access changes still need
 * to reach the app's live Activity Log. App registers its main audit emitter
 * here, mirroring the existing active WorkspaceService accessor pattern.
 */
let activeMatterAuditEmitter: MatterAuditEmitter | null = null;
let activeMatterAuditEmitterAsync: MatterAuditEmitterAsync | null = null;

export function setMatterAuditEmitter(
  emitter: MatterAuditEmitter | null
): void {
  activeMatterAuditEmitter = emitter;
}

/** Non-reactive accessor so other platform modules (e.g. clientMapStore) can
 *  emit to the live Activity Log without threading a callback prop through. */
export function getMatterAuditEmitter(): MatterAuditEmitter | null {
  return activeMatterAuditEmitter;
}

export function setMatterAuditEmitterAsync(
  emitter: MatterAuditEmitterAsync | null
): void {
  activeMatterAuditEmitterAsync = emitter;
}

export function getMatterAuditEmitterAsync(): MatterAuditEmitterAsync | null {
  return activeMatterAuditEmitterAsync;
}

function auditMatterMcpAccess(matter: Matter, granted: boolean): void {
  activeMatterAuditEmitter?.(
    auditEventToEntry({
      type: granted ? 'mcp_matter_access_granted' : 'mcp_matter_access_revoked',
      timestamp: new Date().toISOString(),
      payload: {
        matterId: matter.id,
        matterName: matter.name || matter.client || matter.id,
        detail: granted
          ? 'external AI tools can read this client through MCP'
          : 'external AI tools can no longer read this client through MCP',
      },
    })
  );
}

/**
 * QA-93 round 3 (Codex F1): when the one-time per-workspace migration drops a
 * matter's UNPROVEN (relative) folder mappings, that must not vanish silently —
 * the advisor sees a folder that quietly stopped auto-filing. One plain-language
 * Activity Log entry per affected matter explains what happened and how to fix
 * it (re-map the folder on the client).
 *
 * Entries are QUEUED, not emitted inline: migration runs synchronously inside
 * the store's rehydrate, BEFORE the lifecycle points the durable audit store at
 * the new workspace — emitting immediately would write the entry into the
 * PREVIOUS workspace's audit log. `useWorkspaceLifecycle` flushes the queue for
 * the opened root right after its audit store hydrates. Entries are tagged with
 * the root that produced them so they can never flush into a different
 * workspace's log.
 */
interface PendingMigrationDropAudit {
  root: string;
  entry: Omit<AuditEntry, 'id' | 'timestamp'>;
}
const pendingMigrationDropAudits: PendingMigrationDropAudit[] = [];
/** Hard cap so a pathological legacy dataset can't grow the queue unbounded. */
const MAX_PENDING_MIGRATION_DROP_AUDITS = 500;
const MIGRATION_DROP_OVERFLOW_EVENT_TYPE = 'matter_migration_folder_link_drop_overflow';

function queueMigrationDropOverflowAudit(root: string): void {
  const existing = pendingMigrationDropAudits.find(
    (p) =>
      p.root === root &&
      p.entry.metadata['auditEventType'] === MIGRATION_DROP_OVERFLOW_EVENT_TYPE,
  );
  const omittedClientCount =
    (existing?.entry.metadata['omittedClientCount'] as number | undefined) ?? 0;
  const nextCount = omittedClientCount + 1;
  const description =
    `${String(nextCount)} more ${nextCount === 1 ? 'client was' : 'clients were'} affected by this workspace setup, ` +
    `but were not listed one by one because the safety log hit its ${String(MAX_PENDING_MIGRATION_DROP_AUDITS)}-client limit. ` +
    `Review client folder links if files seem unassigned.`;

  if (existing) {
    existing.entry.description = description;
    existing.entry.metadata = {
      ...existing.entry.metadata,
      omittedClientCount: nextCount,
    };
    return;
  }

  pendingMigrationDropAudits.push({
    root,
    entry: {
      action: 'user_action',
      description,
      model: undefined,
      inputs: {},
      outputs: {},
      userDecision: 'auto',
      metadata: {
        auditEventType: MIGRATION_DROP_OVERFLOW_EVENT_TYPE,
        omittedClientCount: nextCount,
        workspaceRoot: root,
        individualEntryLimit: MAX_PENDING_MIGRATION_DROP_AUDITS,
      },
    },
  });
}

function queueMigrationDropAudit(
  matter: Matter,
  droppedFolderPaths: string[],
  root: string,
): void {
  const individualEntryCount = pendingMigrationDropAudits.filter(
    (p) => p.entry.metadata['auditEventType'] === 'matter_migration_folder_link_dropped',
  ).length;
  if (individualEntryCount >= MAX_PENDING_MIGRATION_DROP_AUDITS) {
    queueMigrationDropOverflowAudit(root);
    return;
  }
  const clientName = matter.name || matter.client || matter.id;
  const list = droppedFolderPaths.map((p) => `"${p}"`).join(', ');
  const plural = droppedFolderPaths.length > 1;
  pendingMigrationDropAudits.push({
    root,
    entry: {
      action: 'user_action',
      description:
        `While setting up this workspace, ${plural ? `${String(droppedFolderPaths.length)} folder links` : 'a folder link'} ` +
        `for client "${clientName}" (${list}) ${plural ? 'were' : 'was'} not carried over, ` +
        `because ${plural ? 'they' : 'it'} could not be confirmed to belong to this workspace. ` +
        `Files in ${plural ? 'those folders' : 'that folder'} will stay unassigned until you link ${plural ? 'them' : 'it'} to the client again.`,
      model: undefined,
      inputs: {},
      outputs: {},
      userDecision: 'auto',
      metadata: {
        auditEventType: 'matter_migration_folder_link_dropped',
        matterId: matter.id,
        matterName: clientName,
        droppedFolderPaths,
        workspaceRoot: root,
      },
    },
  });
}

/**
 * Deliver the queued migration-drop entries for `root` to the live Activity
 * Log. Called by `useWorkspaceLifecycle` right after the durable audit store
 * has been pointed at the newly-opened workspace. Entries for OTHER roots stay
 * queued (they belong to a workspace whose audit store isn't open); if no
 * emitter is registered yet, everything stays queued for the next flush.
 */
export function flushPendingMatterMigrationAudit(root: string): void {
  if (!activeMatterAuditEmitter) return;
  const toEmit: PendingMigrationDropAudit[] = [];
  const rest: PendingMigrationDropAudit[] = [];
  for (const p of pendingMigrationDropAudits) (p.root === root ? toEmit : rest).push(p);
  if (toEmit.length === 0) return;
  pendingMigrationDropAudits.length = 0;
  pendingMigrationDropAudits.push(...rest);
  for (const p of toEmit) activeMatterAuditEmitter(p.entry);
}

/** Test seam: reset the queue so one test's migration can't leak entries into
 *  the next. Production code never calls this. */
export function clearPendingMatterMigrationAudit(): void {
  pendingMigrationDropAudits.length = 0;
}

function readLegacyEnvelope(
  key: string
): { state?: Record<string, unknown>; version?: number } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as {
      state?: Record<string, unknown>;
      version?: number;
    };
  } catch {
    return null;
  }
}

/** Keep only the object entries whose key is in `ids`. */
function pickByIds<T>(rec: Record<string, T>, ids: ReadonlySet<string>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, value] of Object.entries(rec)) {
    if (ids.has(id)) out[id] = value;
  }
  return out;
}

/**
 * QA-93 one-time migration: seed a freshly-opened workspace scope from the
 * LEGACY GLOBAL matter data. Non-destructive — the global keys are LEFT INTACT
 * so a different workspace can still claim its own matters on ITS first open.
 *
 * A matter is carried into `root` iff it has at least one ABSOLUTE folderPath
 * that lives under `root` (`isPathInFolder`, the app's case-correct containment
 * predicate). Relative folderPaths are NEVER guessed — they can't be proven to
 * belong to any workspace (see the "no automatic reconciliation" note below), so
 * a matter with ONLY relative folders is left in global (reachable only if it
 * later gains an absolute match). A carried matter's folderPaths are FILTERED to
 * those under `root` (plus any relative ones, left untouched) so a matter that
 * happens to span two workspaces never drags one workspace's absolute folder
 * claims into the other's scope. activeMatterId, snapshots, and cache ride along
 * only for carried matter ids.
 *
 * Always returns a CONCRETE envelope (never null) at the current schema version,
 * so persist REPLACES any stale in-memory slice from a previously-open workspace
 * (a null return would leave zustand's merge keeping the old matters).
 */
function migrateGlobalMattersForScope(root: string): StorageValue<PersistedMatterState> {
  const gMatters = readLegacyEnvelope(MATTERS_BASE_KEY);
  const gUi = readLegacyEnvelope(UI_BASE_KEY);
  const gGlance = readLegacyEnvelope(GLANCE_BASE_KEY);
  const migrated = migrateMatters(
    {
      matters: (gMatters?.state?.['matters'] as Matter[] | undefined) ?? [],
      activeMatterId: (gMatters?.state?.['activeMatterId'] as string | null | undefined) ?? null,
      selectionHint: gMatters?.state?.['selectionHint'] as
        | PersistedSelectionHint
        | undefined,
      snapshots: (gUi?.state?.['snapshots'] as Record<string, MatterUiSnapshot> | undefined) ?? {},
      cache: (gGlance?.state?.['cache'] as Record<string, MatterAtAGlanceEntry> | undefined) ?? {},
    },
    gMatters?.version ?? MATTERS_VERSION,
  );
  const kept: Matter[] = [];
  for (const m of migrated.matters) {
    const underRoot = m.folderPaths.some((fp) => isAbsolutePath(fp) && isPathInFolder(fp, root));
    if (!underRoot) continue;
    // A carried matter keeps ONLY folder mappings PROVEN to belong to this
    // workspace: absolute paths under the opened root. A relative entry is
    // unproven — readers resolve it against the CURRENT root, so carrying
    // "Clients/Legacy" into /wsA would silently attribute /wsA/Clients/Legacy
    // files to a client whose mapping may describe a folder in a different
    // workspace. Misattributing a file to the wrong client is the worst
    // failure class for this product, so relative entries are dropped from the
    // carried copy (round 3, Codex F1) — and each drop is audit-logged below so
    // the advisor can see why a folder stopped auto-filing and re-map it. The
    // untouched global source still holds the original shape. Absolute folders
    // under a DIFFERENT workspace are dropped too (they must not leak into
    // this scope) but stay claimable by their own workspace, so they need no
    // audit trail here.
    const folderPaths = m.folderPaths.filter(
      (fp) => isAbsolutePath(fp) && isPathInFolder(fp, root),
    );
    const droppedRelative = m.folderPaths.filter((fp) => !isAbsolutePath(fp));
    if (droppedRelative.length > 0) queueMigrationDropAudit(m, droppedRelative, root);
    kept.push({ ...m, folderPaths });
  }
  const keptIds = new Set(kept.map((m) => m.id));
  const state: PersistedMatterState = {
    matters: kept,
    activeMatterId:
      migrated.activeMatterId && keptIds.has(migrated.activeMatterId)
        ? migrated.activeMatterId
        : null,
    ...(migrated.selectionHint ? { selectionHint: migrated.selectionHint } : {}),
    snapshots: pickByIds(migrated.snapshots, keptIds),
    cache: pickByIds(migrated.cache, keptIds),
  };
  // COMMIT the migration to this workspace's scoped keys now. zustand's
  // `rehydrate()` does NOT write hydrated state back to storage, so without this
  // the one-time migration would recompute from global on every open. Writing
  // here makes it durable + idempotent (the next open finds the scoped key and
  // skips migration entirely) and leaves the global source intact.
  writeScopedMatterEnvelopes(scopedMatterKeys(), state, MATTERS_VERSION);
  return { state, version: MATTERS_VERSION };
}

/** Write the partialized state out to a scope's three keys (matters + activeId,
 *  ui snapshots, at-a-glance cache). Shared by `setItem` and the one-time
 *  migration so there is ONE definition of the on-disk envelope shape. */
function writeScopedMatterEnvelopes(
  keys: { matters: string; ui: string; glance: string },
  state: PersistedMatterState,
  version: number,
): void {
  try {
    localStorage.setItem(
      keys.matters,
      JSON.stringify({
        state: {
          matters: state.matters,
          activeMatterId: state.activeMatterId,
          ...(state.selectionHint ? { selectionHint: state.selectionHint } : {}),
        },
        version,
      })
    );
    localStorage.setItem(
      keys.ui,
      JSON.stringify({ state: { snapshots: state.snapshots }, version: 0 })
    );
    localStorage.setItem(
      keys.glance,
      JSON.stringify({ state: { cache: state.cache }, version: 0 })
    );
  } catch {
    /* localStorage may be unavailable (strict privacy mode) */
  }
}

/**
 * Multi-key, PER-WORKSPACE persistence (QA-93). This single store fans out to
 * THREE localStorage keys, each carrying the active workspace's `::ws:<id>`
 * suffix. `partialize` controls WHAT persists; this storage controls WHERE.
 *
 * WHERE rules:
 *   - No workspace scope active (app boot before a workspace opens; unit tests) →
 *     suffix `''` → the legacy GLOBAL keys, so pre-QA-93 behavior is unchanged.
 *   - A workspace scope active with data already at its scoped keys → load it.
 *   - A workspace scope active with NO scoped data yet → one-time migrate from
 *     the legacy global data (see `migrateGlobalMattersForScope`).
 *
 * The sync slice is never partialized, so it never reaches here.
 */
const multiKeyMatterStorage: PersistStorage<PersistedMatterState> = {
  getItem: (): StorageValue<PersistedMatterState> | null => {
    const keys = scopedMatterKeys();
    const matters = readLegacyEnvelope(keys.matters);
    const ui = readLegacyEnvelope(keys.ui);
    const glance = readLegacyEnvelope(keys.glance);
    if (matters || ui || glance) {
      const state: PersistedMatterState = {
        matters: (matters?.state?.['matters'] as Matter[] | undefined) ?? [],
        activeMatterId:
          (matters?.state?.['activeMatterId'] as string | null | undefined) ?? null,
        ...((matters?.state?.['selectionHint'] as PersistedSelectionHint | undefined)
          ? {
              selectionHint: matters?.state?.['selectionHint'] as PersistedSelectionHint,
            }
          : {}),
        snapshots:
          (ui?.state?.['snapshots'] as Record<string, MatterUiSnapshot> | undefined) ?? {},
        cache:
          (glance?.state?.['cache'] as Record<string, MatterAtAGlanceEntry> | undefined) ?? {},
      };
      // Return the matters key's stored version so `persist` runs the schema
      // migration when an older user hydrates. ui/glance are unversioned.
      if (selectionWriterRetirementEnabled()) {
        pendingSelectionRehydration = selectionRehydrationInput(state);
      }
      return { state, version: matters?.version ?? MATTERS_VERSION };
    }
    // No data at this scope.
    const root = getActiveWorkspaceScopeRoot();
    if (!root) return null; // no scope + no global data — fresh user → defaults
    // A workspace is open but has no scoped data yet → migrate from global.
    const migrated = migrateGlobalMattersForScope(root);
    if (selectionWriterRetirementEnabled()) {
      pendingSelectionRehydration = selectionRehydrationInput(migrated.state);
    }
    return migrated;
  },
  setItem: (_name, value): void => {
    // Capture the authority hint in the same workspace-bound snapshot as the
    // matter facts. A queued write must never read whichever workspace happens
    // to be active later.
    const persistedState: PersistedMatterState = {
      ...value.state,
      ...persistenceHintFields(),
    };
    writeScopedMatterEnvelopes(
      scopedMatterKeys(),
      persistedState,
      value.version ?? MATTERS_VERSION
    );
    // WORKSPACE-DISK WRITE-THROUGH (2026-07 durability fix): localStorage is
    // only a fast cache — every persisted change is also committed to the open
    // workspace's own `.lantern/matters.json` so a browser-profile wipe can
    // never destroy the client organization. See the disk-sync section below.
    scheduleMattersWorkspaceDiskWrite(
      persistedState,
      value.version ?? MATTERS_VERSION
    );
  },
  removeItem: (): void => {
    const keys = scopedMatterKeys();
    try {
      localStorage.removeItem(keys.matters);
      localStorage.removeItem(keys.ui);
      localStorage.removeItem(keys.glance);
    } catch {
      /* ignore */
    }
    // Deliberately does NOT delete the workspace's matters file: removeItem
    // only clears the profile-side CACHE (persist.clearStorage). The durable
    // on-disk source of truth is never destroyed automatically.
  },
};

// ─────────────────────────────────────────────────────────────────────
// Workspace-disk durability (2026-07 data-loss fix)
//
// Matter/client organization used to live ONLY in browser-profile-scoped
// localStorage. Reproduced on the real Windows bench: a WebView2 profile
// reset (or a user's cache clear / reinstall / new machine) permanently
// destroyed ALL client organization across every workspace — the document
// files re-indexed fine but showed "No clients yet". The workspace's own
// folder is now the SOURCE OF TRUTH (`.lantern/matters.json`, written through
// WorkspaceService like every other app write); the scoped localStorage keys
// above remain only a fast synchronous cache for boot.
//
// Lifecycle per workspace open (`reloadWorkspaceScopedStores` →
// `hydrateMattersFromWorkspaceDisk`):
//   - disk file present  → it wins: schema-migrate + apply to the store (the
//     resulting persist refreshes the localStorage cache);
//   - disk file absent   → the just-rehydrated cache (scoped keys, or the
//     QA-93 legacy-global migration) is committed to disk ONCE — the one-time
//     migration for pre-fix installs;
//   - disk file corrupt  → raw bytes are backed up beside it, then the cache
//     copy rebuilds it (organization is never silently destroyed);
//   - disk file unreadable (I/O error) → the cache stays in charge for the
//     session and ALL disk writes for that workspace stay blocked, so a file
//     we couldn't read is never clobbered.
//
// All disk operations run through ONE serial queue so a write scheduled while
// the hydrate read is in flight can never interleave with it. Writes for a
// workspace are gated on that workspace's hydrate having completed
// (`diskHydratedScopes`) — otherwise the empty just-booted store state could
// race ahead of the hydrate and overwrite a good disk file with nothing.
// ─────────────────────────────────────────────────────────────────────

let mattersDiskQueue: Promise<void> = Promise.resolve();
/** Scopes whose disk hydrate has completed — the write gate. */
const diskHydratedScopes = new Set<string>();
/** Last JSON committed to disk per scope, to skip no-op writes (persist fires
 *  on every setState, including ones that don't change the persisted slices). */
const lastDiskWriteJsonByScope = new Map<string, string>();

function enqueueMattersDiskOp(op: () => Promise<void>): Promise<void> {
  const next = mattersDiskQueue.then(op).catch((err: unknown) => {
    console.warn('[matterStore] workspace matters-file operation failed:', err);
  });
  mattersDiskQueue = next;
  return next;
}

/** Await all queued workspace-disk work (tests + shutdown-style callers). */
export function flushMattersWorkspaceDiskWrites(): Promise<void> {
  return mattersDiskQueue;
}

/** Test seam: forget all module-level disk-sync bookkeeping, as a fresh app
 *  process would. Production code never calls this. */
export function __resetMattersWorkspaceDiskSyncForTests(): void {
  mattersDiskQueue = Promise.resolve();
  diskHydratedScopes.clear();
  lastDiskWriteJsonByScope.clear();
}

/** The open workspace's service, ONLY when the active scope, the active
 *  WorkspaceService, and the requested root all agree on the same workspace
 *  identity — the guard that keeps a disk op from ever touching a different
 *  workspace than the state it carries (workspace-switch races). */
function resolveWorkspaceDiskTarget(
  root: string,
): { service: WorkspaceService; scopeId: string } | null {
  const scopeId = workspaceScopeId(root);
  const activeRoot = getActiveWorkspaceScopeRoot();
  if (!activeRoot || workspaceScopeId(activeRoot) !== scopeId) return null;
  const service = getActiveWorkspaceService();
  if (!service) return null;
  const serviceRoot = service.getRootPath();
  if (!serviceRoot || workspaceScopeId(serviceRoot) !== scopeId) return null;
  return { service, scopeId };
}

/** One canonical serialization for the change-detection compare (same key
 *  order as `partialize`, so an echo write after hydrate matches exactly). */
function serializeDiskState(state: PersistedMatterState, version: number): string {
  return JSON.stringify({
    version,
    state: {
      matters: state.matters,
      activeMatterId: state.activeMatterId,
      ...(state.selectionHint ? { selectionHint: state.selectionHint } : {}),
      snapshots: state.snapshots,
      cache: state.cache,
    },
  });
}

/** Write-through: commit the persisted slices to the open workspace's matters
 *  file. Fire-and-forget from the storage adapter's setItem; serialized on the
 *  disk queue; gated on the scope's hydrate (see the section doc above).
 *
 *  The target (root + service) is resolved AT SCHEDULE TIME, and the queued op
 *  writes to that captured target even if the ACTIVE workspace has moved on by
 *  the time it runs. This matters at a fast workspace switch: the final change
 *  of the outgoing workspace may still be in the queue when the new scope
 *  activates, and dropping it would strand that change in the localStorage
 *  cache — which the next disk-wins open of that workspace would discard.
 *  Writing to the captured (still-valid) service is always workspace-correct:
 *  the state was serialized under that same scope. */
function scheduleMattersWorkspaceDiskWrite(state: PersistedMatterState, version: number): void {
  const root = getActiveWorkspaceScopeRoot();
  if (!root) return; // no workspace open → legacy global keys stay cache-only
  const target = resolveWorkspaceDiskTarget(root);
  if (!target) return; // no matching service (browser/test) → cache-only, pre-fix behavior
  const json = serializeDiskState(state, version);
  // eslint-disable-next-line lantern-async/no-silent-failure -- enqueueMattersDiskOp catches internally (logs every failure); its returned promise never rejects
  void enqueueMattersDiskOp(async () => {
    if (!diskHydratedScopes.has(target.scopeId)) return; // never write before hydrate
    if (lastDiskWriteJsonByScope.get(target.scopeId) === json) return; // no-op change
    await writeMattersWorkspaceFile(target.service, root, {
      matters: state.matters,
      activeMatterId: state.activeMatterId,
      ...(state.selectionHint ? { selectionHint: state.selectionHint } : {}),
      snapshots: state.snapshots,
      cache: state.cache,
    }, version);
    lastDiskWriteJsonByScope.set(target.scopeId, json);
  });
}

/** Coerce a schema-migrated (but still untrusted — it came off disk) envelope
 *  state into a well-formed PersistedMatterState. */
function sanitizeDiskMatterState(migrated: PersistedMatterState | undefined): PersistedMatterState {
  const matters = Array.isArray(migrated?.matters) ? migrated.matters : [];
  let activeMatterId =
    typeof migrated?.activeMatterId === 'string' ? migrated.activeMatterId : null;
  if (activeMatterId && !matters.some((m) => m.id === activeMatterId)) activeMatterId = null;
  return {
    matters,
    activeMatterId,
    ...(migrated?.selectionHint ? { selectionHint: migrated.selectionHint } : {}),
    snapshots:
      migrated?.snapshots && typeof migrated.snapshots === 'object' ? migrated.snapshots : {},
    cache: migrated?.cache && typeof migrated.cache === 'object' ? migrated.cache : {},
  };
}

/**
 * Load the workspace's durable matter organization from ITS OWN on-disk file,
 * making the workspace folder the source of truth (see the section doc above
 * for the four outcomes). Called by `reloadWorkspaceScopedStores` right after
 * the synchronous localStorage rehydrate at every workspace open; safe to call
 * when no matching WorkspaceService is active (browser mode, tests) — it
 * simply leaves the cache in charge, which is the pre-fix behavior.
 */
export function hydrateMattersFromWorkspaceDisk(root: string): Promise<void> {
  // Snapshot the persisted slices SYNCHRONOUSLY at the call — i.e. immediately
  // after the caller's rehydrate, when the store holds exactly the localStorage
  // cache. Two jobs: (1) detect any user mutation that lands between workspace
  // open and the disk read finishing (Codex P1 — an unconditional disk-wins
  // apply would silently drop a just-created client), and (2) hold THIS
  // workspace's pure cache copy for the corrupt-rebuild path, which must never
  // read the live store after an await (a workspace switch during the backup
  // write would make the live store hold a DIFFERENT workspace's records —
  // writing those into this workspace's file would cross the
  // client-confidentiality boundary; Codex P1).
  const pre = useMatterStore.getState();
  const preSnapshot: PersistedMatterState = {
    matters: pre.matters,
    activeMatterId: pre.activeMatterId,
    ...persistenceHintFields(),
    snapshots: pre.snapshots,
    cache: pre.cache,
  };
  return enqueueMattersDiskOp(async () => {
    const target = resolveWorkspaceDiskTarget(root);
    if (!target) return;
    // CLOSE the write gate for the duration of this hydrate. The scope may
    // still be marked hydrated from an EARLIER visit this session; without
    // this, a read failure below would return early with the stale gate open
    // and later writes could overwrite the very file we couldn't read (Codex
    // re-review P1). Writes queued BEFORE this op already ran (queue order),
    // so nothing legitimate is dropped; the gate re-opens on every branch
    // that establishes a trustworthy disk state.
    diskHydratedScopes.delete(target.scopeId);

    const result = await readMattersWorkspaceFile(target.service, root);
    // The workspace may have switched while the read was in flight — never
    // apply one workspace's records under another's scope.
    if (!resolveWorkspaceDiskTarget(root)) return;

    if (result.status === 'error') {
      console.error(
        '[matterStore] workspace matters file exists but could not be read; ' +
          'keeping the cached copy for this session and blocking overwrites of the file:',
        result.error,
      );
      return; // NOT marked hydrated → the write gate keeps the file safe
    }

    if (result.status === 'ok') {
      let applied = sanitizeDiskMatterState(migrateMatters(result.state, result.version));
      // Did the user mutate matter state since workspace open (created,
      // edited, or deleted a client in the instant before the disk read
      // finished)? Strict disk-wins would silently undo that. Three-way merge
      // with the pre-open cache snapshot as the common base (Codex re-review
      // P1 — creations alone weren't enough, edits/deletions of existing
      // records count too):
      //   - id in the live store        → STORE version (edits + creations
      //     win; the cache base ≈ disk in every state where an existing
      //     record could have been edited);
      //   - id on disk, not in store:
      //       · the cache KNEW it   → the user deleted it just now → honor
      //         the deletion;
      //       · the cache didn't    → a disk-only record the store never saw
      //         (fresh-profile restore) → restore it.
      // Deliberately not a field-level merge — the window is one small file
      // read at workspace open.
      const now = useMatterStore.getState();
      const mutatedDuringRead =
        now.matters !== preSnapshot.matters ||
        now.activeMatterId !== preSnapshot.activeMatterId ||
        now.snapshots !== preSnapshot.snapshots ||
        now.cache !== preSnapshot.cache;
      if (mutatedDuringRead) {
        const storeIds = new Set(now.matters.map((m) => m.id));
        const baseIds = new Set(preSnapshot.matters.map((m) => m.id));
        const diskOnlyRestores = applied.matters.filter(
          (m) => !storeIds.has(m.id) && !baseIds.has(m.id),
        );
        const matters = [...now.matters, ...diskOnlyRestores];
        const keptIds = new Set(matters.map((m) => m.id));
        const activeMatterId =
          now.activeMatterId && keptIds.has(now.activeMatterId)
            ? now.activeMatterId
            : applied.activeMatterId && keptIds.has(applied.activeMatterId)
              ? applied.activeMatterId
              : null;
        applied = {
          matters,
          activeMatterId,
          ...(selectionWriterRetirementEnabled()
            ? persistenceHintFields()
            : applied.selectionHint
              ? { selectionHint: applied.selectionHint }
              : {}),
          snapshots: {
            ...pickByIds(applied.snapshots, keptIds),
            ...pickByIds(now.snapshots, keptIds),
          },
          cache: {
            ...pickByIds(applied.cache, keptIds),
            ...pickByIds(now.cache, keptIds),
          },
        };
      }
      const needsDiskCommit = mutatedDuringRead || result.recoveredFromBackup === true;
      // Open the write gate BEFORE setState. When nothing changed and the main
      // file was read directly, also prime the change detector so the persist
      // echo refreshes the localStorage cache without an identical disk
      // re-write. When the union added records — or the state was recovered
      // from the .bak sibling and the MAIN file is missing — leave the
      // detector unprimed so the echo COMMITS the applied state to disk.
      diskHydratedScopes.add(target.scopeId);
      if (!needsDiskCommit) {
        lastDiskWriteJsonByScope.set(target.scopeId, serializeDiskState(applied, MATTERS_VERSION));
      }
      if (selectionWriterRetirementEnabled()) {
        useMatterStore.setState({
          matters: applied.matters,
          snapshots: applied.snapshots,
          cache: applied.cache,
        });
        rehydrateSelectionFromData(selectionRehydrationInput(applied));
      } else {
        useMatterStore.setState({
          matters: applied.matters,
          activeMatterId: applied.activeMatterId,
          snapshots: applied.snapshots,
          cache: applied.cache,
        });
      }
      return;
    }

    if (result.status === 'corrupt') {
      console.error(
        '[matterStore] workspace matters file was unreadable; backing it up and rebuilding from the cached copy',
      );
      const backedUp = await backupCorruptMattersWorkspaceFile(target.service, root, result.raw);
      if (!backedUp) {
        // The corrupt bytes are the ONLY copy of whatever that file held.
        // Without a successful backup, rebuilding over it would destroy it
        // (Codex re-review P2). Keep the cache in charge for this session and
        // leave the write gate closed so nothing overwrites the file.
        console.error(
          '[matterStore] corrupt matters file could NOT be backed up; leaving it untouched and blocking overwrites this session',
        );
        return;
      }
      // The backup was an await — revalidate before touching anything else
      // (a switch during it must not write another workspace's records here).
      if (!resolveWorkspaceDiskTarget(root)) return;
      // Rebuild from the pre-read cache snapshot (NOT the live store — see the
      // snapshot comment above), even when it's empty: the corrupt bytes are
      // safely backed up and the main file must become readable again.
      await writeMattersWorkspaceFile(target.service, root, {
        matters: preSnapshot.matters,
        activeMatterId: preSnapshot.activeMatterId,
        ...(preSnapshot.selectionHint
          ? { selectionHint: preSnapshot.selectionHint }
          : {}),
        snapshots: preSnapshot.snapshots,
        cache: preSnapshot.cache,
      }, MATTERS_VERSION);
      if (resolveWorkspaceDiskTarget(root)) {
        diskHydratedScopes.add(target.scopeId);
        lastDiskWriteJsonByScope.set(
          target.scopeId,
          serializeDiskState(preSnapshot, MATTERS_VERSION),
        );
      }
      return;
    }

    // absent: the just-rehydrated cache is the best copy there is. Commit it
    // to the workspace folder once — the one-time migration for installs from
    // before this fix. (No awaits since the last revalidation, so the live
    // store is still this workspace's state.)
    diskHydratedScopes.add(target.scopeId);
    const s = useMatterStore.getState();
    const snapshot: PersistedMatterState = {
      matters: s.matters,
      activeMatterId: s.activeMatterId,
      ...persistenceHintFields(),
      snapshots: s.snapshots,
      cache: s.cache,
    };
    if (snapshot.matters.length === 0) {
      // Nothing to migrate — don't dirty a workspace that has no organization.
      return;
    }
    await writeMattersWorkspaceFile(target.service, root, {
      matters: snapshot.matters,
      activeMatterId: snapshot.activeMatterId,
      ...(snapshot.selectionHint ? { selectionHint: snapshot.selectionHint } : {}),
      snapshots: snapshot.snapshots,
      cache: snapshot.cache,
    }, MATTERS_VERSION);
    lastDiskWriteJsonByScope.set(target.scopeId, serializeDiskState(snapshot, MATTERS_VERSION));
  });
}

/**
 * Schema migration for the persisted matters slice (v1 -> v10). Extracted from
 * the persist config so the QA-93 per-workspace storage adapter can reuse it to
 * bring LEGACY GLOBAL data up to the current schema before filtering it by the
 * opened workspace root (see `multiKeyMatterStorage`). Pure function; the persist
 * `migrate` hook just delegates to it.
 */
function migrateMatters(persisted: unknown, version: number): PersistedMatterState {
  const state = persisted as Partial<PersistedMatterState> | undefined;
  if (!state || !Array.isArray(state.matters))
    return state as PersistedMatterState;
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
  if (version < 7) {
    // v6 -> v7: additive connector mapping slots. These are empty until
    // each connector branch provides its real mapping UI/rules.
    state.matters = state.matters.map((m) => ({
      ...m,
      onedriveFolderKeys: m.onedriveFolderKeys ?? [],
      esignKeys: m.esignKeys ?? [],
      meetingKeys: m.meetingKeys ?? [],
    }));
  }
  if (version < 8) {
    // v7 -> v8: more additive connector mapping slots. These are no-op
    // shells until each connector branch supplies real mapping logic.
    state.matters = state.matters.map((m) => ({
      ...m,
      boxFolderKeys: m.boxFolderKeys ?? [],
      jotformKeys: m.jotformKeys ?? [],
      sharefileFolderKeys: m.sharefileFolderKeys ?? [],
      zocksKeys: m.zocksKeys ?? [],
      addeparKeys: m.addeparKeys ?? [],
    }));
  }
  if (version < 9) {
    // v8 -> v9: SANITISE `folderPaths` (2026-07-01 QA re-fix). Earlier
    // migrations only ADDED fields; none ever re-validated the existing
    // `folderPaths`. `folderPaths` is TYPED `string[]`, but a persisted
    // matter could carry a NON-STRING entry (a folder-picker object, or a
    // corrupted write). Left alone it survives into `folderPaths[0]` and
    // stringifies to the literal `"[object Object]"` when used as a
    // create target — the exact bug where scoped "New document" wrote to a
    // real garbage folder named `[object Object]` and the scoped
    // Grid/Tree showed empty. `dedupeFolderPaths` now coerces each entry
    // to a real string path and drops anything that can't be, so every
    // persisted matter comes back with a clean `string[]`.
    state.matters = state.matters.map((m) => ({
      ...m,
      folderPaths: dedupeFolderPaths(
        Array.isArray(m.folderPaths) ? (m.folderPaths as unknown[]) : [],
        null,
      ),
    }));
  }
  if (version < 10) {
    // v9 -> v10: re-validate `folderPaths` SHAPE ONLY (2026-07
    // path-shape-discipline fix, F2.3) — coerce/drop non-strings and
    // dedupe, same as v9, but this version bump exists to carry the
    // real-path-proof log below. It deliberately does NOT attempt to
    // resolve a surviving workspace-RELATIVE entry to absolute here.
    //
    // Earlier drafts of this fix DID call `getWorkspaceRootNonReactive()`
    // at this exact point and resolved relative -> absolute against
    // whatever root that returned — and a later draft added a
    // `useWorkspaceStore.subscribe` reconciliation that auto-bound a
    // surviving relative entry once a folder at that path was verified
    // to exist in the current workspace's tree. Both were removed after
    // independent review: neither can prove the entry actually belongs
    // to THIS workspace rather than a same-named coincidence in a
    // DIFFERENT one the user also has, and once wrongly rewritten to
    // absolute, that mistake can never self-correct (see the "no
    // automatic reconciliation" note right after this store's
    // definition for the full rationale). No available signal proves
    // workspace IDENTITY here without threading a workspace-root
    // parameter through `matterResolver.resolveMatterId`'s hot path —
    // out of lane, per this module's write-choke-point doc above.
    //
    // So this migration always passes `workspaceRoot: null` — a
    // surviving relative entry stays relative (shape-clean, not
    // dropped), and stays that way until the user touches that
    // specific matter's folders again with the CORRECT workspace open
    // (the write-time choke-point above, which is unambiguous by
    // construction — only one workspace is ever in play there).
    //
    // Not gated on `import.meta.env.DEV` (that block is stripped from
    // `vite build`) — this line is the real-path proof a later bench
    // pass greps for to confirm the migration actually ran in the
    // shipped app, not just in tests.
    let canonicalizedCount = 0;
    let droppedCount = 0;
    state.matters = state.matters.map((m) => {
      const before = Array.isArray(m.folderPaths) ? (m.folderPaths as unknown[]) : [];
      const after = dedupeFolderPaths(before, null);
      canonicalizedCount += after.length;
      droppedCount += before.length - after.length;
      return { ...m, folderPaths: after };
    });
    console.log(
      `[PathShape] canonicalized ${String(canonicalizedCount)} folderPaths, dropped ${String(droppedCount)} invalid`,
    );
  }
  return state as PersistedMatterState;
}

export const useMatterStore = create<MatterState>()(
  persist(
    (set, get) => ({
      matters: [],
      activeMatterId: null,

      createMatter: (input) => {
        const canonicalFolderPaths = dedupeFolderPaths(
          input.folderPaths ?? [],
          getWorkspaceRootNonReactive(),
        );
        const matter: Matter = {
          id: input.id ?? newMatterId(),
          name: input.name.trim(),
          client: input.client.trim(),
          folderPaths: ensureUniqueFolderPaths(canonicalFolderPaths, get().matters),
          mailFolderPaths: Array.from(
            new Set((input.mailFolderPaths ?? []).filter(Boolean))
          ),
          crmHouseholdKeys: Array.from(
            new Set((input.crmHouseholdKeys ?? []).filter(Boolean))
          ),
          onedriveFolderKeys: Array.from(
            new Set((input.onedriveFolderKeys ?? []).filter(Boolean))
          ),
          boxFolderKeys: Array.from(
            new Set((input.boxFolderKeys ?? []).filter(Boolean))
          ),
          esignKeys: Array.from(
            new Set((input.esignKeys ?? []).filter(Boolean))
          ),
          jotformKeys: Array.from(
            new Set((input.jotformKeys ?? []).filter(Boolean))
          ),
          sharefileFolderKeys: Array.from(
            new Set((input.sharefileFolderKeys ?? []).filter(Boolean))
          ),
          meetingKeys: Array.from(
            new Set((input.meetingKeys ?? []).filter(Boolean))
          ),
          zocksKeys: Array.from(
            new Set((input.zocksKeys ?? []).filter(Boolean))
          ),
          addeparKeys: Array.from(
            new Set((input.addeparKeys ?? []).filter(Boolean))
          ),
          privileged: input.privileged ?? false,
          mcpAccessGranted: input.mcpAccessGranted ?? false,
          createdAt: new Date().toISOString(),
          ...(input.createdFromCrm ? { createdFromCrm: true } : {}),
          ...(input.firmMatterId !== undefined
            ? { firmMatterId: input.firmMatterId }
            : {}),
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
                  ...(patch.name !== undefined
                    ? { name: patch.name.trim() }
                    : {}),
                  ...(patch.client !== undefined
                    ? { client: patch.client.trim() }
                    : {}),
                }
              : m
          ),
        }));
      },

      deleteMatter: (id) => {
        const workspaceRoot = getWorkspaceRootNonReactive();
        if (workspaceRoot) {
          try {
            usePendingDeletedMatterStore.getState().record(workspaceRoot, id);
          } catch (err) {
            console.error(
              '[matterStore] deleted matter hold could not be saved; refusing to delete matter:',
              err,
            );
            return;
          }
        }
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
            // While authority is active, deletion changes matter facts only;
            // the source classifier synchronously blocks and its one projection
            // writer owns follower convergence. Dark mode keeps legacy bytes.
            activeMatterId: selectionWriterRetirementEnabled()
              ? state.activeMatterId
              : state.activeMatterId === id
                ? null
                : state.activeMatterId,
            // Close its Client Map hub so a recycled id can't reopen it.
            clientMapHubId: state.clientMapHubId === id ? null : state.clientMapHubId,
            snapshots,
            cache,
            statusByMatterId,
          };
        });
        // Prune the now-deleted client from every rail group. This lives HERE
        // (not at the dialog call site) so EVERY delete path — the manager
        // dialog, connector disconnects, Wealthbox cleanup — prunes, and only
        // AFTER the delete actually happened (the early return above on a failed
        // safety-record hold never reaches this point).
        useClientGroupStore.getState().removeMatterFromAllGroups(id);
        // Matter-delete semantics (BUG-042, product decision 2026-06-21):
        // delete REMOVES the matter and its grouping + wipes the AI's memory of
        // it, but KEEPS the user's actual files on disk. (Archive is the
        // "hide but keep everything" path; delete is the more final one that
        // never destroys documents — a law practice has retention duties.)
        //
        // To make "wipe from the AI" honest we first saved a durable pending
        // delete record, then clear the two durable AI-side traces of the
        // matter. If either purge fails, the pending record keeps that matter
        // hidden from retrieval and the next workspace boot retries it:
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
        if (workspaceRoot) {
          void purgeDeletedMatterForWorkspace(workspaceRoot, id).catch((err: unknown) => {
            console.warn('Failed to clear the pending deleted-client record after deleting a client:', err);
          });
        } else {
          // No workspace identity to key a durable hold on (browser mode /
          // pre-open edge). Still attempt the immediate purge — the pre-existing
          // behavior — rather than silently skipping the AI-memory wipe; there
          // is just no boot-retry safety net in this state.
          void ragDeleteMatter(id).catch((err: unknown) => {
            console.warn('[matterStore] RAG purge for deleted matter failed (no workspace hold):', err);
          });
          void mailClearMatterFilings(id).catch((err: unknown) => {
            console.warn('[matterStore] mail-filings purge for deleted matter failed (no workspace hold):', err);
          });
        }
      },

      setFolderPaths: (id, folderPaths) => {
        const workspaceRoot = getWorkspaceRootNonReactive();
        set((state) => ({
          matters: state.matters.map((m) => {
            if (m.id !== id) return m;
            // REPLACES the list with exactly what's passed — but an entry
            // that's simply being passed through unchanged keeps its
            // ALREADY-STORED shape (never re-derived against whichever
            // workspace happens to be open now); only a genuinely new value
            // gets canonicalized fresh. See `resolveFolderPathEntry`'s doc.
            const existingByNormalized = buildExistingByNormalized(m.folderPaths);
            const out: string[] = [];
            const seen = new Set<string>();
            for (const value of folderPaths) {
              const resolved = resolveFolderPathEntry(value, existingByNormalized, workspaceRoot);
              if (resolved === null || seen.has(resolved)) continue;
              seen.add(resolved);
              out.push(resolved);
            }
            return { ...m, folderPaths: out };
          }),
        }));
      },

      addFolderPath: (id, folderPath) => {
        const workspaceRoot = getWorkspaceRootNonReactive();
        set((state) => ({
          matters: state.matters.map((m) => {
            if (m.id !== id) return m;
            // APPENDS one folder — every OTHER already-stored entry is left
            // completely untouched, whatever shape it's currently in (see
            // `resolveFolderPathEntry`'s doc for why this matters).
            const existingByNormalized = buildExistingByNormalized(m.folderPaths);
            const resolved = resolveFolderPathEntry(folderPath, existingByNormalized, workspaceRoot);
            if (resolved === null || m.folderPaths.includes(resolved)) return m;
            return { ...m, folderPaths: [...m.folderPaths, resolved] };
          }),
        }));
      },

      removeFolderPath: (id, folderPath) => {
        const workspaceRoot = getWorkspaceRootNonReactive();
        const canon = canonicalizeFolderPath(folderPath, workspaceRoot);
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === id
              ? {
                  ...m,
                  folderPaths: m.folderPaths.filter(
                    (f) => canonicalizeFolderPath(f, workspaceRoot) !== canon
                  ),
                }
              : m
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
              ? {
                  ...m,
                  mailFolderPaths: (m.mailFolderPaths ?? []).filter(
                    (k) => k !== key
                  ),
                }
              : m
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
              ? {
                  ...m,
                  crmHouseholdKeys: (m.crmHouseholdKeys ?? []).filter(
                    (k) => k !== key
                  ),
                }
              : m
          ),
        }));
      },

      addMeetingKey: (id, rawKey) => {
        const key = rawKey.trim();
        if (!key) return;
        // codex-review P2: compare/filter by the SAME normalized form the
        // resolver uses (buildCalendarMatterMap / buildMeetingMatterMap),
        // not the raw trimmed string — otherwise assigning a
        // differently-cased or whitespace-varied form of an already-taught
        // key (e.g. "Kim@Henderson.COM" vs a stored "kim@henderson.com")
        // fails to move it off the other matter, leaving two matters with
        // what the resolver treats as the same key.
        const normalized = normalizeMeetingKey(key);
        set((state) => ({
          matters: state.matters.map((m) => {
            if (m.id === id) {
              const existing = m.meetingKeys ?? [];
              const alreadyPresent = existing.some((k) => normalizeMeetingKey(k) === normalized);
              return alreadyPresent ? m : { ...m, meetingKeys: [...existing, key] };
            }
            const others = m.meetingKeys ?? [];
            const filtered = others.filter((k) => normalizeMeetingKey(k) !== normalized);
            return filtered.length === others.length ? m : { ...m, meetingKeys: filtered };
          }),
        }));
      },

      addOneDriveFolderKey: (id, folderKey) => {
        const key = folderKey.trim();
        if (!key) return;
        set((state) => ({
          matters: state.matters.map((m) => {
            if (m.id === id) {
              const existing = m.onedriveFolderKeys ?? [];
              return existing.includes(key)
                ? m
                : { ...m, onedriveFolderKeys: [...existing, key] };
            }
            // A OneDrive folder belongs to exactly ONE matter. Move the key off
            // any old matter so the backend never indexes one cloud folder under
            // two client boundaries at once.
            const others = m.onedriveFolderKeys ?? [];
            return others.includes(key)
              ? { ...m, onedriveFolderKeys: others.filter((k) => k !== key) }
              : m;
          }),
        }));
      },

      addBoxFolderKey: (id, folderKey) => {
        const key = folderKey.trim();
        if (!key) return;
        set((state) => ({
          matters: state.matters.map((m) => {
            if (m.id === id) {
              const existing = m.boxFolderKeys ?? [];
              return existing.includes(key)
                ? m
                : { ...m, boxFolderKeys: [...existing, key] };
            }
            // A Box folder belongs to exactly ONE matter. Move the key off any
            // old matter so the backend never indexes one cloud folder under two
            // client boundaries at once.
            const others = m.boxFolderKeys ?? [];
            return others.includes(key)
              ? { ...m, boxFolderKeys: others.filter((k) => k !== key) }
              : m;
          }),
        }));
      },

      addSharefileFolderKey: (id, folderKey) => {
        const key = folderKey.trim();
        if (!key) return;
        set((state) => ({
          matters: state.matters.map((m) => {
            if (m.id === id) {
              const existing = m.sharefileFolderKeys ?? [];
              return existing.includes(key)
                ? m
                : { ...m, sharefileFolderKeys: [...existing, key] };
            }
            const others = m.sharefileFolderKeys ?? [];
            return others.includes(key)
              ? { ...m, sharefileFolderKeys: others.filter((k) => k !== key) }
              : m;
          }),
        }));
      },

      addAddeparKey: (id, addeparKey) => {
        const key = addeparKey.trim();
        if (!key) return;
        set((state) => ({
          matters: state.matters.map((m) => {
            if (m.id === id) {
              const existing = m.addeparKeys ?? [];
              return existing.includes(key)
                ? m
                : { ...m, addeparKeys: [...existing, key] };
            }
            const others = m.addeparKeys ?? [];
            return others.includes(key)
              ? { ...m, addeparKeys: others.filter((k) => k !== key) }
              : m;
          }),
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
          const hasContent =
            m.folderPaths.length > 0 || (m.mailFolderPaths ?? []).length > 0;
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
                const base = (
                  firstFolder
                    ? (firstFolder.split(/[\\/]/).filter(Boolean).pop() ?? '')
                    : ''
                ).trim();
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
        if (privileged) {
          const selection = readSelectionOperationDecision({
            operationClass: 'matter-scoped',
            allowAllMatters: true,
            requireFollowerAgreement: true,
          });
          // Any uncertainty stays protected. The follower is consulted only to
          // refuse/unconditionally arm; it can never turn protection off.
          if (
            selection.kind === 'refused' ||
            (selection.kind === 'matter' && selection.matter.id === id)
          ) {
            requestNativeNetworkLockdown(true);
          }
        }
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === id ? { ...m, privileged } : m
          ),
        }));
      },

      setMatterMcpAccess: (id, granted) => {
        const matter = findMatter(id, get().matters);
        if (!matter || !!matter.mcpAccessGranted === granted) return;
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === id ? { ...m, mcpAccessGranted: granted } : m
          ),
        }));
        auditMatterMcpAccess(matter, granted);
      },

      setMatterArchived: (id, archived) => {
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === id ? { ...m, archived } : m
          ),
          // Don't leave the active scope pointing at a just-archived matter —
          // fall back to the explicit all-matters scope (same as deleteMatter).
          activeMatterId:
            selectionWriterRetirementEnabled()
              ? state.activeMatterId
              : archived && state.activeMatterId === id
                ? null
                : state.activeMatterId,
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
          if (nextActive && findMatter(nextActive, state.matters)?.privileged) {
            requestNativeNetworkLockdown(true);
          }
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
            m.id === id ? { ...m, firmMatterId, orgId, role, shared: true } : m
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
          matters: state.matters.map((m) => (m.id === id ? { ...m, role } : m)),
        }));
      },

      // ── UI slice ────────────────────────────────────────────────────────
      snapshots: {},
      saveSnapshot: (matterId, snapshot) => {
        set((state) => ({
          snapshots: { ...state.snapshots, [matterId]: snapshot },
        }));
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
      clientMapHubTab: null,
      setClientMapHubTab: (tab) => set({ clientMapHubTab: tab }),
      clientMapHubRequestId: null,
      setClientMapHubRequestId: (requestId) => set({ clientMapHubRequestId: requestId }),
      pendingMeetingOpen: null,
      setPendingMeetingOpen: (req) => set({ pendingMeetingOpen: req }),
    }),
    {
      name: SK_MATTERS,
      version: MATTERS_VERSION,
      storage: multiKeyMatterStorage,
      // v1 -> v2: matters gained `mailFolderPaths`. v2 -> v3: matters gained the
      // `privileged` flag. v3 -> v4: matters gained firm linkage fields
      // (firmMatterId, orgId, role, shared). v4 -> v5: matters gained the
      // explicit MCP access grant. v5 -> v6: matters gained `crmHouseholdKeys`
      // for the Wealthbox connector. v6 -> v7: matters gained additive external
      // connector slots (`onedriveFolderKeys`, `esignKeys`, `meetingKeys`).
      // v7 -> v8: matters gained additive connector mapping slots for Box,
      // Jotform, ShareFile, Zocks, and Addepar. v8 -> v9: re-validate
      // `folderPaths` — coerce any non-string entry to a real path and drop what
      // can't be, so a corrupted/legacy object can never stringify to
      // `"[object Object]"` and become a garbage create target. v9 -> v10:
      // canonicalize `folderPaths` to the ABSOLUTE shape the type declares
      // (see the `migrate` step below for the full rationale).
      // Backfill defaults so older persisted matters parse cleanly (missing
      // values are tolerated by readers, but normalising here keeps the shape
      // consistent). Only the `matters` slice is versioned;
      // the snapshots/cache slices pass through untouched.
      migrate: migrateMatters,
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
      merge: (persisted, current) => {
        const restored = persisted as Partial<PersistedMatterState>;
        if (!selectionWriterRetirementEnabled()) {
          return { ...current, ...restored };
        }
        const { activeMatterId: _legacyFollowerHint, ...facts } = restored;
        return { ...current, ...facts };
      },
      onRehydrateStorage: () => () => {
        if (!selectionWriterRetirementEnabled() || !pendingSelectionRehydration) {
          return;
        }
        const input = pendingSelectionRehydration;
        pendingSelectionRehydration = null;
        rehydrateSelectionFromData(input);
      },
    }
  )
);

// ─────────────────────────────────────────────────────────────────────
// Deliberately NO automatic reconciliation of legacy relative `folderPaths`
// (removed after independent review, F2.3).
//
// Rounds 1-5 of this fix built a `useWorkspaceStore` subscription that
// auto-repaired a surviving legacy-relative `folderPaths` entry by checking
// whether a folder at that exact relative path existed in the CURRENTLY-open
// workspace's file tree, and binding (rewriting to absolute) only when it
// did. That check rules out an obviously-wrong workspace, but it is still
// NAME evidence, not IDENTITY evidence: if the user has two workspaces that
// happen to share the same folder structure (e.g. a "Production" and a
// "Sandbox" practice both containing `Clients/Hollings`), whichever workspace
// opens FIRST after upgrading would pass the tree check and get the entry
// permanently bound to it — and once absolute, that binding can never
// self-correct, even when the RIGHT workspace opens later. A matter's
// scoped documents/RAG retrieval would then point at another workspace's
// client files: worse than the (bounded, already-known) pre-fix bug of an
// unindexed-until-touched matter, because it actively misassigns content
// instead of merely failing to assign it. No available signal (the file
// tree, the `recentWorkspaces` path list, the matter's own name/client) can
// prove workspace IDENTITY rather than mere name coincidence without
// threading a workspace-root parameter through `matterResolver.resolveMatterId`
// (the live RAG indexer's hot path) — the exact invasive, out-of-lane change
// canonical=ABSOLUTE was chosen specifically to avoid (see the module's write-
// choke-point doc above).
//
// So this fix stops at the two mechanisms that ARE unambiguous by
// construction: the v9 -> v10 migration (shape-only; never resolves, never
// guesses) and the write-time choke-point (`createMatter`/`setFolderPaths`/
// `addFolderPath`), which only ever runs while a workspace IS open and the
// folder candidate came from THAT SAME workspace's own tree at that same
// moment — no coincidence, no guess, exactly one workspace in play. A matter
// left with a genuinely relative `folderPaths` entry from BEFORE this fix
// shipped stays relative (and its indexing/scoping stays exactly as broken as
// it already was) until the user touches that matter's folder mapping again
// with the correct workspace open — an honest, bounded, already-known
// limitation, never a silent mis-assignment across workspaces.
// ─────────────────────────────────────────────────────────────────────

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
  const selection = readSelectionOperationDecision({
    operationClass: 'matter-scoped',
    allowAllMatters: true,
    requireFollowerAgreement: true,
  });
  if (selection.kind === 'refused') return true;
  return selection.kind === 'matter' && !!selection.matter.privileged;
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
 * Resolve every equivalent SHAPE of the same underlying file (e.g. its
 * workspace-relative form and its `rootPath`-joined absolute form) TOGETHER,
 * reporting whether an unassigned result was a genuine identity conflict
 * (two matters claim overlapping folders, in any shape) rather than a plain
 * non-match. Callers that need to resolve a workspace path to its matter
 * (e.g. `resolveMatterIdForWorkspacePath`) must use this rather than trying
 * shapes one at a time, so a stale/legacy folder entry that matches ONE
 * shape cleanly can never paper over a real ambiguity found via another
 * shape of the identical file. Pass `rootPath` (when known) so each matter's
 * folders are ALSO canonicalized to absolute before comparing — otherwise a
 * legacy-relative folder claim and an absolute claim for the SAME physical
 * folder tie at different raw string lengths and the absolute one silently
 * "wins" instead of the genuine ambiguity failing closed.
 */
export function resolveMatterMatchForPaths(paths: string[], rootPath?: string | null): MatterMatch {
  return resolveMatterMatchAcrossForms(paths, useMatterStore.getState().matters, rootPath);
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
  activeMatterId: string | null
): Matter | null {
  const m = findMatter(activeMatterId, matters);
  return m && !m.archived ? m : null;
}

export function getActiveScope(): MatterScope {
  const selection = readSelectionOperationDecision({
    operationClass: 'matter-scoped',
    allowAllMatters: true,
    requireFollowerAgreement: true,
  });
  if (selection.kind === 'refused') throw new Error(selection.message);
  return selection.kind === 'matter'
    ? { kind: 'matter', matterId: selection.matter.id }
    : { kind: 'allMatters' };
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
  return useMatterStore(
    useShallow((s) => s.matters.filter((m) => !m.archived))
  );
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
    useShallow((s) => resolveActiveMatter(s.matters, s.activeMatterId))
  );
}

/**
 * Subscribe to whether the active matter is tagged privileged. Drives the
 * auto-on behaviour of Privileged Matter Mode.
 */
export function useActiveMatterPrivileged(): boolean {
  return useMatterStore(
    (s) => !!resolveActiveMatter(s.matters, s.activeMatterId)?.privileged
  );
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
    })
  );
}
