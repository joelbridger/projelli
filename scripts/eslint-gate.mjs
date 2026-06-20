#!/usr/bin/env node
/**
 * ESLint Fingerprint Gate
 *
 * WHY FINGERPRINTS instead of total counts:
 *   The old approach stored {errors, warnings} totals. Those totals are
 *   environment-fragile: the same issue can be classified as an error in CI
 *   and a warning locally (or vice versa) depending on ESLint plugin versions
 *   or NODE_ENV. This caused CI to fail even when no genuinely new problems
 *   existed — just a severity re-classification of pre-existing issues.
 *
 *   A fingerprint key is (relative-file-path | ruleId | message). It does NOT
 *   include line/column (so refactoring code doesn't invalidate the baseline)
 *   and does NOT include severity (so warning↔error reclassification is
 *   invisible to the gate). The gate only fails when a NEW unique problem
 *   appears, or an existing problem appears MORE times than the baseline.
 *   Problems that disappear or decrease are always fine.
 *
 * Usage:
 *   node scripts/eslint-gate.mjs                  # gate check (used by CI)
 *   node scripts/eslint-gate.mjs --update-baseline # regenerate the baseline
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Derive the repo root from this script's location: scripts/ -> repo root.
// Using fileURLToPath + dirname gives a real filesystem path (no URL encoding
// surprises) that works correctly on Linux, macOS, and Windows CI runners.
const __dirname = dirname(fileURLToPath(import.meta.url)); // .../keepance/scripts
const repoRoot = resolve(__dirname, '..');                  // .../keepance

const baselinePath = resolve(repoRoot, '.eslint-baseline.json');
const writeMode = process.argv.includes('--update-baseline');

// Run ESLint and collect JSON output.
// ESLint exits non-zero when there are lint errors, but the JSON is still on stdout.
let raw = '[]';
try {
  raw = execSync('npx eslint src/ -f json', {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (e) {
  raw = e.stdout?.toString() || '[]';
}

const results = JSON.parse(raw);

/**
 * Build a fingerprint → count map from ESLint results.
 * Key format: "<relative-path>|<ruleId>|<message>"
 * - relative-path: always relative to repo root (never /home/... absolute)
 * - ruleId: the ESLint rule name, or 'unknown' if absent
 * - message: the human-readable lint message text
 * Severity is intentionally excluded so warning↔error swaps don't break the baseline.
 *
 * WHY line/column/severity are excluded from the fingerprint key:
 *   Including line number re-introduces the exact line-fragility we designed out:
 *   every edit that shifts code lines would create a "new" fingerprint for an
 *   unchanged violation, causing phantom regressions on routine refactors. The
 *   accepted residual risk is that a NEW violation with an identical
 *   (file + rule + message) tuple replacing an old one at the same count would
 *   go undetected — this is the robustness tradeoff we deliberately accept for
 *   cross-environment + cross-edit stability.
 */
/**
 * Strip the absolute repo root from any string so machine-specific paths
 * don't leak into fingerprint keys. ESLint embeds the absolute filePath
 * inside some multi-line error messages (e.g. react-hooks/refs code context),
 * so we need to normalize those out as well.
 * We replace "<repoRoot>/" with "" so "src/App.tsx" remains relative.
 */
function stripAbsRoot(str) {
  // repoRoot ends with "/" (from resolve), so repoRoot + '/' would double it.
  // The actual prefix in ESLint messages is the raw absolute path + '/'.
  const prefix = repoRoot.endsWith('/') ? repoRoot : repoRoot + '/';
  return str.replaceAll(prefix, '');
}

function buildFingerprintMap(eslintResults) {
  const map = {};
  for (const file of eslintResults) {
    // Make the path relative to the repo root so it's the same on any machine.
    // Normalize backslashes to forward slashes so Windows-generated keys match
    // the Linux-generated baseline (Windows path separators would otherwise
    // produce keys like "src\App.tsx|..." that never match "src/App.tsx|...").
    const relPath = relative(repoRoot, file.filePath).replace(/\\/g, '/');
    for (const msg of file.messages) {
      const ruleId = msg.ruleId ?? 'unknown';
      // Strip any embedded absolute paths from the message text so the fingerprint
      // is identical regardless of where the repo is checked out.
      const normalizedMessage = stripAbsRoot(msg.message);
      const key = `${relPath}|${ruleId}|${normalizedMessage}`;
      map[key] = (map[key] ?? 0) + 1;
    }
  }
  return map;
}

const currentMap = buildFingerprintMap(results);

if (writeMode) {
  // Sort keys so the baseline file has a stable, human-readable diff.
  const sorted = Object.fromEntries(
    Object.entries(currentMap).sort(([a], [b]) => a.localeCompare(b))
  );
  writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + '\n');
  const count = Object.keys(sorted).length;
  console.log(`Baseline updated: ${count} fingerprints written to .eslint-baseline.json`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

// Find regressions: any fingerprint whose current count EXCEEDS the baseline count.
// New fingerprints not in the baseline have an implicit baseline count of 0.
const regressions = [];
for (const [key, count] of Object.entries(currentMap)) {
  const baselineCount = baseline[key] ?? 0;
  if (count > baselineCount) {
    regressions.push({ key, baselineCount, currentCount: count });
  }
}

if (regressions.length > 0) {
  console.error(`\n❌ ESLint regression: ${regressions.length} new/increased finding(s) vs baseline:\n`);
  for (const { key, baselineCount, currentCount } of regressions) {
    const [filePath, ruleId, message] = key.split('|');
    const delta = currentCount - baselineCount;
    console.error(
      `  +${delta}  [${ruleId}]  ${filePath}\n        ${message}\n`
    );
  }
  console.error(
    'Fix the new findings, or if intentional run: npm run lint:gate -- --update-baseline'
  );
  process.exit(1);
}

const baselineCount = Object.keys(baseline).length;
const currentCount = Object.keys(currentMap).length;
const improved = baselineCount - currentCount;
const improvementNote = improved > 0 ? ` (${improved} fingerprint(s) cleaned up vs baseline)` : '';
console.log(`✅ No ESLint regression vs baseline.${improvementNote}`);
