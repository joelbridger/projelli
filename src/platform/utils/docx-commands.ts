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
  DocxAiEditOutcome,
  DocxAuthorRevisionsResult,
  DocxResolveAction,
} from '@/platform/types/docx';
import { resolveWorkspacePath } from '@/platform/fs/pathResolve';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { BRAND } from '@/config/brand';
// Pure-JS table detection lives in docx-table-utils.ts, not docx-io.ts: this
// module is statically reached from the always-on document editor, and
// docx-io.ts pulls in mammoth/docx-preview/JSZip/docx. `markdownToRedlineBlocks`
// (the one heavy function this file needs) is dynamically imported below,
// inside `expandRedlineEditsForTables`'s default `convert` fallback.
import {
  containsMarkdownTable,
  containsPipeTableLikeBlock,
  normalizeStandalonePipeTable,
  type RedlineBlock,
} from '@/platform/utils/docx-table-utils';

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
  `The Word document editor is only available in the ${BRAND.name} desktop app.`;

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
 *   default to "Lantern AI" / now (UTC) when omitted.
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
 * @param author defaults to "Lantern AI" when omitted/empty.
 * @param date ISO-8601; defaults to now (UTC) when omitted.
 */
export async function docxAuthorRevisions(
  document: DocumentJson,
  edits: DocxAiEdit[],
  opts: { author?: string; date?: string } = {},
): Promise<DocxAuthorRevisionsResult> {
  if (!isTauri()) throw new Error(BROWSER_ERROR);
  // HARD INVARIANT: a Markdown pipe table in an insert/replace `newText` must
  // become a REAL Word table, never literal pipe text. We expand those edits
  // into `insertBlock` wire ops (carrying real `<w:tbl>` XML) BEFORE the engine
  // sees them, then collapse the engine's per-wire results back to one result
  // per original edit so the results panel is unchanged.
  const { wireEdits, plan } = await expandRedlineEditsForTables(edits);
  const raw = await invoke<DocxAuthorRevisionsResult>('docx_author_revisions', {
    document,
    edits: wireEdits,
    author: opts.author ?? null,
    date: opts.date ?? null,
  });
  return {
    document: raw.document,
    results: collapseRedlineResults(plan, raw.results),
  };
}

// ---------------------------------------------------------------------------
// AI-redline table expansion (Markdown pipe table → real <w:tbl>)
// ---------------------------------------------------------------------------

/**
 * A single edit as sent on the wire to the `docx_author_revisions` command.
 * Superset of {@link DocxAiEdit}: adds the synthesized `insertBlock` op (which
 * the model never emits) carrying raw block OOXML in `xml`.
 */
export interface RedlineWireEdit {
  op: 'insert' | 'delete' | 'replace' | 'insertBlock';
  paragraphIndex: number;
  anchorText?: string;
  newText?: string;
  atParagraphStart?: boolean;
  xml?: string;
  reason?: string;
}

/** How one ORIGINAL edit was routed onto the wire (used to collapse results). */
export type RedlineEditPlan =
  | { kind: 'passthrough'; wireIndex: number }
  | { kind: 'expanded'; wireIndices: number[] }
  | { kind: 'rejected'; error: string };

/** Plain-language message shown when a proposed table can't be converted. */
export const TABLE_CONVERT_REJECT_MESSAGE =
  "This table couldn't be turned into a Word table, so it was skipped and " +
  'nothing was inserted. Try asking again or simplifying the table.';

/**
 * Plain-language message when the model asks to REPLACE existing text WITH a
 * table. We don't support that as one reversible tracked change: the engine
 * models a table as an opaque block (not a tracked insertion), so a paired
 * "strike the text + add the table" could leave the table behind if the user
 * rejects the change. We reject rather than risk that inconsistent state.
 */
export const TABLE_REPLACE_REJECT_MESSAGE =
  "I can add a table, but I can't replace existing text with one in a single " +
  'reviewable change yet — so this was skipped and nothing was changed. Ask me ' +
  'to add the table instead, then delete the old text separately.';

