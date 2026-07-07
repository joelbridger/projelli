#!/usr/bin/env node
/**
 * UI ITERATION SYSTEM — Part 1: permanent-handle guard.
 *
 * WHY: tests and robot drivers grip elements by a stable, semantic
 * `data-testid` ("handle") so a re-paint or re-layout of the UI never breaks
 * them. That only holds if handles are PERMANENT. This guard snapshots every
 * handle in the app and FAILS when one disappears (removed or renamed) without
 * a deliberate migration entry. Adding handles is always free; removing one is
 * a conscious, logged act.
 *
 * WHAT COUNTS AS A HANDLE: any `data-testid`, `testId`, or `testid` attribute
 * whose value is a string literal or a template literal. Template literals are
 * normalised to a pattern (`ai-provider-${}`) so a stable dynamic handle counts
 * as one key regardless of runtime value. Values that are bare variables
 * (`data-testid={x}`) can't be known statically and are ignored.
 *
 * MODEL (mirrors scripts/eslint-gate.mjs): a committed baseline of handle keys.
 * The guard fails only when a baseline key is ABSENT from the current source
 * and is NOT authorised by an entry in the migrations file. New keys never fail
 * the guard; run --update-baseline to fold them in.
 *
 * Usage:
 *   node scripts/ui-system/handle-guard.mjs                 # guard check (CI / gate)
 *   node scripts/ui-system/handle-guard.mjs --update-baseline
 *   node scripts/ui-system/handle-guard.mjs --list          # print current handles
 *
 * Exit: 0 = ok, 1 = a handle vanished without a migration entry.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const srcDir = resolve(repoRoot, 'src');
const baselinePath = resolve(__dirname, 'handles.baseline.json');
const migrationsPath = resolve(__dirname, 'handles.migrations.json');

// ---- collect source files ---------------------------------------------------
/** Recursively list .ts/.tsx under src, excluding tests & type decls. */
function listSourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

