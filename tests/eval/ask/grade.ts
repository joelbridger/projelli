/**
 * Deterministic grader for Ask answer-quality cases.
 *
 * The grader is provider-agnostic: it scores an answer string against a case and
 * the retrieved hits. It reuses the SAME citation logic the app ships
 * (`parseCitations` + `resolveCitationTarget` from workspaceCommand) so a
 * "grounded citation" in the eval means exactly what it means in the product —
 * the cited file AND the exact retrieved paragraph/page (BUG-065). That keeps
 * the eval honest: an answer can't pass by citing a file it never grounded.
 *
 * Two halves:
 *   - answer cases: must NOT be a decline, must carry the required grounded
 *     citation(s), must include the required facts, must avoid the forbidden
 *     strings.
 *   - decline cases: must read as a decline AND carry no grounded citation
 *     (you can't "decline" while citing a source as support), plus the same
 *     forbidden-string guard against fabrication.
 */

import { parseCitations, resolveCitationTarget, citationBasename } from '@/platform/rag/workspaceCommand';
import type { RagHit } from '@/platform/utils/tauri-commands';
import { NO_EVIDENCE_DECLINE } from '@/features/ask/askPrompt';
import type { EvalCase } from './cases';

export interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string | undefined;
}

export interface GradeResult {
  pass: boolean;
  checks: CheckResult[];
  failed: string[];
  /** Fraction of checks that passed (0..1) — a softer signal for reporting. */
  score: number;
}

/** Normalize for case/'apostrophe'-insensitive substring matching. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[‘’′`]/g, "'");
}

/**
 * Does this answer read as a "no evidence" decline? Exact match on the canonical
 * sentence (the gate path + a well-behaved model), plus a broader detector so a
 * real model's paraphrase still counts in the nightly run.
 */
