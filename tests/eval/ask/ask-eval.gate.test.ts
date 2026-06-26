/**
 * Ask answer-quality eval — DETERMINISTIC GATE.
 *
 * Runs in the normal gate (`npm run gate` / `npx vitest run`). It uses
 * MockProvider with scripted answers, so it is fast, free, and deterministic. It
 * does NOT measure a live model — the nightly `realModel.eval.test.ts` does that.
 *
 * What this locks down:
 *   1. Every case's hand-written GOLD answer PASSES the grader. This pins the
 *      rubric to a real exemplar — if a future change to the grading logic or
 *      the prompt contract breaks a good answer, this reddens.
 *   2. Every TRAP answer FAILS the grader. This is the negative control: it
 *      proves the grader actually discriminates good answers from bad ones (a
 *      grader that passes everything would be worthless). Traps cover
 *      fabrication, missing citations, wrong-locator citations, cross-matter
 *      leaks, hidden contradictions, and answering-when-it-should-decline.
 *   3. The harness wiring (real prompt build → provider → real citation
 *      resolution → grade) works end-to-end against a mock.
 */

import { describe, it, expect } from 'vitest';
import { MockProvider } from '@/platform/providers/MockProvider';
import { CASES } from './cases';
import { buildHits } from './corpus';
import { runAskCase } from './harness';
import { gradeAnswer } from './grade';

/** A MockProvider that returns exactly `answer` for any prompt. */
function scripted(answer: string): MockProvider {
  const p = new MockProvider();
  p.setDefaultResponse({ content: answer, delay: 0 });
  return p;
}

async function gradeScripted(caseId: string, answer: string) {
  const c = CASES.find((x) => x.id === caseId)!;
  const run = await runAskCase(c, scripted(answer));
  return gradeAnswer(c, run.answer, run.hits);
}

describe('Ask answer-quality eval — corpus + case integrity', () => {
  it('has a healthy, non-trivial case set', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length); // unique ids
    expect(CASES.some((c) => c.expect === 'answer')).toBe(true);
    expect(CASES.filter((c) => c.expect === 'decline').length).toBeGreaterThanOrEqual(5);
  });

  it('every case selects only paragraphs that exist in the corpus', () => {
    // buildHits → paragraph() throws on an out-of-range selection, so this also
    // guards against a case citing a paragraph the corpus does not contain.
    for (const c of CASES) {
      expect(() => buildHits(c.sources), `${c.id} sources`).not.toThrow();
    }
  });

  it('keeps enough negative-control coverage (traps) to trust the grader', () => {
    const withTraps = CASES.filter((c) => (c.traps?.length ?? 0) > 0);
    expect(withTraps.length).toBeGreaterThanOrEqual(10);
  });
});

describe('Ask answer-quality eval — GOLD answers pass (MockProvider, deterministic)', () => {
  for (const c of CASES) {
    it(`${c.id}: gold answer passes the grader`, async () => {
      const grade = await gradeScripted(c.id, c.gold);
      expect(grade.failed, `gold for ${c.id} failed checks: ${grade.failed.join(', ')}`).toEqual([]);
      expect(grade.pass).toBe(true);
    });
  }
});

describe('Ask answer-quality eval — TRAP answers fail (negative control)', () => {
  for (const c of CASES) {
    for (const [i, trap] of (c.traps ?? []).entries()) {
      it(`${c.id} trap #${i + 1} fails (${trap.why})`, async () => {
        const grade = await gradeScripted(c.id, trap.answer);
        expect(grade.pass, `trap "${trap.why}" unexpectedly passed for ${c.id}`).toBe(false);
      });
    }
  }
});
