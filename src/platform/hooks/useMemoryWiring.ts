/**
 * useMemoryWiring — install the M1 RAG indexer for the active workspace.
 *
 * Lifecycle (per workspace open):
 *   1. Wire the MemoryService toggle reader against the persisted setting.
 *   2. Tell the Rust backend which workspace to index (`rag_set_workspace`).
 *   3. Start the workspace file watcher (`watch_workspace`) so the Rust
 *      side emits `workspace-file-changed` events with 200 ms debounce.
 *   4. Subscribe to those events and re-index files on change / drop them
 *      on delete.
 *   5. Kick off a background `rag_index_workspace` so the user's first
 *      query returns hits, even if they haven't edited anything yet.
 *
 * On unmount or workspace switch the watcher subscription is torn down.
 *
 * In browser / test mode (`isTauri()` returns false) every step is a
 * no-op so this hook is safe to mount unconditionally.
 */

import { useEffect, useRef } from 'react';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { workspacePath, isAbsolutePath, joinWorkspacePath } from '@/platform/fs/appPath';
import { WORKSPACE_DATA_DIR } from '@/config/identity';
import {
  isOcrScannedPdfsEnabled,
  isPdfIndexingEnabled,
  MemoryService,
  setMemoryEnabledReader,
  setOcrScannedPdfsEnabledReader,
  setMatterResolver,
  setPdfIndexingEnabledReader,
  setPrivilegeResolver,
  setRetrievalHitExclusion,
  resetRetrievalHitExclusion,
  setSourceIdForms,
  resetSourceIdForms,
  type RagHit,
} from '@/platform/rag/MemoryService';
import {
  createRetagScheduler,
  type RetagScheduler,
} from '@/platform/rag/retagScheduler';
import {
  getExcludedMatterFolders,
  getExcludedMailMatters,
  isAllMailHeld,
  isAllFilesHeld,
  useScopeUpdateStore,
} from '@/platform/rag/scopeUpdateStore';
import {
  usePendingMailRetagStore,
  pendingMailRetagHydrationSuspect,
} from '@/platform/rag/pendingMailRetagStore';
import {
  usePendingFolderRetagStore,
  pendingFolderRetagHydrationSuspect,
} from '@/platform/rag/pendingFolderRetagStore';
import {
  beginPendingMailRagRetagStartupHold,
  isPendingMailRagRetagLoading,
  isPendingMailRagRetagSource,
  setPendingMailRagRetagSources,
} from '@/platform/rag/pendingMailRagRetagHold';
import {
  pendingDeletedMatterHydrationSuspect,
  purgePendingDeletedMattersForWorkspace,
  usePendingDeletedMatterStore,
} from '@/platform/rag/pendingDeletedMatterStore';
import { getMatters, useMatterStore } from '@/platform/matter/matterStore';
import {
  buildMailMatterMap,
  isPathInFolder,
  mailFolderKey,
  parseMailFolderKey,
  resolveWorkspaceMatterId,
} from '@/platform/rag/matterResolver';
import { UNASSIGNED_MATTER_ID } from '@/platform/types/matter';
import {
  mailBackfillRag,
  mailListPendingRagRetags,
  mailRepairPendingRagRetags,
  mailRetagFolderMatter,
} from '@/platform/utils/mail-commands';
import {
  resolvePrivilegeForSource,
  usePrivilegeStore,
} from '@/platform/firm/privilegeStore';
import type { PrivilegeMap } from '@/platform/rag/privilegeResolver';
import { createFactsService, type FactsStorage } from '@/platform/rag/FactsService';
import {
  setFactsService,
  setFactsInjectionReader,
  setFactsAutoAcceptReader,
} from '@/platform/rag/factsSingleton';
import {
  MODEL_DOWNLOAD_EVENT,
  modelStatus,
  ragManifestPdfFresh,
  resolveWorkspaceDataDirName,
  watchWorkspace,
  type ModelDownloadProgress,
  type WorkspaceChangeEvent,
} from '@/platform/utils/tauri-commands';
import { mailSetWorkspace } from '@/platform/utils/mail-commands';
import { docusignSetWorkspace } from '@/platform/utils/docusign-commands';
import { jotformSetWorkspace } from '@/platform/utils/jotform-commands';
import { zocksSetWorkspace } from '@/platform/utils/zocks-commands';
import { addeparSetWorkspace } from '@/platform/utils/addepar-commands';
import { crmSetWorkspace } from '@/platform/utils/wealthbox-commands';
import { useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';
import { externalWriteSetWorkspace } from '@/platform/utils/external-write-commands';
import { useExternalWriteQueueStore } from '@/platform/state/externalWriteQueueStore';
import { oneDriveSetWorkspace } from '@/platform/utils/onedrive-commands';
import { boxSetWorkspace } from '@/platform/utils/box-commands';
import { sharefileSetWorkspace } from '@/platform/utils/sharefile-commands';
import { calendlySetWorkspace } from '@/platform/utils/calendly-commands';
import { calendarSetWorkspace } from '@/platform/utils/calendar-commands';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import type { FileNode } from '@/platform/types/workspace';
import { usePdfIndexProgressStore } from '@/platform/rag/pdfIndexProgressStore';

/** Build a FactsStorage adapter from a WorkspaceService-shaped object. */
export function buildFactsStorage(
  workspaceService: MemoryWiringWorkspaceService,
  rootPath: string,
): FactsStorage {
  const resolve = (relative: string) => workspacePath(rootPath, relative);
  return {
    read: (relative) => workspaceService.readFile(resolve(relative)),
    write: (relative, content) =>
      workspaceService.writeFile(resolve(relative), content),
    exists: (relative) => workspaceService.exists(resolve(relative)),
    remove: workspaceService.delete
      ? (relative) => workspaceService.delete!(resolve(relative))
      : async () => {
          /* no-op if delete isn't exposed; stale .tmp is harmless */
        },
  };
}

/** Shape of the workspace service passed to useMemoryWiring.
 *  Requires readFileBinary for A3 PDF indexing in addition to the
 *  existing text-read / write / exists / delete methods. */
export type MemoryWiringWorkspaceService = {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  delete?: (path: string) => Promise<void>;
  /** A3: binary read for PDF extraction. */
  readFileBinary?: (path: string) => Promise<ArrayBuffer>;
  /**
   * WS-B/C: live disk scan returning the full workspace file tree. When
   * present (Tauri desktop), the folder-mapping change subscriber uses this
   * instead of the cached in-memory tree so externally-added files are
   * discovered and re-indexed immediately after a matter is assigned.
   */
  getFileTree?: (opts?: { fresh?: boolean }) => Promise<FileNode[]>;
};

type WorkspaceIdentitySnapshot = Readonly<{
  rootPath: string | null;
  rootGeneration: number;
}>;

function captureWorkspaceIdentity(): WorkspaceIdentitySnapshot {
  const { rootPath, rootGeneration } = useWorkspaceStore.getState();
  return { rootPath, rootGeneration };
}

function isWorkspaceIdentityCurrent(snapshot: WorkspaceIdentitySnapshot): boolean {
  const { rootPath, rootGeneration } = useWorkspaceStore.getState();
  return rootPath === snapshot.rootPath && rootGeneration === snapshot.rootGeneration;
}

/**
 * QA-44 (R7-1) — thrown by a scheduler re-tag op when the workspace identity
 * changed WHILE the op was in flight (a switch, or an in-place reload that bumps
 * the generation). Origin's identity guards make the underlying re-tag return
 * QUIETLY on such an abort; that bare resolution would otherwise read as a CLEAN
 * SUCCESS to the caller and clear a fail-closed hold without having re-tagged
 * anything. Throwing this makes the abort a DISTINCT outcome: the scheduler's
 * catch keeps the hold (and, if not disposed, retries under the new identity),
 * and no discharge path runs.
 */
class WorkspaceIdentityChangedError extends Error {
  constructor() {
    super('workspace identity changed during re-tag; fail-closed hold kept');
    this.name = 'WorkspaceIdentityChangedError';
  }
}

/** Collect all .pdf paths from a FileNode tree recursively. */
function collectPdfPaths(nodes: FileNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.type === 'file' && node.name.toLowerCase().endsWith('.pdf')) {
      out.push(node.path);
    } else if (node.type === 'folder' && node.children) {
      out.push(...collectPdfPaths(node.children));
    }
  }
  return out;
}

/** Collect every file path in a FileNode tree recursively. */
function collectAllFilePaths(nodes: FileNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      out.push(node.path);
    } else if (node.children) {
      out.push(...collectAllFilePaths(node.children));
    }
  }
  return out;
}

function toForwardSlashPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * fix/ask-list-hang — true when a path lives inside the app's own internal
 * workspace data directory (`.lantern/`). These files (e.g. the MCP
 * session-scope file, the RAG manifest, the vector store) are Advisor Prep
 * Hero's private plumbing, NOT user documents, and must never be fed to the RAG
 * indexer. The full-workspace walk already skips `.lantern` via
 * `is_skipped_dir_name`; the single-file watcher path did not, so the MCP
 * session-scope heartbeat's repeated `.lantern/mcp-session-scope.json` rewrites
 * were re-indexed on every change — keeping LanceDB perpetually busy and
 * starving the on-demand Ask retrieval into an indefinite hang. Matches a
 * `.lantern` path SEGMENT (not a substring) across both separators, so a real
 * user file whose name merely contains ".lantern" is unaffected.
 */
export function isInternalWorkspacePath(path: string): boolean {
  const segments = toForwardSlashPath(path).split('/');
  return segments.includes(WORKSPACE_DATA_DIR);
}

/**
 * Convert a workspace-relative path into the same absolute forward-slash path
 * shape the RAG store uses. Joining itself is delegated to the canonical
 * `joinWorkspacePath` (appPath.ts) — the same helper `matterStore.ts` uses to
 * canonicalize `Matter.folderPaths` — instead of a second, hand-rolled join
 * that normalized separators but never collapsed doubled ones the way
 * `joinWorkspacePath` does.
 */
export function buildWorkspaceAbsolutePath(rootPath: string | null | undefined, path: string): string {
  if (!rootPath || isAbsolutePath(path)) return toForwardSlashPath(path);
  return joinWorkspacePath(rootPath, path);
}

function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith('.pdf');
}

function buildBinaryWorkspace(workspaceService: MemoryWiringWorkspaceService): {
  readBinary: (path: string) => Promise<ArrayBuffer>;
} | null {
  if (!workspaceService.readFileBinary) return null;
  return {
    readBinary: (path: string) => workspaceService.readFileBinary!(path),
  };
}

async function getFreshOrCachedFileTree(
  workspaceService: MemoryWiringWorkspaceService | null | undefined,
): Promise<FileNode[]> {
  if (workspaceService?.getFileTree) {
    try {
      return await workspaceService.getFileTree();
    } catch {
      // Disk scan failed. Fall back to the cached in-memory tree.
    }
  }
  return useWorkspaceStore.getState().fileTree;
}

/**
 * Like getFreshOrCachedFileTree, but RETRIES the live disk scan with bounded
 * backoff until the workspace backend is initialized and the tree is non-empty.
 *
 * The on-open full index can fire BEFORE the workspace finishes initializing
 * (most reliably when the embedding model is already cached, so indexing starts
 * immediately). At that instant `getFileTree()` throws "workspace not
 * initialized" and the plain helper falls back to the EMPTY cached tree, so
 * `collectPdfPaths` returns [] and no PDFs index — the single biggest "it
 * doesn't just work on import" gap (demo bug log A2). Retrying until the scan
 * succeeds makes the on-open PDF index reliable.
 */
