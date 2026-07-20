#!/usr/bin/env node
/**
 * scripts/sweep-test-clock-bombs.mjs — the BEHAVIOURAL decider for date bombs.
 *
 * `scripts/check-test-clock-bombs.mjs` is a cheap LEXICAL belt: it sees a
 * future date literal sitting in a test file with no fake clock. It is blind by
 * construction to a bomb whose fuse is a PAST date, to one reached through an
 * imported fixture, and to one with no literal at all (the flag registry's
 * expiry is exactly that shape).
 *
 * This runs the actual corpus under a whole-`Date` OFFSET clock set to a future
 * instant and reports what changes verdict. Nothing here is lexical, so none of
 * those blind spots apply.
 *
 * NOT WIRED INTO `npm run gate`, deliberately: one pass costs a full suite run
 * (measured 4m55s over the 428 date-carrying files at VITEST_MAX_FORKS=2, so
 * roughly 10-15 min over all 1195). It belongs on a schedule, or before a
 * release, not on every merge. Wire it only after measuring it on this box.
 *
 *   node scripts/sweep-test-clock-bombs.mjs                   # +1y and +5y
 *   node scripts/sweep-test-clock-bombs.mjs 2026-09-14T00:00:01.000Z
 *
 * Anything that reds is a candidate, not a verdict: re-run that file ALONE on
 * the real clock and under the probe before calling it a bomb. Two lanes have
 * now filed false bombs from a defective probe (one TORN, one FROZEN) — the
 * setup file's positive controls throw on both, but the alone-run is the belt.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = 'scripts/testing/vitest.clock-sweep.config.ts';

function futureInstants() {
  const now = Date.now();
  const at = (ms) => new Date(now + ms).toISOString();
  return [at(365 * 864e5), at(5 * 365 * 864e5)];
}

const instants = process.argv.slice(2).length ? process.argv.slice(2) : futureInstants();
let failed = 0;

for (const instant of instants) {
  if (!Number.isFinite(Date.parse(instant))) {
    console.error(`❌ not a parseable instant: ${instant}`);
    process.exitCode = 1;
    continue;
  }
  console.log(`\n===== clock sweep @ ${instant} =====`);
  const run = spawnSync(
    resolve(ROOT, 'node_modules/.bin/vitest'),
    ['run', '--config', CONFIG],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, CLOCK_PROBE_AT: instant },
    }
  );
  // Read the STATUS, never a pipe's. A signal is not a pass.
  if (run.error) {
    console.error(`❌ could not run vitest: ${run.error.message}`);
    failed += 1;
  } else if (run.signal) {
    console.error(`❌ vitest was killed by ${run.signal} — that is UNKNOWN, not green.`);
    failed += 1;
  } else if (run.status !== 0) {
    console.error(`❌ RED at ${instant} (exit ${run.status}) — attribute each failing file ALONE before calling it a bomb.`);
    failed += 1;
  } else {
    console.log(`✅ green at ${instant}`);
  }
}

console.log(failed === 0 ? '\n✅ no scheduled failures at the sampled instants' : `\n❌ ${failed}/${instants.length} sampled instants RED`);
console.log('Bound: sampled instants are not a proof of totality. A fuse strictly between two samples is invisible to this run.');
process.exitCode = failed === 0 ? 0 : 1;
