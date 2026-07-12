// Thin wrappers around custom Tauri commands defined in
// `src-tauri/src/commands/`. Each wrapper is safe to call from browser
// test mode: `isTauri()` returns false and the function short-circuits with a
// browser-appropriate fallback (null for detection, thrown error for
// conversion).
//
// The app already has a detection helper `isTauriEnvironment()` in
// BackendFactory, but that reads `window.__TAURI__` directly. Here we use
// the official `isTauri` export from `@tauri-apps/api/core` so mocks that
// replace `window.__TAURI_INTERNALS__` (Tauri v2's real internal bridge) flow
// through the same code path the rest of the Tauri API uses.

import { invoke, isTauri } from '@tauri-apps/api/core';
import { resolveWorkspacePath } from '@/platform/fs/pathResolve';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { LOCAL_AI_NAME } from '@/config/brandText';
import type { DateConflictFlag, DatedFact, SourceDate } from '@/platform/retrieval/dates';

/**
 * Resolve `path` to an absolute workspace path using the active workspace root.
 * Mirrors `toAbsoluteDocxPath` in docx-commands.ts — kept separate so
 * tauri-commands.ts doesn't depend on docx-commands.ts (different concern).
 */
function toAbsoluteWorkspacePath(path: string): string {
  const rootPath = useWorkspaceStore.getState().rootPath;
  if (!rootPath) return path;
  return resolveWorkspacePath(rootPath, path);
}

/**
 * Detect whether LibreOffice (`soffice`) is installed on the user's system.
 *
 * @returns the absolute path to the soffice binary, or `null` if not found
 *   (or if running in the browser).
 */
export async function detectLibreOffice(): Promise<string | null> {
  if (!isTauri()) return null;
  const result = await invoke<string | null>('detect_libreoffice');
  return result;
}

/** Outcome of the per-workspace data-folder check for the `.lantern` folder. */
export interface WorkspaceDataDirMigrationReport {
  /** e.g. "fresh-install" | "already-migrated" */
  data_dir: string;
  /** e.g. "fresh-install" | "already-migrated" */
  vault_meta: string;
}

/**
 * First-launch check for a workspace's internal `.lantern` data folder and
 * vault-metadata file. Dev-data reset is approved for the Lantern rename, so
 * old folders are not migrated. Browser/dev: no-op (returns null).
 *
 * MUST be awaited at workspace-open time BEFORE any store (audit/mail/rag/…) is
 * opened, so the data folder is converged before consumers touch it.
 */
export async function migrateWorkspaceDataDir(
  workspaceRoot: string,
): Promise<WorkspaceDataDirMigrationReport | null> {
  if (!isTauri()) return null;
  return invoke<WorkspaceDataDirMigrationReport>('migrate_workspace_data_dir', { workspaceRoot });
}

/**
 * Resolve the internal data-dir name for a workspace (`.lantern`) — the same
 * decision the Rust stores use. Renderer-side writers into the data dir resolve
 * their path against this so a write never lands in the wrong folder. Returns
 * `null` in the browser/dev (no Tauri); callers default to `.lantern`.
 */
export async function resolveWorkspaceDataDirName(
  workspaceRoot: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string>('resolve_workspace_data_dir_name', { workspaceRoot });
}

/**
 * Convert a legacy `.doc` file to `.docx` using LibreOffice in headless mode.
 * The output `.docx` is written next to the input file.
 *
 * @param inputPath absolute path to the `.doc` file
 * @returns absolute path of the produced `.docx` file
 * @throws if LibreOffice isn't installed, the conversion fails, or we're in
 *   the browser (conversion is only available in the desktop app)
 */
export async function convertDocToDocx(inputPath: string): Promise<string> {
  if (!isTauri()) {
    throw new Error('Conversion is only available in the desktop app.');
  }
  return invoke<string>('convert_doc_to_docx', { inputPath: toAbsoluteWorkspacePath(inputPath) });
}

/**
 * Convert a `.ppt` or `.pptx` file to `.pdf` using LibreOffice in headless
 * mode. The resulting PDF is cached under the OS temp directory so reopening
 * the same file is instant; the cache is invalidated when the source file's
 * mtime changes.
 *
 * @param inputPath absolute path to the `.ppt` or `.pptx` file
 * @returns absolute path of the cached `.pdf` file
 * @throws if LibreOffice isn't installed, the conversion fails, or we're in
 *   the browser (preview is only available in the desktop app)
 */
export async function convertPptToPdf(inputPath: string): Promise<string> {
  if (!isTauri()) {
    throw new Error('PowerPoint preview is only available in the desktop app.');
  }
  return invoke<string>('convert_ppt_to_pdf', { inputPath: toAbsoluteWorkspacePath(inputPath) });
}

// --------------------------------------------------------------------
// Phase 2 (v1.5) Rust foundation bindings.
//
// These thin wrappers mirror the new commands in `src-tauri/src/commands/`
// (http.rs, keychain.rs, rag.rs, watcher.rs). Each gracefully degrades in
// browser / test mode so callers can wire UI against them today.
// --------------------------------------------------------------------

/** Structured error the `keychain_*` commands can return. Frontend callers
 *  can switch on `.kind` to show a useful message ("install gnome-keyring"
 *  on Linux, "allow the app to access your Keychain" on macOS, etc.). */
export type KeychainErrorKind =
  | 'notFound'
  | 'noBackend'
  | 'denied'
  | 'other';

export interface KeychainError {
  kind: KeychainErrorKind;
  message: string;
}

/** A single retrieval hit returned by `rag_retrieve`.
 *  A3 adds optional sourceType and pageNumber for PDF chunks.
 *  WS-B/C (3.0) adds `id` (the content-addressed citation key), `matterId`
 *  (the confidentiality scope the chunk belongs to), and `sourceId` (the
 *  resolvable originating source: a file path or `mail:<message-id>`). */