async function getFreshTreeWithRetry(
  workspaceService: MemoryWiringWorkspaceService | null | undefined,
  maxAttempts = 14,
  delayMs = 500,
): Promise<FileNode[]> {
  // A successful (non-throwing) getFileTree means the backend IS initialized,
  // even if the tree is momentarily empty during the populate race. Remember
  // the last such result so we can prefer it over a stale cached tree if we
  // never see a populated scan.
  let lastInitialized: FileNode[] | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (workspaceService?.getFileTree) {
      try {
        // P1.1 (Task 6): FORCE a real scan each retry. `getFileTree` now caches
        // the boot scan; a plain call would hand back the SAME cached (possibly
        // settled-empty) tree on every retry, defeating the populate-race retry
        // this helper exists for. `{ fresh: true }` re-scans AND repopulates the
        // shared cache once a populated tree is seen.
        const tree = await workspaceService.getFileTree({ fresh: true });
        if (Array.isArray(tree) && tree.length > 0) return tree;
        lastInitialized = Array.isArray(tree) ? tree : [];
      } catch {
        // Workspace not initialized yet — back off and retry.
        lastInitialized = null;
      }
    }
    // Skip the sleep after the final attempt — no point waiting to give up.
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Gave up waiting on a populated scan — prefer a confirmed-initialized (even
  // if empty) tree over a possibly-stale cached one.
  return lastInitialized ?? useWorkspaceStore.getState().fileTree;
}

function pathForms(path: string, rootPath: string | null | undefined): string[] {
  const forms = new Set<string>();
  forms.add(toForwardSlashPath(path));
  if (rootPath) {
    forms.add(buildWorkspaceAbsolutePath(rootPath, path));
  }
  return Array.from(forms);
}

function pathInAnyFolder(path: string, folders: string[], rootPath: string | null | undefined): boolean {
  const forms = pathForms(path, rootPath);
  return folders.some((folder) => {
    const folderForms = pathForms(folder, rootPath);
    return forms.some((form) =>
      folderForms.some((folderForm) => isPathInFolder(form, folderForm)),
    );
  });
}

function workspaceRelativePath(path: string, rootPath: string | null | undefined): string | null {
  if (!rootPath) return null;
  const normalizedPath = toForwardSlashPath(path);
  const normalizedRoot = toForwardSlashPath(rootPath);
  if (normalizedPath === normalizedRoot) return '';
  const prefix = `${normalizedRoot}/`;
  if (!normalizedPath.startsWith(prefix)) return null;
  return normalizedPath.slice(prefix.length);
}

/**
 * Resolve a matter id for a file path that may be workspace-relative (as
 * MainPanel's open tabs store it) OR already absolute (as `Matter.folderPaths`
 * store it, or as the RAG indexer's file-watcher paths are). Exported (Wave 0)
 * so any caller with a tab path + the workspace root can resolve correctly —
 * this is now the ONE resolver every caller uses (indexer, docx toolbar
 * button-gating, Draft-follow-up "To" suggestion): it used to be two
 * independently-maintained implementations (this one, plus a
 * `resolveMatterIdWithWorkspaceForms` registered only for the RAG indexer)
 * that had silently diverged — the indexer's version additionally tried a
 * workspace-relative-derived form that this one skipped. A caller resolving a
 * workspace path to its matter is a matter-isolation-relevant check (it gates
 * a CRM write and an auto-suggested recipient), so it must not depend on
 * which entry point happened to reach it.
 *
 * Considers up to three SHAPES of the same logical path TOGETHER (not
 * sequential candidates to fall through until one "succeeds" — see
 * `resolveMatterMatchAcrossForms`'s doc comment for why that distinction
 * matters: a stale/legacy-relative folder entry matching one shape must
 * never paper over a real cross-matter ambiguity found via another shape of
 * the identical file — Codex review, smoke-2 P0 #5 fix):
 *   1. the raw path as-is (handles an already-absolute path, and the rare
 *      legacy matter with a genuinely relative `folderPaths` entry — see
 *      `matterStore.ts`'s `resolveAbsolute` doc comment);
 *   2. if `path` is itself absolute and under `rootPath`, the path relative
 *      to `rootPath` (handles that same legacy-relative-entry case when the
 *      caller passes an absolute path instead of a relative one);
 *   3. if `path` is workspace-relative, the `rootPath`-joined absolute form
 *      (the common case — `Matter.folderPaths` are absolute).
 */
export function resolveMatterIdForWorkspacePath(path: string, rootPath: string | null | undefined): string {
  return resolveWorkspaceMatterId(path, rootPath, getMatters());
}

/** Thin wrapper matching the `MatterResolver` signature `MemoryService` expects
 *  (no `rootPath` parameter — it reads the live workspace root itself). */
function resolveMatterIdWithWorkspaceForms(path: string): string {
  return resolveMatterIdForWorkspacePath(path, useWorkspaceStore.getState().rootPath);
}

/**
 * Delete-flood guard (frontend half — the backend LanceDB writer-race is a
 * separate lane). A mass delete (e.g. dragging a folder with thousands of
 * files to trash) fires one `workspace-file-changed` event PER FILE. Firing
 * `MemoryService.deletePath` per event with no error handling meant a
 * 2,000+ file storm issued that many concurrent backend calls AND surfaced
 * every failure as an unhandled-rejection pageerror (2,292 of them observed
 * in a 4-minute bench). This batcher:
 *   1. buffers paths over a short window and dedupes repeats, so a storm
 *      becomes one bounded, SEQUENTIAL sweep instead of N concurrent calls;
 *   2. never rejects — every call is wrapped, failures are logged once per
 *      batch, not once per file;
 *   3. opens a breaker after N consecutive failures, bounding a doomed burst
 *      to at most N backend calls per cooldown cycle (never hammers a fully
 *      down backend). Every path is PAUSED, never dropped — a failed or
 *      not-yet-attempted path is put back on the queue, with not-yet-
 *      attempted paths rotated to the FRONT so the same leading run of
 *      chronic failures can't perpetually block what's behind it. A delete
 *      is a privacy operation (a deleted client file must stop being
 *      searchable); losing one silently would leave stale content indexed
 *      indefinitely, so this batcher only ever paces and reorders retries,
 *      never abandons a path;
 *   4. exposes `cancel(path)` so the caller can drop a queued delete when a
 *      create/modify for the SAME path arrives first — otherwise a
 *      delete-then-recreate within the buffer window (an atomic save/replace
 *      or a sync restore) would index the fresh content and then have the
 *      stale queued delete remove it moments later.
 */
export type DeleteBurstBatcherOptions = {
  /** How long to buffer incoming paths before issuing the batch. */
  windowMs?: number;
  /** Consecutive per-path failures before the breaker opens. */
  breakerThreshold?: number;
  /** How long the breaker stays open (pauses retries) once tripped. */
  cooldownMs?: number;
  /** Injectable for tests; defaults to console.warn. */
  onLog?: (message: string) => void;
  /**
   * Called (best-effort, fire-and-forget — errors are swallowed) when a
   * path's delete was cancelled by a create/modify that arrived WHILE its
   * `deletePath` call was already in flight and had ALREADY SUCCEEDED by the
   * time the cancellation was noticed. `cancel()` can mark such a path but
   * can't un-send the request already issued, so the delete may have just
   * removed chunks the create/modify handler wrote moments before. The
   * caller should re-index `path` to restore it.
   */
  onCancelledAfterDelete?: (path: string) => void;
};

export type DeleteBurstBatcher = {
  /** Queue a path for deletion; the batch flushes after `windowMs` of quiet. */
  enqueue: (path: string) => void;
  /**
   * Drop a queued-but-not-yet-flushed delete for `path`, if one is pending.
   * Returns true if a queued delete was cancelled. Call this when a
   * create/modify event for the same path arrives, so a delete→recreate
   * race can't remove freshly-indexed content.
   */
  cancel: (path: string) => boolean;
  /** Cancel any pending timers and drop queued paths (call on teardown). */
  dispose: () => void;
};

const DEFAULT_DELETE_BATCH_WINDOW_MS = 250;
const DEFAULT_DELETE_BREAKER_THRESHOLD = 5;
const DEFAULT_DELETE_BREAKER_COOLDOWN_MS = 15_000;

export function createDeleteBurstBatcher(
  deletePath: (path: string) => Promise<void>,
  options: DeleteBurstBatcherOptions = {},
): DeleteBurstBatcher {
  const windowMs = options.windowMs ?? DEFAULT_DELETE_BATCH_WINDOW_MS;
  const breakerThreshold = options.breakerThreshold ?? DEFAULT_DELETE_BREAKER_THRESHOLD;
  const cooldownMs = options.cooldownMs ?? DEFAULT_DELETE_BREAKER_COOLDOWN_MS;
  const log =
    options.onLog ??
    ((message: string) => {
      console.warn(message);
    });
  const onCancelledAfterDelete = options.onCancelledAfterDelete;

  let pending = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  let isFlushing = false;
  let consecutiveFailures = 0;
  let breakerOpenUntil = 0;
  let disposed = false;
  // Read through a function, not the bare `disposed` binding, at every
  // check inside `flush`'s loop. `dispose()` is a SEPARATE closure the
  // caller can invoke at any point — including during an `await` this
  // function is suspended on — so `disposed` genuinely can change between
  // one check and the next even though nothing in `flush`'s own textual
  // body assigns it. TypeScript's control-flow narrowing can't see that
  // (it only tracks mutations reachable from this function's own code) and
  // flags the checks as always-true/false; reading through a function call
  // is opaque to that narrowing while still observing the live value.
  const isDisposed = () => disposed;
  // The current round's snapshot (see `flush`) and which of its paths have
  // been cancelled since being pulled out of `pending`. A path is briefly
  // "in flight" — no longer in `pending`, but not yet attempted — between
  // the moment a round snapshots it and the moment its turn comes up in the
  // for-loop below. `cancel()` alone can't reach it there (it only touches
  // `pending`), so a create/modify arriving in that window would otherwise
  // still let the stale delete run and remove the fresh content moments
  // after indexing it. These two let `cancel()` reach an in-flight path too.
  let inFlightPaths: Set<string> | null = null;
  let cancelledInFlight = new Set<string>();

  // Wakes the batcher up once a breaker's cooldown elapses, even if no new
  // path is ever enqueued in the meantime — otherwise paths queued at trip
  // time (or added during the cooldown) would have nothing left to trigger
  // their retry.
  const scheduleCooldownRetry = (delayMs: number) => {
    if (cooldownTimer || disposed) return;
    cooldownTimer = setTimeout(() => {
      cooldownTimer = null;
      void flush();
    }, delayMs);
  };

  // Drains `pending` in a loop rather than a single pass, guarded by
  // `isFlushing`. A sustained delete storm keeps calling `enqueue` while a
  // batch is still awaiting `deletePath`; without this guard a new debounce
  // timer would fire and start a SECOND concurrent flush, bringing back the
  // exact overlapping-backend-calls problem this batcher exists to prevent.
  // New arrivals during an in-flight flush are simply picked up by the next
  // loop iteration — no extra timer needed.
  const flush = async (): Promise<void> => {
    flushTimer = null;
    if (isFlushing || disposed) return;
    if (Date.now() < breakerOpenUntil) {
      // Still cooling down. Don't touch `pending` — nothing queued is ever
      // dropped, it just waits for the scheduled retry below.
      scheduleCooldownRetry(breakerOpenUntil - Date.now());
      return;
    }
    isFlushing = true;
    // Reset once per flush invocation (i.e. once per cooldown wake-up), not
    // per internal while-round. Otherwise a single path that NEVER recovers
    // stays first in `pending` (Set insertion order) and, since its failure
    // count was already at/above threshold when the breaker last tripped,
    // instantly re-trips on the very next attempt. Resetting here gives every
    // post-cooldown attempt a fresh threshold budget.
    consecutiveFailures = 0;
    try {
      while (pending.size > 0 && !isDisposed()) {
        const paths = Array.from(pending);
        pending = new Set();
        inFlightPaths = new Set(paths);
        cancelledInFlight = new Set();
        let failed = 0;
        let breakerTripped = false;
        for (const path of paths) {
          if (isDisposed()) return;
          if (cancelledInFlight.delete(path)) {
            // Cancelled after this round snapshotted it but before we even
            // started it — a create/modify beat us to it. Skip the stale
            // delete entirely; the fresh content stays indexed.
            inFlightPaths.delete(path);
            continue;
          }
          // Deliberately KEEP `path` in `inFlightPaths` through the whole
          // await below (only cleared in `finally`) — not just until we
          // start it. A create/modify can still race the ALREADY-ISSUED
          // `deletePath` call itself (not just the queue); `cancel()` can't
          // un-send that call, but it CAN mark it here so we notice once it
          // settles.
          try {
            // Deliberate: sequential, bounded processing is the fix (never N
            // concurrent backend calls).
            await deletePath(path);
            if (isDisposed()) return;
            // The workspace could have closed/switched WHILE this delete was
            // in flight. Bail before any bookkeeping or recovery below —
            // `onCancelledAfterDelete` re-indexes via the shared
            // MemoryService, which targets whatever workspace is CURRENTLY
            // active on the backend; running it after a switch would
            // misroute this (old-workspace) path's content into the NEW
            // workspace's index. The disposed batcher's own `pending` is
            // already discarded, so there is nothing left worth updating
            // here either way.
            consecutiveFailures = 0;
            if (cancelledInFlight.delete(path)) {
              // A create/modify arrived WHILE this delete was already in
              // flight — too late for `cancel()` to stop the call, and the
              // delete has now completed (successfully) AFTER the file was
              // recreated. It may have just removed the fresh content's
              // chunks (if the create/modify handler's own re-index landed
              // before this delete finished). Ask the caller to re-index
              // this path to restore it. Best-effort: never let this
              // recovery hook break the flush loop.
              try {
                onCancelledAfterDelete?.(path);
              } catch {
                // Best-effort recovery hook.
              }
            }
          } catch {
            if (isDisposed()) return; // same guard on the failure path
            failed += 1;
            consecutiveFailures += 1;
            if (cancelledInFlight.delete(path)) {
              // Cancelled AND the delete failed: nothing to undo (no rows
              // were removed) and nothing to retry — the create/modify
              // handler already re-indexed the recreated file, so requeuing
              // a delete for this path would just remove it again once
              // retried. Drop it here; that's the correct outcome of the
              // cancellation, not a lost delete.
            } else {
              // Never lose this path: a failed delete is retried, not abandoned.
              pending.add(path);
            }
            if (consecutiveFailures >= breakerThreshold) {
              // Stop attempting NOW — bounded exposure. A 2,000-file delete
              // storm against a fully-down backend must cost at most
              // `breakerThreshold` doomed calls per cooldown cycle, not
              // hammer through the whole burst before backing off.
              breakerOpenUntil = Date.now() + cooldownMs;
              // Fairness: paths this round never even got to attempt go to
              // the FRONT of the next round, AHEAD of the run that just
              // tripped the breaker. Without this, the same leading
              // chronically-bad paths would occupy the front of `pending`
              // again next round (Set insertion order) and re-trip before
              // ever reaching what's behind them — starving good deletes
              // forever. Rotating guarantees every path gets priority for a
              // real attempt within one cooldown cycle of being blocked.
              // Exclude anything already cancelled in-flight — a create/
              // modify already told us that path exists again; requeuing it
              // here would undo the cancellation and let it get deleted
              // again once this round's requeue is retried.
              const notYetAttempted = paths
                .slice(paths.indexOf(path) + 1)
                .filter((p) => !cancelledInFlight.has(p));
              pending = new Set([...notYetAttempted, ...pending]);
              log(
                `[memory] ${String(consecutiveFailures)} consecutive delete failures; backing off for ${String(cooldownMs)}ms, ` +
                  `retrying ${String(pending.size)} pending delete event(s) after cooldown`,
              );
              scheduleCooldownRetry(cooldownMs);
              breakerTripped = true;
              break;
            }
          } finally {
            inFlightPaths.delete(path);
          }
        }
        if (breakerTripped) break;
        if (failed > 0) {
          log(`[memory] ${String(failed)} of ${String(paths.length)} delete event(s) failed; retrying`);
        }
      }
    } finally {
      isFlushing = false;
      // Nothing is "in flight" once we're outside the for-loop (this round's
      // leftovers, if any, are back in `pending`, reachable by `cancel()`
      // the normal way) — clear so a `cancel()` between now and the next
      // round's snapshot can't match a stale reference.
      inFlightPaths = null;
    }
  };

  return {
    enqueue(path: string) {
      if (disposed) return;
      pending.add(path);
      // While a flush is in-flight it will drain this addition itself (see
      // above) — starting a timer here would race a second flush in.
      if (!flushTimer && !isFlushing) {
        flushTimer = setTimeout(() => {
          void flush();
        }, windowMs);
      }
    },
    cancel(path: string): boolean {
      // Check BOTH — never short-circuit. A duplicate delete event for the
      // same path during an active round can leave a copy in `pending` (a
      // fresh enqueue) AND a stale copy already snapshotted in-flight at the
      // same time; cancelling must defeat both; stopping at the first found
      // would leave the other to still run and delete freshly-recreated
      // content.
      const removedFromPending = pending.delete(path);
      let cancelledInFlightNow = false;
      if (inFlightPaths?.has(path)) {
        cancelledInFlight.add(path);
        cancelledInFlightNow = true;
      }
      return removedFromPending || cancelledInFlightNow;
    },
    dispose() {
      disposed = true;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (cooldownTimer) {
        clearTimeout(cooldownTimer);
        cooldownTimer = null;
      }
      if (pending.size > 0) {
        // Deliberately NOT fired here. `deletePath` (rag_delete_path) has no
        // per-call workspace-scoping parameter — it always targets whatever
        // workspace is CURRENTLY active on the Rust side. On a workspace
        // switch, the next effect's `MemoryService.setWorkspace(newRoot)`
        // can race ahead of an async IPC call fired from here (a Tauri
        // invoke crosses the IPC boundary asynchronously; there is no
        // ordering guarantee it reaches the backend before the new
        // workspace is set). Firing these now risks misrouting an OLD
        // workspace's deletes into the NEW workspace's index — a worse bug
        // than the one being avoided. A workspace-scoped delete command
        // would need a Rust-side signature change, out of scope for this
        // frontend fix. The Rust boot reconcile heals the OLD workspace's
        // index the next time it's opened, so these paths are stale until
        // then, not permanently lost.
        log(
          `[memory] workspace closed with ${String(pending.size)} delete(s) still queued; ` +
            'leaving them for the next boot reconcile rather than risk misrouting to a new workspace',
        );
      }
      pending = new Set();
    },
  };
}

export type WorkspaceFileChangedHandlerDeps = {
  deleteBatcher: Pick<DeleteBurstBatcher, 'enqueue' | 'cancel'>;
  workspaceService: MemoryWiringWorkspaceService | null | undefined;
  /** See {@link createIndexRetryScheduler}. Owns the retry timers for THIS
   *  workspace mount so a switch/close can cancel them before they fire. */
  indexRetryScheduler: Pick<IndexRetryScheduler, 'schedule'>;
};

/**
 * QA-19: a single watcher-triggered index attempt used to be fire-and-forget
 * with no retry — a transient failure (e.g. a read racing the tail end of an
 * autosave write, or a lock held a moment too long) permanently dropped that
 * file from search until the next full boot reconcile. These are the delays
 * between retries; two retries at a short, then a longer, interval is enough
 * to ride out a write-in-flight race without turning a genuinely bad file
 * into an infinite retry loop.
 */
export const INDEX_FILE_RETRY_DELAYS_MS = [300, 1000];

export type IndexRetryScheduler = {
  /** Index `path`, retrying with backoff on failure. */
  schedule: (path: string) => void;
  /**
   * Cancel every pending retry timer WITHOUT running it. Must be called on
   * workspace close/switch (see the per-workspace effect's cleanup) — a
   * scheduled retry captures only a plain file path, not which workspace it
   * belonged to, and `MemoryService.indexFile` always targets whatever
   * workspace is CURRENTLY active on the Rust side. An uncancelled retry that
   * fires after a switch would therefore index an OLD workspace's file
   * straight into the NEW workspace's search index — a cross-client content
   * leak. (Flagged by codex-review on the first cut of this fix, which left
   * retries running forever with no cancellation handle.)
   */
  disposeAll: () => void;
};

/**
 * Create a scheduler that (re)indexes a file, retrying with backoff on
 * failure before giving up and logging loudly. One instance is owned per
 * workspace mount so its retries can be cancelled wholesale on close/switch
 * — see {@link IndexRetryScheduler.disposeAll}.
 */
export function createIndexRetryScheduler(): IndexRetryScheduler {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;

  const attempt = (path: string, retryCount: number): void => {
    MemoryService.indexFile(path).catch((err: unknown) => {
      if (disposed) return;
      if (retryCount < INDEX_FILE_RETRY_DELAYS_MS.length) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          attempt(path, retryCount + 1);
        }, INDEX_FILE_RETRY_DELAYS_MS[retryCount]);
        timers.add(timer);
      } else {
        console.error(
          `[memory] failed to index ${path} after ${String(retryCount + 1)} attempts; ` +
            'it will be picked up by the next reconcile instead',
          err,
        );
      }
    });
  };

  return {
    schedule(path: string) {
      attempt(path, 0);
    },
    disposeAll() {
      disposed = true;
      timers.forEach((timer) => {
        clearTimeout(timer);
      });
      timers.clear();
    },
  };
}

