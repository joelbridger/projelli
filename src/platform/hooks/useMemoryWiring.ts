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

import { useEffect } from 'react';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { workspacePath } from '@/platform/fs/appPath';
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
} from '@/platform/rag/MemoryService';
import { getMatters, resolveMatterIdForPath, useMatterStore } from '@/platform/matter/matterStore';
import {
  buildMailMatterMap,
  isPathInFolder,
  parseMailFolderKey,
} from '@/platform/rag/matterResolver';
import { UNASSIGNED_MATTER_ID } from '@/platform/types/matter';
import { mailBackfillRag, mailRetagFolderMatter } from '@/platform/utils/mail-commands';
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

function isAbsoluteWorkspacePath(path: string): boolean {
  return (
    path.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.startsWith('\\\\')
  );
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
  return toForwardSlashPath(path)
    .split('/')
    .includes(WORKSPACE_DATA_DIR);
}

/** Convert a workspace-relative path into the same absolute forward-slash path shape the RAG store uses. */
export function buildWorkspaceAbsolutePath(rootPath: string | null | undefined, path: string): string {
  if (!rootPath || isAbsoluteWorkspacePath(path)) return toForwardSlashPath(path);
  const root = toForwardSlashPath(rootPath);
  const relative = path.replace(/^[\\/]+/, '').replace(/[\\/]+/g, '/');
  return `${root}/${relative}`;
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

/**
 * Resolve a matter id for a file path that may be workspace-relative (as
 * MainPanel's open tabs store it) OR already absolute (as `Matter.folderPaths`
 * store it) — tries the raw path first, then the workspace-root-joined
 * absolute form. Exported (Wave 0) so any caller with a tab path + the
 * workspace root can resolve correctly, not just this hook's own indexing.
 */
export function resolveMatterIdForWorkspacePath(path: string, rootPath: string | null | undefined): string {
  const direct = resolveMatterIdForPath(path);
  if (direct !== UNASSIGNED_MATTER_ID || !rootPath || isAbsoluteWorkspacePath(path)) {
    return direct;
  }
  return resolveMatterIdForPath(buildWorkspaceAbsolutePath(rootPath, path));
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

function resolveMatterIdWithWorkspaceForms(path: string): string {
  const direct = resolveMatterIdForPath(path);
  if (direct !== UNASSIGNED_MATTER_ID) return direct;

  const { rootPath } = useWorkspaceStore.getState();
  const relative = workspaceRelativePath(path, rootPath);
  if (relative) {
    const relativeMatch = resolveMatterIdForPath(relative);
    if (relativeMatch !== UNASSIGNED_MATTER_ID) return relativeMatch;
  }

  if (rootPath && !isAbsoluteWorkspacePath(path)) {
    const absoluteMatch = resolveMatterIdForPath(buildWorkspaceAbsolutePath(rootPath, path));
    if (absoluteMatch !== UNASSIGNED_MATTER_ID) return absoluteMatch;
  }

  return UNASSIGNED_MATTER_ID;
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
};

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
  const { deleteBatcher, workspaceService } = deps;
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
    void MemoryService.indexFile(payload.path);
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
): Array<{ key: string; matterId: string }> {
  const before = new Map<string, string>(); // key -> matterId
  for (const m of prev) for (const k of m.mailFolderPaths ?? []) before.set(k, m.id);
  const after = new Map<string, string>();
  for (const m of next) for (const k of m.mailFolderPaths ?? []) after.set(k, m.id);

  const changed = new Map<string, string>(); // key -> resolved matterId after change
  for (const [key, id] of after) {
    if (before.get(key) !== id) changed.set(key, id);
  }
  for (const [key] of before) {
    if (!after.has(key)) changed.set(key, UNASSIGNED_MATTER_ID); // unmapped -> unassigned
  }
  return Array.from(changed, ([key, matterId]) => ({ key, matterId }));
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
 */
export async function reindexFolderPaths(
  folders: string[],
  workspaceService: MemoryWiringWorkspaceService | null | undefined,
): Promise<void> {
  const allPaths = collectAllFilePaths(await getFreshOrCachedFileTree(workspaceService));

  const { rootPath } = useWorkspaceStore.getState();
  const affected = allPaths.filter((p) => pathInAnyFolder(p, folders, rootPath));

  const pdfPaths = affected.filter(isPdfPath);
  const officeAndTextPaths = affected.filter((p) => !isPdfPath(p));

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
    await MemoryService.reindexPaths(paths, matterId);
  }

  if (!isPdfIndexingEnabled() || !workspaceService) return;
  const binaryWs = buildBinaryWorkspace(workspaceService);
  if (!binaryWs) return;
  for (const path of pdfPaths) {
    try {
      await MemoryService.indexPdfFile(buildWorkspaceAbsolutePath(rootPath, path), binaryWs);
    } catch {
      // Best-effort: skip individual failures, continue with the rest.
    }
  }
}

/** Walk all .pdf files in the workspace and index them via MemoryService. */
export async function indexWorkspacePdfs(
  workspaceService: MemoryWiringWorkspaceService,
): Promise<void> {
  const binaryWs = buildBinaryWorkspace(workspaceService);
  if (!binaryWs) return;
  const { rootPath } = useWorkspaceStore.getState();
  // Retry the FRESH scan until the workspace backend is initialized and the tree
  // is loaded, so PDFs index reliably even when the index fires immediately on
  // open (the empty-cached-tree race that previously dropped ~80% of files).
  const pdfPaths = collectPdfPaths(await getFreshTreeWithRetry(workspaceService));
  if (pdfPaths.length === 0) return;
  const progress = usePdfIndexProgressStore.getState();
  progress.set({ processed: 0, total: pdfPaths.length, currentPath: null });
  // P1.1 (Task 3): whether OCR is on is part of a PDF's freshness signature, so
  // read it once and pass it to the manifest fresh-check below.
  const ocrEnabled = isOcrScannedPdfsEnabled();
  for (const [index, path] of pdfPaths.entries()) {
    const ragPath = buildWorkspaceAbsolutePath(rootPath, path);
    progress.set({ processed: index, total: pdfPaths.length, currentPath: ragPath });
    try {
      // P1.1 (Task 3): skip a PDF whose size/mtime + OCR setting are unchanged
      // since it was last indexed — PDF extraction + OCR is the single most
      // expensive per-file cost, so this is the biggest boot win for PDF-heavy
      // workspaces. A new/changed/tombstoned PDF returns false and re-indexes.
      if (await ragManifestPdfFresh(ragPath, ocrEnabled)) {
        continue;
      }
      await MemoryService.indexPdfFile(ragPath, binaryWs);
    } catch {
      // Best-effort: skip individual failures, continue with the rest.
    } finally {
      progress.set({ processed: index + 1, total: pdfPaths.length, currentPath: ragPath });
    }
  }
  progress.clearSoon();
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
): Promise<void> {
  const allPaths = collectAllFilePaths(await getFreshOrCachedFileTree(workspaceService));
  const { rootPath } = useWorkspaceStore.getState();
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
  for (const [matterId, paths] of byMatter) {
    try {
      // In-place, batched — no re-extract / re-embed. Files with no rows yet are
      // a no-op; the reconcile/watcher indexes them.
      await MemoryService.retagMatterBatch(paths, matterId);
    } catch {
      // Best-effort: skip and continue with the next matter.
    }
  }
  for (const { abs, privilege } of privileged) {
    try {
      await MemoryService.retagPrivilege(abs, privilege);
    } catch {
      // Best-effort.
    }
  }
}

export async function retagExistingMatterFolderPaths(
  workspaceService: MemoryWiringWorkspaceService | null | undefined,
): Promise<void> {
  const folders = Array.from(
    new Set(
      getMatters()
        .flatMap((matter) => matter.folderPaths)
        .filter((folder): folder is string => Boolean(folder)),
    ),
  );
  if (folders.length === 0) return;
  try {
    // P1.1: retag IN PLACE (no re-embed) so a warm boot of a mapped workspace
    // stays cheap. (Was `reindexFolderPaths`, which re-embedded every file.)
    await retagFolderPathsInPlace(folders, workspaceService);
  } catch {
    // Best-effort: the initial index already completed; do not block startup.
  }
}

export async function startFullIndex(
  workspaceService: MemoryWiringWorkspaceService | null | undefined,
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
      // A3: index PDF files (skips unchanged via the manifest fresh-check).
      if (isPdfIndexingEnabled() && workspaceService) {
        await indexWorkspacePdfs(workspaceService).catch(() => {});
      }
      // Option B healing: re-index any mail imported while the model was still
      // downloading, from the local encrypted bodies. No-ops fast when the
      // backfill marker is absent (the common case).
      await mailBackfillRag(buildMailMatterMap(getMatters())).catch(() => {});
      // Apply folder→matter scoping to the (now stable) rows, in place.
      await retagExistingMatterFolderPaths(workspaceService);
    })
    .catch(() => {
      /* errors are surfaced via the progress event with status: error */
    });

  await indexAndRetag;
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
  }, []);

  // M3 — wire the facts service once the workspace is open so the
  // Settings panel and chat viewer can both read/write `memory.json`.
  useEffect(() => {
    if (!rootPath || !workspaceService) {
      setFactsService(null);
      return;
    }
    const storage = buildFactsStorage(workspaceService, rootPath);
    setFactsService(createFactsService({ storage }));
    return () => {
      setFactsService(null);
    };
  }, [rootPath, workspaceService]);

  // Per-workspace lifecycle.
  useEffect(() => {
    if (!rootPath) return;

    let unlisten: (() => void) | null = null;
    const stopModelListeners: Array<() => void> = [];
    let cancelled = false;
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
            { deleteBatcher, workspaceService },
          );
        },
      },
    );

    void (async () => {
      try {
        const core = await import('@tauri-apps/api/core');
        if (!core.isTauri()) return;

        await MemoryService.setWorkspace(rootPath);
        await mailSetWorkspace(rootPath);
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
        await watchWorkspace(rootPath);

        const { listen } = await import('@tauri-apps/api/event');
        const stop = await listen<WorkspaceChangeEvent>(
          'workspace-file-changed',
          (event) => {
            handleWorkspaceFileChangedEvent(event.payload, {
              deleteBatcher,
              workspaceService,
            });
          },
        );
        if (cancelled) {
          stop();
        } else {
          unlisten = stop;
        }

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
          void startFullIndex(workspaceService);
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
        if (cancelled) stopModelListen();
        else stopModelListeners.push(stopModelListen);

        const status = await modelStatus().catch(() => 'ready');
        if (status === 'ready') {
          // Already ready — the listener is unnecessary; drop it and start
          // immediately. Otherwise keep the listener; it starts the index on
          // the ready event.
          stopModelListen();
          startFullIndexOnce();
        }
      } catch {
        // Tauri or watcher init failed — leave memory disabled gracefully.
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      stopModelListeners.forEach((s) => {
        s();
      });
      deleteBatcher.dispose();
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

    let prevEnabled = Boolean(
      useSettingsStore.getState().getSetting<boolean>('includePdfsInWorkspaceIndex'),
    );

    const unsubscribe = useSettingsStore.subscribe((state) => {
      const enabled = Boolean(state.getSetting<boolean>('includePdfsInWorkspaceIndex'));
      if (enabled === prevEnabled) return;
      prevEnabled = enabled;
      if (enabled) {
        void indexWorkspacePdfs(workspaceService).catch(() => {});
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
      if (folders.length === 0) return;

      // Re-index the affected files from the current source of truth. Uses a
      // live disk scan (via workspaceService.getFileTree) when available so
      // externally-added files — not yet reflected in the cached in-memory
      // tree — are picked up immediately. Falls back to the cached tree in
      // browser mode or when the scan fails. Best-effort: errors are swallowed.
      void reindexFolderPaths(folders, workspaceService).catch(() => {});
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
      if (changed.length === 0) return;
      for (const { key, matterId } of changed) {
        const parsed = parseMailFolderKey(key);
        if (!parsed) continue;
        void mailRetagFolderMatter(
          parsed.provider,
          parsed.account,
          parsed.folderId,
          matterId,
        ).catch(() => {});
      }
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
      if (sources.length === 0) return;
      for (const sourceId of sources) {
        // resolvePrivilegeForSource reflects the latest store (a cleared entry
        // resolves to "none", which re-tags the chunks back to non-privileged).
        const privilege = resolvePrivilegeForSource(sourceId);
        void MemoryService.retagPrivilege(sourceId, privilege).catch(() => {});
      }
    });
    return unsubscribe;
  }, [rootPath]);
}

export default useMemoryWiring;
