/**
 * Citation FAITHFULNESS eval — DETERMINISTIC GATE (WS3b).
 *
 * The existing answer eval proves an answer cites a RETRIEVED source. It does
 * NOT prove the cited source's TEXT actually supports the claim. This file
 * closes that gap: for every gold answer it verifies that
 *
 *   1. every inline citation resolves to a real retrieved chunk (no dangling,
 *      fabricated, or cross-document locators), AND
 *   2. every required fact the answer asserts genuinely appears in the TEXT of a
 *      chunk the answer actually cited (no hallucinated or paraphrase-drifted
 *      citation), AND
 *   3. a decline never cites a source as support.
 *
 * It reuses the SAME `parseCitations` / `resolveCitationTarget` the product
 * ships (via `gradeCitationFaithfulness`), so "faithful" in the eval means
 * exactly what it means in the app (BUG-065). Like the answer gate, it pairs the
 * positive control (gold answers ARE faithful) with a negative control (a
 * curated set of UNfaithful answers across every violation class MUST be caught)
 * — without the negative control a checker that passes everything would look
 * healthy while proving nothing.
 *
 * Fast, free, deterministic — no model. Runs in the normal `npx vitest run`.
 */

import { describe, it, expect } from 'vitest';
import { CASES, type EvalCase } from './cases';
import { buildHits } from './corpus';
import { parseCitations, resolveCitationTarget } from '@/platform/rag/workspaceCommand';
import { gradeCitationFaithfulness } from './grade';

function caseById(id: string): EvalCase {
  const c = CASES.find((x) => x.id === id);
  if (!c) throw new Error(`unknown eval case: ${id}`);
  return c;
}

function faithfulness(id: string, answer: string) {
  const c = caseById(id);
  return gradeCitationFaithfulness(c, answer, buildHits(c.sources));
}

describe('Citation faithfulness — gold answers are faithful (positive control)', () => {
  for (const c of CASES) {
    it(`${c.id}: gold answer is citation-faithful`, () => {
      const grade = gradeCitationFaithfulness(c, c.gold, buildHits(c.sources));
      expect(
        grade.failed,
        `gold for ${c.id} failed faithfulness checks: ${grade.failed.join(', ')}`,
      ).toEqual([]);
      expect(grade.pass).toBe(true);
    });
  }

  it('every answer-case gold actually carries a resolvable citation', () => {
    // Otherwise the faithfulness property would be vacuously true.
    for (const c of CASES.filter((x) => x.expect === 'answer')) {
      const hits = buildHits(c.sources);
      const cites = parseCitations(c.gold);
      expect(cites.length, `${c.id} gold has no citation`).toBeGreaterThan(0);
      for (const cite of cites) {
        expect(
          resolveCitationTarget(cite, hits),
          `${c.id} gold citation ${cite.match} did not resolve`,
        ).not.toBeNull();
      }
    }
  });
});

/**
 * The negative control: deliberately UNfaithful answers, one per violation
 * class, each of which MUST be caught. `expectFailedCheck` names the specific
 * check we expect to redden, so a control can't "pass for the wrong reason"
 * (e.g. a drift trap that only trips because the citation also fails to resolve).
 */
interface FaithTrap {
  caseId: string;
  answer: string;
  why: string;
  /** A substring of the check name we expect to fail. */
  expectFailedCheck: string;
}

const FAITH_TRAPS: FaithTrap[] = [
  {
    caseId: 'johnson-severance',
    why: 'DANGLING locator — cites a paragraph that was never retrieved',
    answer: 'Nexus Dynamics offered him four weeks of severance [johnson-deposition.md paragraph 9].',
    expectFailedCheck: 'all-citations-resolve',
  },
  {
    caseId: 'johnston-severance',
    why: 'CROSS-CLIENT source — cites the OTHER Marcus’s deposition (not in this question’s context)',
    answer: 'Marcus Johnston was offered four weeks of severance [johnson-deposition.md paragraph 4].',
    expectFailedCheck: 'all-citations-resolve',
  },
  {
    caseId: 'johnson-deadline',
    why: 'WRONG-PARAGRAPH drift — cites a retrieved chunk whose text does not support the claimed date',
    // paragraph 2 IS retrieved, but it is the forwarded-docs paragraph; it does
    // not contain "October 17", so the cited text does not support the claim.
    answer: 'The deadline was October 17, 2025 [johnson-deposition.md paragraph 2].',
    expectFailedCheck: 'cited-text-supports',
  },
  {
    caseId: 'johnston-rate',
    why: 'SAME-LOCATOR number drift — right citation, but states the other client’s rate',
    answer: 'Marcus Johnston agreed to $425 per hour for attorney time [johnston-engagement-letter.md paragraph 3].',
    expectFailedCheck: 'excludes',
  },
  {
    caseId: 'nexus-diag-parties',
    why: 'CONFUSABLE-COMPANY drift — substitutes Nexus Dynamics for Nexus Diagnostics',
    answer: 'The parties are Nexus Dynamics Corp. and Helix Bioworks LLC [nexus-diagnostics-nda.md paragraph 1].',
    expectFailedCheck: 'excludes',
  },
  {
    caseId: 'decline-johnston-from-johnson-context',
    why: 'DECLINE-THAT-CITES — a decline case answered with a grounded citation (leaked the other client’s fact)',
    answer: 'Marcus Johnston was offered four weeks of severance [johnson-deposition.md paragraph 4].',
    expectFailedCheck: 'decline-has-no-grounded-citation',
  },
];

describe('Citation faithfulness — unfaithful answers are caught (negative control)', () => {
  for (const [i, trap] of FAITH_TRAPS.entries()) {
    it(`trap #${i + 1} (${trap.caseId}): ${trap.why}`, () => {
      const grade = faithfulness(trap.caseId, trap.answer);
      expect(grade.pass, `unfaithful answer unexpectedly passed for ${trap.caseId}`).toBe(false);
      expect(
        grade.failed.some((name) => name.includes(trap.expectFailedCheck)),
        `expected a "${trap.expectFailedCheck}" check to fail for ${trap.caseId}; failed: ${grade.failed.join(', ')}`,
      ).toBe(true);
    });
  }

  it('the grader inspects the CITED CHUNK text, not just the answer string', () => {
    // The answer states the right fact AND cites a retrieved chunk — but the
    // cited chunk does not contain the fact. A naive checker that only scans the
    // answer would pass this; a faithful one must not.
    const grade = faithfulness(
      'nexus-diag-rider',
      // paragraph 3 is retrieved and mentions the Rider, but NOT "TA-204".
      'The Telomere Assay Confidentiality Rider is what protects the lab’s work [nexus-diagnostics-nda.md paragraph 3].',
    );
    expect(grade.pass).toBe(false);
    expect(grade.failed.some((n) => n.includes('cited-text-supports'))).toBe(true);
  });
});