/**
 * Route one `workspace-file-changed` event: buffer deletes through the burst
 * batcher, and for a create/modify, first cancel any delete still queued for
 * the same path (the delete→recreate race guard — see
 * createDeleteBurstBatcher) before (re)indexing it. Extracted out of the
 * `listen()` callback so the race guard is unit-testable without standing up
 * the full Tauri event-listener machinery.
 */
export function handleWorkspaceFileChangedEvent(
  payload: WorkspaceChangeEvent | null | undefined,
  deps: WorkspaceFileChangedHandlerDeps,
): void {
  if (!payload?.path) return;
  const { deleteBatcher, workspaceService, indexRetryScheduler } = deps;
  // fix/ask-list-hang — NEVER react to churn in the app's own internal
  // `.lantern/` directory (the MCP session-scope heartbeat rewrites a file
  // there constantly). This must run BEFORE the delete queue / PDF indexing
  // below: an internal-file event should never even enter the coalescing
  // batcher (it would otherwise sit there consuming a debounce window and
  // a breaker "slot" for something that must never be deleted or indexed)
  // or trigger a PDF (re)index. Internal files are never user documents.
  if (isInternalWorkspacePath(payload.path)) return;
  // Best-effort: don't await, don't surface errors.
  const isPdf = payload.path.toLowerCase().endsWith('.pdf');
  if (payload.kind === 'delete') {
    // Buffered/bounded/backoff-guarded — see createDeleteBurstBatcher.
    deleteBatcher.enqueue(payload.path);
    return;
  }
  // A create/modify for this path means it exists again — drop any delete
  // still queued for it (delete-then-recreate within the buffer window, e.g.
  // an atomic save/replace or a sync restore) so the fresh content isn't
  // removed moments after being indexed.
  deleteBatcher.cancel(payload.path);
  if (isPdf && workspaceService) {
    // Only re-index PDF on change if the toggle is on.
    if (isPdfIndexingEnabled() && workspaceService.readFileBinary) {
      const binaryWs = {
        readBinary: (p: string) => workspaceService.readFileBinary!(p),
      };
      void MemoryService.indexPdfFile(payload.path, binaryWs).catch(() => {});
    }
  } else {
    indexRetryScheduler.schedule(payload.path);
  }
}

/**
 * WS-B/C — diff two matter lists and return the set of folder paths whose
 * matter assignment changed (added, removed, or moved between matters). When a
 * mapping changes we re-index every file under the affected folders so their
 * chunks pick up the right matter id.
 */
export function changedFolderPaths(
  prev: Array<{ id: string; folderPaths: string[] }>,
  next: Array<{ id: string; folderPaths: string[] }>,
): string[] {
  const before = new Map<string, string>(); // folder -> matterId
  for (const m of prev) for (const f of m.folderPaths) before.set(f, m.id);
  const after = new Map<string, string>();
  for (const m of next) for (const f of m.folderPaths) after.set(f, m.id);

  const changed = new Set<string>();
  for (const [folder, id] of after) {
    if (before.get(folder) !== id) changed.add(folder);
  }
  for (const [folder] of before) {
    if (!after.has(folder)) changed.add(folder); // folder removed from a matter
  }
  return Array.from(changed);
}

/**
 * WS-B/C — diff two matters' mail-folder mappings and return the set of mail
 * folder keys whose matter assignment changed (added, removed, or moved between
 * matters), as `{ key, matterId }` (the resolved matter id after the change, or
 * the unassigned sentinel when the key was unmapped). When a mapping changes we
 * re-tag the already-synced mail in that folder so retrieval scoping updates
 * immediately. Mirrors `changedFolderPaths` but for mail folder keys.
 */
export function changedMailFolderPaths(
  prev: Array<{ id: string; mailFolderPaths?: string[] }>,
  next: Array<{ id: string; mailFolderPaths?: string[] }>,
): Array<{ key: string; matterId: string; prevMatterId: string }> {
  const before = new Map<string, string>(); // key -> matterId
  for (const m of prev) for (const k of m.mailFolderPaths ?? []) before.set(k, m.id);
  const after = new Map<string, string>();
  for (const m of next) for (const k of m.mailFolderPaths ?? []) after.set(k, m.id);

  // key -> resolved matterId after change. `prevMatterId` (the matter it was
  // filed under BEFORE the change, or unassigned) rides along (QA-44) so a
  // re-map that fails can hold out the OLD client's mail from retrieval.
  const changed = new Map<string, string>();
  for (const [key, id] of after) {
    if (before.get(key) !== id) changed.set(key, id);
  }
  for (const [key] of before) {
    if (!after.has(key)) changed.set(key, UNASSIGNED_MATTER_ID); // unmapped -> unassigned
  }
  return Array.from(changed, ([key, matterId]) => ({
    key,
    matterId,
    prevMatterId: before.get(key) ?? UNASSIGNED_MATTER_ID,
  }));
}

/**
 * WS-PRIV — diff two privilege maps and return the set of source ids whose
 * privilege changed (added, removed, or value-changed). When a source's
 * privilege changes we re-tag its already-indexed chunks so default retrieval
 * picks up the new exclusion immediately.
 */
export function changedPrivilegeSources(
  prev: PrivilegeMap,
  next: PrivilegeMap,
): string[] {
  const changed = new Set<string>();
  for (const key of Object.keys(next)) {
    if (prev[key] !== next[key]) changed.add(key);
  }
  for (const key of Object.keys(prev)) {
    if (!(key in next)) changed.add(key); // privilege cleared back to "none"
  }
  return Array.from(changed);
}

/**
 * WS-B/C — re-index all files under the changed folders using the current
 * source of truth. When the workspace service exposes `getFileTree`, a fresh
 * disk scan is performed so externally-added files (not yet reflected in the
 * cached in-memory tree) are included. Falls back to the cached tree in
 * browser / test mode or when the disk scan fails. Exported for unit testing.
 *
 * Groups the affected paths by their resolved matter id and submits each
 * group to `MemoryService.reindexPaths`, which handles per-file privilege
 * preservation internally.
 *
 * QA-44 (Codex round 1): THROWS if any affected file could not be re-tagged, so
 * the caller (the re-tag scheduler) keeps the folders excluded from retrieval
 * and retries, rather than treating a partial re-tag as a clean success. For
 * PDFs the matter tag is corrected IN PLACE first (reliable — an in-place retag
 * cannot "skip" the way a re-embed can for scanned/encrypted/OCR-off files),
 * then a best-effort re-embed refreshes content; a re-embed skip therefore never
 * leaves a stale wrong-client matter tag behind.
 */
export async function reindexFolderPaths(
  folders: string[],
  workspaceService: MemoryWiringWorkspaceService | null | undefined,
  workspaceIdentity: WorkspaceIdentitySnapshot = captureWorkspaceIdentity(),
): Promise<void> {
  const { rootPath } = workspaceIdentity;
  const allPaths = collectAllFilePaths(await getFreshOrCachedFileTree(workspaceService));
  if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return;

  const affected = allPaths.filter((p) => pathInAnyFolder(p, folders, rootPath));

  const pdfPaths = affected.filter(isPdfPath);
  const officeAndTextPaths = affected.filter((p) => !isPdfPath(p));

  let failures = 0;

  // Group by resolved matter id so we re-index in matter batches. Matter
  // resolution uses the workspace-relative path, then the backend receives the
  // absolute path shape the Rust full-workspace walk stores.
  const byMatter = new Map<string, string[]>();
  for (const p of officeAndTextPaths) {
    const id = resolveMatterIdForWorkspacePath(p, rootPath);
    const list = byMatter.get(id) ?? [];
    list.push(buildWorkspaceAbsolutePath(rootPath, p));
    byMatter.set(id, list);
  }
  for (const [matterId, paths] of byMatter) {
    // reindexPaths returns the count of files that failed (it never throws).
    // Identity guards: if the workspace switched/reloaded mid-pass, BAIL (return)
    // without throwing the failure error below — a stale pass must neither re-tag
    // the new workspace nor report a partial re-tag as a clean success. The caller
    // (the scheduler op / pre-mount fallback) re-checks identity after we resolve
    // and keeps the fail-closed hold when we bailed (QA-44 R7-1).
    if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return;
    failures += await MemoryService.reindexPaths(paths, matterId);
    if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return;
  }

  // PDFs: correct the matter tag in place (cannot skip), THEN best-effort
  // re-embed for content freshness. Only the in-place retag failing is a
  // fail-closed-relevant failure — a re-embed skip/failure leaves the (already
  // corrected) matter tag intact.
  if (isPdfIndexingEnabled() && workspaceService && pdfPaths.length > 0) {
    const binaryWs = buildBinaryWorkspace(workspaceService);
    if (binaryWs) {
      for (const path of pdfPaths) {
        if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return;
        const abs = buildWorkspaceAbsolutePath(rootPath, path);
        const matterId = resolveMatterIdForWorkspacePath(path, rootPath);
        try {
          await MemoryService.retagMatter(abs, matterId);
        } catch {
          // Could not correct the matter tag — keep the folder excluded + retry.
          failures += 1;
        }
        try {
          await MemoryService.indexPdfFile(abs, binaryWs);
        } catch {
          // Content refresh only; the matter tag was already corrected above.
        }
        if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return;
      }
    }
  }

  if (failures > 0) {
    throw new Error(
      `reindexFolderPaths: ${String(failures)} file(s) failed to re-tag; ` +
        'folders stay excluded from retrieval until a clean re-tag',
    );
  }
}