export function isDecline(answer: string): boolean {
  const a = norm(answer);
  if (a.includes(norm(NO_EVIDENCE_DECLINE))) return true;
  const negFind =
    /\b(could\s?n'?t|can\s?not|can'?t|cannot|unable to|do(?:es)?\s?n'?t|did\s?n'?t|no|not)\b[^.?!]*\b(find|found|contain|mention|reference|information|details?|data|record|anything|nothing|answer)\b/;
  const notInDocs =
    /\b(not|isn'?t|aren'?t|n'?t)\b[^.?!]*\b(in|within|present in|contained in|mentioned in)\b[^.?!]*\b(documents?|context|files?|workspace|materials?|records?)\b/;
  return negFind.test(a) || notInDocs.test(a);
}

function matches(answer: string, needle: string | RegExp): boolean {
  return typeof needle === 'string' ? norm(answer).includes(norm(needle)) : needle.test(answer);
}

/** Citations in the answer that PROVABLY resolve to a retrieved hit. */
function groundedCitations(answer: string, hits: RagHit[]) {
  return parseCitations(answer)
    .map((c) => ({ citation: c, hit: resolveCitationTarget(c, hits) }))
    .filter((r): r is { citation: ReturnType<typeof parseCitations>[number]; hit: RagHit } => r.hit !== null);
}

export function gradeAnswer(c: EvalCase, answer: string, hits: RagHit[]): GradeResult {
  const checks: CheckResult[] = [];
  const declined = isDecline(answer);

  if (c.expect === 'decline') {
    checks.push({
      name: 'declines',
      ok: declined,
      detail: declined ? undefined : 'expected a decline, but the answer asserted something',
    });
    const grounded = groundedCitations(answer, hits);
    checks.push({
      name: 'no-grounded-citation',
      ok: grounded.length === 0,
      detail: grounded.length ? `declined but cited ${grounded.length} source(s) as support` : undefined,
    });
  } else {
    checks.push({
      name: 'is-an-answer',
      ok: !declined,
      detail: declined ? 'expected an answer, but the model declined' : undefined,
    });
    const grounded = groundedCitations(answer, hits);
    for (const want of c.mustCite ?? []) {
      const ok = grounded.some((r) => r.hit.path === want.doc && r.citation.paragraphIndex === want.para);
      checks.push({
        name: `cites:${want.doc}#${want.para}`,
        ok,
        detail: ok ? undefined : 'required grounded citation missing (wrong file, wrong paragraph, or absent)',
      });
    }
  }

  for (const want of c.mustInclude ?? []) {
    const ok = matches(answer, want);
    checks.push({ name: `includes:${describe(want)}`, ok, detail: ok ? undefined : 'required content missing' });
  }
  for (const bad of c.mustNotInclude ?? []) {
    const ok = !matches(answer, bad);
    checks.push({
      name: `excludes:${describe(bad)}`,
      ok,
      detail: ok ? undefined : 'forbidden content present (possible fabrication or cross-matter leak)',
    });
  }

  const failed = checks.filter((ch) => !ch.ok).map((ch) => ch.name);
  const score = checks.length === 0 ? 1 : (checks.length - failed.length) / checks.length;
  return { pass: failed.length === 0, checks, failed, score };
}

function describe(needle: string | RegExp): string {
  return typeof needle === 'string' ? `"${needle}"` : needle.toString();
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  WS3b — CITATION FAITHFULNESS grader.
 *
 *  `gradeAnswer` proves an answer cites a RETRIEVED source. It does NOT prove
 *  the cited source's TEXT actually supports the claim. `gradeCitationFaithfulness`
 *  closes that gap — the property a hallucinated or paraphrase-drifted citation
 *  violates — by tying each required fact to the text of the chunk the answer
 *  cited. It reuses the SAME `parseCitations` / `resolveCitationTarget` the
 *  product ships, so "faithful" here means exactly what it means in the app.
 *
 *  For an `answer` case it checks three things:
 *    1. EVERY citation in the answer resolves to a retrieved chunk — a dangling
 *       or fabricated locator (wrong file, unretrieved paragraph, or another
 *       client's document) is an unfaithful citation.
 *    2. Every required fact (`mustInclude`) appears in the TEXT of at least one
 *       chunk the answer actually cited — catches "states fact X, cites a source
 *       that doesn't contain X" (the drift/hallucination this test exists for).
 *    3. No forbidden / cross-client content (`mustNotInclude`) in the answer.
 *  For a `decline` case it checks that the answer carries NO grounded citation
 *  (you cannot "decline" while citing a source as support).
 *
 *  SCOPE (check 2 is a UNION over the cited chunks). This measures whether each
 *  required fact is supported by SOME chunk the answer cited — exact for the
 *  common single-citation answer. For a MULTI-source synthesis answer it cannot,
 *  on its own, prove a fact was attributed to the RIGHT subject (e.g. in a
 *  two-client answer where both correct depositions are cited, swapping "Johnson
 *  got six weeks / Johnston got four weeks" still has each NUMBER supported by a
 *  cited chunk). That subject-attribution correctness is deliberately left to the
 *  answer grader's `mustNotInclude` and the nightly LLM-judge rubric (which
 *  requires keeping the clients straight) — citation faithfulness ≠ answer
 *  correctness, and this grader does not overclaim the latter.
 * ═══════════════════════════════════════════════════════════════════════════ */
export function gradeCitationFaithfulness(c: EvalCase, answer: string, hits: RagHit[]): GradeResult {
  const checks: CheckResult[] = [];

  if (c.expect === 'decline') {
    const grounded = groundedCitations(answer, hits);
    checks.push({
      name: 'decline-has-no-grounded-citation',
      ok: grounded.length === 0,
      detail: grounded.length ? `a decline must not cite, but cited ${grounded.length} source(s)` : undefined,
    });
  } else {
    const resolved = parseCitations(answer).map((cite) => ({
      cite,
      hit: resolveCitationTarget(cite, hits),
    }));

    // (1) No dangling / fabricated / cross-document citation.
    const dangling = resolved.filter((r) => r.hit === null);
    checks.push({
      name: 'all-citations-resolve',
      ok: dangling.length === 0,
      detail: dangling.length
        ? `citation(s) resolve to no retrieved chunk: ${dangling.map((d) => d.cite.match).join(', ')}`
        : undefined,
    });

    // An answer that asserts facts must cite SOMETHING to be faithful.
    checks.push({
      name: 'answer-carries-a-citation',
      ok: resolved.length > 0,
      detail: resolved.length ? undefined : 'answer asserts facts but cites nothing',
    });

    // (2) Each required fact must be present in the TEXT of a CITED chunk.
    const citedTexts = resolved.filter((r) => r.hit !== null).map((r) => r.hit!.chunkText);
    for (const want of c.mustInclude ?? []) {
      const ok = citedTexts.some((t) => matches(t, want));
      checks.push({
        name: `cited-text-supports:${describe(want)}`,
        ok,
        detail: ok
          ? undefined
          : 'required fact not present in any cited chunk (hallucinated or paraphrase-drifted citation)',
      });
    }

    // (3) Fabrication / cross-client leak guard on the answer text.
    for (const bad of c.mustNotInclude ?? []) {
      const ok = !matches(answer, bad);
      checks.push({
        name: `excludes:${describe(bad)}`,
        ok,
        detail: ok ? undefined : 'forbidden content present (fabrication or cross-client leak)',
      });
    }
  }

  const failed = checks.filter((ch) => !ch.ok).map((ch) => ch.name);
  const score = checks.length === 0 ? 1 : (checks.length - failed.length) / checks.length;
  return { pass: failed.length === 0, checks, failed, score };
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  WS3b — RETRIEVAL grader.
 *
 *  A retrieval case asks: for this query (and scope), did the engine rank the
 *  RIGHT source document highly? `gradeRetrieval` answers the binary gate
 *  question — "is a required (relevant) source within the top K?" — over a
 *  ranked `RagHit[]`, deduplicated to the best rank per source DOCUMENT (the
 *  unit a citation points at). The richer ranking metrics (MRR / NDCG / P@K)
 *  live in `retrievalMetrics.ts`; this grader is the simple pass/fail the
 *  retrieval gate asserts per case.
 * ═══════════════════════════════════════════════════════════════════════════ */
export interface RetrievalGradeInput {
  /** Basenames of the source document(s) that are RELEVANT to this query. */
  expectedSources: string[];
  /** The cutoff K for the "required hit in top K?" gate. */
  topK: number;
}

export interface RetrievalGrade {
  pass: boolean;
  /** 1-based rank of the first relevant source in the dedup-by-document list,
   *  or null when no relevant source was retrieved at all. */
  rankOfFirstRelevant: number | null;
  /** True when a relevant source is within the top `topK`. */
  hitAtK: boolean;
  topK: number;
  /** Source basenames in retrieved order, best rank per document only. */
  rankedSources: string[];
  checks: CheckResult[];
}

/** Collapse a ranked `RagHit[]` to the ordered list of distinct source
 *  documents (basenames), keeping each document at its BEST (first) rank. */
export function rankedSourceList(hits: ReadonlyArray<{ path: string }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hits) {
    const base = citationBasename(h.path);
    if (seen.has(base)) continue;
    seen.add(base);
    out.push(base);
  }
  return out;
}

export function gradeRetrieval(
  c: RetrievalGradeInput,
  hits: ReadonlyArray<{ path: string }>,
): RetrievalGrade {
  const ranked = rankedSourceList(hits);
  const relevant = new Set(c.expectedSources.map((s) => citationBasename(s)));
  // 1-based rank of the first relevant document; null if none retrieved.
  let rankOfFirstRelevant: number | null = null;
  for (let i = 0; i < ranked.length; i++) {
    if (relevant.has(ranked[i]!)) {
      rankOfFirstRelevant = i + 1;
      break;
    }
  }
  const hitAtK = rankOfFirstRelevant !== null && rankOfFirstRelevant <= c.topK;
  const checks: CheckResult[] = [
    {
      name: `relevant-source-in-top-${c.topK}`,
      ok: hitAtK,
      detail: hitAtK
        ? undefined
        : rankOfFirstRelevant === null
          ? `none of [${[...relevant].join(', ')}] retrieved; got [${ranked.join(', ')}]`
          : `relevant source first appears at rank ${rankOfFirstRelevant} (> ${c.topK}); got [${ranked.join(', ')}]`,
    },
  ];
  return { pass: hitAtK, rankOfFirstRelevant, hitAtK, topK: c.topK, rankedSources: ranked, checks };
}