// ---- extract handle keys ----------------------------------------------------
const ATTR = '(?:data-testid|testId|testid|rootTestId|getTabTestId)';
// String literal:  data-testid="foo"  /  testId='foo'
const RE_LITERAL = new RegExp(`${ATTR}\\s*=\\s*["']([^"'\\n]+)["']`, 'g');
// JSX-braced template: data-testid={`ai-provider-${p.id}`}
const RE_TEMPLATE = new RegExp(`${ATTR}\\s*=\\s*\\{\\s*\`([^\`]+)\`\\s*\\}`, 'g');
// JSX expression containing a template fallback/callback:
//   data-testid={getTabTestId ? getTabTestId(path) : `tab-${path}`}
//   getTabTestId={(path) => `documents-tab-${path}`}
const RE_BRACED_TEMPLATE = new RegExp(`${ATTR}\\s*=\\s*\\{[^\\n\`]*\`([^\`]+)\`[^\\n]*\\}`, 'g');
// Object prop passed to a reusable component:
//   leadingTab={{ testId: 'documents-files-tab' }}
const RE_OBJECT_LITERAL = /\btestId\s*:\s*["']([^"'\n]+)["']/g;
const RE_OBJECT_TEMPLATE = /\btestId\s*:\s*`([^`]+)`/g;

/** Replace every ${...} interpolation with a fixed ${} placeholder. */
function normaliseTemplate(body) {
  return body.replace(/\$\{[^}]*\}/g, '${}');
}

function isCssAttributeSelector(text, index) {
  return text[index - 1] === '[';
}

function collectHandles() {
  const handles = new Map(); // key -> { count, files:Set }
  const add = (key, file) => {
    if (!/[A-Za-z]/.test(key.replace(/\$\{\}/g, ''))) return;
    const rel = relative(repoRoot, file);
    const e = handles.get(key) ?? { count: 0, files: new Set() };
    e.count += 1;
    e.files.add(rel);
    handles.set(key, e);
  };
  for (const file of listSourceFiles(srcDir)) {
    const text = readFileSync(file, 'utf8');
    let m;
    RE_LITERAL.lastIndex = 0;
    while ((m = RE_LITERAL.exec(text))) {
      if (!isCssAttributeSelector(text, m.index)) add(m[1], file);
    }
    RE_TEMPLATE.lastIndex = 0;
    while ((m = RE_TEMPLATE.exec(text))) add(normaliseTemplate(m[1]), file);
    RE_BRACED_TEMPLATE.lastIndex = 0;
    while ((m = RE_BRACED_TEMPLATE.exec(text))) add(normaliseTemplate(m[1]), file);
    RE_OBJECT_LITERAL.lastIndex = 0;
    while ((m = RE_OBJECT_LITERAL.exec(text))) add(m[1], file);
    RE_OBJECT_TEMPLATE.lastIndex = 0;
    while ((m = RE_OBJECT_TEMPLATE.exec(text))) add(normaliseTemplate(m[1]), file);
  }
  return handles;
}

// ---- run --------------------------------------------------------------------
const handles = collectHandles();
for (const [pattern, expansions] of Object.entries({
  'spine-nav-${}': ['spine-nav-matters', 'spine-nav-search', 'spine-nav-workflows'],
})) {
  if (!handles.has(pattern)) continue;
  for (const key of expansions) {
    if (handles.has(key)) continue;
    handles.set(key, {
      count: 1,
      files: new Set(['src/app/shell/layout/Spine.tsx']),
    });
  }
}
const currentKeys = [...handles.keys()].sort();

// Static uniqueness (round-2 P0): a handle rendered from MORE THAN ONE source
// location is a likely runtime duplicate — the robot may grip the wrong one.
// Runtime uniqueness is only checkable on reachable screens; this static check
// covers the WHOLE inventory. Existing duplicates are frozen in the baseline
// (many are legit mutually-exclusive branches); the guard blocks NEW ones.
const currentDupes = new Map();
for (const [k, e] of handles) if (e.files.size > 1) currentDupes.set(k, e.files.size);

if (process.argv.includes('--list')) {
  for (const k of currentKeys) console.log(`${k}  (${handles.get(k).count})`);
  console.log(`\nTOTAL HANDLE KEYS: ${currentKeys.length} | cross-file duplicates: ${currentDupes.size}`);
  process.exit(0);
}

if (process.argv.includes('--update-baseline')) {
  const payload = {
    _comment:
      'Permanent-handle baseline for the UI Iteration System. Regenerate with ' +
      '`node scripts/ui-system/handle-guard.mjs --update-baseline` ONLY when a ' +
      'handle removal/rename is intentional and logged in handles.migrations.json. ' +
      '`duplicates` freezes handles rendered from >1 file (frozen debt; the guard ' +
      'blocks NEW cross-file duplicates so a handle can\'t silently become ambiguous).',
    count: currentKeys.length,
    keys: currentKeys,
    duplicates: Object.fromEntries([...currentDupes].sort(([a], [b]) => a.localeCompare(b))),
  };
  writeFileSync(baselinePath, JSON.stringify(payload, null, 2) + '\n');
  console.log(`✅ Wrote baseline: ${currentKeys.length} handle keys, ${currentDupes.size} frozen duplicates → ${relative(repoRoot, baselinePath)}`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error('❌ No handle baseline found. Create it once with:\n   node scripts/ui-system/handle-guard.mjs --update-baseline');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const baselineKeys = new Set(baseline.keys ?? []);
const migrations = existsSync(migrationsPath)
  ? JSON.parse(readFileSync(migrationsPath, 'utf8'))
  : { migrations: [] };
const authorisedRemovals = new Set((migrations.migrations ?? []).map((mig) => mig.removed));

const currentSet = new Set(currentKeys);
const removed = [...baselineKeys].filter((k) => !currentSet.has(k));
const added = currentKeys.filter((k) => !baselineKeys.has(k));

const unauthorised = removed.filter((k) => !authorisedRemovals.has(k));
const authorised = removed.filter((k) => authorisedRemovals.has(k));

console.log(`Handle guard: ${currentKeys.length} keys in source, ${baselineKeys.size} in baseline.`);
if (added.length) {
  console.log(`\n➕ ${added.length} NEW handle(s) (fine — run --update-baseline to fold in):`);
  for (const k of added.slice(0, 30)) console.log(`     + ${k}`);
  if (added.length > 30) console.log(`     … +${added.length - 30} more`);
}
if (authorised.length) {
  console.log(`\n📝 ${authorised.length} removed handle(s) authorised by a migration entry:`);
  for (const k of authorised) console.log(`     - ${k}`);
}

if (unauthorised.length) {
  console.error(`\n❌ HANDLE GUARD FAILED — ${unauthorised.length} handle(s) removed or renamed WITHOUT a migration entry:`);
  for (const k of unauthorised) console.error(`     - ${k}`);
  console.error(
    '\nA test or robot script may grip these. To remove/rename intentionally, add an entry to\n' +
      `   ${relative(repoRoot, migrationsPath)}\n` +
      'of the form { "removed": "<old-key>", "replacement": "<new-key or null>", "reason": "...", "date": "YYYY-MM-DD" }\n' +
      'then run --update-baseline. Otherwise, restore the handle.',
  );
  process.exit(1);
}

// Verify replacements named by migrations actually exist now (catch a rename
// that logged the removal but never added the new handle).
const missingReplacements = (migrations.migrations ?? [])
  .filter((mig) => mig.replacement && !currentSet.has(mig.replacement))
  .map((mig) => mig.replacement);
if (missingReplacements.length) {
  console.error(`\n❌ HANDLE GUARD FAILED — migration names replacement handle(s) that do not exist in source:`);
  for (const k of missingReplacements) console.error(`     ? ${k}`);
  process.exit(1);
}

// New / widened cross-file duplicates → likely a handle silently made ambiguous.
const baseDupes = baseline.duplicates ?? {};
const newDupes = [];
for (const [k, n] of currentDupes) {
  const b = baseDupes[k] ?? 0;
  if (b === 0) newDupes.push(`${k} (now in ${n} files)`);
  else if (n > b) newDupes.push(`${k} (${b} → ${n} files)`);
}
if (newDupes.length) {
  console.error(`\n❌ HANDLE GUARD FAILED — ${newDupes.length} handle(s) newly rendered from more than one location (ambiguous — the robot may grip the wrong one):`);
  for (const k of newDupes) console.error(`     ⧉ ${k}`);
  console.error(
    '\nGive each interactive element a UNIQUE data-testid. If this duplication is\n' +
      'genuinely intentional (mutually-exclusive render branches), run\n' +
      '`node scripts/ui-system/handle-guard.mjs --update-baseline` to freeze it.',
  );
  process.exit(1);
}

console.log(`\n✅ Handle guard passed — no permanent handle vanished, and no new ambiguous (duplicate) handles (${currentDupes.size} frozen).`);
process.exit(0);
