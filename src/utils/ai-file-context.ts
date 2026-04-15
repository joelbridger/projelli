// AI File Context Extraction
//
// Turns a tab's file content into a plain-text blob suitable for injection
// into an AI chat's system prompt. Content types are handled per-extension so
// spreadsheets become TSV-flavored text, docx gets mammoth-extracted plain
// text, and plain-text formats pass through essentially untouched.
//
// Unsupported binary formats (pdf, images, audio, whiteboards) return null —
// Phase 2 intentionally keeps scope tight.
//
// Token estimation follows Anthropic's rule of thumb of 4 characters per
// token. The 200,000-character cap corresponds to ~50k tokens, which fits
// comfortably inside Claude Sonnet's context window even when combined with
// conversation history and tool results.
//
// Truncation clips from the end and appends a visible marker so the AI knows
// the file was cut short and can ask the user for more detail if needed.
//
// NOTE: This module is called on every tab content change via the
// `useOpenFileAIContext` hook. Keep it cheap and fail-soft — a throw here
// would surface as a runtime error in the editor, which is worse than simply
// having no AI context for one file.
//
// TRUNCATION_MARKER is exported so tests can assert on the exact wording and
// UI can rely on the specific suffix if it ever needs to hide the notice.
import { parseSpreadsheet, type SpreadsheetExtension, type SheetData } from './spreadsheet-io';
import { extractDocxText } from './docx-io';

/** Character cap before AI-bound text is truncated. ~50k Claude tokens. */
export const MAX_EXTRACTED_CHARS = 200_000;

/** Suffix appended to truncated text so the AI (and tests) can detect it. */
export const TRUNCATION_MARKER = '\n\n[...truncated: file continues beyond this point...]';

export type ExtractedSourceKind = 'spreadsheet' | 'docx' | 'text';

export interface ExtractedContext {
  /** File name as shown in the tab (e.g. "Q1-model.xlsx"). */
  fileName: string;
  /** Fully-qualified tab path, used as the map key in `fileContextStore`. */
  path: string;
  /** Flattened text the AI reads. Never empty for returned results. */
  extractedText: string;
  /** Cheap per-file token estimate (chars / 4). */
  tokenEstimate: number;
  /** True when the content was clipped to fit `MAX_EXTRACTED_CHARS`. */
  truncated: boolean;
  /** Which extraction branch produced the text — useful for UI affordances. */
  sourceKind: ExtractedSourceKind;
}

export interface ExtractForAIOptions {
  /** Tab path; forwarded verbatim into `ExtractedContext.path`. */
  path: string;
  /** File name including extension; used for display + extension fallback. */
  name: string;
  /** Lower-cased extension without leading dot, or `undefined` if unknown. */
  extension: string | undefined;
  /**
   * Raw tab content. Text files pass this through; spreadsheets/docx expect
   * a data URL (how binary files are read from disk into the editor store).
   */
  content: string;
}

/**
 * Extract a plain-text representation of `content` for AI consumption.
 * Returns `null` when the file type isn't supported for extraction or when
 * the resulting text would be empty.
 */
export async function extractForAI(
  opts: ExtractForAIOptions
): Promise<ExtractedContext | null> {
  const { path, name, content } = opts;
  const ext = resolveExtension(opts.extension, name);

  if (!ext) {
    return null;
  }

  let rawText: string | null = null;
  let sourceKind: ExtractedSourceKind | null = null;

  try {
    if (ext === 'xlsx' || ext === 'xls') {
      const model = await parseSpreadsheet(content, ext as SpreadsheetExtension);
      rawText = flattenSheetsToText(model.sheets);
      sourceKind = 'spreadsheet';
    } else if (ext === 'csv') {
      // CSV is already text. Prefer the tab's raw content string, which is
      // what the user would see in an editor. If the content arrived as a
      // data URL (binary read path), parse it into rows so the AI sees the
      // actual sign-ups/revenue/etc. instead of a base64 blob.
      if (content.startsWith('data:')) {
        const model = await parseSpreadsheet(content, 'csv');
        rawText = flattenSheetsToText(model.sheets);
        sourceKind = 'spreadsheet';
      } else {
        rawText = content;
        sourceKind = 'text';
      }
    } else if (ext === 'docx') {
      const extraction = await extractDocxText(content);
      rawText = extraction.plainText ?? '';
      sourceKind = 'docx';
    } else if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
      rawText = content;
      sourceKind = 'text';
    } else if (ext === 'rt' || ext === 'rtf') {
      // TipTap persists `.rt` files as HTML. Strip tags down to plain text
      // with a minimal regex — good enough for AI context, and avoids
      // pulling in a DOM parser during extraction.
      rawText = content
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      sourceKind = 'text';
    } else if (ext === 'json' || ext === 'source') {
      rawText = content;
      sourceKind = 'text';
    } else {
      // Unsupported: pdf, images, audio, video, whiteboard, aichat, doc, etc.
      return null;
    }
  } catch (error) {
    console.warn(
      `[ai-file-context] Failed to extract AI context for "${name}":`,
      error
    );
    return null;
  }

  if (rawText == null) {
    return null;
  }

  const trimmed = rawText.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let extractedText = trimmed;
  let truncated = false;
  if (extractedText.length > MAX_EXTRACTED_CHARS) {
    extractedText = extractedText.slice(0, MAX_EXTRACTED_CHARS) + TRUNCATION_MARKER;
    truncated = true;
  }

  const tokenEstimate = Math.ceil(extractedText.length / 4);

  return {
    fileName: name,
    path,
    extractedText,
    tokenEstimate,
    truncated,
    sourceKind: sourceKind ?? 'text',
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function resolveExtension(
  ext: string | undefined,
  name: string
): string | undefined {
  if (ext && ext.length > 0) {
    return ext.toLowerCase();
  }
  const fromName = name.split('.').pop();
  return fromName ? fromName.toLowerCase() : undefined;
}

/**
 * Flatten parsed sheet rows to tab-separated text with a per-sheet header.
 * Matches the format described in the Phase 2 spec:
 *
 *   === Sheet: Revenue ===
 *   Month\tRevenue\tFormula
 *   Jan\t10000\t=B2*1.1
 *   ...
 */
function flattenSheetsToText(sheets: SheetData[]): string {
  const chunks: string[] = [];
  for (const sheet of sheets) {
    const header = `=== Sheet: ${sheet.name} ===`;
    const rowLines: string[] = [];
    for (const row of sheet.rows) {
      // Skip rows that are entirely empty — they add noise without content.
      if (row.every((cell) => cell == null || cell.display.trim() === '')) {
        continue;
      }
      const parts = row.map((cell) => {
        if (cell == null) return '';
        if (cell.formula) {
          // Show formula + computed value for transparency: "=B2*1.1 -> 11000"
          return `=${cell.formula} -> ${cell.display}`;
        }
        return cell.display;
      });
      rowLines.push(parts.join('\t'));
    }
    // Skip sheets with no content so the AI doesn't see blank section headers.
    if (rowLines.length === 0) {
      continue;
    }
    chunks.push([header, ...rowLines].join('\n'));
  }
  return chunks.join('\n\n');
}
