/**
 * answerBlocks — the provenance layer for the Ask-smart "source-aware advisor
 * agent". Ask is no longer files-only; it can also answer from general
 * knowledge and write drafts. To keep the cited-trust moat intact, every answer
 * is broken into PROVENANCE-LABELLED blocks (see {@link AnswerBlock}), and the
 * block a claim lives in is stored as REAL data — not inferred from colour. That
 * is what makes the labels reliable, exports honest, and a future audit able to
 * prove what was grounded.
 *
 * The model emits a block by writing a marker line, e.g. `[[BLOCK:GENERAL]]`,
 * before each section. This module parses those markers back into typed blocks
 * and binds citations ONLY inside FILES blocks (general/draft/nothing-found
 * blocks are scrubbed of any stray citation marker, so a green chip can never
 * appear over uncited prose — the single most important trust rule).
 *
 * Pure: no React, no side effects. Safe to import anywhere (app, tests, eval).
 */

import {
  bindCitationsCore,
  buildWorkspaceSources,
  newCitationBindAccumulator,
  renumberBlocksAndCitations,
  splitTrailingGeneralFromFilesBlock,
  type AnswerBlock,
  type AnswerBlockKind,
  type AnswerCitation,
} from './askHelpers';
import {
  BLOCK_MARKER_RE,
  BLOCK_MARKERS,
  kindFromMarker,
  stripBlockMarkers,
} from './answerBlockMarkers';
import type { WorkspaceSource } from '@/platform/types/ai';
import type { RagHit } from '@/platform/utils/tauri-commands';

// Re-export the marker vocabulary so existing importers of `answerBlocks` keep
// working; the literals themselves live in the dependency-free markers module.
export { BLOCK_MARKERS, stripBlockMarkers };

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

interface RawBlock {
  kind: AnswerBlockKind;
  text: string;
}

/**
 * Split a raw model answer into raw (unbound) blocks by its marker lines.
 *
 * - Text before the first marker becomes a leading block whose kind is inferred:
 *   FILES when evidence was retrieved (so its citations can bind), else GENERAL.
 * - When the model emits no markers at all (e.g. a small local model that
 *   ignored the instruction), the whole answer is one inferred block — graceful
 *   degradation that still binds citations when there were hits.
 * - Consecutive same-kind blocks are coalesced so the UI never shows two
 *   identical labels back to back.
 */
export function splitRawBlocks(raw: string, hasHits: boolean): RawBlock[] {
  const inferredLeadKind: AnswerBlockKind = hasHits ? 'files' : 'general';
  const markers: { index: number; len: number; kind: AnswerBlockKind }[] = [];
  BLOCK_MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_MARKER_RE.exec(raw)) !== null) {
    markers.push({ index: m.index, len: m[0].length, kind: kindFromMarker(m[1] ?? 'GENERAL') });
  }

  const blocks: RawBlock[] = [];
  if (markers.length === 0) {
    const text = raw.trim();
    if (text) blocks.push({ kind: inferredLeadKind, text });
    return coalesce(blocks);
  }

  const first = markers[0];
  if (first) {
    const lead = raw.slice(0, first.index).trim();
    if (lead) blocks.push({ kind: inferredLeadKind, text: lead });
  }

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    if (!marker) continue;
    const start = marker.index + marker.len;
    const next = markers[i + 1];
    const end = next ? next.index : raw.length;
    const text = raw.slice(start, end).trim();
    if (text) blocks.push({ kind: marker.kind, text });
  }

  return coalesce(blocks);
}