export interface RagHit {
  path: string;
  chunkText: string;
  score: number;
  paragraphIndex: number;
  /** WS-B/C: content-addressed chunk id — pass to `ragVerifyCitation`. */
  id?: string;
  /** WS-B/C: the matter this chunk belongs to. Present post-3.0. */
  matterId?: string;
  /** WS-B/C: resolvable source (`/path/to/file` or `mail:<id>`). */
  sourceId?: string;
  /** A3: discriminates text vs PDF vs mail chunks. Absent on pre-A3 rows.
   *  VG-2b adds the office formats (docx/xlsx/pptx/rtf); VG-3c adds
   *  certified deposition transcripts. */
  sourceType?: 'text' | 'pdf' | 'mail' | 'docx' | 'xlsx' | 'pptx' | 'rtf' | 'transcript' | 'crm' | 'onedrive' | 'esign' | 'meeting' | 'box' | 'jotform' | 'sharefile' | 'zocks' | 'addepar';
  /** A3: 1-based page number for PDF chunks; VG-2b reuses it for the REAL
   *  1-based sheet/slide number on xlsx/pptx chunks; VG-3c reuses it for a
   *  transcript chunk's start page. Absent on pre-A3 rows. */
  pageNumber?: number;
  /** VG-3c: page:line locator for certified deposition transcript chunks
   *  (`"startPage:startLine-endPage:endLine"`, e.g. `"45:12-46:3"`). Absent
   *  on every other source. Citation labels prefer it: "Tr. 45:12-46:3". */
  locator?: string;
  /** WS-PRIV: the chunk's privilege status. Present post-WS-PRIV. Default
   *  retrieval only ever returns `'none'`; a non-`none` value appears only on an
   *  explicitly include-privileged query, so the UI can label it. */
  privilege?: 'none' | 'attorney-client' | 'work-product';
  /** VG-2: `'ocr'` when this chunk's text was read from a scanned page by the
   *  local OCR engine. Absent on natively-extracted chunks. */
  extraction?: 'ocr';
  /** VG-2: mean OCR word confidence (0-100) for the chunk's page. Absent on
   *  native chunks. Below `OCR_LOW_CONFIDENCE` the UI labels the citation a
   *  low-confidence scan. */
  extractionConfidence?: number;
  /** B1: timestamp read from the original mail, CRM, or file source. */
  sourceDate?: SourceDate;
  /** B1: optional source-adapter fact identity and visible value. */
  datedFact?: DatedFact;
  /** B1: visible incompatible-dated-evidence warning. */
  dateConflict?: DateConflictFlag;
}

/** VG-2 — the OCR confidence disclosure threshold (0-100 scale). A chunk with
 *  `extraction === 'ocr'` and `extractionConfidence` below this is labelled a
 *  low-confidence scan in citations and finder locators, so nobody relies on a
 *  shaky scan without opening the source. One shared constant: the chat chips,
 *  the sources accordion, and the finder deliverable all read it. */
export const OCR_LOW_CONFIDENCE = 60;

/** WS3c — the OCR confidence SKIP threshold (0-100 scale). An OCR-read page
 *  whose mean word confidence is below this is near-gibberish: it is dropped at
 *  ingestion and never indexed, so garbage scans cannot pollute retrieval or
 *  produce bad citations. The final coherent design is a two-tier gate:
 *  skip below `OCR_SKIP_CONFIDENCE` (30) · disclose between it and
 *  `OCR_LOW_CONFIDENCE` (60) as a "low-confidence scan" · trust at/above 60.
 *  Only OCR-read pages are subject to the skip; native-text pages are always
 *  indexed. Centralised here alongside `OCR_LOW_CONFIDENCE` so the two
 *  thresholds stay together and are never magic-number-scattered. */
export const OCR_SKIP_CONFIDENCE = 30;

/** WS-B/C — the REQUIRED retrieval scope. A caller cannot omit scope and
 *  silently search every matter; it must name `matter` or `allMatters`.
 *  Mirrors `RetrievalScope` in `src-tauri/src/commands/rag/state.rs`.
 *
 *  - `{ kind: 'matter', matterId }` — scope to ONE matter (LanceDB prefilter).
 *  - `{ kind: 'allMatters' }`       — explicit, audited cross-matter search.
 */
export type RetrievalScope =
  | { kind: 'matter'; matterId: string }
  | { kind: 'allMatters' };

/** WS-B/C — verdict from `ragVerifyCitation`. The app must refuse to present
 *  any answer whose citation does not return `{ verdict: 'verified' }`.
 *  Mirrors `Verdict` in `src-tauri/src/commands/rag/state.rs`. */
export type CitationVerdict =
  | { verdict: 'verified' }
  | { verdict: 'notFound' }
  | { verdict: 'matterMismatch'; actualMatter: string }
  | { verdict: 'textMismatch' };

/** RAG indexer status emitted on the `rag-indexing-progress` Tauri event.
 *  Mirror of `IndexingStatus` in `src-tauri/src/commands/rag/state.rs`. */
export type RagIndexingStatus =
  | 'idle'
  // P1.1 (Task 4): the cheap stat-walk phase of a boot reconcile (comparing
  // files against the manifest). Fast even on large workspaces.
  | 'checking'
  | 'indexing'
  | 'done'
  | 'cancelled'
  | 'error';

