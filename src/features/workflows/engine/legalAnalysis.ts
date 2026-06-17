/**
 * WS-D — Litigation associate analysis pipeline.
 *
 * This is the grounded, cited engine behind the `analyze` workflow step. The
 * flagship is the Deposition Contradiction Finder, but the shape is generic so
 * the other litigation templates (timeline builder, privilege-log drafter,
 * discovery triage, …) can adopt the same retrieve → structure → verify → Word
 * pipeline.
 *
 * Framing (load-bearing): the associate FLAGS candidate findings for the lawyer
 * to verify. EVERY finding carries a citation. Findings whose citation does not
 * verify against the local store are clearly marked unverified, never silently
 * presented. This is an assistant that organizes the record, not an oracle.
 *
 * Dependencies (retrieval, citation verification) are INJECTED so this module
 * stays free of Tauri imports and is fully unit-testable with mocks. The engine
 * wires the real `MemoryService.retrieve` + `ragVerifyCitation` at the call
 * site (see `App.tsx` / `WorkflowEngine`).
 */

import type { Provider, OutputSchema } from '@/platform/providers/Provider';
import type {
  AnalyzeStepConfig,
  ContradictionAnalysisResult,
  ContradictionFinding,
  FindingSource,
} from '@/platform/types/workflow';
import { OCR_LOW_CONFIDENCE, type RetrievalScope } from '@/platform/utils/tauri-commands';

/** A retrieved chunk, narrowed to the fields the analysis pipeline needs.
 *  Structurally compatible with `RagHit` from `@/platform/utils/tauri-commands`. */
export interface RetrievedChunk {
  path: string;
  chunkText: string;
  paragraphIndex: number;
  id?: string;
  matterId?: string;
  sourceId?: string;
  /** VG-2b widens the union with the office formats; VG-3c with certified
   *  transcripts (mirrors `RagHit`). */
  sourceType?: 'text' | 'pdf' | 'mail' | 'docx' | 'xlsx' | 'pptx' | 'rtf' | 'transcript';
  pageNumber?: number;
  /** VG-3c: page:line locator for certified transcript chunks
   *  (`"startPage:startLine-endPage:endLine"`, mirrors `RagHit`); finder
   *  deliverable locators read it as "Tr. 45:12-46:3". */
  locator?: string;
  /** VG-2: `'ocr'` when the chunk was read from a scanned page by the local
   *  OCR engine (mirrors `RagHit`); locators disclose it. */
  extraction?: 'ocr';
  /** VG-2: mean OCR word confidence (0-100); below `OCR_LOW_CONFIDENCE` the
   *  locator says "scanned, low-confidence". */
  extractionConfidence?: number;
}

/** Inject the real RAG retrieval. Matter scope + privilege handling are the
 *  caller's responsibility — the engine passes the ACTIVE matter scope and
 *  leaves privilege EXCLUDED (the safe default). `perSourceCap` (F-510) is the
 *  optional per-source diversity cap forwarded to the backend; omitted = no
 *  cap (chat retrieval and every pre-F-510 caller are unchanged). */
export type RetrieveFn = (
  query: string,
  topK: number,
  scope: RetrievalScope,
  perSourceCap?: number,
) => Promise<RetrievedChunk[]>;

/** A citation verdict, mirroring `CitationVerdict` from tauri-commands but
 *  flattened to the `verdict` string the pipeline records on each source. */
export type VerifyVerdict =
  | 'verified'
  | 'notFound'
  | 'matterMismatch'
  | 'textMismatch'
  | 'unverified';

/** Inject the real `ragVerifyCitation`. Returns `'unverified'` when verification
 *  cannot run (browser/test mode); the pipeline treats that as not-safe. */
export type VerifyCitationFn = (
  citationId: string,
  claimedMatterId: string,
  quotedText: string,
) => Promise<VerifyVerdict>;

/** The model-side shape we ask `structuredOutput` to produce. We resolve the
 *  model's `sourceLocator` back to a real retrieved chunk (by paragraph/page or
 *  quote match) to recover the verifiable citation id — the model never invents
 *  ids, it only points at the numbered sources we gave it. */
interface RawFindingSource {
  /** 1-based index into the numbered retrieved-context list, or 0 if none. */
  sourceNumber: number;
  /** The exact quoted statement this side relies on. */
  quote: string;
}