/** Walk all .pdf files in the workspace and index them via MemoryService. */
export async function indexWorkspacePdfs(
  workspaceService: MemoryWiringWorkspaceService,
  workspaceIdentity: WorkspaceIdentitySnapshot = captureWorkspaceIdentity(),
): Promise<void> {
  const binaryWs = buildBinaryWorkspace(workspaceService);
  if (!binaryWs) return;
  const { rootPath } = workspaceIdentity;
  // Retry the FRESH scan until the workspace backend is initialized and the tree
  // is loaded, so PDFs index reliably even when the index fires immediately on
  // open (the empty-cached-tree race that previously dropped ~80% of files).
  const pdfPaths = collectPdfPaths(await getFreshTreeWithRetry(workspaceService));
  if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return;
  if (pdfPaths.length === 0) return;
  const progress = usePdfIndexProgressStore.getState();
  progress.set({ processed: 0, total: pdfPaths.length, currentPath: null });
  try {
    // P1.1 (Task 3): whether OCR is on is part of a PDF's freshness signature, so
    // read it once and pass it to the manifest fresh-check below.
    const ocrEnabled = isOcrScannedPdfsEnabled();
    for (const [index, path] of pdfPaths.entries()) {
      if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return;
      const ragPath = buildWorkspaceAbsolutePath(rootPath, path);
      progress.set({ processed: index, total: pdfPaths.length, currentPath: ragPath });
      try {
        // P1.1 (Task 3): skip a PDF whose size/mtime + OCR setting are unchanged
        // since it was last indexed — PDF extraction + OCR is the single most
        // expensive per-file cost, so this is the biggest boot win for PDF-heavy
        // workspaces. A new/changed/tombstoned PDF returns false and re-indexes.
        if (await ragManifestPdfFresh(ragPath, ocrEnabled)) {
          if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return;
          continue;
        }
        if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return;
        await MemoryService.indexPdfFile(ragPath, binaryWs);
      } catch {
        // Best-effort: skip individual failures, continue with the rest.
      } finally {
        if (isWorkspaceIdentityCurrent(workspaceIdentity)) {
          progress.set({ processed: index + 1, total: pdfPaths.length, currentPath: ragPath });
        }
      }
      if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return;
    }
  } finally {
    progress.clearSoon();
  }
}

/** Fail-closed hold for the boot-time in-place matter retag (see
 *  {@link retagFolderPathsInPlace}). Holds the exact FILE paths that failed. */
const BOOT_RETAG_ID = 'matter:boot-retag';

/**
 * QA-44 (final round, P2) — when a LIVE per-folder retag of `folder` succeeds, it
 * has just re-tagged that folder's files, INCLUDING any the boot-time retag had
 * failed on and left held out under {@link BOOT_RETAG_ID}. That boot entry has a
 * DIFFERENT id (a single aggregate, not `matter:<folder>`), so the live success
 * never discharged it — leaving those files HIDDEN from search until a clean boot.
 * Prune the just-retagged folder's paths from the boot hold (removing it entirely
 * once empty) so a live success makes its files visible immediately.
 */
/** Prune every held prefix under `folder` from the scope hold `id` (removing the
 *  entry once empty), preserving its failed/visible state. Shared by the boot
 *  retag hold and the R7-3 durable folder hold. */
function pruneFolderFromScopeHold(id: string, folder: string, root: string | null): void {
  const store = useScopeUpdateStore.getState();
  const entry = store.entries[id];
  if (!entry) return;
  const remaining = entry.excludeFolders.filter((p) => !pathInAnyFolder(p, [folder], root));
  if (remaining.length === entry.excludeFolders.length) return; // nothing overlapped
  if (remaining.length === 0) {
    store.remove(id);
    return;
  }
  store.begin({
    id,
    kind: entry.kind,
    label: entry.label,
    excludeFolders: remaining,
    excludeMailMatters: entry.excludeMailMatters,
  });
  store.markFailed(id);
}

function dischargeBootRetagForFolder(folder: string): void {
  pruneFolderFromScopeHold(BOOT_RETAG_ID, folder, useWorkspaceStore.getState().rootPath);
}

/** QA-44 (R7-3) — scope-hold id for FILE-folder holds RESTORED from the durable
 *  per-workspace store on open. Distinct from the live per-folder `matter:<folder>`
 *  ids and the boot `matter:boot-retag` aggregate so it survives independently. */
const DURABLE_FOLDER_ID = 'matter:durable-folder';

/** QA-44 (R8, F3) — scope-hold id for the BLANKET all-files hold installed when the
 *  durable folder-retag store hydrated incompletely. The file mirror of the mail
 *  `mail:hydration-suspect` id; discharged when the boot folder retag runs clean. */
const FILE_HYDRATION_SUSPECT_ID = 'matter:hydration-suspect';

/** QA-44 (R7-3) — persist that these folder prefixes are held out (a live re-map is
 *  pending, or a boot in-place retag failed under them) so the hold survives a
 *  close/switch. The FILE mirror of `usePendingMailRetagStore.record`. */
function recordDurableFolderHold(root: string | null | undefined, folders: string[]): void {
  if (!root || folders.length === 0) return;
  usePendingFolderRetagStore.getState().hold(root, folders);
}

/** QA-44 (R7-3) — a re-tag of `folder` LANDED: release every durable held prefix
 *  under it AND prune the restored `matter:durable-folder` scope hold, so its files
 *  become visible immediately rather than staying hidden until the next boot. */
function dischargeDurableFolderHold(folder: string, root: string | null | undefined): void {
  if (!root) return;
  const held = usePendingFolderRetagStore.getState().forWorkspace(root);
  const under = held.filter((p) => pathInAnyFolder(p, [folder], root));
  if (under.length > 0) usePendingFolderRetagStore.getState().release(root, under);
  pruneFolderFromScopeHold(DURABLE_FOLDER_ID, folder, root);
}

/**
 * QA-44 (R7-3) — re-establish this workspace's DURABLE file-folder holds
 * SYNCHRONOUSLY on open (fail closed) BEFORE the slow boot chain runs — the FILE
 * mirror of {@link restoreMailHolds}. Without it, a folder whose live re-map failed
 * in a prior session has NO hold from workspace-open until the boot in-place retag
 * reaches it, and that retag runs LAST in the boot chain (minutes on a large
 * workspace) — a cross-session wrong-client window. Entries use the dedicated
 * `matter:durable-folder` id; a live or boot success discharges them.
 */
export function restoreFolderHolds(workspaceRoot: string | null | undefined): void {
  if (!workspaceRoot) return;
  const held = usePendingFolderRetagStore.getState().forWorkspace(workspaceRoot);
  const store = useScopeUpdateStore.getState();
  if (held.length > 0) {
    store.begin({
      id: DURABLE_FOLDER_ID,
      kind: 'matter',
      label: 'Applying client scope to search',
      excludeFolders: held,
    });
    store.markFailed(DURABLE_FOLDER_ID);
  }
  // F3 (R8): if the durable FOLDER store hydrated incompletely (corrupt/partial
  // localStorage), the holds above may be MISSING records. We can't know which
  // folders were lost, so fail closed on ALL files (`excludeAllFiles`) — the file
  // mirror of the mail suspect hold — until the idempotent boot folder retag
  // reconverges every mapped folder's tag and discharges this entry.
  if (pendingFolderRetagHydrationSuspect()) {
    store.begin({
      id: FILE_HYDRATION_SUSPECT_ID,
      kind: 'matter',
      label: 'Applying client scope to search',
      excludeAllFiles: true,
    });
    store.markFailed(FILE_HYDRATION_SUSPECT_ID);
  }
}

/**
 * QA-44 — the retrieval fail-closed predicate: true drops the hit. Installed once
 * at mount ({@link setRetrievalHitExclusion}); exported as a pure function so its
 * fail-closed behavior is unit-testable without rendering the hook. Reads live
 * store state on every call, so it always reflects the current holds.
 *
 * Mail and file hits are governed independently: a MAIL-store suspicion never hides
 * files, and a FOLDER-store suspicion never hides mail.
 */
// Durable mail filing markers live in SQLCipher, not localStorage. Until we have
// read them for the current workspace, hold mail conservatively; afterwards we
// hold just their exact source ids. This closes the short startup window where a
// stale RAG row could otherwise be retrieved before repair starts.
async function refreshPendingMailRagRetagHold(
  workspaceIdentity: WorkspaceIdentitySnapshot,
): Promise<number | null> {
  const workspaceRoot = workspaceIdentity.rootPath;
  if (!workspaceRoot) return null;
  try {
    const pending = await mailListPendingRagRetags();
    if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return null;
    setPendingMailRagRetagSources(workspaceRoot, pending.map((entry) => entry.sourceId));
    return pending.length;
  } catch {
    // Keep the conservative all-mail hold: an unreadable durable marker store
    // must never be interpreted as "no sources are pending".
    return null;
  }
}

const PENDING_MAIL_RAG_REPAIR_RETRY_MS = 1_000;

/**
 * Repair durable mail filings without waiting for a full workspace index.  A
 * temporary backend or vector-store failure keeps the exact mail sources held
 * out and retries while this workspace stays open.
 */
export function startPendingMailRagRetagRecovery(
  workspaceIdentity: WorkspaceIdentitySnapshot,
  options: {
    retryDelayMs?: number;
    isCancelled?: () => boolean;
  } = {},
): () => void {
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const retryDelayMs = options.retryDelayMs ?? PENDING_MAIL_RAG_REPAIR_RETRY_MS;
  const isStopped = () => stopped || options.isCancelled?.() === true ||
    !isWorkspaceIdentityCurrent(workspaceIdentity);

  const scheduleRetry = (attempt: () => void) => {
    if (isStopped()) return;
    retryTimer = setTimeout(attempt, retryDelayMs);
  };

  const attempt = () => {
    void (async () => {
      // The first successful marker read is the only thing allowed to release
      // the all-mail startup hold. Until then, retry with the hold intact.
      const pendingCount = await refreshPendingMailRagRetagHold(workspaceIdentity);
      if (isStopped()) return;
      if (pendingCount === null) {
        scheduleRetry(attempt);
        return;
      }
      if (pendingCount === 0) return;

      try {
        await mailRepairPendingRagRetags();
      } catch {
        scheduleRetry(attempt);
        return;
      }
      if (isStopped()) return;

      const remainingCount = await refreshPendingMailRagRetagHold(workspaceIdentity);
      if (isStopped() || remainingCount === 0) return;
      // A failed read, a failed repair, or a newer durable filing all retry.
      scheduleRetry(attempt);
    })().catch((err: unknown) => {
      if (isStopped()) return;
      console.warn('Pending email search repair failed unexpectedly; retrying:', err);
      scheduleRetry(attempt);
    });
  };

  attempt();
  return () => {
    stopped = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
  };
}

export function shouldExcludeHitFromRetrieval(hit: RagHit): boolean {
  if (pendingDeletedMatterHydrationSuspect()) return true;
  const { rootPath: liveRoot } = useWorkspaceStore.getState();
  if (
    liveRoot &&
    hit.matterId &&
    usePendingDeletedMatterStore.getState().forWorkspace(liveRoot).includes(hit.matterId)
  ) {
    return true;
  }
  // Detect mail across every id form a row might carry: the typed `sourceType`, the
  // `mail:`-prefixed `sourceId`, AND (R8 hardening) the `mail:`-prefixed `path` —
  // older/odd rows can lack `sourceType`/`sourceId` but still key by `path`, and
  // missing one form would let such a mail hit slip past the fail-closed all-mail hold.
  const isMail =
    hit.sourceType === 'mail' ||
    (hit.sourceId ?? '').startsWith('mail:') ||
    hit.path.startsWith('mail:');
  if (isMail) {
    if (isPendingMailRagRetagLoading()) return true;
    if (([hit.sourceId, hit.path].filter(Boolean) as string[])
      .some((id) => isPendingMailRagRetagSource(liveRoot, id))) return true;
    // R8 (F2): a corrupt mail-retag store can't say WHICH matters lost their hold, so
    // fail closed on ALL mail until the boot mail retag reconverges every tag.
    if (isAllMailHeld()) return true;
    // A mail folder re-mapped between clients: hold out any mail hit still carrying
    // the OLD client's matter id until the re-tag lands.
    if (hit.matterId && getExcludedMailMatters().includes(hit.matterId)) return true;
    return false;
  }
  // R8 (F3): the file mirror — a corrupt folder-retag store fails closed on ALL files.
  if (isAllFilesHeld()) return true;
  // Files under a folder whose matter re-tag is pending/failed.
  const folders = getExcludedMatterFolders();
  if (folders.length === 0) return false;
  return pathInAnyFolder(hit.sourceId ?? hit.path, folders, liveRoot);
}