/** Payload emitted on the `rag-indexing-progress` event. The
 *  `useRagStatus` hook subscribes to this event.
 *
 *  BUG-099: `skipped`, `failed`, `timedOut`, `cleanupFailed`, and
 *  `skippedPaths` carry the per-walk skip counts surfaced by the Rust indexer.
 *  They are optional/zero on per-file `indexing` events (kept small); populated
 *  on the terminal `done` / `cancelled` event so the UI can say "Memory ready
 *  (2 files skipped)" instead of a plain "Memory ready."
 *
 *  Counter semantics (important for the banner's honest indexed count):
 *  - `skipped`      = files NOT indexed (= failed + timedOut). Each file counted ONCE.
 *  - `cleanupFailed`= of skipped: files whose stale-row cleanup ALSO failed.
 *                     These are ALREADY in `skipped` -- this is an ADDITIONAL
 *                     counter, not a replacement. The banner uses
 *                     `indexed = total - skipped` (not total - skipped - cleanupFailed). */
export interface RagIndexingProgress {
  status: RagIndexingStatus;
  processed: number;
  total: number;
  currentPath?: string | null;
  /** Total files skipped (= failed + timedOut). Each file counted once. */
  skipped?: number;
  /** Of skipped: extraction / embedding failures. */
  failed?: number;
  /** Of skipped: files that exceeded the per-file index timeout. */
  timedOut?: number;
  /** Separate from skipped: files whose stale-row cleanup also failed (tombstoned).
   *  Omitted from the wire when zero. */
  cleanupFailed?: number;
  /** Paths of skipped files (bounded to 100 on the wire; use counts for total). */
  skippedPaths?: string[];
  /** P1.1 (Task 2): true ONLY while a one-time schema-migration rebuild runs.
   *  The banner shows an honest "Upgrading search index…" then, distinct from a
   *  routine boot reconcile. Omitted (falsey) on every normal walk. */
  migrating?: boolean;
  /** P1.1 (Task 4): files a boot reconcile SKIPPED as unchanged (work avoided). */
  reused?: number;
  /** P1.1 (Task 4): files a boot reconcile actually re-indexed (new/changed). */
  reindexed?: number;
  /** P1.1 (Task 4): sources whose rows were purged because the file was deleted. */
  deleted?: number;
}

/** Tauri event name. Mirror of `PROGRESS_EVENT` in mod.rs. */
export const RAG_PROGRESS_EVENT = 'rag-indexing-progress';

/** Payload emitted when indexed content is invalidated without representing a
 *  full indexing-status snapshot. */
export interface RagContentInvalidated {
  source: string;
  deleted: number;
}

/** Tauri event name. Mirror of `CONTENT_INVALIDATED_EVENT` in mod.rs. */
export const RAG_CONTENT_INVALIDATED_EVENT = 'rag-content-invalidated';

/** Simplified change kind emitted on the `workspace-file-changed` event. */
export type WorkspaceChangeKind = 'create' | 'modify' | 'delete' | 'rename';

export interface WorkspaceChangeEvent {
  path: string;
  kind: WorkspaceChangeKind;
}

/**
 * Fetch the HTML title of a URL for Q12 smart paste. Returns `""` on any
 * error — the frontend should treat an empty string as "fall back to the
 * raw URL". Browser mode also returns `""` since we don't have access to
 * a CORS-friendly fetcher.
 */
export async function fetchUrlTitle(url: string): Promise<string> {
  if (!isTauri()) return '';
  try {
    return await invoke<string>('fetch_url_title', { url });
  } catch {
    return '';
  }
}

/** Store a secret in the OS keychain under (service, key). Overwrites. */
export async function keychainSet(
  key: string,
  value: string,
  service?: string,
): Promise<void> {
  if (!isTauri()) {
    throw new Error('keychain is only available in the desktop app.');
  }
  return invoke<void>('keychain_set', { service, key, value });
}

/** Read a secret from the OS keychain. Throws with a structured
 *  `KeychainError` if not found or the backend rejects the query. */
export async function keychainGet(
  key: string,
  service?: string,
): Promise<string> {
  if (!isTauri()) {
    throw new Error('keychain is only available in the desktop app.');
  }
  return invoke<string>('keychain_get', { service, key });
}

/** Delete a secret. Idempotent — succeeds if the key wasn't present. */
export async function keychainDelete(
  key: string,
  service?: string,
): Promise<void> {
  if (!isTauri()) {
    throw new Error('keychain is only available in the desktop app.');
  }
  return invoke<void>('keychain_delete', { service, key });
}

/** Set or replace the active workspace root the RAG indexer points at.
 *  Must be called once when the user opens a workspace, before any other
 *  `rag_*` command. */
export async function ragSetWorkspace(path: string): Promise<void> {
  if (!isTauri()) return; // no-op in browser
  return invoke<void>('rag_set_workspace', { path });
}

/** Index a single file into the local RAG store. Idempotent — re-running
 *  for the same path replaces stale chunks. Returns immediately for
 *  unsupported file types (silently). */
export async function ragIndexFile(
  path: string,
  matterId?: string,
  privilege?: string,
): Promise<void> {
  if (!isTauri()) {
    throw new Error('RAG is only available in the desktop app.');
  }
  // WS-B/C: omitting matterId indexes under the "unassigned" sentinel (never
  // null). The matter-assignment UI passes a real id here.
  // WS-PRIV: omitting privilege indexes as "none" (not privileged); the privilege
  // store passes the source's real status so privileged content is excluded by default.
  return invoke<void>('rag_index_file', { path, matterId, privilege });
}

/** Index the entire active workspace. Walks every supported file under the
 *  workspace root, emits `rag-indexing-progress` events as it goes, and
 *  honours `ragCancelIndexing()` between files. Resolves once indexing
 *  completes (or is cancelled). */