interface RawContradictionFinding {
  topic: string;
  statementA: RawFindingSource;
  statementB: RawFindingSource;
  conflictRationale: string;
  followUpQuestions?: string[];
}

interface RawContradictionResult {
  findings: RawContradictionFinding[];
}

/** JSON schema we hand to `provider.structuredOutput`. Kept deliberately tight
 *  so the model returns source POINTERS (numbers into the context list) rather
 *  than free-form citations it could fabricate. */
const CONTRADICTION_SCHEMA: OutputSchema = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      description: 'Every candidate contradiction found. Empty array if none.',
      items: {
        type: 'object',
        required: ['topic', 'statementA', 'statementB', 'conflictRationale'],
        properties: {
          topic: { type: 'string', description: 'Short topic/theme heading for this finding.' },
          statementA: {
            type: 'object',
            required: ['sourceNumber', 'quote'],
            properties: {
              sourceNumber: {
                type: 'number',
                description:
                  'The [N] number of the source in the provided context that this quote came from. Use 0 only if it genuinely is not in the context.',
              },
              quote: { type: 'string', description: 'The exact quoted statement.' },
            },
          },
          statementB: {
            type: 'object',
            required: ['sourceNumber', 'quote'],
            properties: {
              sourceNumber: {
                type: 'number',
                description:
                  'The [N] number of the source in the provided context that the conflicting quote came from. Use 0 only if it genuinely is not in the context.',
              },
              quote: { type: 'string', description: 'The exact conflicting quoted statement.' },
            },
          },
          conflictRationale: {
            type: 'string',
            description: 'Plain-language explanation of why these two statements conflict.',
          },
          followUpQuestions: {
            type: 'array',
            description: 'Suggested follow-up deposition questions (may be omitted).',
            items: { type: 'string' },
          },
        },
      },
    },
  },
};

/** Build the numbered `<retrieved_context>` block injected into the prompt.
 *  Mirrors the chat citation format so the model is primed to point at `[N]`. */
export function buildRetrievedContextBlock(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return '<retrieved_context>\n(No matter documents were retrieved for this query.)\n</retrieved_context>';
  }
  const lines = chunks
    .map((c, i) => {
      const n = i + 1;
      const locator = sourceLocator(c);
      return `[${String(n)}] ${locator}\n${c.chunkText}`;
    })
    .join('\n\n');
  return `<retrieved_context>\n${lines}\n</retrieved_context>`;
}

/** VG-2 — the OCR disclosure a deliverable locator carries: a passage read
 *  from a scanned page says so, and a shaky read says so louder. Propose,
 *  don't decide — the lawyer sees the quality of the ground under a finding. */
function ocrLocatorSuffix(c: RetrievedChunk): string {
  if (c.extraction !== 'ocr') return '';
  const low = c.extractionConfidence !== undefined && c.extractionConfidence < OCR_LOW_CONFIDENCE;
  return low ? ' (scanned, low-confidence)' : ' (scanned)';
}

/** Human-readable locator label for a retrieved chunk. VG-2b: sectioned
 *  office sources label the honest locator ("sheet 2", "slide 3" — the
 *  REAL 1-based number carried in pageNumber); docx/rtf chunk like text and
 *  fall through to the paragraph branch. VG-2: OCR-read pages disclose
 *  " (scanned)" / " (scanned, low-confidence)". VG-3c: certified transcript
 *  chunks cite the way lawyers cite — "Tr. 45:12-46:3" from the page:line
 *  locator. */
function sourceLocator(c: RetrievedChunk): string {
  const base = basename(c.path);
  const suffix = ocrLocatorSuffix(c);
  if (c.sourceType === 'transcript' && c.locator) {
    return `${base} Tr. ${c.locator}`;
  }
  if (c.sourceType === 'pdf' && c.pageNumber != null) {
    return `${base} page ${String(c.pageNumber)}${suffix}`;
  }
  if (c.sourceType === 'xlsx' && c.pageNumber != null) {
    return `${base} sheet ${String(c.pageNumber)}${suffix}`;
  }
  if (c.sourceType === 'pptx' && c.pageNumber != null) {
    return `${base} slide ${String(c.pageNumber)}${suffix}`;
  }
  if (c.sourceType === 'mail') {
    return `${base} (email)`;
  }
  return `${base} paragraph ${String(c.paragraphIndex)}${suffix}`;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  const last = parts[parts.length - 1];
  return last && last.length > 0 ? last : path;
}