/**
 * P1.1 — apply each mapped folder's matter (and privilege) to its files' EXISTING
 * rows IN PLACE, WITHOUT re-embedding. A cheap SQL column update per file.
 *
 * Why this is separate from `reindexFolderPaths` (which re-embeds): the boot
 * reconcile already (re)indexed every new/changed file — new ones under the
 * UNASSIGNED default — so on boot the files under a client folder already have
 * rows; they just need the folder's matter applied. Re-embedding them (the old
 * boot behaviour) redid the single most expensive step on EVERY warm boot of any
 * workspace WITH client mappings, defeating the reconcile's whole win. In-place
 * retag moves them to the right scope for pennies. (Explicit folder-mapping
 * changes still go through `reindexFolderPaths`, which also indexes not-yet-
 * indexed files — a deliberate one-off, not a per-boot cost.)
 */
async function retagFolderPathsInPlace(
  folders: string[],
  workspaceService: MemoryWiringWorkspaceService | null | undefined,
  workspaceIdentity: WorkspaceIdentitySnapshot = captureWorkspaceIdentity(),
): Promise<boolean> {
  // Returns TRUE only on a fully CLEAN pass (no failed files AND the workspace
  // identity never changed under it). An identity-abort or any failed file returns
  // FALSE, so the caller never treats an aborted/partial pass as a clean success
  // (which would wrongly discharge the F3 all-files suspect hold).
  const { rootPath } = workspaceIdentity;
  const allPaths = collectAllFilePaths(await getFreshOrCachedFileTree(workspaceService));
  if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return false;

  const affected = allPaths.filter((p) => pathInAnyFolder(p, folders, rootPath));

  // Group by resolved matter so each matter's files retag in ONE batched UPDATE.
  // LanceDB rewrites data per UPDATE, so a per-file retag loop is ~as slow as
  // re-embedding — batching per matter collapses it to one rewrite per matter.
  const byMatter = new Map<string, string[]>();
  const privileged: Array<{ abs: string; privilege: string }> = [];
  for (const p of affected) {
    const abs = buildWorkspaceAbsolutePath(rootPath, p);
    const matterId = resolveMatterIdForWorkspacePath(p, rootPath);
    const list = byMatter.get(matterId);
    if (list) list.push(abs);
    else byMatter.set(matterId, [abs]);
    // Only privileged sources need a privilege retag — the common 'none' default
    // is already correct, so we skip it (and keep those few per-file).
    const privilege = resolvePrivilegeForSource(abs);
    if (privilege !== 'none') privileged.push({ abs, privilege });
  }
  // QA-44 (Codex round 1): the reactive matter exclusion lives only in memory,
  // so a reload/crash drops it while the index can still hold OLD matter tags. On
  // boot this in-place retag is what re-applies the correct matter — but its
  // failures used to be swallowed, leaving stale wrong-client tags with NO
  // exclusion. Now, if a matter batch fails here, hold exactly those files out of
  // retrieval (fail closed) until a later boot's retag succeeds; a clean pass
  // clears any exclusion a prior pass left. We only touch the store AFTER the
  // retag resolves (never dropping an existing exclusion before its replacement
  // is known), so there is no window where a prior failure's exclusion is lost.
  // Privilege failures need no exclusion — the retrieval privilege re-check
  // already fails closed durably.

  const failedPaths: string[] = [];
  for (const [matterId, paths] of byMatter) {
    if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return false;
    // R7-4: re-resolve each file's CURRENT matter right before the write. This
    // boot pass snapshotted `byMatter` once at the start but writes over
    // seconds/minutes; if a folder is re-mapped mid-pass, the live scheduler
    // re-tags (and clears its hold) while we still hold the STALE snapshot. Writing
    // the snapshot matter now would silently re-tag the re-mapped file to the WRONG
    // client with NO hold, healed only on the next boot. Skipping any file whose
    // current matter no longer matches this batch leaves it as the live scheduler
    // (correctly) tagged it. An unchanged file still resolves to `matterId`, so the
    // common case is untouched. (`resolveMatterIdForWorkspacePath` is order-
    // independent across path forms, so re-resolving the abs path is consistent.)
    const currentPaths = paths.filter(
      (abs) => resolveMatterIdForWorkspacePath(abs, rootPath) === matterId,
    );
    if (currentPaths.length === 0) continue;
    try {
      // In-place, batched — no re-extract / re-embed. Returns the PER-PATH
      // misses: files that still have no rows under `matterId` after the retag.
      const missing = await MemoryService.retagMatterBatch(currentPaths, matterId);
      // QA-92: those files never got vector rows to re-tag (a timing gap, or a
      // path-form mismatch). Left as-is they stay UNASSIGNED and are invisible to
      // client-scoped Ask this session. Re-index EXACTLY the misses under the
      // target matter so they become searchable now — not only after the next
      // boot's row-verified reconcile heals them. Checking per-path (not the
      // aggregate count) is what catches a MIXED batch where a sibling retagged
      // fine but this one silently missed.
      //
      // QA-44 (R7-1): a MISS is not a failure — but if RE-INDEXING a miss FAILS,
      // that file may still carry the OLD (wrong-client) matter tag, so it must
      // join the fail-closed hold. `reindexPaths` returns how many failed (it
      // never throws); when >0, hold the misses out until a later boot re-tags
      // them cleanly. (Never-indexed misses that re-index fine are NOT held.)
      if (missing.length > 0) {
        const missReindexFailures = await MemoryService.reindexPaths(missing, matterId);
        if (missReindexFailures > 0) failedPaths.push(...missing);
      }
    } catch {
      // The batched UPDATE itself threw — the whole batch may still carry the OLD
      // matter tag, so hold every file in it out of retrieval; a later boot retries.
      failedPaths.push(...currentPaths);
    }
    if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return false;
  }
  for (const { abs, privilege } of privileged) {
    if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return false;
    try {
      await MemoryService.retagPrivilege(abs, privilege);
    } catch {
      // Best-effort.
    }
    if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return false;
  }

  // Round 4 + R7-1: guard the store write by the workspace IDENTITY this pass ran
  // for (root path AND generation). This async retag can resolve AFTER a workspace
  // switch OR an in-place reload of the same path; without the guard its
  // `matter:boot-retag` entry (excluded paths + banner) would bleed into the NEW
  // workspace, OR — worse — a stale pass could CLEAR (`store.remove`) the boot hold
  // the current workspace still needs. The entry is not owned by the disposed
  // scheduler, and the new workspace's own `retagExistingMatterFolderPaths`
  // early-returns when it has no mapped folders, so nothing would clear a bled hold.
  if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return false;
  const store = useScopeUpdateStore.getState();
  if (failedPaths.length > 0) {
    store.begin({
      id: BOOT_RETAG_ID,
      kind: 'matter',
      label: 'Applying client scope to search',
      // Exact absolute file paths that failed to retag — matched at retrieval by
      // path containment, so only those files are held out (not whole folders).
      excludeFolders: failedPaths,
    });
    store.markFailed(BOOT_RETAG_ID);
  } else {
    // A clean pass — clear any exclusion a prior failed pass left behind.
    store.remove(BOOT_RETAG_ID);
  }

  // R7-3: mirror the outcome into the DURABLE per-workspace folder-hold store so a
  // hold survives a close/switch and is re-established synchronously on next open.
  // A folder with ANY failed file is recorded; a folder whose files ALL re-tagged
  // cleanly is discharged (which also prunes any `matter:durable-folder` hold this
  // pass restored at mount, making its files visible now). Folder granularity
  // matches the live per-folder hold; the precise per-file hold stays in
  // `matter:boot-retag` for THIS session.
  const failedFolders = folders.filter((f) =>
    failedPaths.some((p) => pathInAnyFolder(p, [f], rootPath)),
  );
  for (const f of folders) {
    if (!failedFolders.includes(f)) dischargeDurableFolderHold(f, rootPath);
  }
  recordDurableFolderHold(rootPath, failedFolders);
  // Clean iff no file failed to retag (identity stayed current — early returns above
  // already returned false on abort).
  return failedPaths.length === 0;
}

export async function retagExistingMatterFolderPaths(
  workspaceService: MemoryWiringWorkspaceService | null | undefined,
  workspaceIdentity: WorkspaceIdentitySnapshot = captureWorkspaceIdentity(),
): Promise<void> {
  const capturedRoot = workspaceIdentity.rootPath;
  // F1 (R8): union in every folder/path that still has a DURABLE pending hold but
  // may no longer be MAPPED. Without this, a folder that was unmapped/removed while
  // its retag was pending is re-held by `restoreFolderHolds` on every open but the
  // boot pass — which built its list ONLY from currently-mapped `folderPaths` — never
  // retagged it, so it stayed held out of search FOREVER. Driving the held paths here
  // retags each file to its CURRENT matter (unmapped → unassigned, resolved per file
  // inside `retagFolderPathsInPlace`) and discharges the durable hold on success. This
  // is the FILE mirror of `retagExistingMailFolders`, which already unions its pending
  // intents so a mail hold is always retried until it lands.
  const pendingHeld = capturedRoot
    ? usePendingFolderRetagStore.getState().forWorkspace(capturedRoot)
    : [];
  const folders = Array.from(
    new Set(
      [
        ...getMatters().flatMap((matter) => matter.folderPaths),
        ...pendingHeld,
      ].filter((folder): folder is string => Boolean(folder)),
    ),
  );
  // Mind the early-return: a pending-only workspace (holds but no mapped folders)
  // MUST still run so the stranded hold can be discharged. When there are genuinely
  // NO folders to retag, the pass is TRIVIALLY clean — still discharge the F3 hold.
  let clean = false;
  if (folders.length === 0) {
    clean = true;
  } else {
    try {
      // P1.1: retag IN PLACE (no re-embed) so a warm boot of a mapped workspace
      // stays cheap. (Was `reindexFolderPaths`, which re-embedded every file.)
      clean = await retagFolderPathsInPlace(folders, workspaceService, workspaceIdentity);
    } catch {
      // Best-effort: the initial index already completed; do not block startup.
      clean = false;
    }
  }
  // F3 (R8): a fully clean boot folder retag means every mapped folder's files
  // reconverged to the correct client, so release the blanket all-files hold a
  // hydration-suspect folder store installed (see `restoreFolderHolds`) for THIS
  // session. A failure keeps it (still fail closed). Guarded by identity so a stale
  // pass that resolved after a switch can't clear the now-active workspace's hold;
  // the still-suspect module flag re-establishes it on the next open.
  if (clean && isWorkspaceIdentityCurrent(workspaceIdentity)) {
    useScopeUpdateStore.getState().remove(FILE_HYDRATION_SUSPECT_ID);
  }
}

/**
 * QA-44 (round 4) — true when clearing the durable mail-retag record for
 * `folderKey` is safe for a retag that targeted `matterId`: either no record
 * exists, or the record's target still matches. A newer re-map with a DIFFERENT
 * target must keep its record — an older retag's success is stale for it and must
 * not discharge the newer hold.
 */
function mailIntentTargets(
  workspaceRoot: string,
  folderKey: string,
  matterId: string,
): boolean {
  const current = usePendingMailRetagStore
    .getState()
    .forWorkspace(workspaceRoot)
    .find((i) => mailFolderKey(i.provider, i.account, i.folderId) === folderKey);
  return !current || current.targetMatter === matterId;
}

/**
 * QA-44 (Codex round 3+4) — the MAIL mirror of {@link retagExistingMatterFolderPaths}.
 *
 * On every boot re-tag every MAPPED mail folder to its CURRENT matter, re-derived
 * from the PERSISTED matter map (`matterStore.mailFolderPaths` — the durable
 * intent, exactly like `folderPaths` for files). `mail_retag_folder_matter` is
 * idempotent (it re-lists the folder's message ids from the encrypted store each
 * call and honors durable per-message filings), so a tag that drifted converges
 * back to the mapping on reopen regardless of what it drifted to.
 *
 * Fail-closed across sessions AND across repeated failures (round 4): the durable
 * hold for a stale-client folder lives in {@link usePendingMailRetagStore} and is
 * re-established as an `excludeMailMatters` exclusion on workspace open (see
 * `restoreMailHolds`) BEFORE this runs. This pass only DISCHARGES that hold on a
 * genuine SUCCESS — it removes the folder's `mail:<key>` exclusion and clears the
 * persisted intent. On FAILURE it touches neither, so the exclusion + record
 * survive to the next boot (and the boot after that), which is exactly the
 * guarantee that was missing when a boot re-tag double-failed. It clears the same
 * `mail:<key>` id the live reaction and `restoreMailHolds` install, so a success
 * discharges whichever of them established the hold.
 *
 * Store writes are guarded by the captured workspace IDENTITY (root + generation):
 * if the workspace switched OR reloaded-in-place while this async pass was in
 * flight, we skip the write so a stale clear can't drop a DIFFERENT workspace's
 * hold (R7-1 tightens the round-4 root-only guard to the full identity).
 */
