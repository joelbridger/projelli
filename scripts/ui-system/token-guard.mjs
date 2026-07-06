#!/usr/bin/env node
/**
 * UI ITERATION SYSTEM — Part 2: design-token leak guard.
 *
 * WHY: a "reskin" (new brand colour, new theme) must touch ONLY the paint layer
 * — the token definitions in src/styles/globals.css and brand/brand.config.json
 * — plus assets. That promise holds only if component code never hard-codes a
 * colour. This guard scans component source for literal colour values (hex,
 * rgb()/rgba()/hsl()/hsla() with numeric literals) and FAILS when a NEW leak
 * appears, so hard-coded styling can't creep back in.
 *
 * ALLOWED (not scanned): the paint layer itself —
 *   - src/styles/globals.css   (the @theme token defs + component style layer)
 *   - brand/brand.config.json  (the brand source of truth)
 * Colour literals belong THERE. Everywhere else — component .tsx/.ts inline
 * styles, arbitrary Tailwind values like text-[#fff], and any other .css — must
 * reference a token (var(--kp-*), a Tailwind token class, or a CSS var).
 *
 * MODEL (mirrors scripts/eslint-gate.mjs): a committed baseline of existing
 * leaks keyed by (file | literal), excluding line numbers so refactors don't
 * churn it. The guard fails only when a NEW leak fingerprint appears, or an
 * existing one appears MORE times than baseline. Removing leaks is always fine.
 * Enforcement over coverage: we freeze the debt and forbid growth rather than
 * hand-fixing every legacy value.
 *
 * Usage:
 *   node scripts/ui-system/token-guard.mjs                  # guard check (gate)
 *   node scripts/ui-system/token-guard.mjs --update-baseline
 *   node scripts/ui-system/token-guard.mjs --list           # print all current leaks
 *
 * Exit: 0 = ok, 1 = a new hard-coded colour leaked into component code.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const srcDir = resolve(repoRoot, 'src');
const baselinePath = resolve(__dirname, 'tokens.baseline.json');

// The paint layer — colour literals are ALLOWED here (this is what a reskin edits).
const ALLOWED_FILES = new Set(['src/styles/globals.css']);

// ---- colour-literal detectors ----------------------------------------------
// Hex colours: #rgb, #rgba, #rrggbb, #rrggbbaa. Word-bounded to avoid ids.
const RE_HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
// Numeric-literal colour functions. A leading digit/dot after "(" means a raw
// number, NOT a token: rgba(255,0,0,.5) leaks; rgba(var(--x),.1) is fine.
const RE_FUNC = /\b(?:rgb|rgba|hsl|hsla)\(\s*[.\d]/g;

/** Recursively list scannable files under src (tsx/ts/css, no tests/decls). */
function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listFiles(full));
    } else if (
      /\.(tsx?|css)$/.test(name) &&
      !/\.(test|spec)\.tsx?$/.test(name) &&
      !name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Collect leak fingerprints: Map "<relfile>|<literal>" -> count. */
function collectLeaks() {
  const leaks = new Map();
  for (const file of listFiles(srcDir)) {
    const rel = relative(repoRoot, file).split('\\').join('/');
    if (ALLOWED_FILES.has(rel)) continue;
    const text = readFileSync(file, 'utf8');
    const bump = (literal) => {
      const key = `${rel}|${literal.toLowerCase()}`;
      leaks.set(key, (leaks.get(key) ?? 0) + 1);
    };
    let m;
    RE_HEX.lastIndex = 0;
    while ((m = RE_HEX.exec(text))) bump(m[0]);
    RE_FUNC.lastIndex = 0;
    while ((m = RE_FUNC.exec(text))) bump(m[0].replace(/\s+/g, ''));
  }
  return leaks;
}

// ---- run --------------------------------------------------------------------
const leaks = collectLeaks();

if (process.argv.includes('--list')) {
  const sorted = [...leaks.entries()].sort();
  for (const [k, n] of sorted) console.log(`${k}  x${n}`);
  console.log(`\nTOTAL LEAK FINGERPRINTS: ${sorted.length}`);
  process.exit(0);
}

if (process.argv.includes('--update-baseline')) {
  const obj = {};
  for (const [k, n] of [...leaks.entries()].sort()) obj[k] = n;
  const payload = {
    _comment:
      'Baseline of pre-existing hard-coded colour leaks (file|literal -> count). ' +
      'These are frozen debt. The guard forbids NEW leaks; it never asks you to ' +
      'fix these. Regenerate with `node scripts/ui-system/token-guard.mjs ' +
      '--update-baseline` after LEGITIMATELY reducing leaks or after an approved ' +
      'exception. Colour literals belong in src/styles/globals.css, not here.',
    total: Object.keys(obj).length,
    leaks: obj,
  };
  writeFileSync(baselinePath, JSON.stringify(payload, null, 2) + '\n');
  console.log(`✅ Wrote token baseline: ${Object.keys(obj).length} leak fingerprints → ${relative(repoRoot, baselinePath)}`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error('❌ No token baseline found. Create it once with:\n   node scripts/ui-system/token-guard.mjs --update-baseline');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).leaks ?? {};
const newLeaks = [];
const grown = [];
for (const [k, n] of leaks.entries()) {
  const base = baseline[k] ?? 0;
  if (base === 0) newLeaks.push(k);
  else if (n > base) grown.push(`${k} (${base} → ${n})`);
}

console.log(`Token guard: ${leaks.size} leak fingerprints in source, ${Object.keys(baseline).length} in baseline.`);

if (newLeaks.length === 0 && grown.length === 0) {
  console.log('\n✅ Token guard passed — no NEW hard-coded colour leaked into component code.');
  process.exit(0);
}

if (newLeaks.length) {
  console.error(`\n❌ TOKEN GUARD FAILED — ${newLeaks.length} NEW hard-coded colour(s) in component code:`);
  for (const k of newLeaks.slice(0, 40)) console.error(`     ${k.replace('|', '  →  ')}`);
  if (newLeaks.length > 40) console.error(`     … +${newLeaks.length - 40} more`);
}
if (grown.length) {
  console.error(`\n❌ TOKEN GUARD FAILED — ${grown.length} existing leak(s) grew in count:`);
  for (const k of grown.slice(0, 40)) console.error(`     ${k}`);
}
console.error(
  '\nUse a design token instead of a literal colour:\n' +
    '   • CSS:  color: var(--kp-navy)   (see src/styles/globals.css @theme)\n' +
    '   • Tailwind: className="text-primary"  not  text-[#0a2540]\n' +
    'If the colour genuinely belongs to the paint layer, define it as a token in\n' +
    'src/styles/globals.css and reference it. Colour literals live there, not in components.',
);
process.exit(1);
