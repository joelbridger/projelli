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
import { resolveWorkspacePath } from '@/modules/workspace/pathResolve';
import { useWorkspaceStore } from '@/stores/workspaceStore';

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
  /** A3: discriminates text vs PDF vs mail chunks. Absent on pre-A3 rows. */
  sourceType?: 'text' | 'pdf' | 'mail';
  /** A3: 1-based page number for PDF chunks. Absent on pre-A3 rows. */
  pageNumber?: number;
  /** WS-PRIV: the chunk's privilege status. Present post-WS-PRIV. Default
   *  retrieval only ever returns `'none'`; a non-`none` value appears only on an
   *  explicitly include-privileged query, so the UI can label it. */
  privilege?: 'none' | 'attorney-client' | 'work-product';
}

/** WS-B/C — the REQUIRED retrieval scope. A caller cannot omit scope and
 *  silently search every matter; it must name `matter` or `allMatters`.
 *  Mirrors `RetrievalScope` in `src-tauri/src/commands/rag/mod.rs`.
 *
 *  - `{ kind: 'matter', matterId }` — scope to ONE matter (LanceDB prefilter).
 *  - `{ kind: 'allMatters' }`       — explicit, audited cross-matter search.
 */
export type RetrievalScope =
  | { kind: 'matter'; matterId: string }
  | { kind: 'allMatters' };

/** WS-B/C — verdict from `ragVerifyCitation`. The app must refuse to present
 *  any answer whose citation does not return `{ verdict: 'verified' }`.
 *  Mirrors `Verdict` in `src-tauri/src/commands/rag/mod.rs`. */
export type CitationVerdict =
  | { verdict: 'verified' }
  | { verdict: 'notFound' }
  | { verdict: 'matterMismatch'; actualMatter: string }
  | { verdict: 'textMismatch' };

/** RAG indexer status emitted on the `rag-indexing-progress` Tauri event.
 *  Mirror of `IndexingStatus` in `src-tauri/src/commands/rag/mod.rs`. */
export type RagIndexingStatus =
  | 'idle'
  | 'indexing'
  | 'done'
  | 'cancelled'
  | 'error';

/** Payload emitted on the `rag-indexing-progress` event. The
 *  `useRagStatus` hook subscribes to this event. */
export interface RagIndexingProgress {
  status: RagIndexingStatus;
  processed: number;
  total: number;
  currentPath?: string | null;
}

/** Tauri event name. Mirror of `PROGRESS_EVENT` in mod.rs. */
export const RAG_PROGRESS_EVENT = 'rag-indexing-progress';

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

/**
 * Index pre-extracted PDF page text into the RAG store. Called after
 * `extractPdfText` produces page strings in the renderer process.
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
): Promise<number> {
  if (!isTauri()) {
    throw new Error('RAG PDF indexing is only available in the desktop app.');
  }
  // WS-PRIV: omitting privilege indexes as "none"; pass the source's status to
  // exclude a privileged PDF from default retrieval.
  return invoke<number>('rag_index_pdf_chunks', { path, pages, pageCount, matterId, privilege });
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
 *  composes with the matter scope as a single backend prefilter. */
export async function ragRetrieve(
  query: string,
  topK: number,
  scope: RetrievalScope,
  includePrivileged?: boolean,
): Promise<RagHit[]> {
  if (!isTauri()) {
    throw new Error('RAG is only available in the desktop app.');
  }
  return invoke<RagHit[]>('rag_retrieve', { query, topK, scope, includePrivileged });
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

/** Cheap model presence probe: 'ready' | 'absent' | 'downloading'. */
export async function modelStatus(): Promise<string> {
  return invoke<string>('model_status');
}

/** Idempotent: kicks off the visible model download when files are missing. */
export async function modelEnsure(): Promise<string> {
  return invoke<string>('model_ensure');
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
// The `keepance-mcp` binary (see `src-tauri/src/bin/mcp/`) writes approval
// requests to disk when an MCP client calls `write_workspace_file` with
// `require_confirmation = true`. These commands let the desktop app
// surface them to the user and return the user's decision.
// --------------------------------------------------------------------

/** One pending write approval queued by the `keepance-mcp` sidecar.
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
// Keepance 3.0 — encrypted, append-only audit store (the "defense file").
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