export async function retagExistingMailFolders(
  workspaceIdentity: WorkspaceIdentitySnapshot = captureWorkspaceIdentity(),
): Promise<void> {
  const capturedRoot = workspaceIdentity.rootPath;
  // Drive to resolution every MAPPED mail folder (re-tag to its CURRENT matter)
  // AND every folder that still has a durable pending hold but is NO LONGER mapped
  // (re-tag to the intent's own target — e.g. 'unassigned' after an unmap). Union
  // them so a hold is ALWAYS retried until it lands, instead of stranding a folder
  // held out forever once it drops off the mapping.
  const targets = new Map<
    string,
    { provider: string; account: string; folderId: string; matterId: string }
  >();
  for (const e of buildMailMatterMap(getMatters())) {
    targets.set(mailFolderKey(e.provider, e.account, e.folderId), e);
  }
  if (capturedRoot) {
    for (const intent of usePendingMailRetagStore.getState().forWorkspace(capturedRoot)) {
      const key = mailFolderKey(intent.provider, intent.account, intent.folderId);
      if (!targets.has(key)) {
        targets.set(key, {
          provider: intent.provider,
          account: intent.account,
          folderId: intent.folderId,
          matterId: intent.targetMatter,
        });
      }
    }
  }
  // NB: no early-return on an empty target set — a fully clean (even trivially
  // empty) pass must still fall through to discharge the F2 all-mail suspect hold.
  let anyFailure = false;
  for (const [key, { provider, account, folderId, matterId }] of targets) {
    // R7-4: re-resolve this folder's CURRENT matter right before the write. `targets`
    // was snapshotted at pass start but we write over time; a folder re-mapped
    // mid-pass (the live scheduler already re-tagged it and cleared its hold) would
    // otherwise get the STALE snapshot matter written LAST — tagging the mail to the
    // wrong client with no hold, healed only on the next boot. Re-reading the live
    // mapping makes the boot write the CURRENT target; a folder that's still mapped
    // (or unmapped but held via its own pending intent) is unchanged.
    const liveEntry = buildMailMatterMap(getMatters()).find(
      (e) => mailFolderKey(e.provider, e.account, e.folderId) === key,
    );
    const currentMatter = liveEntry?.matterId ?? matterId;
    try {
      // R7-5b: pin to the captured workspace so a switch mid-boot-heal refuses.
      await mailRetagFolderMatter(provider, account, folderId, currentMatter, capturedRoot ?? undefined);
    } catch {
      // Failure: leave the restored exclusion + durable record in place (fail
      // closed across sessions); the idempotent retag converges on a later boot.
      anyFailure = true;
      continue;
    }
    // Success — discharge the hold, but only if we're still the same workspace
    // IDENTITY AND this retag's target is still the live intent (a newer re-map
    // must keep its own hold).
    if (!isWorkspaceIdentityCurrent(workspaceIdentity)) continue;
    if (capturedRoot && !mailIntentTargets(capturedRoot, key, currentMatter)) continue;
    useScopeUpdateStore.getState().remove(`mail:${key}`);
    if (capturedRoot) usePendingMailRetagStore.getState().clear(capturedRoot, key);
  }
  // R8 (F2): a fully clean boot mail retag means every mapped mail folder's tag
  // reconverged, so the blanket all-mail hold installed for a hydration-suspect
  // store (see `restoreMailHolds`) can be released for THIS session. Any per-folder
  // failure keeps it (still fail closed). Guarded by identity so a stale pass that
  // resolved after a switch can't clear the now-active workspace's hold. The entry
  // is re-established from the still-suspect module flag on the next open, so a later
  // workspace with its own incomplete records still fails closed.
  if (!anyFailure && isWorkspaceIdentityCurrent(workspaceIdentity)) {
    useScopeUpdateStore.getState().remove('mail:hydration-suspect');
  }
}

/**
 * QA-44 (round 4) — re-establish the fail-closed mail exclusions for a workspace
 * from the DURABLE per-workspace records, synchronously on open, BEFORE any
 * re-tag runs. This is what makes the hold survive a close/switch: the in-memory
 * `scopeUpdateStore` was cleared on the last close, but the persisted intent was
 * not, so we rebuild the `excludeMailMatters` exclusion from it immediately (fail
 * closed) and let the boot re-tag ({@link retagExistingMailFolders}) discharge it
 * only on success. Entries use the live `mail:<key>` id so a later success (boot
 * or live) clears the same entry.
 */
export function restoreMailHolds(workspaceRoot: string | null | undefined): void {
  if (!workspaceRoot) return;
  const intents = usePendingMailRetagStore.getState().forWorkspace(workspaceRoot);
  const store = useScopeUpdateStore.getState();
  for (const intent of intents) {
    if (intent.staleMatters.length === 0) continue;
    const id = `mail:${mailFolderKey(intent.provider, intent.account, intent.folderId)}`;
    store.begin({
      id,
      kind: 'mail',
      label: 'Updating email search scope',
      excludeMailMatters: intent.staleMatters,
    });
    store.markFailed(id);
  }
  // R7-6/R8 (F2): if the durable store hydrated incompletely (corrupt/partial
  // localStorage), the holds above may be MISSING records. We can't know which
  // matters were lost, so fail closed for REAL — hold EVERY mail hit out of retrieval
  // (`excludeAllMail`) AND surface the visible failed banner — until the idempotent
  // boot mail retag reconverges every mapped folder's tag and discharges this entry.
  // (R7-6 only showed the banner while holding NOTHING, so the copy overstated.)
  if (pendingMailRetagHydrationSuspect()) {
    store.begin({
      id: 'mail:hydration-suspect',
      kind: 'mail',
      label: 'Updating email search scope',
      excludeAllMail: true,
    });
    store.markFailed('mail:hydration-suspect');
  }
}

export async function startFullIndex(
  workspaceService: MemoryWiringWorkspaceService | null | undefined,
  workspaceIdentity: WorkspaceIdentitySnapshot = captureWorkspaceIdentity(),
): Promise<void> {
  // P1.1: everything that WRITES the vector table runs AFTER the reconcile
  // completes — never concurrently with it. The reconcile may DROP + rebuild the
  // whole table (a schema migration, a missing/corrupt table, or the manifest
  // key-format upgrade). A concurrent PDF index / mail backfill would write rows
  // (and, for PDFs, record a "fresh" signature) INTO a table being rebuilt, so
  // the rebuild could drop rows a fresh signature was just recorded for — leaving
  // that source "fresh" but absent from search. Sequencing removes the race; it
  // is still all background work (the shell is already interactive).
  const indexAndRetag = MemoryService.indexWorkspace()
    .then(async () => {
      if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return;
      // A3: index PDF files (skips unchanged via the manifest fresh-check).
      if (isPdfIndexingEnabled() && workspaceService) {
        await indexWorkspacePdfs(workspaceService, workspaceIdentity).catch(() => {});
      }
      if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return;
      // Option B healing: re-index any mail imported while the model was still
      // downloading, from the local encrypted bodies. No-ops fast when the
      // backfill marker is absent (the common case).
      await mailBackfillRag(buildMailMatterMap(getMatters())).catch(() => {});
      if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return;
      // QA-44 (Codex round 3): re-apply every mapped mail folder's matter on
      // boot — the mail mirror of `retagExistingMatterFolderPaths` below. Heals a
      // stale mail tag left by a failed live re-map whose in-memory exclusion was
      // dropped on the previous workspace close (cross-session wrong-client leak).
      await retagExistingMailFolders(workspaceIdentity).catch(() => {});
      if (!isWorkspaceIdentityCurrent(workspaceIdentity)) return;
      // Apply folder→matter scoping to the (now stable) rows, in place.
      await retagExistingMatterFolderPaths(workspaceService, workspaceIdentity);
    })
    .catch(() => {
      /* errors are surfaced via the progress event with status: error */
    });

  await indexAndRetag;
}

// ── QA-19: live-index wiring resilience ─────────────────────────────────────
//
// The per-workspace lifecycle effect below used to run `MemoryService
// .setWorkspace` and `mailSetWorkspace` inside the SAME try/catch that also
// covered `watchWorkspace` + the `workspace-file-changed` listener
// registration. Any transient failure in either call — or in any of the
// (best-effort) optional connector setup calls that used to run BEFORE the
// watcher — silently aborted watcher installation for the rest of the
// session: no log, no retry, and the effect's deps rarely change again after
// mount. That is the root cause behind BUG-DB QA-19/QA-13: a newly created
// doc AND a separately dropped external file both never got a reindex event
// for the rest of that session, and only a full app restart (a fresh mount
// of this effect) recovered.
//
// The fix below makes the ESSENTIAL wiring (point RAG at the workspace, start
// the watcher, register the listener) a small, dependency-free unit that is
// retried with backoff and always runs BEFORE any optional connector setup —
// so a mail/CRM/OneDrive/etc. failure can never prevent live indexing again.

/** Options for {@link retryAsync}. */
export type RetryAsyncOptions = {
  /** Delay (ms) before each retry. Length = number of retries after the first attempt. */
  delaysMs: number[];
  /** Called after each failed attempt, before the (possible) retry delay. */
  onError?: (err: unknown, attempt: number) => void;
  /** Checked before every attempt (including the first); when true, stops immediately. */
  isCancelled?: () => boolean;
};

/**
 * Call `fn`, retrying with the given backoff delays on failure. Throws the
 * last error once all retries are exhausted (or the caller cancels via
 * `isCancelled`). Generic + dependency-free so it is reusable wherever a
 * transient startup failure shouldn't require a full app restart to recover
 * from.
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  options: RetryAsyncOptions,
): Promise<T> {
  const { delaysMs, onError, isCancelled } = options;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    if (isCancelled?.()) {
      throw toError(lastErr, 'retryAsync: cancelled');
    }
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      onError?.(err, attempt);
      if (attempt < delaysMs.length) {
        await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
      }
    }
  }
  throw toError(lastErr, 'retryAsync: exhausted all retries');
}

/** Normalize an unknown caught value into a real `Error` instance to throw. */
function toError(err: unknown, fallbackMessage: string): Error {
  return err instanceof Error ? err : new Error(fallbackMessage);
}

/** Backoff for {@link installEssentialWorkspaceWiring} via {@link retryAsync}. */
export const ESSENTIAL_WIRING_RETRY_DELAYS_MS = [1000, 3000];

/**
 * Install the ESSENTIAL live-index wiring for a workspace: point the RAG
 * engine at it (`MemoryService.setWorkspace`), start the `notify`-backed file
 * watcher, and subscribe to `workspace-file-changed`. Deliberately imports
 * nothing beyond MemoryService / the watcher / the tauri event listener, so
 * it can never be broken by a failure in the optional connector setup
 * (mail/CRM/OneDrive/Box/ShareFile/DocuSign/Jotform/Zocks/Addepar/Calendly/
 * Calendar) that runs alongside it — see QA-19.
 */
export async function installEssentialWorkspaceWiring(
  rootPath: string,
  workspaceService: MemoryWiringWorkspaceService | null | undefined,
  deleteBatcher: Pick<DeleteBurstBatcher, 'enqueue' | 'cancel'>,
  indexRetryScheduler: Pick<IndexRetryScheduler, 'schedule'>,
): Promise<() => void> {
  await MemoryService.setWorkspace(rootPath);
  await watchWorkspace(rootPath);
  const { listen } = await import('@tauri-apps/api/event');
  return listen<WorkspaceChangeEvent>('workspace-file-changed', (event) => {
    handleWorkspaceFileChangedEvent(event.payload, {
      deleteBatcher,
      workspaceService,
      indexRetryScheduler,
    });
  });
}

// ── QA-44: durable, visible, fail-closed scope-update scheduling ────────────
//
// The three RAG re-tag reactions below used to swallow their failures with a
// `.catch(() => {})`. A failed re-tag then left the search index on the OLD tag
// while the UI implied the new rule was live — a privilege leak (a source stays
// retrievable in normal Ask) or a wrong-client leak (content stays scoped to the
// old matter). These helpers route each re-tag through the retry scheduler
// (durable + visible) and, for folder->matter, keep the affected folders
// excluded from retrieval until the re-tag lands. Extracted from the hook's
// effects so the wiring is unit-testable without mounting the whole hook, the
// same way `handleWorkspaceFileChangedEvent` is. `scheduler` is null only in the
// unusual window before the per-workspace scheduler mounts; the fallback keeps
// the old best-effort behaviour rather than dropping the update entirely.

/** Re-index files whose folder->matter mapping changed, fail-closed. */
export function scheduleFolderMatterRetag(
  folders: string[],
  workspaceService: MemoryWiringWorkspaceService | null | undefined,
  scheduler: RetagScheduler | null,
): void {
  if (folders.length === 0) return;
  // R7-3: record these folders in the DURABLE per-workspace hold BEFORE the re-tag
  // runs, so a re-tag that never lands (failed all retries, or the app closed
  // mid-flight) leaves a hold that `restoreFolderHolds` re-establishes next open —
  // the file mirror of how the mail reaction records its pending intent upfront. A
  // success discharges it below.
  recordDurableFolderHold(useWorkspaceStore.getState().rootPath, folders);
  if (!scheduler) {
    // Pre-mount fallback (no scheduler yet). Pin the identity so a switch/reload
    // mid-scan does NOT read as a clean success: only discharge the boot hold if
    // the workspace is still the one this re-index ran for (R7-1).
    const identity = captureWorkspaceIdentity();
    void reindexFolderPaths(folders, workspaceService, identity)
      .then(() => {
        if (!isWorkspaceIdentityCurrent(identity)) return;
        for (const folder of folders) {
          dischargeBootRetagForFolder(folder);
          dischargeDurableFolderHold(folder, identity.rootPath);
        }
      })
      // eslint-disable-next-line lantern-async/no-silent-failure -- best-effort pre-mount fallback; a failed re-index stays held out and the next boot reconcile re-tags it
      .catch(() => {});
    return;
  }
  // Key ONE task PER FOLDER, not one per changed-folder SET (QA-44, Codex round 2
  // — P2). A grouped id like `matter:A|B` never supersedes a later single-folder
  // `matter:A`, so a folder caught in an earlier FAILED group would stay excluded
  // from retrieval even after its own re-index succeeds — stranded (content
  // wrongly hidden) until the next boot reconcile. Per-folder ids make a later
  // `matter:A` supersede exactly its own hold and clear it on success, while
  // every other folder keeps its independent fail-closed hold.
  for (const folder of folders) {
    scheduler.run({
      id: `matter:${folder}`,
      kind: 'matter',
      label: 'Updating search scope for 1 folder',
      // Fail closed: hold this folder's files out of retrieval until its
      // re-index lands, so stale chunks can't surface under the wrong client.
      excludeFolders: [folder],
      op: async (isSuperseded) => {
        // Pin the workspace identity for this attempt. Origin's guards make
        // reindexFolderPaths return QUIETLY if the workspace switches/reloads
        // mid-flight; a bare resolution would then look like a clean success and
        // clear this folder's fail-closed hold + discharge the boot hold without
        // having re-tagged anything. Re-check after it resolves and THROW on an
        // abort so the scheduler keeps the hold (and retries under the new
        // identity if still live) instead of clearing it (QA-44 R7-1).
        const identity = captureWorkspaceIdentity();
        await reindexFolderPaths([folder], workspaceService, identity);
        if (!isWorkspaceIdentityCurrent(identity)) {
          throw new WorkspaceIdentityChangedError();
        }
        // R8 (P1): if a NEWER re-map of this same folder superseded this attempt
        // while it ran, this op re-tagged to a STALE mapping. Its body still runs
        // to completion (serialization only delays the newer op, it can't abort
        // this one), so discharging here would clear the DURABLE hold the newer
        // pending re-tag just re-recorded — and closing the app before that newer
        // re-tag lands would reopen with NO fail-closed hold, leaking stale
        // wrong-client chunks across sessions. Tie the release to the generation
        // that owns this id: a stale generation's discharge is a no-op, and the
        // newest generation's op (which re-tagged to the CURRENT mapping) is the
        // one that clears the hold. Mirrors the mail op's `mailIntentTargets`
        // guard. The scheduler's own status cleanup is already generation-guarded.
        if (isSuperseded()) return;
        // A live success also re-tagged any of this folder's files the boot
        // retag had failed on — discharge them from the boot hold so they don't
        // stay hidden until a clean boot (final round P2). R7-3: also discharge
        // the DURABLE folder hold (release the record + prune any restored hold),
        // so its files become visible now and no stale hold survives to next open.
        dischargeBootRetagForFolder(folder);
        dischargeDurableFolderHold(folder, identity.rootPath);
      },
    });
  }
}

