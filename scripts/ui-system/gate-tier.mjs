#!/usr/bin/env node
/**
 * UI ITERATION SYSTEM — the per-tier gate runner.
 *
 * Runs exactly the checks a change of a given tier needs — the whole point of
 * the system: re-verification effort MATCHES change size.
 *
 *   gate-tier.mjs P   (paint-safe): typecheck + brand sync + token guard +
 *                     handle guard + i18n completeness + visual smoke
 *                     (boot + handle integrity + no-overflow at desktop & narrow).
 *   gate-tier.mjs S   (structure): everything in P + SCOPED component tests
 *                     (auto-selected from the changed files — FAILS if none run)
 *                     + the full robot rehearsal (handle integrity + visual + Ask).
 *   gate-tier.mjs B   (behaviour): defers to the full serial gate — this is not
 *                     a cheap UI iteration; run `npm run gate` + real-Windows.
 *
 * You may pass explicit test files for Tier S:
 *   gate-tier.mjs S src/ui/kp/SegmentedToggle.test.tsx
 * Otherwise they're auto-selected from `git diff` against origin/lantern-plus.
 *
 * Get the tier from `node scripts/ui-system/classify-tier.mjs`. A coordinator
 * may RAISE the tier, never lower it without a written exception (per review).
 *
 * Exit: 0 = all steps passed, 1 = any step failed (incl. Tier S with no tests).
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectTests } from './lib/select-tests.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argvRest = process.argv.slice(3);
const tierArg = (process.argv[2] || '').toUpperCase().replace(/^P-SAFE$/, 'P');

if (!['P', 'S', 'B'].includes(tierArg)) {
  console.error('Usage: node scripts/ui-system/gate-tier.mjs <P|S|B> [explicit test files…]');
  process.exit(2);
}

let failed = 0;
function step(label, cmd, args, env = {}) {
  console.log(`\n===== ${label} =====`);
  const r = spawnSync(cmd, args, { cwd: repoRoot, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.log(`❌ FAILED: ${label}`);
    failed = 1;
  }
  return r.status === 0;
}

if (tierArg === 'B') {
  console.log('Tier B (behaviour) — this is not a cheap UI round.');
  console.log('Run the full serial gate:  npm run gate');
  console.log('AND real-Windows verification on the Legion (see WORKER-DISCIPLINE.md).');
  process.exit(1);
}

// ---- shared P-safe checks (both P and S run these) ---------------------------
step('TypeScript', 'npm', ['run', 'typecheck']);
step('Brand sync (tokens in sync with brand.config.json)', 'npm', ['run', 'brand:check']);
step('Design-token leak guard', 'node', ['scripts/ui-system/token-guard.mjs']);
step('Permanent-handle guard', 'node', ['scripts/ui-system/handle-guard.mjs']);
step('i18n locale completeness', 'npm', ['run', 'i18n:completeness']);

if (tierArg === 'P') {
  step('Visual smoke (boot + handle integrity + no-overflow)', 'node', ['scripts/ui-system/rehearsal.mjs'], {
    REHEARSAL_VISUAL_ONLY: '1',
  });
} else {
  // ---- Tier S: RUN scoped component tests (round-2 P1) ----------------------
  // Round-2 review: the gate must actually run scoped tests and FAIL when none
  // run — not just print a reminder.
  let tests = argvRest.length ? argvRest : autoSelectTests();
  console.log('\n===== Scoped component tests (Tier S) =====');
  if (tests.length === 0) {
    console.log(
      '❌ FAILED: Tier S requires scoped component tests, but none were found for the changed\n' +
        '   files. Add a co-located <Component>.test.tsx (or a tests/ test), or pass one\n' +
        '   explicitly: node scripts/ui-system/gate-tier.mjs S <testfile>.',
    );
    failed = 1;
  } else {
    console.log('Running: ' + tests.join(' '));
    step('Scoped component tests', 'npx', ['vitest', 'run', ...tests]);
  }
  step('Robot rehearsal (full DEMO-V1 path: handles + visual + Ask)', 'node', ['scripts/ui-system/rehearsal.mjs']);
}

console.log('');
console.log(failed ? '❌ TIER GATE RED' : '✅ TIER GATE GREEN');
process.exit(failed);

// ---- helpers ----------------------------------------------------------------
function changedFiles() {
  const set = new Set();
  const grab = (args) => {
    try {
      for (const s of execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).split('\n')) {
        const t = s.trim();
        if (t) set.add(t);
      }
    } catch { /* ignore */ }
  };
  grab(['diff', '--name-only', 'origin/lantern-plus...HEAD']);
  grab(['diff', '--name-only', 'HEAD']);
  return [...set];
}

// Walk tests/ once and index test files by basename, so a non-co-located test
// (e.g. tests/unit/ask/AskComposer.test.tsx for src/features/ask/AskComposer.tsx)
// is still found.
let _testIndex = null;
function findTestByBasename(bn) {
  if (!_testIndex) {
    _testIndex = new Map();
    const testsDir = join(repoRoot, 'tests');
    const walk = (d) => {
      let entries = [];
      try { entries = readdirSync(d); } catch { return; }
      for (const n of entries) {
        const f = join(d, n);
        let s; try { s = statSync(f); } catch { continue; }
        if (s.isDirectory()) walk(f);
        else if (/\.(test|spec)\.(tsx?|mjs)$/.test(n)) {
          const key = n.replace(/\.(test|spec)\.(tsx?|mjs)$/, '');
          const rel = relative(repoRoot, f);
          const arr = _testIndex.get(key) || [];
          arr.push(rel);
          _testIndex.set(key, arr);
        }
      }
    };
    walk(testsDir);
  }
  return _testIndex.get(bn) || [];
}

function autoSelectTests() {
  return selectTests(changedFiles(), (p) => existsSync(join(repoRoot, p)), findTestByBasename);
}
