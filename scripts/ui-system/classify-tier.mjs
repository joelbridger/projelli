#!/usr/bin/env node
/**
 * UI ITERATION SYSTEM — Part 3: tiered merge-gate classifier.
 *
 * Classifies a change so re-verification effort MATCHES change size. It scans
 * changed CODE, not just paths (a hard requirement from the adversarial review:
 * paths lie — a "paint" CSS edit can break behaviour, and a "UI" feature edit
 * can change what the app DOES).
 *
 *   Tier P-safe  — token VALUE swaps / asset swaps / copy only. No behaviour, no
 *                  layout/visibility CSS, no component-class or selector changes.
 *                  Gate: typecheck + token & handle guards + visual smoke
 *                  (incl. narrow-width overflow) + i18n completeness.
 *   Tier S       — UI component / feature markup changed, handles preserved, no
 *                  behaviour touched. Behaviour-adjacent CSS (P-risky) lands here
 *                  too. Gate: P-safe checks + scoped component tests + the robot
 *                  rehearsal (handles + visual assertions).
 *   Tier B       — behaviour touched: platform / stores / services / Rust /
 *                  backend, OR a UI file whose changed lines touch hooks, async,
 *                  state, event-handler logic, storage, provider selection, or
 *                  Tauri invokes. Gate: full serial gate + real-Windows (Legion).
 *
 * Reports the HIGHEST tier present (B > S > P-safe). A human coordinator may only
 * RAISE the tier, never lower it without a written exception (per the review).
 *
 * Usage:
 *   node scripts/ui-system/classify-tier.mjs                 # diff vs origin/lantern-plus
 *   node scripts/ui-system/classify-tier.mjs --base <ref>
 *   node scripts/ui-system/classify-tier.mjs --files a b c   # explicit list (whole-file scan)
 *   node scripts/ui-system/classify-tier.mjs --json
 *
 * Exit 0 always (it reports; the gate scripts fail). execFileSync (arg arrays,
 * no shell) — a ref/path never reaches a shell.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { pathBucket, cssTier, uiCodeTier } from './lib/classify.mjs';

const RANK = { NONE: 0, 'P-safe': 1, S: 2, B: 3 };

// The classification RULES live in ./lib/classify.mjs (pure, unit-tested in
// tests/unit/ui-system/classify.test.ts — incl. the round-2 review's
// handler-rebind / disabled / href / submit-type misclassifying diffs). This
// file only gathers the diff and applies them.

// ---- changed-line extraction ------------------------------------------------
function changedLines(base, file, wholeFileFallback) {
  // Collect added/removed content lines from committed + working diffs. Falls
  // back to the whole file when no diff is available (e.g. --files mode).
  const lines = [];
  const grab = (args) => {
    try {
      const out = execFileSync('git', args, { encoding: 'utf8' });
      for (const ln of out.split('\n')) {
        if ((ln.startsWith('+') || ln.startsWith('-')) && !ln.startsWith('+++') && !ln.startsWith('---')) {
          lines.push(ln.slice(1));
        }
      }
    } catch {
      /* ref/file unknown */
    }
  };
  if (base) grab(['diff', `${base}...HEAD`, '--', file]);
  grab(['diff', 'HEAD', '--', file]);
  grab(['diff', '--', file]); // unstaged
  if (lines.length === 0 && wholeFileFallback && existsSync(file)) {
    try { return readFileSync(file, 'utf8').split('\n'); } catch { /* ignore */ }
  }
  return lines;
}

// ---- input ------------------------------------------------------------------
const argv = process.argv.slice(2);
let base = 'origin/lantern-plus';
let explicit = null;
const baseIdx = argv.indexOf('--base');
if (baseIdx !== -1) base = argv[baseIdx + 1];
const filesIdx = argv.indexOf('--files');
if (filesIdx !== -1) explicit = argv.slice(filesIdx + 1).filter((a) => !a.startsWith('--'));