/** Re-tag synced mail whose folder->matter mapping changed, durable + visible.
 *  Mail hits carry no folder path, so there is no path-prefix to exclude by like
 *  files. Instead, when a folder is RE-MAPPED from one real client to another and
 *  the re-tag is pending/failed, the OLD client's mail (by its stale matter id)
 *  is held out of retrieval so it can't surface under the wrong client mid-retag
 *  (QA-44, Codex round 1). A fresh mapping (previously unassigned) needs no such
 *  hold — unassigned mail surfacing is not a wrong-CLIENT exposure. */
export function scheduleMailMatterRetag(
  changed: Array<{ key: string; matterId: string; prevMatterId: string }>,
  scheduler: RetagScheduler | null,
): void {
  for (const { key, matterId, prevMatterId } of changed) {
    const parsed = parseMailFolderKey(key);
    if (!parsed) continue;
    if (!scheduler) {
      void mailRetagFolderMatter(
        parsed.provider,
        parsed.account,
        parsed.folderId,
        matterId,
        useWorkspaceStore.getState().rootPath ?? undefined,
      ).catch((err: unknown) => {
        console.warn('Email search scope update failed before its retry system was ready:', err);
      });
      continue;
    }
    const id = `mail:${key}`;
    const workspaceRoot = useWorkspaceStore.getState().rootPath;
    // Fail closed ACROSS repeated re-maps (QA-44, Codex round 2 — P1 leak) AND
    // ACROSS SESSIONS (round 4). The messages in this folder stay PHYSICALLY
    // tagged with their old matter until a re-tag actually SUCCEEDS. If the folder
    // is re-mapped again before that lands (A->B fails, then the user maps B->C),
    // the messages may still be tagged A — so we keep excluding A, not just the
    // LATEST old client. Union this re-map's old client into whatever is already
    // held (from the live entry AND the durable per-workspace record), and never
    // exclude the CURRENT target (content correctly tagged `matterId` must
    // surface). A successful re-tag physically moves every message to the new
    // matter, so only success clears the hold — the DURABLE record below.
    const persistedStale = workspaceRoot
      ? usePendingMailRetagStore
          .getState()
          .forWorkspace(workspaceRoot)
          .find(
            (i) => mailFolderKey(i.provider, i.account, i.folderId) === key,
          )?.staleMatters ?? []
      : [];
    const heldNow = useScopeUpdateStore.getState().entries[id]?.excludeMailMatters ?? [];
    const hold = new Set([...heldNow, ...persistedStale]);
    if (prevMatterId && prevMatterId !== UNASSIGNED_MATTER_ID) hold.add(prevMatterId);
    hold.delete(matterId);

    // Persist the pending intent PER WORKSPACE so the hold survives a close/switch
    // (round 4). `record` unions/clears based on the hold; only a successful
    // re-tag (the op below) or a hold that shrank to empty removes it.
    if (workspaceRoot) {
      if (hold.size > 0) {
        usePendingMailRetagStore.getState().record({
          workspaceRoot,
          provider: parsed.provider,
          account: parsed.account,
          folderId: parsed.folderId,
          targetMatter: matterId,
          staleMatters: [...hold],
        });
      } else {
        usePendingMailRetagStore.getState().clear(workspaceRoot, key);
      }
    }

    scheduler.run({
      id,
      kind: 'mail',
      label: 'Updating email search scope',
      ...(hold.size > 0 ? { excludeMailMatters: [...hold] } : {}),
      op: async () => {
        const result = await mailRetagFolderMatter(
          parsed.provider,
          parsed.account,
          parsed.folderId,
          matterId,
          // R7-5b: pin to the workspace captured when this op was scheduled — an
          // op that outlives a switch is refused by the backend rather than
          // re-tagging the new workspace's mail.
          workspaceRoot ?? undefined,
        );
        // Success: the mail is now physically tagged `matterId`, so the durable
        // hold is discharged — BUT only if this retag's target is still the live
        // intent. A rapid re-map (A->B then B->C) can supersede this op; the old
        // op finishing must NOT clear the newer intent (target C, still pending),
        // or the mail (now at B) would surface under the wrong client. (The
        // scheduler clears the in-memory entry itself, guarded by generation.)
        if (workspaceRoot && mailIntentTargets(workspaceRoot, key, matterId)) {
          usePendingMailRetagStore.getState().clear(workspaceRoot, key);
        }
        return result;
      },
    });
  }
}

/** Re-tag sources whose privilege changed, durable + visible. The leak itself is
 *  closed independently by `MemoryService.retrieve` (which re-checks every hit
 *  against the live privilege store), so this only keeps the index consistent
 *  and tells the user the rule isn't fully applied yet. */
export function schedulePrivilegeRetag(
  sources: string[],
  scheduler: RetagScheduler | null,
): void {
  for (const sourceId of sources) {
    // resolvePrivilegeForSource reflects the latest store (a cleared entry
    // resolves to "none", which re-tags the chunks back to non-privileged).
    const privilege = resolvePrivilegeForSource(sourceId);
    if (!scheduler) {
      void MemoryService.retagPrivilege(sourceId, privilege).catch(() => {});
      continue;
    }
    scheduler.run({
      id: `privilege:${sourceId}`,
      kind: 'privilege',
      label: 'Updating privilege scope',
      op: () => MemoryService.retagPrivilege(sourceId, privilege),
    });
  }
}

