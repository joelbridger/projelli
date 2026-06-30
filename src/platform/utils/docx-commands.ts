// Typed Tauri command wrappers for the in-house OOXML engine (WS-A / A3).
//
// Thin, typed bindings over the `docx_*` commands defined in
// `src-tauri/src/commands/docx/mod.rs`. The editor (A3) calls these; the AI
// redliner (A4) gets `docxAuthorRevision` for free. Each command operates on
// the JSON DOM (`DocumentJson`) — open/save also take a real on-disk file path
// (the engine reads/writes the `.docx` directly, preserving every unmodeled
// part of the package).
//
// Style mirrors `utils/tauri-commands.ts`: we use the official `isTauri` export
// from `@tauri-apps/api/core` so test mocks that replace the bridge flow through
// the same code path, and we throw a clear browser-mode error rather than
// silently no-op'ing (the editor surfaces that as a read-only fallback).

import { invoke, isTauri } from '@tauri-apps/api/core';

import type {
  DocumentJson,
  DocxAiEdit,
  DocxAuthorRevisionsResult,
  DocxResolveAction,
} from '@/platform/types/docx';
import { resolveWorkspacePath } from '@/platform/fs/pathResolve';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';

/**
 * Resolve `path` to an absolute path using the workspace root from the store.
 * If rootPath is null (no workspace open yet), returns the path unchanged.
 * This ensures all native Tauri commands receive absolute paths regardless of
 * whether the caller remembered to resolve them first.
 */
function toAbsoluteDocxPath(path: string): string {
  const rootPath = useWorkspaceStore.getState().rootPath;
  if (!rootPath) return path;
  return resolveWorkspacePath(rootPath, path);
}

/** True when the in-house docx engine is reachable (desktop app only). */
export function isDocxEngineAvailable(): boolean {
  return isTauri();
}

const BROWSER_ERROR =
  'The Word document editor is only available in the Advisor Prep Hero desktop app.';

/**
 * Open a `.docx` at `path` and return its JSON DOM for the editor.
 *
 * @throws in browser/test mode (no native engine), or with the engine's
 *   user-facing error string if the file can't be parsed.
 */
export async function docxOpen(path: string): Promise<DocumentJson> {
  if (!isTauri()) throw new Error(BROWSER_ERROR);
  return invoke<DocumentJson>('docx_open', { path: toAbsoluteDocxPath(path) });
}

/**
 * Save the JSON DOM back to a `.docx` at `path`, preserving the unmodeled parts
 * of the file already there (styles, numbering, theme, headers/footers, media).
 */
export async function docxSave(
  path: string,
  document: DocumentJson,
): Promise<void> {
  if (!isTauri()) throw new Error(BROWSER_ERROR);
  await invoke('docx_save', { path: toAbsoluteDocxPath(path), document });
}

/**
 * Accept or reject a SINGLE tracked change (by its revision `w:id`) and return
 * the updated DOM. Word semantics: accept-insertion keeps the text / reject
 * removes it; accept-deletion removes the text / reject restores it.
 *
 * @throws if the action is unknown or no revision with `revisionId` exists.
 */
export async function docxResolveRevision(
  document: DocumentJson,
  revisionId: string,
  action: DocxResolveAction,
): Promise<DocumentJson> {
  if (!isTauri()) throw new Error(BROWSER_ERROR);
  return invoke<DocumentJson>('docx_resolve_revision', {
    document,
    revisionId,
    action,
  });
}

/**
 * Accept-all / reject-all every tracked change and return the updated DOM. A
 * document with no tracked changes is returned unchanged (not an error).
 */
export async function docxResolveAll(
  document: DocumentJson,
  action: DocxResolveAction,
): Promise<DocumentJson> {
  if (!isTauri()) throw new Error(BROWSER_ERROR);
  return invoke<DocumentJson>('docx_resolve_all', { document, action });
}

/**
 * Author a new tracked change on the JSON DOM and return the updated DOM. This
 * is the seam the AI redliner (A4) hangs off — the editor does not call it yet.
 * Pure DOM-in / DOM-out; no disk I/O.
 *
 * @param kind `"insertion"` | `"deletion"` | `"insertParagraph"`
 * @param paragraphIndex which paragraph (counting only paragraphs) to edit
 * @param opts `text` for insertions, `needle` for deletions; `author`/`date`
 *   default to "Advisor Prep Hero AI" / now (UTC) when omitted.
 */
export async function docxAuthorRevision(
  document: DocumentJson,
  kind: 'insertion' | 'deletion' | 'insertParagraph',
  paragraphIndex: number,
  opts: {
    text?: string;
    needle?: string;
    author?: string;
    date?: string;
  } = {},
): Promise<DocumentJson> {
  if (!isTauri()) throw new Error(BROWSER_ERROR);
  return invoke<DocumentJson>('docx_author_revision', {
    document,
    kind,
    paragraphIndex,
    text: opts.text ?? null,
    needle: opts.needle ?? null,
    author: opts.author ?? null,
    date: opts.date ?? null,
  });
}

