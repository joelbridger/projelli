/**
 * Ask answer-quality eval — REAL MODEL (nightly drift run).
 *
 * SKIPPED BY DEFAULT. It only runs when `ASK_EVAL_REAL=1` and an API key is
 * present, so the normal gate never touches a live model, never costs money, and
 * never flakes on provider jitter. The `scripts/eval/ask-nightly.mjs` wrapper
 * sets the env, runs this file, then reports drift via `notify-jameson`.
 *
 * What it does when enabled:
 *   - asks the configured real model every case question over the SAME prompt
 *     the app ships,
 *   - grades each answer with the deterministic grader (primary signal) and an
 *     LLM-as-judge (advisory quality signal),
 *   - writes a machine-readable report to `results/latest.json`,
 *   - compares the pass rate against the committed `baseline.json` and fails the
 *     run only on a meaningful regression (a soft floor), so day-to-day model
 *     wording changes don't red the nightly but a real quality drop does.
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES } from './cases';
import { evaluateCase, summarize, type CaseOutcome } from './harness';
import { makeRealProvider, makeJudgeProvider } from './realProvider';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(HERE, 'results');
const BASELINE_PATH = join(HERE, 'baseline.json');

const ENABLED = !!process.env['ASK_EVAL_REAL'];
/** Default absolute floor; the baseline (if present) raises it. */
const FLOOR = Number(process.env['ASK_EVAL_FLOOR'] ?? '0.75');
/** Allowed slip below the committed baseline pass rate before failing. */
const TOLERANCE = Number(process.env['ASK_EVAL_TOLERANCE'] ?? '0.15');

interface Baseline {
  passRate: number;
  model?: string;
  capturedAt?: string;
}

describe.skipIf(!ENABLED)('Ask answer-quality eval — REAL MODEL (nightly)', () => {
  it(
    'answers, grades, judges, writes results, and holds the regression floor',
    async () => {
      const real = makeRealProvider();
      if (!real) {
        throw new Error(
          'ASK_EVAL_REAL is set but no API key was found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.',
        );
      }
      const judge = makeJudgeProvider();

      const outcomes: CaseOutcome[] = [];
      for (const c of CASES) {
        // Sequential on purpose — avoids provider rate limits and keeps cost low.
        outcomes.push(await evaluateCase(c, real.provider, { judge: judge?.provider }));
      }
      const summary = summarize(outcomes);

      const report = {
        capturedAt: new Date().toISOString(),
        answerer: { provider: real.providerId, model: real.model },
        judge: judge ? { provider: judge.providerId, model: judge.model } : null,
        summary,
        outcomes: outcomes.map((o) => ({
          id: o.id,
          expect: o.expect,
          pass: o.pass,
          failed: o.grade.failed,
          judge: o.judge,
          answer: o.answer,
        })),
      };

      mkdirSync(RESULTS_DIR, { recursive: true });
      writeFileSync(join(RESULTS_DIR, 'latest.json'), JSON.stringify(report, null, 2));

      // eslint-disable-next-line no-console
      console.log(
        `\n[ask-eval] ${real.providerId}/${real.model}: ${summary.passed}/${summary.total} passed ` +
          `(${(summary.passRate * 100).toFixed(0)}%)` +
          (summary.judgeMeanScore != null ? ` · judge mean ${(summary.judgeMeanScore * 100).toFixed(0)}%` : '') +
          (summary.failures.length ? `\n  failures: ${summary.failures.map((f) => f.id).join(', ')}` : ''),
      );

      let floor = FLOOR;
      if (existsSync(BASELINE_PATH)) {
        const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
        floor = Math.max(floor, baseline.passRate - TOLERANCE);
      }
      expect(
        summary.passRate,
        `pass rate ${(summary.passRate * 100).toFixed(0)}% fell below the floor ` +
          `${(floor * 100).toFixed(0)}%. Failing cases: ${summary.failures.map((f) => f.id).join(', ')}`,
      ).toBeGreaterThanOrEqual(floor);
    },
    15 * 60 * 1000,
  );
});