export async function ragIndexWorkspace(matterId?: string): Promise<void> {
  if (!isTauri()) {
    throw new Error('RAG is only available in the desktop app.');
  }
  // WS-B/C: also runs the one-time pre-3.0 migration (re-index under matter
  // scope). Omitting matterId files everything under the "unassigned" sentinel.
  return invoke<void>('rag_index_workspace', { matterId });
}

/** P1.1 (Task 4) — the BOOT indexer. Cheap stat-walk of the workspace, then
 *  (re)index only new/changed files, purge rows for deleted files, and skip
 *  everything unchanged (via the persistent manifest). Falls back to a full
 *  rebuild automatically on a schema migration or fail-closed recovery. Use this
 *  on workspace open instead of `ragIndexWorkspace` so a warm boot no longer
 *  re-embeds the whole workspace. Emits the same `rag-indexing-progress` events. */
export async function ragReconcileWorkspace(matterId?: string): Promise<void> {
  if (!isTauri()) {
    throw new Error('RAG is only available in the desktop app.');
  }
  // `await` (not `return invoke<void>`) so we don't use `void` as a generic type
  // arg (@typescript-eslint/no-invalid-void-type); the unknown result is discarded.
  await invoke('rag_reconcile_workspace', { matterId });
}

/** P1.1 (Task 3) — has this PDF already been indexed at its current version +
 *  OCR setting? The PDF-index loop calls this to skip unchanged PDFs on boot.
 *  Returns false (→ re-index) when new/changed/tombstoned or unknown. Browser
 *  mode always returns false (no manifest). */
export async function ragManifestPdfFresh(
  path: string,
  ocrEnabled: boolean,
): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>('rag_manifest_pdf_fresh', { path, ocrEnabled });
  } catch {
    // Fail safe toward re-indexing.
    return false;
  }
}

/** P1.1 (Task 3) — forget all PDF manifest signatures. Call when PDF indexing is
 *  turned OFF (rows deleted) so a later toggle-ON re-indexes PDFs instead of
 *  wrongly skipping them as "fresh". Best-effort; never throws. */
export async function ragManifestForgetPdfs(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('rag_manifest_forget_pdfs');
  } catch (err) {
    console.warn('ragManifestForgetPdfs failed (non-fatal):', err);
  }
}

/** P1.1 (Task 3) — record a PDF's signature after a successful index so a later
 *  boot can skip it while unchanged. Best-effort; never throws to the caller. */
export async function ragManifestRecordPdf(
  path: string,
  pageCount: number,
  ocrEnabled: boolean,
  matterId?: string,
  privilege?: string,
): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('rag_manifest_record_pdf', {
      path,
      pageCount,
      ocrEnabled,
      matterId,
      privilege,
    });
  } catch (err) {
    console.warn('ragManifestRecordPdf failed (non-fatal):', err);
  }
}

/** Cancel the currently-running workspace indexer. Safe to call when no
 *  indexer is running (no-op). */
export async function ragCancelIndexing(): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>('rag_cancel_indexing');
}

/** Drop every stored chunk for `path`. Wrapper for the watcher path —
 *  callers that already know a file is gone can use this directly. */
export async function ragDeletePath(path: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>('rag_delete_path', { path });
}

/** BUG-040: purge every stored chunk for a matter. Called when a matter is
 *  deleted so its content can't resurface through all-matters retrieval. */
export async function ragDeleteMatter(matterId: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>('rag_delete_matter', { matterId });
}

/**
 * Index pre-extracted PDF page text into the RAG store. Called after
 * `extractPdfText` produces page strings in the renderer process.
 *
 * VG-2: `pageConfidences` is aligned with `pages` — a number marks a page
 * whose text came from the local OCR engine (mean word confidence, 0-100);
 * `undefined` entries (serialized as null) are natively-extracted pages.
 * Omit the array entirely for an all-native PDF. The Rust side stamps
 * OCR pages' chunks with `extraction = "ocr"` + the confidence.
 *
 * Returns the number of chunks stored (0 if all pages were empty or skipped).
 * Throws in browser mode (RAG requires Tauri).
 */
export async function ragIndexPdfChunks(
  path: string,
  pages: string[],
  pageCount: number,
  matterId?: string,
  privilege?: string,
  pageConfidences?: (number | undefined)[],
): Promise<number> {
  if (!isTauri()) {
    throw new Error('RAG PDF indexing is only available in the desktop app.');
  }
  // WS-PRIV: omitting privilege indexes as "none"; pass the source's status to
  // exclude a privileged PDF from default retrieval.
  // VG-2: JSON serialization turns undefined array entries into null, which the
  // Rust command reads as Option::None per page.
  return invoke<number>('rag_index_pdf_chunks', {
    path,
    pages,
    pageCount,
    matterId,
    privilege,
    pageConfidences,
  });
}

/** Query the local RAG store, scoped to a matter. Returns up to `topK` hits
 *  sorted by score (descending). Empty query or `topK = 0` returns `[]` without
 *  invoking the embedder.
 *
 *  WS-B/C: `scope` is REQUIRED — confidentiality is enforced here. Pass
 *  `{ kind: 'matter', matterId }` for normal client work (prefiltered to that
 *  matter), or the explicit `{ kind: 'allMatters' }` for a deliberate
 *  cross-matter search. There is no "search everything" default.
 *
 *  WS-PRIV: `includePrivileged` defaults to `false` (omitted) — attorney-client
 *  and work-product content is EXCLUDED by default. Pass `true` only for a
 *  deliberate, user-initiated "include privileged sources" query. The exclusion
 *  composes with the matter scope as a single backend prefilter.
 *
 *  F-510: `perSourceCap` is an optional per-source diversity cap — at most
 *  that many hits per source document (the backend overfetches, then caps,
 *  preserving rank order). Omitted = no cap; today only the contradiction
 *  finder's feed passes one. The cap runs over already-scoped hits, so it can
 *  only narrow a result set, never widen it.
 *
 *  WS3d-A: `enableReranker` is an OPTIONAL cross-encoder reranking pass.
 *  DEFAULT OFF (omitted or `false`) — retrieval is byte-for-byte the vector-only
 *  path. When `true`, the backend re-orders ONLY within the already-scoped
 *  candidate set (never widening scope/privilege), and transparently falls back
 *  to vector-only if the reranker model isn't installed.
 *
 *  `enableHybridSearch` is an OPTIONAL keyword + vector blended search pass.
 *  DEFAULT OFF (omitted or `false`) — retrieval is the pure vector-only path.
 *  When `true`, the backend blends BM25 keyword hits with the vector results so
 *  exact terms (names, case numbers, citations) surface more reliably. */
