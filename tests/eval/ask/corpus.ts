/**
 * Eval corpus loader.
 *
 * The answer-quality eval runs over a small, STABLE corpus that the eval owns
 * (the `corpus/*.md` files next to this loader). They deliberately mirror the
 * fictional matters in `tests/fixtures/matter-corpus/` — Johnson v. Nexus
 * Dynamics (employment) and Acme v. Road Runner (contract), including the
 * planted deposition-vs-summary contradictions — but are authored as plain,
 * human-readable Markdown so the eval never depends on binary extraction (OCR,
 * .docx parsing) or on the fixture generator's exact paragraph boundaries.
 *
 * A "retrieval hit" in the eval is just a (document, paragraph) selection turned
 * into a real `RagHit`. The harness feeds those hits through the SAME
 * `buildWorkspaceContextBlock` the app uses, so the model sees an identical
 * context block and the same citation contract (`[basename paragraph N]`).
 * `paragraphIndex` is the 0-based index of the paragraph within its document,
 * which is exactly what a citation must match to resolve (BUG-065).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RagHit } from '@/platform/utils/tauri-commands';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(HERE, 'corpus');

/** The documents in the eval corpus, keyed by basename (the citation label).
 *
 *  The first five are the original Johnson (employment) + Acme (contract)
 *  matters. The last three are DISTRACTORS added for the retrieval-quality eval
 *  (WS3b): a deliberately confusable second client (`johnston-*`, "Marcus
 *  Johnston" vs. "Marcus Johnson") with conflicting parallel facts, and a
 *  confusable company (`nexus-diagnostics-nda.md`, "Nexus Diagnostics Inc." vs.
 *  the Johnson matter's "Nexus Dynamics Corp.") carrying rare long-tail keywords
 *  (the "Telomere Assay Confidentiality Rider" / "TA-204"). They exist so a
 *  retrieval test can catch "retrieved the wrong client's document" bugs. */
export const CORPUS_DOCS = [
  'johnson-deposition.md',
  'johnson-incident-summary.md',
  'johnson-engagement-letter.md',
  'acme-supply-agreement.md',
  'acme-intake-memo.md',
  'johnston-deposition.md',
  'johnston-engagement-letter.md',
  'nexus-diagnostics-nda.md',
] as const;

export type CorpusDoc = (typeof CORPUS_DOCS)[number];

/** Which confidentiality scope (matter) each document belongs to. The harness
 *  uses this so a cross-matter citation can be caught exactly as the app would.
 *
 *  SINGLE SOURCE OF TRUTH: this map mirrors `corpus/manifest.json`, which the
 *  Rust retrieval-quality baseline (`src-tauri/tests/rag_retrieval_quality.rs`)
 *  also reads, so both languages index the same corpus under the same matters.
 *  `corpusManifest()` loads the JSON and `corpus-manifest.test.ts` asserts the
 *  two never drift. */
export const DOC_MATTER: Record<CorpusDoc, string> = {
  'johnson-deposition.md': 'matter-johnson',
  'johnson-incident-summary.md': 'matter-johnson',
  'johnson-engagement-letter.md': 'matter-johnson',
  'acme-supply-agreement.md': 'matter-acme',
  'acme-intake-memo.md': 'matter-acme',
  'johnston-deposition.md': 'matter-johnston',
  'johnston-engagement-letter.md': 'matter-johnston',
  'nexus-diagnostics-nda.md': 'matter-nexus-diagnostics',
};

/** A document's entry in `corpus/manifest.json`. */
export interface CorpusManifestEntry {
  matterId: string;
  privilege: 'none' | 'attorney-client' | 'work-product';
}

/** Load and parse `corpus/manifest.json` — the cross-language (TS + Rust) source
 *  of truth for which matter/privilege each corpus document is indexed under. */
export function corpusManifest(): Record<string, CorpusManifestEntry> {
  const raw = readFileSync(join(CORPUS_DIR, 'manifest.json'), 'utf8');
  const parsed = JSON.parse(raw) as { documents: Record<string, CorpusManifestEntry> };
  return parsed.documents;
}

const cache = new Map<CorpusDoc, string[]>();

/** Split a document into paragraphs on blank lines, trimmed, non-empty. */
function loadParagraphs(doc: CorpusDoc): string[] {
  const cached = cache.get(doc);
  if (cached) return cached;
  const raw = readFileSync(join(CORPUS_DIR, doc), 'utf8');
  const paragraphs = raw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  cache.set(doc, paragraphs);
  return paragraphs;
}

/** The text of one paragraph (0-based). Throws if out of range so an eval case
 *  can never silently cite a paragraph that doesn't exist. */
export function paragraph(doc: CorpusDoc, index: number): string {
  const paragraphs = loadParagraphs(doc);
  const text = paragraphs[index];
  if (text === undefined) {
    throw new Error(
      `Eval corpus: ${doc} has no paragraph ${index} (it has ${paragraphs.length}).`,
    );
  }
  return text;
}

/** How many paragraphs a document has — handy for authoring/validating cases. */
export function paragraphCount(doc: CorpusDoc): number {
  return loadParagraphs(doc).length;
}

export interface HitSelection {
  doc: CorpusDoc;
  /** 0-based paragraph index within the document. */
  para: number;
  /** Optional retrieval score override (defaults decline with selection order). */
  score?: number;
}

/** Build a single `RagHit` from a (document, paragraph) selection. */
export function corpusHit(sel: HitSelection, order = 0): RagHit {
  return {
    path: sel.doc,
    chunkText: paragraph(sel.doc, sel.para),
    score: sel.score ?? Math.max(0.5, 0.9 - order * 0.02),
    paragraphIndex: sel.para,
    id: `${sel.doc}#${sel.para}`,
    matterId: DOC_MATTER[sel.doc],
    sourceType: 'text',
  };
}

/** Build the ordered `RagHit[]` for an eval case from its selections. */
export function buildHits(selections: readonly HitSelection[]): RagHit[] {
  return selections.map((sel, i) => corpusHit(sel, i));
}

/** The citation string the model is asked to produce for a selection,
 *  `[basename paragraph N]`. Handy for authoring gold answers without
 *  hand-counting. */
export function citeFor(sel: { doc: CorpusDoc; para: number }): string {
  return `[${sel.doc} paragraph ${sel.para}]`;
}