/** Normalize for containment matching: lowercase, straight quotes,
 *  collapsed whitespace. */
function normalizeQuote(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quotes shorter than this can match accidentally; refuse to ground them. */
const MIN_QUOTE_MATCH_CHARS = 20;

/**
 * F-507(b) — recover a missing/invalid sourceNumber by verbatim quote
 * containment against the retrieved chunks (the "quote match" half this
 * module's header always promised). Deterministic: first matching chunk in
 * the numbered-context order wins. A fabricated quote matches nothing and
 * the finding stays honestly unverified.
 */
export function groundQuoteToChunk(quote: string, chunks: RetrievedChunk[]): number {
  const needle = normalizeQuote(quote);
  if (needle.length < MIN_QUOTE_MATCH_CHARS) return -1;
  return chunks.findIndex((c) => normalizeQuote(c.chunkText).includes(needle));
}

/** Resolve a model-returned source pointer back to a real retrieved chunk and
 *  build a `FindingSource` carrying the verifiable citation id (when grounded). */
function resolveSource(raw: RawFindingSource, chunks: RetrievedChunk[]): FindingSource {
  // sourceNumber is 1-based; 0 (or out of range) means the model could not
  // ground this side in the retrieved context — a hallucinated reference.
  // (`raw.sourceNumber` may be undefined from a sloppy model: undefined - 1
  // is NaN, NaN >= 0 is false, so the quote-match fallback runs.)
  const idx = raw.sourceNumber - 1;
  let chunk = idx >= 0 && idx < chunks.length ? chunks[idx] : undefined;
  // F-507(b): local models routinely omit sourceNumber even when the quote
  // is verbatim from the numbered context (RESULTS.md claim 10 — both runs
  // returned sourceNumber: None on every finding). Recover by quote match.
  // The structured output is untrusted, so `raw.quote` may itself be absent;
  // a missing quote grounds nothing (and must not crash the run).
  if (!chunk && raw.quote) {
    const found = groundQuoteToChunk(raw.quote, chunks);
    if (found >= 0) chunk = chunks[found];
  }
  if (!chunk) {
    return {
      locator: 'Not grounded in retrieved record',
      quote: raw.quote,
      verdict: 'unverified',
    };
  }
  const source: FindingSource = {
    locator: sourceLocator(chunk),
    quote: raw.quote,
  };
  if (chunk.id) source.citationId = chunk.id;
  if (chunk.matterId) source.matterId = chunk.matterId;
  if (chunk.sourceId) source.sourceId = chunk.sourceId;
  return source;
}

/** Verify a single finding side against the local store. Mutates `verdict` in
 *  place on the passed source and returns whether it is `'verified'`. */
async function verifySource(source: FindingSource, verify: VerifyCitationFn): Promise<boolean> {
  // A source the model could not ground (no citation id) is never verifiable.
  if (!source.citationId || !source.matterId) {
    source.verdict = 'unverified';
    return false;
  }
  try {
    const verdict = await verify(source.citationId, source.matterId, source.quote);
    source.verdict = verdict;
    return verdict === 'verified';
  } catch {
    // Browser/test mode or backend error — flag as unverified, never present.
    source.verdict = 'unverified';
    return false;
  }
}

export interface RunContradictionAnalysisArgs {
  provider: Provider;
  config: AnalyzeStepConfig;
  /** Inputs accumulated so far (interview answers + prior step outputs). */
  inputs: Record<string, unknown>;
  /** The ACTIVE matter retrieval scope (privilege excluded by the retrieve fn). */
  scope: RetrievalScope;
  retrieve: RetrieveFn;
  verify: VerifyCitationFn;
  /** Interpolate `{{var}}` against the inputs (engine supplies its own helper). */
  interpolate: (template: string, values: Record<string, unknown>) => string;
}

/**
 * Run the full contradiction analysis: matter-scoped retrieval → structured
 * findings → per-source citation verification.
 *
 * Returns the structured result (findings each carrying a citation + verdict,
 * plus verified/unverified counts) AND the retrieved chunks (so the engine can
 * record what grounded the analysis). The Word rendering happens in the engine
 * (via `serializeContradictionsDocx`) so this module stays import-light.
 *
 * VG-3b: when `retrieve` THROWS but the attorney pasted material (any of
 * `config.pastedInputIds` is non-blank), the analysis proceeds on the pasted
 * excerpts alone and returns `retrievalUnavailable: true` so the engine can
 * disclose that in the deliverable header. With retrieval down AND nothing
 * pasted it refuses — an analysis with no grounding at all is never produced.
 */
export async function runContradictionAnalysis(
  args: RunContradictionAnalysisArgs,
): Promise<{
  result: ContradictionAnalysisResult;
  chunks: RetrievedChunk[];
  retrievalQuery: string;
  retrievalUnavailable: boolean;
}> {
  const { provider, config, inputs, scope, retrieve, verify, interpolate } = args;

  // 1) Matter-scoped retrieval (privilege excluded by the injected retrieve fn).
  const retrievalQuery = interpolate(config.retrievalQueryTemplate, inputs).trim();
  const topK = config.topK ?? 12;
  let chunks: RetrievedChunk[] = [];
  let retrievalUnavailable = false;
  if (retrievalQuery) {
    try {
      // F-510: the template's per-source diversity cap rides along (the
      // finder passes 4) so one large file cannot drown the finder's feed.
      chunks = await retrieve(retrievalQuery, topK, scope, config.perSourceCap);
    } catch (err) {
      // VG-3b — retrieval down (no index yet, model missing, store error).
      // Fall back to the attorney's pasted excerpts ONLY, and say so in the
      // deliverable header. Refusal below covers the nothing-at-all case.
      // eslint-disable-next-line no-console -- diagnosis trail behind the run record's retrievalUnavailable flag
      console.warn('[legalAnalysis] workspace retrieval unavailable; analyzing pasted excerpts only:', err);
      retrievalUnavailable = true;
    }
  }
  if (retrievalUnavailable) {
    const hasPasted = (config.pastedInputIds ?? []).some(
      (id) => typeof inputs[id] === 'string' && (inputs[id] as string).trim().length > 0,
    );
    if (!hasPasted) {
      throw new Error(
        'Workspace retrieval is unavailable and no excerpts were pasted, so there is nothing to analyze from. Paste the transcript excerpts into the interview, or run again once matter memory is ready.',
      );
    }
  }

  // 2) Structured findings from the model, grounded in the numbered context.
  const contextBlock = buildRetrievedContextBlock(chunks);
  const prompt = interpolate(config.promptTemplate, {
    ...inputs,
    retrievedContext: contextBlock,
  });

  const structuredOpts = config.systemPrompt
    ? { schema: CONTRADICTION_SCHEMA, systemPrompt: config.systemPrompt }
    : { schema: CONTRADICTION_SCHEMA };
  // Treat the model's structured output as UNTRUSTED: it may omit required
  // fields despite the schema, so we re-validate at the boundary rather than
  // trust the declared type.
  const raw = (await provider.structuredOutput<RawContradictionResult>(
    prompt,
    structuredOpts,
  )) as Partial<RawContradictionResult> | null | undefined;

  const rawFindings: Partial<RawContradictionFinding>[] = Array.isArray(raw?.findings)
    ? raw.findings
    : [];

  // 3) Resolve source pointers → verifiable citations, then verify each side.
  const findings: ContradictionFinding[] = [];
  for (const rf of rawFindings) {
    const statementA = resolveSource(rf.statementA ?? { sourceNumber: 0, quote: '' }, chunks);
    const statementB = resolveSource(rf.statementB ?? { sourceNumber: 0, quote: '' }, chunks);

    const okA = await verifySource(statementA, verify);
    const okB = await verifySource(statementB, verify);

    const finding: ContradictionFinding = {
      topic: rf.topic || 'Untitled',
      statementA,
      statementB,
      conflictRationale: rf.conflictRationale || '',
      verified: okA && okB,
    };
    if (Array.isArray(rf.followUpQuestions) && rf.followUpQuestions.length > 0) {
      finding.followUpQuestions = rf.followUpQuestions;
    }
    findings.push(finding);
  }

  const verifiedCount = findings.filter((f) => f.verified).length;
  const result: ContradictionAnalysisResult = {
    findings,
    totalCount: findings.length,
    verifiedCount,
    unverifiedCount: findings.length - verifiedCount,
  };

  return { result, chunks, retrievalQuery, retrievalUnavailable };
}