export async function ragRetrieve(
  query: string,
  topK: number,
  scope: RetrievalScope,
  includePrivileged?: boolean,
  perSourceCap?: number,
  enableReranker?: boolean,
  enableHybridSearch?: boolean,
): Promise<RagHit[]> {
  if (!isTauri()) {
    throw new Error('Private file search is only available in the desktop app.');
  }
  return invoke<RagHit[]>('rag_retrieve', {
    query,
    topK,
    scope,
    includePrivileged,
    perSourceCap,
    enableReranker,
    enableHybridSearch,
  });
}

/** WS-PRIV — update a source's privilege and re-tag its already-indexed chunks
 *  in place (no re-embedding), so toggling privilege immediately changes whether
 *  the source is excluded from default retrieval. `privilege` must be one of
 *  `'none' | 'attorney-client' | 'work-product'`. Returns the number of chunks
 *  updated (0 if the source has not been indexed yet — it will pick up the new
 *  privilege when it is next indexed). No-op in browser/test mode. */
export async function ragRetagPrivilege(
  path: string,
  privilege: string,
): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>('rag_retag_privilege', { path, privilege });
}

/** WS-B/C — update a source's matter and re-tag its already-indexed chunks in
 *  place (no re-embedding), so re-scoping a source (a file moved between mapped
 *  folders, or a mail folder remapped) immediately changes which matter scope it
 *  surfaces under. `matterId` must be non-empty (`'unassigned'` is allowed).
 *  Returns the number of chunks updated. No-op in browser/test mode. */
export async function ragRetagMatter(
  path: string,
  matterId: string,
): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>('rag_retag_matter', { path, matterId });
}

/** P1.1 — BATCHED matter retag: apply `matterId` to many sources' rows in ONE
 *  LanceDB UPDATE per chunk. The boot retag of a mapped client folder uses this
 *  (grouped per matter) so a warm boot of a mapped workspace stays cheap instead
 *  of re-embedding (or per-file retagging, which LanceDB makes ~as slow as
 *  re-embedding). Returns the paths that STILL have no rows under `matterId`
 *  after the retag (never-indexed files, or a path-form mismatch) so the caller
 *  can re-index exactly those — QA-92. */
export async function ragRetagMatterBatch(
  paths: string[],
  matterId: string,
): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>('rag_retag_matter_batch', { paths, matterId });
}

/** WS-B/C — verify a citation against the local store so the app can REFUSE to
 *  present an answer whose citation does not verify. Looks up the chunk by its
 *  content-addressed `id` SCOPED to `claimedMatterId`, then asserts the stored
 *  chunk text contains `quotedText` (whitespace-normalized).
 *
 *  Returns one of: `verified` (present it), `notFound` (fabricated/stale id),
 *  `matterMismatch` (the chunk exists under a DIFFERENT matter — a scope lie),
 *  or `textMismatch` (the answer misquoted the source / mail could not be
 *  decrypted). Only `verified` is safe to surface. */
export async function ragVerifyCitation(
  id: string,
  claimedMatterId: string,
  quotedText: string,
): Promise<CitationVerdict> {
  if (!isTauri()) {
    throw new Error('RAG is only available in the desktop app.');
  }
  return invoke<CitationVerdict>('rag_verify_citation', {
    id,
    claimedMatterId,
    quotedText,
  });
}

/** P2.1 (Finding 2) — one citation to verify in a batch call. */
export interface CitationToVerify {
  id: string;
  claimedMatterId: string;
  quotedText: string;
}

/** P2.1 (Finding 2) — verify MANY citations in ONE backend call. Replaces the
 *  per-citation `ragVerifyCitation` loop (which re-opened the LanceDB table and
 *  ran a point lookup per citation — an N+1). The backend opens the table once
 *  and reads every cited chunk in one `id IN (...)` query. Verdicts come back in
 *  the SAME ORDER as `citations`, one per input. */
export async function ragVerifyCitationsBatch(
  citations: CitationToVerify[],
): Promise<CitationVerdict[]> {
  if (!isTauri()) {
    throw new Error('RAG is only available in the desktop app.');
  }
  if (citations.length === 0) return [];
  return invoke<CitationVerdict[]>('rag_verify_citations_batch', { citations });
}

/** Tauri event for the one-time embedding-model download. Mirrors
 *  MODEL_EVENT in src-tauri/src/commands/rag/model_download.rs. */
export const MODEL_DOWNLOAD_EVENT = 'model-download-progress';

/** Marker substring in Rust errors meaning "model files not downloaded
 *  yet". Mirrors MODEL_NOT_READY in embedder.rs. */
export const MODEL_NOT_READY = 'model-not-ready';

/** Download lifecycle emitted on `model-download-progress` events.
 *  Mirror of `ModelDownloadState` in model_download.rs (lowercase on
 *  the wire). */
export type ModelDownloadState =
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'error';

