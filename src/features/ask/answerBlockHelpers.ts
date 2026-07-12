/**
 * answerBlockHelpers — the provenance layer for the Ask-smart "source-aware advisor
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
import { normalizeNumericCitations } from '@/platform/rag/workspaceCommand';
import { prepareDatedRagHits } from '@/platform/retrieval/dates';
import type { WorkspaceSource } from '@/platform/types/ai';
import type { RagHit } from '@/platform/utils/tauri-commands';

// Re-export the marker vocabulary so existing importers of `answerBlockHelpers`
// keep working; the literals themselves live in the dependency-free markers module.
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

/** A raw `[file paragraph N]` / `[file page N]` / `[file §N]` citation marker. */
const RAW_CITATION_MARKER_RE = /\[[^[\]\n]+?\s+(?:paragraph\s+|page\s+|§\s*)\d+\]/i;

/**
 * A number-keyed citation as a small local model emits it: `[1 paragraph 3]`,
 * `[1 §3]`, or a bare `[1]` (excluding `[1](url)` markdown links and array/
 * footnote syntax preceded by a word char or `]`). Mirrors the forms
 * {@link normalizeNumericCitations} repairs, so a nothing-found block that cites
 * this way is recognized as carrying a real, groundable claim.
 */
const NUMERIC_CITATION_MARKER_RE =
  /\[\d{1,3}\s+(?:paragraph\s+|page\s+|§\s*)\d+\]|(?<![\w\]])\[\d{1,3}\](?!\()/i;

/**
 * The longest a genuine nothing-found block should be: it is only ever a brief
 * "I didn't find that in their files" acknowledgment (the actual guidance goes
 * in a SEPARATE general block, per the prompt contract). A small local model
 * routinely ignores that split and stuffs a full real answer under the
 * `[[BLOCK:NOTHING_FOUND]]` marker — which is exactly what produced the observed
 * "From your files — nothing found" header sitting over a real, asserted answer.
 */
const MAX_BRIEF_NOTHING_FOUND_CHARS = 220;

/**
 * Whether a `nothing-found` block actually carries real answer content (a
 * mislabel by a small model) rather than a brief absence statement. Such a block
 * must NOT keep the "nothing found" label over a real answer; the caller routes
 * it through the files-binding path so it becomes either a properly-cited files
 * block or honest uncited general prose — never a contradictory header.
 */
function nothingFoundBlockHasRealContent(text: string): boolean {
  // Any citation — filename-form OR the small-local-model number-keyed form
  // (`[1]`, `[1 paragraph 3]`) — means the model asserted a sourced claim, even
  // in a short block, so route it to the grounding path rather than leaving a
  // "nothing found" header over it.
  if (RAW_CITATION_MARKER_RE.test(text)) return true;
  if (NUMERIC_CITATION_MARKER_RE.test(text)) return true;
  return scrubCitationMarkers(text).length > MAX_BRIEF_NOTHING_FOUND_CHARS;
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
  // Smart Ask follows a different binding route from Files-only Ask. Prepare
  // its hits here too, so both routes pass the same date fields and conflict
  // warning into their visible citations.
  const datedHits = prepareDatedRagHits(hits);
  const hasHits = datedHits.length > 0;
  const rawBlocks = splitRawBlocks(raw, hasHits);
  const acc = newCitationBindAccumulator();
  const blocks: AnswerBlock[] = [];

  // Bind a block's prose against the retrieved hits and return the resulting
  // provenance blocks: a green FILES block (optionally with trailing general
  // prose split off) when its citations all ground in scope, else an honest,
  // scrubbed general block. Shared by real FILES blocks and by mislabeled
  // nothing-found blocks that actually carry a real answer.
  const bindAsFilesBlock = (rawText: string): AnswerBlock[] => {
    // F-503: small local models (Qwen3-4B) cite the source NUMBER from the
    // context block (`[1]`, `[1 paragraph 3]`) instead of copying the filename,
    // so those citations never bind and the answer renders with no chips / empty
    // Sources even though the context WAS retrieved. Repair number-keyed
    // citations to `[<filename> paragraph N]` HERE — inside the files-bind path
    // only. Doing it per files block (not globally on the whole smart answer) is
    // deliberate: a general/draft block may legitimately contain bracketed
    // numeric text like `[1]` (a footnote or list/form reference); rewriting
    // that into a file citation would then get it scrubbed as a non-file block,
    // silently deleting user-visible prose. No-op for filename citations (cloud)
    // and when nothing was retrieved.
    const text = bindCitationsCore(
      normalizeNumericCitations(rawText, datedHits),
      datedHits,
      expectedMatterId,
      acc,
    );
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
    // B1: gate on `grounded` (resolves to a real retrieved chunk IN SCOPE),
    // not `verified`. `grounded` keeps the SAME trust boundary that mattered
    // here — a cross-client citation is not grounded, so it still downgrades
    // the block — while letting an honest post-hoc "source found, not
    // verified" chip stay in its files block instead of being scrubbed away.
    // (Pre-B1 citations have no `grounded`; fall back to `verified`.)
    if (blockCitations.length > 0 && blockCitations.every((c) => c.grounded ?? c.verified)) {
      // Keep the cited content green, but split off any trailing UNCITED
      // general prose into its own general block (review P1).
      return splitTrailingGeneralFromFilesBlock(text, blockCitations);
    }
    return [{ kind: 'general', text: scrubCitationMarkers(text), citations: [] }];
  };

  for (const rb of rawBlocks) {
    // A nothing-found block that actually carries a real answer (a small local
    // model ignoring the "brief absence only" contract and stuffing the answer
    // under the marker) must never render a "nothing found" header over that
    // answer. Route it through the same grounding path as a files block so it
    // becomes properly-cited files content — recovering the citations the model
    // did emit — or honest uncited general prose. Genuinely brief absence
    // statements keep their nothing-found label.
    // Cloud models sometimes put a genuinely cited, file-backed sentence in a
    // GENERAL block. Local models commonly omit block markers, so their same
    // sentence takes the inferred FILES path; cloud answers used to have their
    // valid citation scrubbed solely because of that label difference. Promote
    // only blocks that carry a citation-shaped source marker, then let the
    // normal binder prove it resolves to an in-scope retrieved chunk. A made-up
    // or out-of-scope citation still falls through to the existing scrubbed
    // general block, so this never turns an untrusted claim green.
    const generalBlockHasSourceMarker =
      rb.kind === 'general' &&
      RAW_CITATION_MARKER_RE.test(rb.text);
    const treatAsFiles =
      rb.kind === 'files' ||
      generalBlockHasSourceMarker ||
      (rb.kind === 'nothing-found' && nothingFoundBlockHasRealContent(rb.text));
    if (treatAsFiles) {
      blocks.push(...bindAsFilesBlock(rb.text));
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
  return {
    blocks: renum.blocks,
    answer,
    citations: renum.citations,
    sources: buildWorkspaceSources(datedHits),
  };
}

/* -------------------------------------------------------------------------- */
/* Per-answer tally (the footer that honestly counts what the answer is built   */
/* from). Drives the green "N claims cited from your files" + grey "M general    */
/* explanations · verify current rules" pills under a mixed answer.             */
/* -------------------------------------------------------------------------- */

export interface AnswerProvenanceTally {
  /** Distinct cited claims drawn from the user's files (verified OR post-hoc). */
  citedClaims: number;
  /**
   * B1: distinct cited claims that are actually VERIFIED (an explicit model
   * citation resolving to a retrieved chunk in scope). `citedClaims -
   * verifiedClaims` is the count of "source found, not verified" post-hoc
   * matches. The green "every cited claim can be checked" attestation requires
   * `verifiedClaims === citedClaims`, so a post-hoc match never earns it.
   */
  verifiedClaims: number;
  /** Whether any general-knowledge block is present. */
  hasGeneral: boolean;
  /** Whether any draft block is present. */
  hasDraft: boolean;
  /** Whether the files search came up empty (a nothing-found block). */
  hasNothingFound: boolean;
}

/**
 * NOTE (lp/badge-consistency): `verifiedClaims` here is the STATIC bind-time
 * count (explicit citation resolving to a retrieved chunk in scope). The
 * rendered header/blocks do NOT use it for the verified/unverified split any
 * more — they aggregate the LIVE backend verifier's per-citation results via
 * {@link tallyCitationTrust} + `citationTrustState` (citationVerification.ts),
 * the same signal the Sources cards show, so the two can never disagree.
 */
export function tallyBlocks(blocks: AnswerBlock[]): AnswerProvenanceTally {
  const citedNumbers = new Set<number>();
  const verifiedNumbers = new Set<number>();
  let hasGeneral = false;
  let hasDraft = false;
  let hasNothingFound = false;
  for (const b of blocks) {
    if (b.kind === 'files') {
      for (const c of b.citations) {
        citedNumbers.add(c.n);
        if (c.verified) verifiedNumbers.add(c.n);
      }
    }
    if (b.kind === 'general') hasGeneral = true;
    if (b.kind === 'draft') hasDraft = true;
    if (b.kind === 'nothing-found') hasNothingFound = true;
  }
  return {
    citedClaims: citedNumbers.size,
    verifiedClaims: verifiedNumbers.size,
    hasGeneral,
    hasDraft,
    hasNothingFound,
  };
}

/* -------------------------------------------------------------------------- */
/* Live citation trust (lp/badge-consistency). The header pills and per-block   */
/* labels aggregate the SAME live per-citation verifier state the Sources       */
/* cards show. These helpers are pure: the caller supplies `stateOf` (in the    */
/* app, `citationTrustState` bound to the shared verdict store).                */
/* -------------------------------------------------------------------------- */

/**
 * A citation's displayed trust state, derived from the live backend verifier:
 * `'verified'` (real check confirmed the quote — card is green), `'checking'`
 * (check still in flight — card shows a spinner), `'unverified'` (check
 * refuted it, or it never earned verification — card is red or neutral).
 */
export type CitationTrustState = 'verified' | 'checking' | 'unverified';

export interface CitationTrustTally {
  /** Distinct cited claims the LIVE check confirmed. */
  verified: number;
  /** Distinct cited claims whose live check is still in flight. */
  checking: number;
  /** Distinct cited claims that are grounded but not (or no longer) verified. */
  unverified: number;
}

/**
 * Tally distinct cited claims (by chip number, matching {@link tallyBlocks})
 * into live trust buckets. Drives the per-answer footer pills so the header
 * count is, by construction, an aggregate of exactly what the cards display.
 */
export function tallyCitationTrust(
  blocks: AnswerBlock[],
  stateOf: (c: AnswerCitation) => CitationTrustState,
): CitationTrustTally {
  const seen = new Set<number>();
  const tally: CitationTrustTally = { verified: 0, checking: 0, unverified: 0 };
  for (const b of blocks) {
    if (b.kind !== 'files') continue;
    for (const c of b.citations) {
      if (seen.has(c.n)) continue;
      seen.add(c.n);
      tally[stateOf(c)] += 1;
    }
  }
  return tally;
}

/**
 * B1 (rewired to the live verifier): the trust state a files block's label
 * wears. Green "From your files" only when EVERY citation in the block is
 * live-verified; amber "not verified" the moment any citation is settled
 * unverified (honest tri-state — a genuinely-unverified citation must show
 * amber here AND on its card); a quiet "checking" while the only unresolved
 * citations are still being checked. A files block always has ≥1 citation
 * (block-keep requires a grounded citation), so an empty list — and any
 * non-files kind — is treated as not-verified.
 */
export function filesBlockTrustState(
  block: AnswerBlock,
  stateOf: (c: AnswerCitation) => CitationTrustState,
): CitationTrustState {
  if (block.kind !== 'files' || block.citations.length === 0) return 'unverified';
  const states = block.citations.map(stateOf);
  if (states.includes('unverified')) return 'unverified';
  if (states.includes('checking')) return 'checking';
  return 'verified';
}
