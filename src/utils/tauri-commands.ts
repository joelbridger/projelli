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
  return invoke<string>('convert_doc_to_docx', { inputPath });
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
  return invoke<string>('convert_ppt_to_pdf', { inputPath });
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

/** A single retrieval hit returned by `rag_retrieve`. Shape is frozen in
 *  Phase 2 so the frontend can wire UI before M1 lands the implementation. */
export interface RagHit {
  path: string;
  chunkText: string;
  score: number;
  paragraphIndex: number;
}

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

/** Index a single file into the local RAG store. Phase 2 stub — Phase 3
 *  (M1) wires the actual embedding + upsert. */
export async function ragIndexFile(path: string): Promise<void> {
  if (!isTauri()) {
    throw new Error('RAG is only available in the desktop app.');
  }
  return invoke<void>('rag_index_file', { path });
}

/** Index the entire active workspace. Phase 2 stub. */
export async function ragIndexWorkspace(): Promise<void> {
  if (!isTauri()) {
    throw new Error('RAG is only available in the desktop app.');
  }
  return invoke<void>('rag_index_workspace');
}

/** Query the local RAG store. Phase 2 stub. */
export async function ragRetrieve(
  query: string,
  topK: number,
): Promise<RagHit[]> {
  if (!isTauri()) {
    throw new Error('RAG is only available in the desktop app.');
  }
  return invoke<RagHit[]>('rag_retrieve', { query, topK });
}

/** Start (or replace) the workspace file watcher. Only one watcher is
 *  active at a time. Emits `workspace-file-changed` events that callers
 *  can subscribe to via `@tauri-apps/api/event`'s `listen`. */
export async function watchWorkspace(path: string): Promise<void> {
  if (!isTauri()) return; // no-op in browser
  return invoke<void>('watch_workspace', { path });
}