/** Payload emitted on the `model-download-progress` event. The
 *  `useModelStatus` hook subscribes to this event. Mirror of
 *  `ModelDownloadProgress` in model_download.rs (camelCase via serde). */
export interface ModelDownloadProgress {
  state: ModelDownloadState;
  file: string | null;
  bytesDone: number;
  bytesTotal: number | null;
  message: string | null;
}

/** Cheap model presence probe: 'ready' | 'absent' | 'downloading' | 'error'. */
export async function modelStatus(): Promise<string> {
  return invoke<string>('model_status');
}

/** Idempotent: kicks off the visible model download when files are missing. */
export async function modelEnsure(): Promise<string> {
  return invoke<string>('model_ensure');
}

// --------------------------------------------------------------------
// Lantern Local AI (embedded llama.cpp engine) — first-run GGUF download
// and lazy llama-server sidecar lifecycle. Mirrors the e5-small model
// download pattern above. Rust side: src-tauri/src/commands/local_llm/.
// --------------------------------------------------------------------

/** Event name for local-LLM download progress (mirror of model_download.rs). */
export const LOCAL_LLM_MODEL_EVENT = 'local-llm-model-download-progress';

/** Progress payload for the local-AI model download (camelCase via serde). */
export interface LocalLlmDownloadProgress {
  state: 'checking' | 'downloading' | 'verifying' | 'ready' | 'error';
  modelId: string;
  filename: string;
  bytesDone: number;
  bytesTotal: number;
  message: string | null;
}

/** Local AI model presence probe: 'ready' | 'absent' | 'downloading' | 'error'. */
export async function localLlmModelStatus(): Promise<string> {
  if (!isTauri()) return 'absent';
  return invoke<string>('local_llm_model_status');
}

/** Idempotent: kicks off the visible local-AI model download when absent. */
export async function localLlmModelEnsure(): Promise<string> {
  return invoke<string>('local_llm_model_ensure');
}

/** Start (lazily) the llama-server sidecar and return its local endpoint
 *  (e.g. http://127.0.0.1:18089). Errors if the model isn't downloaded yet.
 *  @throws if we're in the browser — the sidecar only exists in the desktop app. */
export async function localLlmSidecarStart(): Promise<string> {
  if (!isTauri()) {
    throw new Error(`${LOCAL_AI_NAME} is only available in the desktop app.`);
  }
  return invoke<string>('local_llm_sidecar_start');
}

/** Stop the llama-server sidecar (no-op if not running). */
export async function localLlmSidecarStop(): Promise<void> {
  if (!isTauri()) return;
  await invoke('local_llm_sidecar_stop');
}

/** True when the running sidecar answers its health endpoint. */
export async function localLlmSidecarHealth(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('local_llm_sidecar_health');
}

/** True when the sidecar process is alive. */
export async function localLlmSidecarIsRunning(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('local_llm_sidecar_is_running');
}

/** Start (or replace) the workspace file watcher. Only one watcher is
 *  active at a time. Emits `workspace-file-changed` events that callers
 *  can subscribe to via `@tauri-apps/api/event`'s `listen`. */
export async function watchWorkspace(path: string): Promise<void> {
  if (!isTauri()) return; // no-op in browser
  return invoke<void>('watch_workspace', { path });
}

// --------------------------------------------------------------------
// Phase 4 M4 (v1.5 Flag 2) — MCP sidecar bridge.
//
// The `lantern-mcp` binary (see `src-tauri/src/bin/mcp/`) writes approval
// requests to disk when an MCP client calls `write_workspace_file` with
// `require_confirmation = true`. These commands let the desktop app
// surface them to the user and return the user's decision.
// --------------------------------------------------------------------

/** One pending write approval queued by the `lantern-mcp` sidecar.
 *  Mirror of the `PendingApproval` struct in `src-tauri/src/commands/mcp.rs`
 *  (camelCase via `#[serde(rename_all = "camelCase")]`). */
export interface McpPendingApproval {
  token: string;
  path: string;
  preview: string;
  fileExists: boolean;
  oldPreview: string;
  contentBytes: number;
  receivedAt: number;
}

/** List every pending write approval request on disk. Returns `[]` in
 *  browser mode and on a clean filesystem. Safe to call on a 1s poll. */
export async function mcpListPendingApprovals(): Promise<McpPendingApproval[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<McpPendingApproval[]>('mcp_list_pending_approvals');
  } catch {
    return [];
  }
}

/** Record the user's decision on a pending write. The sidecar's stdout
 *  poller picks it up within 100 ms; the file is deleted after read. */
export async function mcpApproveWrite(
  token: string,
  approved: boolean,
): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>('mcp_approve_write', { token, approved });
}

/** Resolve the absolute path to the platform `.mcpb` bundle that the
 *  Settings section's Download button reveals for the user. Returns `null`
 *  when the bundle isn't available (dev build without prior `build-mcpb`
 *  run, unsupported target, browser mode). */
export async function mcpBundlePath(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string | null>('mcp_bundle_path');
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------
// Phase 4 M6 (v1.5 Flag 4) — voice input via bundled Parakeet/whisper.cpp
// sidecar. Press-to-talk captures WAV bytes in the renderer (via
// `MediaRecorder` + `AudioContext` re-encoding) and ships them here for
// transcription.
// --------------------------------------------------------------------

/** Result of a single transcription run. Mirror of Rust `TranscribeResult`
 *  (`#[serde(rename_all = "camelCase")]`). */
export interface TranscribeResult {
  text: string;
  latencyMs: number;
}

/** Reports whether the bundled voice sidecar is on disk at runtime. Always
 *  returns `false` in browser mode — voice input requires a native sidecar. */
export async function voiceSidecarAvailable(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>('voice_sidecar_available');
  } catch {
    return false;
  }
}