export function useMemoryWiring(
  rootPath: string | null,
  workspaceService?: MemoryWiringWorkspaceService | null,
): void {
  // Wire the toggle readers once. Safe to call repeatedly — last writer wins.
  useEffect(() => {
    setMemoryEnabledReader(() =>
      Boolean(useSettingsStore.getState().getSetting<boolean>('memoryEnabled')),
    );
    // A3 — PDF indexing toggle (default OFF).
    setPdfIndexingEnabledReader(() =>
      Boolean(
        useSettingsStore.getState().getSetting<boolean>('includePdfsInWorkspaceIndex'),
      ),
    );
    // VG-2 — local OCR for scanned PDF pages (default ON; getSetting falls
    // back to the schema default when unset).
    setOcrScannedPdfsEnabledReader(() =>
      Boolean(useSettingsStore.getState().getSetting<boolean>('ocrScannedPdfs')),
    );
    // M3 — facts toggles. Injection defaults ON, auto-accept defaults OFF.
    setFactsInjectionReader(() =>
      Boolean(
        useSettingsStore.getState().getSetting<boolean>('factsInjection'),
      ),
    );
    setFactsAutoAcceptReader(() =>
      Boolean(
        useSettingsStore.getState().getSetting<boolean>('factsAutoAccept'),
      ),
    );
    // WS-B/C — install the matter resolver so every indexed chunk is tagged
    // with the matter the file belongs to (or "unassigned").
    setMatterResolver((path) => resolveMatterIdWithWorkspaceForms(path));
    // WS-PRIV — install the privilege resolver so every indexed chunk is tagged
    // with its source's privilege (or "none"), keeping privileged content
    // excluded from default retrieval even after a re-index.
    setPrivilegeResolver((sourceId) => resolvePrivilegeForSource(sourceId));
    // QA-44 — install the retrieval exclusion predicate so a file whose
    // folder->matter re-tag is pending or failed is dropped from retrieval (fail
    // closed) until the re-tag lands, instead of surfacing under the wrong
    // client. Reads live state each call, so a `[]`-deps install is correct.
    setRetrievalHitExclusion(shouldExcludeHitFromRetrieval);
    // QA-44 (Codex round 1): the privilege UI marks a file by its workspace-
    // RELATIVE path while RAG hits carry the ABSOLUTE path, so the privilege
    // re-check must try every equivalent form (as-is, relative, absolute) and
    // fail closed if ANY is privileged. Mirrors resolveMatterIdForWorkspacePath's
    // multi-form logic.
    setSourceIdForms((id) => {
      // `mail:<id>` ids are not filesystem paths — leave them as-is.
      if (id.startsWith('mail:')) return [id];
      const { rootPath: liveRoot } = useWorkspaceStore.getState();
      const forms = new Set<string>([id]);
      const relative = workspaceRelativePath(id, liveRoot);
      if (relative) forms.add(relative);
      if (liveRoot && !isAbsolutePath(id)) forms.add(buildWorkspaceAbsolutePath(liveRoot, id));
      return Array.from(forms);
    });
    return () => {
      resetRetrievalHitExclusion();
      resetSourceIdForms();
    };
  }, []);

  // QA-44 — one re-tag scheduler per workspace mount, shared by the three
  // scope-update reactions below (folder->matter, mail folder->matter, source
  // privilege). Created on open, disposed on close/switch so no retry can fire
  // against a workspace that is no longer active (a cross-client hazard — see
  // `retagScheduler`).
  const retagSchedulerRef = useRef<RetagScheduler | null>(null);
  useEffect(() => {
    if (!rootPath) return;
    const scheduler = createRetagScheduler();
    retagSchedulerRef.current = scheduler;
    // Round 4 — fail closed IMMEDIATELY on open: rebuild this workspace's mail
    // exclusions from the DURABLE per-workspace records before any retrieval can
    // run. The boot re-tag (`retagExistingMailFolders`, after the reconcile)
    // discharges them only on success.
    restoreMailHolds(rootPath);
    // R7-3 — the FILE mirror: rebuild this workspace's durable FILE-folder holds
    // synchronously on open too, so a folder whose live re-map failed in a prior
    // session is held out from the first retrieval — not only after the slow boot
    // in-place retag (which runs LAST in the boot chain) reaches it.
    restoreFolderHolds(rootPath);
    return () => {
      scheduler.disposeAll();
      // Round 4 — reset the transient scope-update holds on close/switch so this
      // workspace's entries (the live scheduler's owned ones AND the un-owned
      // boot-retag entries `matter:boot-retag` / restored `mail:<key>`) can never
      // bleed into the NEXT workspace. Only ONE workspace is active at a time, so
      // clearing all of them is correct; the next open re-establishes its own
      // from its durable records. The durable records themselves are keyed by
      // workspace root, so they are untouched.
      useScopeUpdateStore.getState().clearAll();
      retagSchedulerRef.current = null;
    };
  }, [rootPath]);

  // M3 — wire the facts service once the workspace is open so the
  // Settings panel and chat viewer can both read/write `memory.json`.
  useEffect(() => {
    if (!rootPath || !workspaceService) {
      setFactsService(null);
      return;
    }
    // Object holder (not a bare `let`) so TS doesn't narrow the flag to a
    // constant across the async closure below.
    const guard = { cancelled: false };
    const storage = buildFactsStorage(workspaceService, rootPath);
    // Resolve the data-dir name once per workspace open, so facts read/write the
    // same folder the Rust stores use.
    // Falls back to the default (`.lantern`) in the browser / on any error.
    void (async () => {
      let dataDirName: string | undefined;
      try {
        dataDirName = (await resolveWorkspaceDataDirName(rootPath)) ?? undefined;
      } catch {
        dataDirName = undefined;
      }
      if (guard.cancelled) return;
      setFactsService(
        createFactsService(dataDirName ? { storage, dataDirName } : { storage }),
      );
    })();
    return () => {
      guard.cancelled = true;
      setFactsService(null);
    };
  }, [rootPath, workspaceService]);

  // Per-workspace lifecycle.
  useEffect(() => {
    if (!rootPath) return;

    const workspaceIdentity = captureWorkspaceIdentity();
    let unlisten: (() => void) | null = null;
    const stopModelListeners: Array<() => void> = [];
    let cancelled = false;
    // This begins synchronously in the effect, before its first await.  Search
    // can therefore never show a stale mail row during a restart's wiring gap.
    beginPendingMailRagRetagStartupHold(rootPath);
    let stopPendingMailRagRetagRecovery: () => void = () => {};
    // QA-19 (codex-review follow-up): owned per mount so its retry timers can
    // be cancelled wholesale on cleanup — see IndexRetryScheduler.disposeAll.
    const indexRetryScheduler = createIndexRetryScheduler();
    const deleteBatcher = createDeleteBurstBatcher(
      (path) => MemoryService.deletePath(path),
      {
        onCancelledAfterDelete: (path) => {
          // A create/modify raced an already-in-flight delete for this path
          // and lost — the delete finished AFTER the file was recreated, so
          // it may have just removed the fresh content's chunks. Re-run the
          // exact same create/modify routing (cancel — a no-op here, the
          // delete already settled — then (re)index) to restore it.
          handleWorkspaceFileChangedEvent(
            { kind: 'modify', path },
            { deleteBatcher, workspaceService, indexRetryScheduler },
          );
        },
      },
    );

    void (async () => {
      try {
        const core = await import('@tauri-apps/api/core');
        if (!core.isTauri()) return;

        // QA-19: install the ESSENTIAL wiring (point RAG at this workspace,
        // start the watcher, subscribe to change events) FIRST, retried with
        // backoff, and structurally before any of the optional connector
        // setup below. Previously this shared one try/catch with mail setup
        // and ran AFTER it — a transient mail/CRM/OneDrive/etc. failure (or a
        // transient `setWorkspace`/`watchWorkspace` failure) silently aborted
        // watcher installation for the rest of the session, with no retry and
        // no log. That is the confirmed root cause of BUG-DB QA-19/QA-13
        // ("only a restart fixes it" — a fresh mount is the only thing that
        // ever retried this sequence).
        const stop = await retryAsync(
          () =>
            installEssentialWorkspaceWiring(
              rootPath,
              workspaceService,
              deleteBatcher,
              indexRetryScheduler,
            ),
          {
            delaysMs: ESSENTIAL_WIRING_RETRY_DELAYS_MS,
            isCancelled: () => cancelled,
            onError: (err, attempt) => {
              console.error(
                `[memory] workspace wiring attempt ${String(attempt + 1)} failed; ` +
                  (attempt < ESSENTIAL_WIRING_RETRY_DELAYS_MS.length ? 'retrying' : 'giving up'),
                err,
              );
            },
          },
        );
        if (cancelled) {
          // P2 (codex-review follow-up): this workspace was closed/switched
          // WHILE essential wiring was still installing. Stop the listener
          // we just registered and bail out immediately — falling through
          // into the optional connector setup below would run
          // mailSetWorkspace/crmSetWorkspace/oneDriveSetWorkspace/etc. with
          // this closure's STALE `rootPath`, potentially racing the NEW
          // workspace's own setup and leaving connector state on the Rust
          // side pointing at an inactive workspace (isolation-adjacent
          // misrouting, not just a wasted call).
          stop();
          return;
        }
        unlisten = stop;

        // Optional connectors — every one of these is best-effort and
        // individually caught, so a failure here can never again take down
        // the file watcher / live indexing installed above.
        try {
          await mailSetWorkspace(rootPath);
          if (isWorkspaceIdentityCurrent(workspaceIdentity)) {
            stopPendingMailRagRetagRecovery = startPendingMailRagRetagRecovery(
              workspaceIdentity,
              { isCancelled: () => cancelled },
            );
          }
        } catch (err) {
          console.warn('mailSetWorkspace failed; continuing workspace setup:', err);
        }
        await purgePendingDeletedMattersForWorkspace(rootPath);
        // Best-effort: tell the CRM backend which workspace to use so
        // crm_sync_all and crm_disconnect know where to read/write. The CRM
        // connector is optional; a failure here must NOT break the rest of
        // workspace wiring (file watching + memory indexing) for every user.
        try {
          await crmSetWorkspace(rootPath);
        } catch (err) {
          console.warn('crmSetWorkspace failed; continuing workspace setup:', err);
        }
        try {
          await useCrmWriteQueueStore.getState().hydrateFromBackend();
        } catch (err) {
          console.warn('CRM write queue hydrate failed; continuing workspace setup:', err);
        }
        // Best-effort: tell the writeback backend which workspace to use so
        // the external-write ledger (RightCapital/Holistiplan planning
        // sockets, Wave 1) reads/writes the right encrypted DB. Optional and
        // individually caught for the same reason as every connector above.
        try {
          await externalWriteSetWorkspace(rootPath);
        } catch (err) {
          console.warn('externalWriteSetWorkspace failed; continuing workspace setup:', err);
        }
        try {
          await useExternalWriteQueueStore.getState().hydrateFromBackend();
        } catch (err) {
          console.warn('External write queue hydrate failed; continuing workspace setup:', err);
        }
        try {
          await oneDriveSetWorkspace(rootPath);
        } catch (err) {
          console.warn('oneDriveSetWorkspace failed; continuing workspace setup:', err);
        }
        try {
          await boxSetWorkspace(rootPath);
        } catch (err) {
          console.warn('boxSetWorkspace failed; continuing workspace setup:', err);
        }
        try {
          await sharefileSetWorkspace(rootPath);
        } catch (err) {
          console.warn('sharefileSetWorkspace failed; continuing workspace setup:', err);
        }
        // Best-effort: DocuSign sync/list/disconnect commands also need the
        // active workspace path before they can read/write local connector data.
        try {
          await docusignSetWorkspace(rootPath);
        } catch (err) {
          console.warn('docusignSetWorkspace failed; continuing workspace setup:', err);
        }
        try {
          await jotformSetWorkspace(rootPath);
        } catch (err) {
          console.warn('jotformSetWorkspace failed; continuing workspace setup:', err);
        }
        try {
          await zocksSetWorkspace(rootPath);
        } catch (err) {
          console.warn('zocksSetWorkspace failed; continuing workspace setup:', err);
        }
        try {
          await addeparSetWorkspace(rootPath);
        } catch (err) {
          console.warn('addeparSetWorkspace failed; continuing workspace setup:', err);
        }
        try {
          await calendlySetWorkspace(rootPath);
        } catch (err) {
          console.warn('calendlySetWorkspace failed; continuing workspace setup:', err);
        }
        try {
          await calendarSetWorkspace(rootPath);
        } catch (err) {
          console.warn('calendarSetWorkspace failed; continuing workspace setup:', err);
        }

        const { listen } = await import('@tauri-apps/api/event');

        // Background full-workspace index. Resolves when complete; the
        // banner / badge UI follow progress events independently.
        //
        // Option B: the index needs the embedding model. When it is still
        // downloading (first run), wait for the model-download ready event
        // and start then — the Rust side also refuses without consuming
        // the once-per-activation latch, so this re-call gets a full walk.
        // Listen-first-then-check: register the ready listener BEFORE probing
        // modelStatus(), so a ready event landing between the probe and the
        // listen can't be missed (the session would otherwise never index
        // until the next launch). If both the event and the probe report
        // ready, the flag makes the kick-off run exactly once.
        let fullIndexStarted = false;
        const startFullIndexOnce = () => {
          if (fullIndexStarted) return;
          fullIndexStarted = true;
          void startFullIndex(workspaceService, workspaceIdentity);
        };
        const stopModelListen = await listen<ModelDownloadProgress>(
          MODEL_DOWNLOAD_EVENT,
          (event) => {
            if (event.payload.state === 'ready') {
              stopModelListen();
              startFullIndexOnce();
            }
          },
        );
        if (cancelled) {
          // P2 (codex-review follow-up): same fall-through hazard as above —
          // falling through here would still call modelStatus() and could
          // kick off startFullIndexOnce() (a full re-index) for a workspace
          // that has already closed/switched.
          stopModelListen();
          return;
        }
        stopModelListeners.push(stopModelListen);

        const status = await modelStatus().catch(() => 'ready');
        if (status === 'ready') {
          // Already ready — the listener is unnecessary; drop it and start
          // immediately. Otherwise keep the listener; it starts the index on
          // the ready event.
          stopModelListen();
          startFullIndexOnce();
        }
      } catch (err) {
        // QA-19: this used to be a bare, silent catch — a permanently-failed
        // setup left memory disabled for the rest of the session with no way
        // to tell why short of a restart. Essential wiring above already
        // retries transient failures with backoff; if it still ends up here,
        // log loudly so a real regression is diagnosable instead of invisible.
        console.error(
          '[memory] workspace wiring setup failed for this session; ' +
            'live indexing and workspace search may be unavailable until reopened',
          err,
        );
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      stopModelListeners.forEach((s) => {
        s();
      });
      deleteBatcher.dispose();
      stopPendingMailRagRetagRecovery();
      // QA-19 (codex-review follow-up): cancel any pending index retry so it
      // can never fire after this workspace has closed/switched and index
      // stale content into whatever workspace is active by then.
      indexRetryScheduler.disposeAll();
    };
    // Depend on workspaceService too. On open the service is created/set AFTER
    // rootPath (the recent-open path sets rootPath, then App creates the service
    // asynchronously), so the FIRST run captures a null service and skips the PDF
    // pass — silently dropping ~80% of files. App re-renders when the service is
    // set (e.g. the tree loads), so re-running here fires the PDF index with a
    // real service. The Rust full walk coalesces via its once-per-activation
    // latch, so it is not redone.
  }, [rootPath, workspaceService]);

  // A3: React to toggle changes for includePdfsInWorkspaceIndex.
  // When turned ON, trigger PDF indexing. When turned OFF, remove PDF chunks.
  useEffect(() => {
    if (!rootPath || !workspaceService) return;
    const workspaceIdentity = captureWorkspaceIdentity();

    let prevEnabled = Boolean(
      useSettingsStore.getState().getSetting<boolean>('includePdfsInWorkspaceIndex'),
    );

    const unsubscribe = useSettingsStore.subscribe((state) => {
      const enabled = Boolean(state.getSetting<boolean>('includePdfsInWorkspaceIndex'));
      if (enabled === prevEnabled) return;
      prevEnabled = enabled;
      if (enabled) {
        void indexWorkspacePdfs(workspaceService, workspaceIdentity).catch(() => {});
      } else {
        // Remove PDF chunks. Collect .pdf paths from the current file tree.
        const { fileTree } = useWorkspaceStore.getState();
        const pdfPaths = collectPdfPaths(fileTree);
        void MemoryService.deleteAllPdfChunks(pdfPaths).catch(() => {});
      }
    });
    return unsubscribe;
  }, [rootPath, workspaceService]);

  // WS-B/C — re-index when a matter's folder mapping changes. Files in a
  // newly-mapped (or remapped/unmapped) folder need their chunks re-tagged
  // with the correct matter id so retrieval scoping stays accurate. We diff
  // the matters list on every change and re-index the files under any folder
  // whose matter assignment moved. Best-effort and debounced by Zustand's
  // single-notification-per-set semantics.
  useEffect(() => {
    if (!rootPath) return;
    let prevMatters = useMatterStore.getState().matters.map((m) => ({
      id: m.id,
      folderPaths: m.folderPaths,
    }));

    const unsubscribe = useMatterStore.subscribe((state) => {
      const nextMatters = state.matters.map((m) => ({
        id: m.id,
        folderPaths: m.folderPaths,
      }));
      const folders = changedFolderPaths(prevMatters, nextMatters);
      prevMatters = nextMatters;
      // QA-44: durable + visible + fail-closed. A swallowed failure here used to
      // leave the files tagged to the OLD client, so they surfaced under the
      // wrong scope while the UI claimed the new mapping was live. The scheduler
      // op captures a FRESH workspace identity at execution time (see
      // `scheduleFolderMatterRetag`), so a switch mid-flight bails + keeps the hold
      // rather than re-tagging the new workspace.
      scheduleFolderMatterRetag(folders, workspaceService, retagSchedulerRef.current);
    });
    return unsubscribe;
  }, [rootPath, workspaceService]);

  // WS-B/C — re-tag synced mail when a matter's mail-folder mapping changes.
  // Mapping a mail folder to a matter (or remapping/unmapping it) must re-scope
  // the email already imported from that folder so retrieval reflects the new
  // matter immediately, without a full re-sync. We diff the matters' mail-folder
  // mappings on every change and re-tag each affected folder's messages IN PLACE
  // via `mail_retag_folder_matter` (the same re-tag path files use). Best-effort
  // and debounced by Zustand's single-notification-per-set semantics.
  useEffect(() => {
    if (!rootPath) return;
    let prevMatters = useMatterStore.getState().matters.map((m) => ({
      id: m.id,
      mailFolderPaths: m.mailFolderPaths ?? [],
    }));

    const unsubscribe = useMatterStore.subscribe((state) => {
      const nextMatters = state.matters.map((m) => ({
        id: m.id,
        mailFolderPaths: m.mailFolderPaths ?? [],
      }));
      const changed = changedMailFolderPaths(prevMatters, nextMatters);
      prevMatters = nextMatters;
      // QA-44: durable retry + visible state instead of a swallowed failure, so
      // a failed re-tag no longer silently claims the new mail mapping is live.
      scheduleMailMatterRetag(changed, retagSchedulerRef.current);
    });
    return unsubscribe;
  }, [rootPath]);

  // WS-PRIV — re-tag when a source's privilege changes. Marking a source
  // privileged must immediately remove it from default retrieval (and clearing
  // privilege must restore it), so we diff the privilege map on every change and
  // re-tag the affected sources' already-indexed chunks IN PLACE (no re-embed)
  // via `rag_retag_privilege`. Best-effort and debounced by Zustand's
  // single-notification-per-set semantics. Mirrors the matter re-index reaction.
  useEffect(() => {
    if (!rootPath) return;
    let prevMap = { ...usePrivilegeStore.getState().privilegeBySource };

    const unsubscribe = usePrivilegeStore.subscribe((state) => {
      const nextMap = { ...state.privilegeBySource };
      const sources = changedPrivilegeSources(prevMap, nextMap);
      prevMap = nextMap;
      // QA-44: durable retry + visible state instead of a swallowed failure. The
      // leak itself is already closed independently by `MemoryService.retrieve`
      // (it re-checks every hit against the live privilege store), so a source
      // the user marked privileged is excluded from normal Ask even if THIS
      // re-tag never lands; this keeps the index consistent and surfaces that
      // the rule isn't fully applied yet.
      schedulePrivilegeRetag(sources, retagSchedulerRef.current);
    });
    return unsubscribe;
  }, [rootPath]);
}

export default useMemoryWiring;