/**
 * Author a BATCH of AI-proposed tracked changes (the A4 redline) in ONE engine
 * pass and return the updated DOM plus per-edit outcomes. This is drift-safe:
 * the engine resolves every `paragraphIndex` and `anchorText` against the
 * ORIGINAL document (not a progressively-mutated one) and assigns each edit a
 * fresh, non-colliding revision id. A `replace` becomes a paired deletion +
 * insertion sharing one id (so Word treats it as a single accept/reject).
 *
 * Anchors that can't be found are skipped and reported in `results[].applied`
 * (not fatal) — a single mis-quoted anchor never discards the whole proposal.
 *
 * @param author defaults to "Advisor Prep Hero AI" when omitted/empty.
 * @param date ISO-8601; defaults to now (UTC) when omitted.
 */
export async function docxAuthorRevisions(
  document: DocumentJson,
  edits: DocxAiEdit[],
  opts: { author?: string; date?: string } = {},
): Promise<DocxAuthorRevisionsResult> {
  if (!isTauri()) throw new Error(BROWSER_ERROR);
  return invoke<DocxAuthorRevisionsResult>('docx_author_revisions', {
    document,
    edits,
    author: opts.author ?? null,
    date: opts.date ?? null,
  });
}

// ---------------------------------------------------------------------------
// Export (A6) — the editor's discoverable Export control.
//
// All three export paths read the on-disk `.docx` at `srcPath` (the editor keeps
// it current via autosave), so the exported copy always matches what the user
// sees. Word + clean copy go through the in-house engine (no LibreOffice); PDF
// uses LibreOffice via `convert_docx_to_pdf`.
// ---------------------------------------------------------------------------

/**
 * Export a faithful Word (`.docx`) copy of `srcPath` to `destPath`, preserving
 * every unmodeled part of the source package (styles, theme, numbering, media).
 * This is "save a copy as .docx" — NOT a lossy re-synthesis.
 */
export async function docxExportCopy(
  srcPath: string,
  destPath: string,
): Promise<void> {
  if (!isTauri()) throw new Error(BROWSER_ERROR);
  await invoke('docx_export_copy', {
    srcPath: toAbsoluteDocxPath(srcPath),
    destPath: toAbsoluteDocxPath(destPath),
  });
}

/**
 * Export a privilege-safe **clean copy** of `srcPath` to `destPath`: strip hidden
 * identifying metadata (`docProps/core.xml` author/lastModifiedBy/company/...,
 * `docProps/app.xml` company/manager). When `acceptAllChanges` is true, also
 * accept every tracked change and remove all comments (a flat final document
 * with no review history). Preserves every other unmodeled part byte-for-byte.
 */
export async function docxExportCleanCopy(
  srcPath: string,
  destPath: string,
  acceptAllChanges: boolean,
): Promise<void> {
  if (!isTauri()) throw new Error(BROWSER_ERROR);
  await invoke('docx_export_clean_copy', {
    srcPath: toAbsoluteDocxPath(srcPath),
    destPath: toAbsoluteDocxPath(destPath),
    acceptAllChanges,
  });
}

/**
 * Convert the saved `.docx` at `srcPath` to PDF via LibreOffice and return the
 * path of the produced PDF (cached in the OS temp dir). Throws a friendly
 * "install LibreOffice" message if `soffice` is not found — PDF is the only
 * export that needs it; Word + clean copy do not.
 */
export async function docxConvertToPdf(srcPath: string): Promise<string> {
  if (!isTauri()) throw new Error(BROWSER_ERROR);
  return invoke<string>('convert_docx_to_pdf', { inputPath: toAbsoluteDocxPath(srcPath) });
}

/**
 * VG-4c — re-house a generated `.docx`'s content inside a firm letterhead
 * template package. Both arguments are base64-encoded `.docx` bytes; the return
 * is the base64-encoded letterheaded document. Operates on in-memory bytes (a
 * workflow deliverable is generated in memory before it is written), so unlike
 * the other commands it takes no file path.
 *
 * @throws in browser/test mode, or with the engine's error string if either
 *   document can't be parsed. The `applyLetterheadIfConfigured` choke point in
 *   `docx-io.ts` turns any throw into a pass-through (a deliverable must never
 *   fail because of the letterhead).
 */
export async function docxApplyLetterhead(
  generatedB64: string,
  templateB64: string,
): Promise<string> {
  if (!isTauri()) throw new Error(BROWSER_ERROR);
  return invoke<string>('docx_apply_letterhead', {
    generatedB64,
    templateB64,
  });
}