/** Transcribe a WAV-encoded audio buffer via the bundled sidecar. Throws
 *  with a user-readable error if the binary is missing, spawn fails, or
 *  the subprocess exits non-zero. */
export async function transcribeAudio(
  wavBytes: Uint8Array,
  model?: string,
): Promise<TranscribeResult> {
  if (!isTauri()) {
    throw new Error('Voice transcription is only available in the desktop app.');
  }
  return invoke<TranscribeResult>('transcribe_audio', {
    wavBytes: Array.from(wavBytes),
    model,
  });
}

// ---------------------------------------------------------------------------
// Wave 4 Track A — within-channel speaker diarization + voiceprint naming.
// Fully local: audio and embeddings never leave the machine.
// ---------------------------------------------------------------------------

export interface DiarizedSpeakerWire {
  label: string;
  turnCount: number;
  totalMs: number;
  centroid: number[];
}
export interface DiarizeMeetingResult {
  speakers: DiarizedSpeakerWire[];
  updatedSegments: number;
  dims: number;
}

/** Separate the far-end voices of a recorded meeting (fully local). `workspaceRoot`
 *  is required so the backend can reject a meetingDir outside the active workspace. */
export async function diarizeMeeting(workspaceRoot: string, meetingDir: string, numSpeakers?: number): Promise<DiarizeMeetingResult> {
  if (!isTauri()) throw new Error('Speaker separation is only available in the desktop app.');
  return invoke<DiarizeMeetingResult>('diarize_meeting', { workspaceRoot, meetingDir, numSpeakers });
}

/** Rename diarized speakers in a meeting transcript ("Speaker 2" -> a client name). */
export async function applySpeakerNames(workspaceRoot: string, meetingDir: string, renames: Record<string, string>): Promise<number> {
  if (!isTauri()) throw new Error('Speaker naming is only available in the desktop app.');
  return invoke<number>('apply_speaker_names', { workspaceRoot, meetingDir, renames });
}

export interface VoiceprintInfo { id: string; name: string; sampleCount: number; updatedAt: string }
export interface VoiceprintMatch { id: string; name: string; confidence: number }

/** List stored voice profiles for a client. Empty (not an error) in browser mode. */
export async function voiceprintList(workspaceRoot: string, matterId: string): Promise<VoiceprintInfo[]> {
  if (!isTauri()) return [];
  return invoke<VoiceprintInfo[]>('voiceprint_list', { workspaceRoot, matterId });
}
/** Save (or merge into an existing) voiceprint for a named speaker. */
export async function voiceprintEnroll(workspaceRoot: string, matterId: string, name: string, embedding: number[]): Promise<VoiceprintInfo> {
  if (!isTauri()) throw new Error('Voice profiles are only available in the desktop app.');
  return invoke<VoiceprintInfo>('voiceprint_enroll', { workspaceRoot, matterId, name, embedding });
}
/** Suggest a stored voice profile for an embedding, or null below the confidence threshold. */
export async function voiceprintMatch(workspaceRoot: string, matterId: string, embedding: number[]): Promise<VoiceprintMatch | null> {
  if (!isTauri()) return null;
  return invoke<VoiceprintMatch | null>('voiceprint_match', { workspaceRoot, matterId, embedding });
}
/** Confirm an auto-suggested voice profile match, merging the new embedding in. */
export async function voiceprintConfirm(workspaceRoot: string, matterId: string, voiceprintId: string, embedding: number[]): Promise<void> {
  if (!isTauri()) return;
  // `await` (not `return invoke<void>`) so we don't use `void` as a generic
  // type arg (@typescript-eslint/no-invalid-void-type); result is discarded.
  await invoke('voiceprint_confirm', { workspaceRoot, matterId, voiceprintId, embedding });
}
/** Delete a stored voice profile (biometric data) for a client. */
export async function voiceprintDelete(workspaceRoot: string, matterId: string, voiceprintId: string): Promise<void> {
  if (!isTauri()) throw new Error('Voice profiles are only available in the desktop app.');
  await invoke('voiceprint_delete', { workspaceRoot, matterId, voiceprintId });
}

// ---------------------------------------------------------------------------
// Lantern 3.0 — encrypted, append-only audit store (the "defense file").
//
// On the desktop the AuditService persists to a SQLCipher-encrypted store
// (`src-tauri/src/commands/audit/`). In the browser these wrappers short-circuit
// (isTauri() === false) and the AuditService keeps its localStorage path, which
// is labelled UNENCRYPTED in the UI — sensitive work belongs in the desktop app.
// ---------------------------------------------------------------------------

/** One audit entry as persisted by the encrypted store. `payloadJson` carries
 *  the full renderer-side `AuditEntry` serialized to JSON so it round-trips
 *  losslessly; the other columns are the queryable summary fields. */
export interface AuditEntryRecord {
  id: string;
  timestamp: string;
  action: string;
  description: string;
  payloadJson: string;
}

export type AuditIntegrityVerdict =
  | { status: 'verified'; checked: number }
  | { status: 'altered'; seq: number; id: string; reason: string; checked: number }
  // FAIL-CLOSED tamper evidence: the surviving rows still chain cleanly, but the
  // integrity SEAL that vouched for the log's completeness is gone. History up to
  // `lastTimestamp` can no longer be proven complete. Appends are refused until an
  // explicit repair re-seals the log and records the anomaly permanently.
  | { status: 'sealMissing'; survivingRows: number; lastTimestamp: string | null };

