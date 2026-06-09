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
} from '@/types/docx';

/** True when the in-house docx engine is reachable (desktop app only). */
export function isDocxEngineAvailable(): boolean {
  return isTauri();
}

const BROWSER_ERROR =
  'The Word document editor is only available in the Keepance desktop app.';

/**
 * Open a `.docx` at `path` and return its JSON DOM for the editor.
 *
 * @throws in browser/test mode (no native engine), or with the engine's
 *   user-facing error string if the file can't be parsed.
 */
export async function docxOpen(path: string): Promise<DocumentJson> {
  if (!isTauri()) throw new Error(BROWSER_ERROR);
  return invoke<DocumentJson>('docx_open', { path });
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
  await invoke('docx_save', { path, document });
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
 *   default to "Keepance AI" / now (UTC) when omitted.
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
 * @param author defaults to "Keepance AI" when omitted/empty.
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
