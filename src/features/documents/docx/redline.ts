// AI redline core (WS-A / A4).
//
// Turns a plain-English instruction ("tighten the indemnity clause", "make this
// more formal", "shorten by 20%") into a set of tracked changes authored by
// "Advisor Prep Hero AI" against the open Word document. This module is the pure,
// testable middle: it
//   1. extracts the document text WITH explicit paragraph indices (and the
//      selected range, if any) — building the prompt,
//   2. defines the structured-output SCHEMA the model must return,
//   3. calls the user's chosen Provider via `structuredOutput`,
//   4. validates + normalizes the returned edit list, and
//   5. hands the edit list to the drift-safe batch engine command.
//
// CONFIDENTIALITY: the document text goes to the user's OWN provider via their
// OWN key (BYOK), DIRECTLY — exactly like the chat. Nothing here routes through
// a Advisor Prep Hero server. (A later task adds a visible egress indicator; this code
// must never contradict "direct to the user's provider".)
//
// ANCHORING CONTRACT (why we feed plain-run text): the engine anchors edits
// against each paragraph's PLAIN-RUN text (text already inside an existing
// `w:ins`/`w:del` is NOT part of the anchorable surface — see
// `author::paragraph_plain_text`). So we feed the model exactly that baseline:
// the clean, un-revised run text of each paragraph. This keeps "what the AI
// quoted" and "what the engine can find" identical, which is what makes
// anchoring reliable on a document that already has tracked changes in it.

import type {
  DocumentJson,
  DocxAiEdit,
  DocxParagraph,
} from '@/platform/types/docx';
import type { OutputSchema, Provider } from '@/platform/providers/Provider';
import { auditEventToEntry } from '@/platform/audit/AuditService';
import { resolveEgress, type ConfidentialityMode } from '@/platform/privacy/egress';
import type { AuditEntry, AuditScope } from '@/platform/types/audit';
import { BRAND } from '@/config/brand';

/** Author string stamped on AI redline revisions (matches the engine default). */
export const REDLINE_AUTHOR = BRAND.messaging.redlineAuthor;

/** A paragraph with its stable index, as fed to the model. */
export interface IndexedParagraph {
  /** Index counting ONLY paragraphs (the unit `paragraphIndex` addresses). */
  paragraphIndex: number;
  /** The clean, un-revised plain-run text of the paragraph. */
  text: string;
}

/** A contiguous selection over paragraph indices (inclusive). */
export interface ParagraphSelection {
  startParagraph: number;
  endParagraph: number;
}

/**
 * The plain-run text of one paragraph (clean baseline, excludes text inside
 * existing tracked insertions/deletions). This is the anchorable surface.
 */
export function paragraphPlainRunText(p: DocxParagraph): string {
  let out = '';
  for (const inline of p.inlines) {
    if (inline.kind === 'run') out += inline.text;
  }
  return out;
}

/**
 * Extract every paragraph as an `IndexedParagraph`, in paragraph-index order.
 * Raw blocks (tables, content controls) are skipped — they don't have a
 * paragraph index and the engine can't anchor into them.
 */
export function extractIndexedParagraphs(doc: DocumentJson): IndexedParagraph[] {
  const out: IndexedParagraph[] = [];
  let paraIdx = 0;
  for (const block of doc.body) {
    if (block.kind === 'paragraph') {
      out.push({ paragraphIndex: paraIdx, text: paragraphPlainRunText(block) });
      paraIdx += 1;
    }
  }
  return out;
}