/**
 * Plain-language message when the model returns a table WITH surrounding prose
 * in one edit. The engine models a table as an opaque block and has no
 * block-level revision model, so the surrounding prose can't be added as a
 * cleanly-reviewable tracked paragraph — rather than half-apply it (prose that
 * won't reject cleanly, or literal pipe text), we skip and ask for just the table.
 */
export const TABLE_MIXED_REJECT_MESSAGE =
  'I can add a table on its own, but this suggestion mixed the table with other ' +
  'text, so I skipped it and nothing was inserted. Ask me to add just the table.';

/**
 * Plain-language message when a table is asked to go at the very START of a
 * paragraph (`atParagraphStart`). A table can only be added AFTER a whole
 * paragraph, never before its first character, so we skip rather than silently
 * move it below the paragraph.
 */
export const TABLE_POSITION_REJECT_MESSAGE =
  "I can add a table after a paragraph, but I can't place one at the very start " +
  'of a paragraph, so this was skipped and nothing was inserted.';

/**
 * Rewrite any INSERT whose `newText` is (only) a Markdown pipe table into
 * `insertBlock` wire ops carrying real `<w:tbl>` XML (added after the target
 * paragraph). Everything else is rejected rather than half-applied, so literal
 * pipe text can NEVER reach the saved `.docx` and no surrounding text is ever
 * silently lost:
 *   - a table-bearing REPLACE (can't be one reversible change),
 *   - a table mixed with ANY other text — detected on the INPUT via
 *     {@link isStandaloneMarkdownTable}, because prose containing a `|` would be
 *     silently folded into/dropped by the lenient converter (prose also can't be
 *     a clean tracked paragraph here),
 *   - a table that fails to convert.
 * Non-table edits pass through unchanged (so plain-text inserts never regress).
 *
 * `convert` is injectable for testing; it defaults to the real converter,
 * dynamically imported from docx-io.ts (the heavy DOCX engine) so a caller
 * that never hits a table never pays for loading it.
 */