function coalesce(blocks: RawBlock[]): RawBlock[] {
  const out: RawBlock[] = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === b.kind) {
      prev.text = `${prev.text}\n\n${b.text}`;
    } else {
      out.push({ ...b });
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Binding                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Strip any citation marker — both the bound `{n}` form and a raw, unresolved
 * `[file paragraph 3]` form — from a NON-files block. Defence in depth: even if
 * the model leaks a citation into a general/draft block, no chip can render
 * there and the trust rule (cited claims only ever sit under a FILES label)
 * holds structurally, not by the model's good behaviour.
 */
function scrubCitationMarkers(text: string): string {
  return text
    .replace(/\s*\{\d+\}/g, '')
    .replace(/\s*\[[^[\]\n]+?\s+(?:paragraph\s+|page\s+|§\s*)\d+\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export interface BoundAnswerBlocks {
  /** The provenance-labelled blocks, in answer order. */
  blocks: AnswerBlock[];
  /** Joined clean prose (markers removed, {n} substituted) — for history/save. */
  answer: string;
  /** Every FILES-block citation, global 1..N numbering, sorted. */
  citations: AnswerCitation[];
  /** All retrieved sources (for the Sources panel). */
  sources: WorkspaceSource[];
}

/**
 * Parse a raw smart-mode model answer into provenance blocks and bind citations
 * within the FILES blocks against the retrieved hits. Numbering is shared across
 * FILES blocks so the Sources panel reads 1..N for the whole answer and a source
 * reused in two blocks keeps one number.
 *
 * @param raw              the model's raw answer (may contain `[[BLOCK:…]]`).
 * @param hits             the retrieved chunks (empty on a nothing-found turn).
 * @param expectedMatterId the active matter scope (null for all-matters); a hit
 *                         from another matter binds but is marked unverified.
 */
export function bindAnswerBlocks(
  raw: string,
  hits: RagHit[],
  expectedMatterId: string | null = null,
): BoundAnswerBlocks {
  const hasHits = hits.length > 0;
  const rawBlocks = splitRawBlocks(raw, hasHits);
  const acc = newCitationBindAccumulator();
  const blocks: AnswerBlock[] = [];

  for (const rb of rawBlocks) {
    if (rb.kind === 'files') {
      const text = bindCitationsCore(rb.text, hits, expectedMatterId, acc);
      // Which citation numbers actually landed in THIS block's text (a source
      // reused across blocks should chip in each block it appears in).
      const present = new Set<number>();
      for (const mm of text.matchAll(/\{(\d+)\}/g)) present.add(Number.parseInt(mm[1] ?? '0', 10));
      const blockCitations = acc.citations.filter((c) => present.has(c.n));
      // TRUST BOUNDARY (Codex P1): a block earns the green "From your files"
      // label ONLY if it has at least one citation and EVERY one of them actually
      // GROUNDED to a retrieved chunk IN SCOPE (verified). This rejects three
      // ways a green badge could otherwise sit over un-trustworthy text:
      //   - zero citations (fabricated/unbound, incl. the unmarked-answer
      //     fallback that inferred 'files' from the mere presence of hits);
      //   - a MIXED block where one citation is cross-matter/unverified — the
      //     "every cited claim can be checked" attestation would then over-claim,
      //     and another client's file must never read as "from your files".
      // Anything that fails the test is the model's own prose — downgrade to a
      // general block and scrub every marker.
      if (blockCitations.length > 0 && blockCitations.every((c) => c.verified)) {
        // Keep the cited content green, but split off any trailing UNCITED
        // general prose into its own general block (review P1).
        blocks.push(...splitTrailingGeneralFromFilesBlock(text, blockCitations));
      } else {
        blocks.push({ kind: 'general', text: scrubCitationMarkers(text), citations: [] });
      }
    } else {
      blocks.push({ kind: rb.kind, text: scrubCitationMarkers(rb.text), citations: [] });
    }
  }

  // Turn-level citations + sources panel reflect ONLY citations that survived in
  // a files block (downgraded blocks' orphaned citations are dropped, so the
  // Sources panel never shows a card with no chip). Then renumber to a
  // contiguous 1..N so a downgraded earlier block can't leave the survivors
  // numbered {2}, {3}, … (Codex P2).
  const kept = new Set<number>();
  for (const b of blocks) if (b.kind === 'files') for (const c of b.citations) kept.add(c.n);
  const survivors = acc.citations.filter((c) => kept.has(c.n));
  const renum = renumberBlocksAndCitations(blocks, survivors);
  const answer = renum.blocks.map((b) => b.text).join('\n\n').trim();
  return { blocks: renum.blocks, answer, citations: renum.citations, sources: buildWorkspaceSources(hits) };
}

/* -------------------------------------------------------------------------- */
/* Per-answer tally (the footer that honestly counts what the answer is built   */
/* from). Drives the green "N claims cited from your files" + grey "M general    */
/* explanations · verify current rules" pills under a mixed answer.             */
/* -------------------------------------------------------------------------- */

export interface AnswerProvenanceTally {
  /** Distinct cited claims drawn from the user's files. */
  citedClaims: number;
  /** Whether any general-knowledge block is present. */
  hasGeneral: boolean;
  /** Whether any draft block is present. */
  hasDraft: boolean;
  /** Whether the files search came up empty (a nothing-found block). */
  hasNothingFound: boolean;
}

export function tallyBlocks(blocks: AnswerBlock[]): AnswerProvenanceTally {
  const citedNumbers = new Set<number>();
  let hasGeneral = false;
  let hasDraft = false;
  let hasNothingFound = false;
  for (const b of blocks) {
    if (b.kind === 'files') for (const c of b.citations) citedNumbers.add(c.n);
    if (b.kind === 'general') hasGeneral = true;
    if (b.kind === 'draft') hasDraft = true;
    if (b.kind === 'nothing-found') hasNothingFound = true;
  }
  return { citedClaims: citedNumbers.size, hasGeneral, hasDraft, hasNothingFound };
}
