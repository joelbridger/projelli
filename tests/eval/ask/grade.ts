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

import { parseCitations, resolveCitationTarget } from '@/platform/rag/workspaceCommand';
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
