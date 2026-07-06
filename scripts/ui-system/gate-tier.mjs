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
 *   gate-tier.mjs S   (structure): everything in P + scoped component tests +
 *                     the full robot rehearsal (handle integrity + visual + Ask).
 *   gate-tier.mjs B   (behaviour): defers to the full serial gate — this is not
 *                     a cheap UI iteration; run `npm run gate` + real-Windows.
 *
 * Get the tier from `node scripts/ui-system/classify-tier.mjs`. A coordinator
 * may RAISE the tier, never lower it without a written exception (per review).
 *
 * Exit: 0 = all steps passed, 1 = any step failed.
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tierArg = (process.argv[2] || '').toUpperCase().replace(/^P-SAFE$/, 'P');

if (!['P', 'S', 'B'].includes(tierArg)) {
  console.error('Usage: node scripts/ui-system/gate-tier.mjs <P|S|B>');
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
  console.log('gate-tier does not attempt to substitute for that.');
  process.exit(1);
}

// ---- shared P-safe checks (both P and S run these) ---------------------------
step('TypeScript', 'npm', ['run', 'typecheck']);
step('Brand sync (tokens in sync with brand.config.json)', 'npm', ['run', 'brand:check']);
step('Design-token leak guard', 'node', ['scripts/ui-system/token-guard.mjs']);
step('Permanent-handle guard', 'node', ['scripts/ui-system/handle-guard.mjs']);
step('i18n locale completeness', 'npm', ['run', 'i18n:completeness']);

if (tierArg === 'P') {
  // Paint-safe: visual smoke only (boot + handle integrity + overflow).
  step('Visual smoke (boot + handle integrity + no-overflow)', 'node', ['scripts/ui-system/rehearsal.mjs'], {
    REHEARSAL_VISUAL_ONLY: '1',
  });
} else {
  // Structure: component tests (scoped by the coordinator/caller) + full robot.
  console.log('\n(Tier S: run your SCOPED component tests, e.g. `npx vitest run <changed area>`.)');
  step('Robot rehearsal (full DEMO-V1 path: handles + visual + Ask)', 'node', ['scripts/ui-system/rehearsal.mjs']);
}

console.log('');
console.log(failed ? '❌ TIER GATE RED' : '✅ TIER GATE GREEN');
process.exit(failed);