/** The structured-output schema the model must conform to. */
export const REDLINE_SCHEMA: OutputSchema = {
  type: 'object',
  description: 'A list of tracked-change edits to apply to the document.',
  required: ['edits'],
  properties: {
    edits: {
      type: 'array',
      description: 'Edits to apply, each anchored to a specific paragraph.',
      items: {
        type: 'object',
        required: ['op', 'paragraphIndex'],
        properties: {
          op: {
            type: 'string',
            description:
              'One of "insert", "delete", or "replace". Use "replace" to change wording in place.',
          },
          paragraphIndex: {
            type: 'number',
            description:
              'The paragraph index to edit, taken verbatim from the [P#] labels in the document.',
          },
          anchorText: {
            type: 'string',
            description:
              'EXACT substring copied verbatim from that paragraph to locate the edit. Required for "delete" and "replace"; for "insert" it places the new text immediately after this substring (omit to append at the paragraph end). Quote it character-for-character including punctuation and spacing.',
          },
          newText: {
            type: 'string',
            description:
              'The text to insert (for "insert") or the replacement text (for "replace"). Omit for "delete". ' +
              'If this text is a TABLE, it MUST be a single complete GFM Markdown table in ONE edit — a ' +
              'header row, a `| --- | --- |` separator row directly under it (one column per header cell), ' +
              'then the data rows — e.g. "| Name | Value |\\n| --- | --- |\\n| Alpha | 42 |". ' +
              'Never split a table across multiple edits, never omit the separator row, and never mix a ' +
              'table with surrounding prose in the same edit.',
          },
          reason: {
            type: 'string',
            description:
              'A brief (one short sentence) explanation of why this edit was made, for the user reviewing it.',
          },
        },
      },
    },
  },
};

/** The shape the model returns (before validation/normalization). */
interface RawRedlineResponse {
  edits?: Array<{
    op?: unknown;
    paragraphIndex?: unknown;
    anchorText?: unknown;
    newText?: unknown;
    reason?: unknown;
  }>;
}

/** System prompt: frames the model as a careful editing associate. */
export const REDLINE_SYSTEM_PROMPT =
  'You are a meticulous editing associate working inside a Word document. ' +
  'You propose precise edits as tracked changes for the user to accept or reject. ' +
  'You never invent facts, never change defined terms unless asked, and you keep ' +
  'edits minimal and faithful to the instruction. You respond ONLY with valid JSON ' +
  'matching the requested schema.';

/**
 * Build the user prompt: the instruction, then the document with explicit
 * `[P{index}]` labels per paragraph. When a selection is given, only those
 * paragraphs are editable (others are shown as CONTEXT so the model can keep
 * cross-references consistent but is told not to edit them).
 *
 * Exposed as a pure function so tests can assert the indices are present.
 */
export function buildRedlinePrompt(
  instruction: string,
  paragraphs: IndexedParagraph[],
  selection?: ParagraphSelection,
): string {
  const inSelection = (idx: number): boolean =>
    selection
      ? idx >= selection.startParagraph && idx <= selection.endParagraph
      : true;

  const lines: string[] = [];
  lines.push(`INSTRUCTION: ${instruction}`);
  lines.push('');
  if (selection) {
    lines.push(
      `Only edit paragraphs P${String(selection.startParagraph)} through P${String(
        selection.endParagraph,
      )}. Other paragraphs are shown as context only — do NOT edit them.`,
    );
    lines.push('');
  }
  lines.push('DOCUMENT (each paragraph is labeled with its index):');
  for (const p of paragraphs) {
    const tag = selection && !inSelection(p.paragraphIndex) ? ' (context only)' : '';
    // Keep empty paragraphs visible so indices stay meaningful and contiguous.
    lines.push(`[P${String(p.paragraphIndex)}]${tag} ${p.text}`);
  }
  lines.push('');
  lines.push(
    'Return a JSON object { "edits": [...] }. For each edit set "op" to ' +
      '"insert", "delete", or "replace"; set "paragraphIndex" to the [P#] number; ' +
      'and for delete/replace copy "anchorText" VERBATIM from that paragraph so it ' +
      'can be located exactly. Include a short "reason" for each edit. If no change ' +
      'is warranted, return { "edits": [] }. If you are adding a TABLE, put the ' +
      'ENTIRE table in ONE insert edit as a complete GFM Markdown table WITH a ' +
      '`| --- | --- |` separator row under the header — never split it across ' +
      'edits and never drop the separator row.',
  );
  return lines.join('\n');
}

/**
 * Validate + normalize the model's raw response into a clean `DocxAiEdit[]`.
 * Drops malformed entries defensively (the model is untrusted output): an edit
 * survives only if it has a known `op`, a finite integer `paragraphIndex`, and
 * the fields its op requires (`anchorText` for delete/replace, `newText` for
 * insert/replace). Never throws; returns `[]` on a totally unusable response.
 */