export async function expandRedlineEditsForTables(
  edits: DocxAiEdit[],
  convert?: (markdown: string) => Promise<RedlineBlock[]>,
): Promise<{ wireEdits: RedlineWireEdit[]; plan: RedlineEditPlan[] }> {
  const wireEdits: RedlineWireEdit[] = [];
  const plan: RedlineEditPlan[] = [];

  for (const e of edits) {
    const isTextInsertOrReplace =
      (e.op === 'insert' || e.op === 'replace') && typeof e.newText === 'string';
    const text = isTextInsertOrReplace ? (e.newText as string) : '';
    // HARD INVARIANT gate: recognize pipe-table-shaped text in ANY form the model
    // actually emits, so it can NEVER slip through as prose. This is BROADER than
    // the old `containsMarkdownTable` (which required a `|---|` separator row):
    //   - `containsMarkdownTable`        → a GFM table WITH a separator row,
    //   - `containsPipeTableLikeBlock`   → ≥2 adjacent pipe rows even with NO
    //                                      separator row (the shape models most
    //                                      often emit for a small table),
    //   - a single full pipe row         → a table split one-row-per-edit; can't
    //                                      form a table alone, so it's rejected
    //                                      below (never leaked as literal pipes).
    // The old detector missed the latter two, so real AI table output was
    // classified as ordinary prose and its literal `|` syntax reached the file.
    const isLonePipeRow =
      isTextInsertOrReplace && /^\s*\|.*\|\s*$/.test(text.trim()) && !text.trim().includes('\n');
    const hasTable =
      isTextInsertOrReplace &&
      (containsMarkdownTable(text) || containsPipeTableLikeBlock(text) || isLonePipeRow);

    if (!hasTable) {
      plan.push({ kind: 'passthrough', wireIndex: wireEdits.length });
      wireEdits.push({ ...e });
      continue;
    }

    // Replacing text WITH a table can't be represented as one reversible change.
    if (e.op === 'replace') {
      plan.push({ kind: 'rejected', error: TABLE_REPLACE_REJECT_MESSAGE });
      continue;
    }

    // A table block can only be appended AFTER a paragraph — never before its
    // first character — so a start-of-paragraph placement can't be honored.
    if (e.atParagraphStart) {
      plan.push({ kind: 'rejected', error: TABLE_POSITION_REJECT_MESSAGE });
      continue;
    }

    // Normalize to a CLEAN, standalone GFM table (synthesizing a `|---|`
    // separator row when the model omitted one). Judge the INPUT, not the
    // converted output: a table mixed with prose (or a lone unconvertible pipe
    // row) returns null here, and we REJECT rather than leak literal pipes or
    // silently fold/drop the surrounding prose.
    const normalizedTable = normalizeStandalonePipeTable(text);
    if (!normalizedTable) {
      console.warn('[Redline] table rejected (not a clean standalone table)');
      plan.push({ kind: 'rejected', error: TABLE_MIXED_REJECT_MESSAGE });
      continue;
    }
    console.log('[Redline] table detected → converting to a real <w:tbl>');

    let blocks: RedlineBlock[];
    try {
      const convertFn =
        convert ?? (await import('@/platform/utils/docx-io')).markdownToRedlineBlocks;
      blocks = await convertFn(normalizedTable);
    } catch {
      plan.push({ kind: 'rejected', error: TABLE_CONVERT_REJECT_MESSAGE });
      continue;
    }

    const tables = blocks.filter(
      (b): b is Extract<RedlineBlock, { kind: 'table' }> => b.kind === 'table',
    );
    // Defense-in-depth: a standalone table should convert to exactly table
    // block(s). If anything else slipped through, reject rather than half-apply.
    if (tables.length === 0) {
      plan.push({ kind: 'rejected', error: TABLE_CONVERT_REJECT_MESSAGE });
      continue;
    }
    if (tables.length !== blocks.length) {
      plan.push({ kind: 'rejected', error: TABLE_MIXED_REJECT_MESSAGE });
      continue;
    }

    // Carry the original insert's anchor (if any) onto every table block as a
    // DRIFT-SAFETY gate: if the paragraph changed while the AI call was in flight,
    // the engine skips these just like it would a normal anchored insert whose
    // anchor vanished — never landing a stale table elsewhere.
    const anchor = e.anchorText;
    const wireIndices: number[] = [];
    for (const block of tables) {
      wireIndices.push(wireEdits.length);
      wireEdits.push({
        op: 'insertBlock',
        paragraphIndex: e.paragraphIndex,
        xml: block.xml,
        ...(anchor ? { anchorText: anchor } : {}),
      });
    }
    plan.push({ kind: 'expanded', wireIndices });
  }

  return { wireEdits, plan };
}

/**
 * Collapse the engine's per-WIRE-edit outcomes back to one outcome per ORIGINAL
 * edit, following `plan`. An expanded (table) edit counts as applied only if
 * EVERY part applied; a rejected edit reports the reject message and applied:false.
 */
export function collapseRedlineResults(
  plan: RedlineEditPlan[],
  wireResults: DocxAiEditOutcome[],
): DocxAiEditOutcome[] {
  return plan.map((entry, index): DocxAiEditOutcome => {
    if (entry.kind === 'rejected') {
      return { index, applied: false, revisionId: null, error: entry.error };
    }
    if (entry.kind === 'passthrough') {
      const r = wireResults[entry.wireIndex];
      return {
        index,
        applied: r?.applied ?? false,
        revisionId: r?.revisionId ?? null,
        error: r ? r.error : 'edit result missing',
      };
    }
    // Expanded: applied only if every wire part applied.
    const parts = entry.wireIndices.map((wi) => wireResults[wi]);
    const allApplied = parts.length > 0 && parts.every((p) => p?.applied);
    const firstError =
      parts.find((p) => p && !p.applied && p.error)?.error ?? null;
    return {
      index,
      applied: allApplied,
      revisionId: null,
      error: allApplied
        ? null
        : firstError ??
          (parts.length > 0 ? 'part of this edit could not be applied' : 'edit result missing'),
    };
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
