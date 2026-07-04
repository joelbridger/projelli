#!/usr/bin/env node
/**
 * Nightly orchestrator for the Ask answer-quality eval.
 *
 * Runs the real-model eval (tests/eval/ask/realModel.eval.test.ts) against a
 * live model, compares the pass rate to the committed baseline, and reports
 * drift to Jameson via `notify-jameson`. Designed to be scheduled by cron on
 * this server (where notify-jameson and the API key live).
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node scripts/eval/ask-nightly.mjs
 *   ASK_EVAL_PROVIDER=anthropic ANTHROPIC_API_KEY=... node scripts/eval/ask-nightly.mjs
 *   node scripts/eval/ask-nightly.mjs --update-baseline   # rebaseline from this run
 *   node scripts/eval/ask-nightly.mjs --no-notify         # dry run, no message
 *
 * Suggested cron (3:15am daily):
 *   15 3 * * *  cd /home/jameson/lantern && OPENAI_API_KEY=... node scripts/eval/ask-nightly.mjs >> /tmp/ask-eval.log 2>&1
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const EVAL_DIR = join(REPO, 'tests', 'eval', 'ask');
const RESULTS = join(EVAL_DIR, 'results', 'latest.json');
const BASELINE = join(EVAL_DIR, 'baseline.json');

const args = process.argv.slice(2);
const updateBaseline = args.includes('--update-baseline');
const noNotify = args.includes('--no-notify');

function notify(level, subject, body) {
  if (noNotify) {
    console.log(`[ask-nightly] (notify suppressed) ${subject}\n${body}`);
    return;
  }
  const res = spawnSync(
    'notify-jameson',
    ['--subject', subject, '--body', body, '--level', level, '--channel', 'email,telegram'],
    { stdio: 'inherit' },
  );
  if (res.error) console.error('[ask-nightly] notify-jameson failed:', res.error.message);
}

// 1. Delete any stale results FIRST, so a present results/latest.json after the
//    run can only be from THIS run (a crash can't leave us reading old numbers).
if (existsSync(RESULTS)) rmSync(RESULTS);

// 2. Run the real-model eval. ASK_EVAL_REAL=1 flips the skipIf in the test on.
console.log('[ask-nightly] running real-model Ask eval…');
const run = spawnSync(
  'npx',
  ['vitest', 'run', 'tests/eval/ask/realModel.eval.test.ts'],
  { cwd: REPO, stdio: 'inherit', env: { ...process.env, ASK_EVAL_REAL: '1' } },
);

// 3. Read the machine-readable report the test wrote. With the pre-delete above,
//    a missing file now unambiguously means "this run produced nothing" (no key,
//    or a crash before the test wrote results) — not a stale leftover.
if (!existsSync(RESULTS)) {
  notify(
    'critical',
    '[Keepance] NEED YOU: Ask eval produced no results',
    [
      'Project: Keepance (~/keepance — Ask answer-quality nightly eval)',
      'Task: Run the nightly answer-quality eval against the real model',
      `Result: The eval did not produce results/latest.json (vitest exit ${run.status}). Likely a missing API key or a crash.`,
      'Next: Check OPENAI_API_KEY/ANTHROPIC_API_KEY and the run log.',
    ].join('\n'),
  );
  process.exit(1);
}

const report = JSON.parse(readFileSync(RESULTS, 'utf8'));
const { summary, answerer } = report;
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;

// 3. Compute drift vs the committed baseline.
const pct = (x) => `${(x * 100).toFixed(0)}%`;
const baselineRate = baseline && typeof baseline.passRate === 'number' ? baseline.passRate : null;
const delta = baselineRate != null ? summary.passRate - baselineRate : null;
const baselineFailing = new Set(baseline?.failing ?? []);
const newlyFailing = summary.failures.map((f) => f.id).filter((id) => !baselineFailing.has(id));

// 4. Optionally rebaseline from this run (intentional, manual). ONLY when the
//    run passed cleanly (exit 0 = the floor held) — never bake a failing/
//    regressed run in as the new baseline.
if (updateBaseline) {
  if (run.status === 0) {
    const next = {
      note: 'Captured by scripts/eval/ask-nightly.mjs --update-baseline.',
      passRate: summary.passRate,
      model: `${answerer.provider}/${answerer.model}`,
      capturedAt: report.capturedAt,
      failing: summary.failures.map((f) => f.id),
    };
    writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
    console.log(`[ask-nightly] baseline updated → ${pct(summary.passRate)} (${next.model}).`);
  } else {
    console.warn(
      `[ask-nightly] --update-baseline SKIPPED: the run did not pass the floor (vitest exit ${run.status}). ` +
        'Refusing to baseline a failing run — investigate the failures first, or lower ASK_EVAL_FLOOR for a calibration run.',
    );
  }
}

// 5. Report. Critical when the run failed OR a regression appeared.
const regressed = run.status !== 0 || newlyFailing.length > 0 || (delta != null && delta < -0.01);
const level = regressed ? 'critical' : 'info';
const type = regressed ? 'NEED YOU' : 'MILESTONE';
const headline = regressed
  ? `Ask answer quality dropped to ${pct(summary.passRate)}`
  : `Ask answer quality holding at ${pct(summary.passRate)}`;

const driftLine =
  delta == null
    ? 'No baseline to compare against yet.'
    : `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(0)} points vs baseline ${pct(baselineRate)}.`;

const body = [
  `Project: Keepance (~/keepance — Ask answer-quality nightly eval, ${answerer.provider}/${answerer.model})`,
  'Task: Grade the AI answers over fixed questions on the synthetic matter corpus',
  `Result: ${summary.passed}/${summary.total} cases passed (${pct(summary.passRate)}). ${driftLine}` +
    (summary.judgeMeanScore != null ? ` Judge mean ${pct(summary.judgeMeanScore)}.` : '') +
    (newlyFailing.length ? `\nNewly failing: ${newlyFailing.join(', ')}.` : '') +
    (summary.failures.length ? `\nAll failing: ${summary.failures.map((f) => f.id).join(', ')}.` : ''),
  regressed
    ? 'Next: Review tests/eval/ask/results/latest.json — a real answer-quality regression or a model change.'
    : 'Next: nothing — quality steady.',
].join('\n');

notify(level, `[Keepance] ${type}: ${headline}`, body);
process.exit(regressed && !updateBaseline ? 1 : 0);