export function normalizeEdits(raw: unknown): DocxAiEdit[] {
  const resp = raw as RawRedlineResponse | null | undefined;
  const list = Array.isArray(resp?.edits) ? resp.edits : [];
  const out: DocxAiEdit[] = [];
  for (const e of list) {
    const op = typeof e.op === 'string' ? e.op.toLowerCase().trim() : '';
    if (op !== 'insert' && op !== 'delete' && op !== 'replace') continue;

    const pi =
      typeof e.paragraphIndex === 'number'
        ? e.paragraphIndex
        : Number.parseInt(String(e.paragraphIndex), 10);
    if (!Number.isInteger(pi) || pi < 0) continue;

    const anchorText =
      typeof e.anchorText === 'string' && e.anchorText.length > 0
        ? e.anchorText
        : undefined;
    const newText = typeof e.newText === 'string' ? e.newText : undefined;
    const reason =
      typeof e.reason === 'string' && e.reason.trim().length > 0
        ? e.reason.trim()
        : undefined;

    // Per-op required fields.
    if ((op === 'delete' || op === 'replace') && anchorText === undefined) continue;
    if ((op === 'insert' || op === 'replace') && (newText === undefined || newText.length === 0)) {
      continue;
    }

    const edit: DocxAiEdit = { op, paragraphIndex: pi };
    if (anchorText !== undefined) edit.anchorText = anchorText;
    if (newText !== undefined) edit.newText = newText;
    if (reason !== undefined) edit.reason = reason;
    out.push(edit);
  }
  return out;
}

/**
 * Ask the model for a redline edit list. Pure of any engine/DOM mutation — it
 * only builds the prompt, calls the provider's `structuredOutput`, and returns
 * normalized edits. The caller applies them via the batch engine command.
 *
 * @throws if the provider call itself fails (network/auth/etc.). A well-formed
 *   but empty response yields `[]` (no edits), which is a valid "nothing to do".
 */
export async function requestRedlineEdits(
  provider: Provider,
  instruction: string,
  doc: DocumentJson,
  selection?: ParagraphSelection,
  options?: { signal?: AbortSignal },
): Promise<DocxAiEdit[]> {
  const paragraphs = extractIndexedParagraphs(doc);
  const prompt = buildRedlinePrompt(instruction, paragraphs, selection);
  const raw = await provider.structuredOutput<unknown>(prompt, {
    schema: REDLINE_SCHEMA,
    systemPrompt: REDLINE_SYSTEM_PROMPT,
    temperature: 0,
    maxTokens: 4096,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  return normalizeEdits(raw);
}

export interface RedlineEgressAuditContext {
  providerId: string;
  model?: string;
  mode: ConfidentialityMode;
  fileName: string;
  filePath?: string;
  scope?: AuditScope;
  assuredAvailable?: boolean;
  isDemo?: boolean;
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
}

export function buildRedlineEgressAuditEntry(
  context: RedlineEgressAuditContext,
): Omit<AuditEntry, 'id' | 'timestamp'> {
  const egress = resolveEgress({
    provider: context.providerId,
    mode: context.mode,
    isDemo: context.isDemo ?? false,
    assuredAvailable: context.assuredAvailable ?? false,
  });
  const entry = auditEventToEntry({
    type: 'egress',
    timestamp: new Date().toISOString(),
    payload: {
      provider: egress.provider,
      ...(context.model !== undefined ? { model: context.model } : {}),
      mode: context.mode,
      destination: egress.destination,
      dataLeaves: egress.dataLeaves,
      ...(context.scope !== undefined ? { scope: context.scope } : {}),
    },
  });
  return {
    ...entry,
    metadata: {
      ...entry.metadata,
      feature: 'docx_redline',
      file: context.filePath ?? context.fileName,
      fileName: context.fileName,
    },
  };
}

/**
 * Audited wrapper for redline sends. The egress row is emitted immediately
 * before the provider request so the audit log records that document text left
 * the app even when the model returns an empty edit list.
 */
export async function requestRedlineEditsWithAudit(
  provider: Provider,
  instruction: string,
  doc: DocumentJson,
  auditContext: RedlineEgressAuditContext,
  selection?: ParagraphSelection,
  options?: { signal?: AbortSignal },
): Promise<DocxAiEdit[]> {
  auditContext.onAuditLog?.(buildRedlineEgressAuditEntry({
    ...auditContext,
    model: auditContext.model ?? provider.getMetadata().model,
  }));
  return requestRedlineEdits(provider, instruction, doc, selection, options);
}