/** Result of an explicit, acknowledged repair of a seal-missing audit log. */
export interface AuditChainRepairReport {
  /** Rows that survived and were re-sealed (excludes the anomaly record). */
  survivingRows: number;
  /** Id of the permanent anomaly record now embedded in the new chain. */
  anomalyId: string;
  /** Total entries after repair (`survivingRows` + 1 anomaly). */
  totalEntries: number;
  /** Boundary of previously-verifiable history, echoed back for the record. */
  lastVerifiableTimestamp: string | null;
}

/** Point the encrypted audit store at a workspace. No-op in the browser. */
export async function auditSetWorkspace(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('audit_set_workspace', { path });
}

/** Append one entry to the encrypted audit store (append-only). No-op in the
 *  browser. Throws only on a real backend failure so callers can fall back. */
export async function auditAppend(entry: AuditEntryRecord): Promise<void> {
  if (!isTauri()) return;
  await invoke('audit_append', { entry });
}

/** List audit entries from the encrypted store in insertion order (oldest
 *  first). Returns `[]` in the browser. */
export async function auditList(
  limit?: number,
  offset?: number,
): Promise<AuditEntryRecord[]> {
  if (!isTauri()) return [];
  return invoke<AuditEntryRecord[]>('audit_list', {
    limit: limit ?? null,
    offset: offset ?? null,
  });
}

/** Count audit entries in the encrypted store. Returns 0 in the browser. */
export async function auditCount(): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>('audit_count');
}

/** Verify the encrypted audit log hash-chain. Browser mode has no encrypted
 *  chain, so there is no integrity verdict to report. */
export async function auditVerifyIntegrity(): Promise<AuditIntegrityVerdict | undefined> {
  if (!isTauri()) return undefined;
  return invoke<AuditIntegrityVerdict>('audit_verify_integrity');
}

/** Repair a seal-missing audit log: re-seal the surviving prefix AND write a
 *  permanent anomaly record into the new chain. Explicit and acknowledged —
 *  never automatic. Rejects (throws) if the store is not seal-missing. No-op in
 *  the browser (no encrypted chain there). */
export async function auditRepairSeal(): Promise<AuditChainRepairReport | undefined> {
  if (!isTauri()) return undefined;
  return invoke<AuditChainRepairReport>('audit_repair_seal');
}

// ── Retention sweep (Wave 4 Track D) ────────────────────────────────────────

export interface SweepDeletionWire { path: string; kind: string }
export interface SweepOutcomeWire {
  deleted: SweepDeletionWire[];
  keptMeetings: number;
  skippedInFlight: number;
  errors: string[];
  ragCleanupSourceIds: string[];
}

/** Enforce the workspace's retention policy over every matter folder given.
 *  Rust deletes the artifacts the policy calls for and appends the
 *  hash-chained audit trail; desktop-only, throws in the browser. */
export async function retentionSweep(
  workspaceRoot: string, matterFolders: string[], mode: string, audioRetentionDays: number,
): Promise<SweepOutcomeWire> {
  if (!isTauri()) throw new Error('Retention runs only in the desktop app.');
  return invoke<SweepOutcomeWire>('retention_sweep', {
    workspaceRoot, matterFolders, mode, audioRetentionDays,
  });
}

/** Non-destructive read of the durable side-file Rust writes the INSTANT a
 *  transcript delete or redaction produces RAG-cleanup ids — before the
 *  native call even returns. This file is the PRIMARY durable record, not
 *  just a one-shot recovery backstop: it is NOT cleared by reading it, so
 *  there is no window between "Rust hands back the ids" and "the renderer
 *  finishes acting on them" where a crash could lose anything — only
 *  `retentionClearPendingRagCleanupId` (called once a specific id is
 *  confirmed flushed) removes an id. Call once at workspace-open time and
 *  merge the result into the renderer's own pending-cleanup state. */
export async function retentionReadPendingRagCleanup(workspaceRoot: string): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>('retention_read_pending_rag_cleanup', { workspace: workspaceRoot });
}

/** Remove exactly one id from the durable pending-RAG-cleanup file, once the
 *  caller has confirmed it's genuinely been cleaned up (rag_delete_path
 *  succeeded) — the counterpart to retentionReadPendingRagCleanup. */
export async function retentionClearPendingRagCleanupId(workspaceRoot: string, id: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('retention_clear_pending_rag_cleanup_id', { workspace: workspaceRoot, id });
}

// ── Local redaction of meeting artifacts (Wave 4 Track D, Task 17b) ────────

export interface RedactionReceiptWire {
  redactedCount: number;
  marker: string;
  docxFlattened: boolean;
  ragCleanupSourceIds: string[];
  auditError?: string;
  /** Set ONLY when notes.docx's commit succeeded but transcript.json's then
   *  failed (e.g. a locked file on Windows) — the one gap the Rust side's
   *  two-phase stage/commit write can't fully close. When present,
   *  redactedCount is 0 (transcript.json — the source of truth this
   *  design's retry-safety depends on — was NOT actually updated) but
   *  notes.docx WAS mutated; the caller should surface this distinctly
   *  (not as plain success) and prompt a retry — safe, since redacting an
   *  already-redacted notes.docx run is a no-op. */
  partialCommitError?: string;
}

/** Redact whole transcript segments from one meeting: rewrites
 *  transcript.json + notes.docx (revision-safe — see redact.rs) and writes
 *  one hash-chained audit entry. Desktop-only, throws in the browser. */
export async function redactMeetingSegments(
  workspace: string, matterFolder: string, meetingDir: string, segmentIndices: number[],
): Promise<RedactionReceiptWire> {
  if (!isTauri()) throw new Error('Redaction runs only in the desktop app.');
  return invoke<RedactionReceiptWire>('redact_meeting_segments', {
    workspace, matterFolder, meetingDir, segmentIndices,
  });
}