function committedFiles() {
  const set = new Set();
  const grab = (args) => {
    try {
      for (const s of execFileSync('git', args, { encoding: 'utf8' }).split('\n')) {
        const t = s.trim();
        if (t) set.add(t);
      }
    } catch { /* ignore */ }
  };
  grab(['diff', '--name-only', `${base}...HEAD`]);
  grab(['diff', '--name-only', 'HEAD']);
  return [...set];
}

const files = explicit ?? committedFiles();
const useBase = explicit ? null : base; // explicit list → whole-file scan (no diff)

// ---- classify ---------------------------------------------------------------
const perFile = files.map((f) => {
  const bucket = pathBucket(f);
  let tier = 'NONE';
  let why = '';
  switch (bucket) {
    case 'B': tier = 'B'; why = 'behaviour layer (path)'; break;
    case 'CSS': {
      tier = cssTier(changedLines(useBase, f, !!explicit));
      why = tier === 'P-safe' ? 'CSS token/value swap only' : 'behaviour-adjacent CSS (P-risky → S)';
      break;
    }
    case 'COPY': tier = 'P-safe'; why = 'user-facing copy (locale)'; break;
    case 'PAINT-ASSET': tier = 'P-safe'; why = 'paint asset / brand config'; break;
    case 'UICODE': {
      tier = uiCodeTier(changedLines(useBase, f, !!explicit));
      why = tier === 'B' ? 'UI file with behaviour changes (hooks/async/state/handlers/invoke)' : 'UI markup/structure only';
      break;
    }
    default: tier = 'NONE'; why = 'non-UI (docs/tests/scripts/config)';
  }
  return { file: f, tier, why };
});

let overall = 'NONE';
for (const { tier } of perFile) if (RANK[tier] > RANK[overall]) overall = tier;

const GATES = {
  NONE: { label: 'No UI-relevant files changed.', gate: '(normal non-UI gate for this branch)' },
  'P-safe': {
    label: 'PAINT (safe) — token/asset/copy value swaps only.',
    gate: 'node scripts/ui-system/gate-tier.mjs P',
    detail: 'typecheck + token guard + handle guard + visual smoke (incl. narrow-width) + i18n completeness.',
  },
  S: {
    label: 'STRUCTURE — UI markup changed (or behaviour-adjacent CSS); handles preserved.',
    gate: 'node scripts/ui-system/gate-tier.mjs S',
    detail: 'P-safe checks + scoped component tests + robot rehearsal (handle integrity + visual assertions).',
  },
  B: {
    label: 'BEHAVIOUR — platform/stores/services/Rust OR a UI file that changed logic.',
    gate: 'npm run gate  (+ real-Windows verification on the Legion)',
    detail: 'Full serial gate. Not a cheap UI iteration.',
  },
};

// ---- output -----------------------------------------------------------------
if (argv.includes('--json')) {
  console.log(JSON.stringify({ tier: overall, files: perFile, gate: GATES[overall] }, null, 2));
  process.exit(0);
}
console.log('\n=== UI change tier classification (content-scanned) ===\n');
if (files.length === 0) { console.log('No changed files detected.'); process.exit(0); }
const order = ['B', 'S', 'P-safe', 'NONE'];
for (const t of order) {
  const rows = perFile.filter((x) => x.tier === t);
  if (!rows.length) continue;
  console.log(`  ${t === 'NONE' ? 'non-UI' : 'Tier ' + t} (${rows.length}):`);
  for (const r of rows.slice(0, 40)) console.log(`     ${r.file}  — ${r.why}`);
  if (rows.length > 40) console.log(`     … +${rows.length - 40} more`);
}
console.log('\n--------------------------------------');
console.log(`OVERALL TIER: ${overall} — ${GATES[overall].label}`);
if (GATES[overall].detail) console.log(`Gate: ${GATES[overall].detail}`);
console.log(`Run:  ${GATES[overall].gate}`);
console.log('Coordinator may RAISE this tier, never lower it without a written exception.');
console.log('--------------------------------------\n');
process.exit(0);
