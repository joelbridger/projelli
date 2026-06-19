#!/usr/bin/env node
// Fails if the ESLint error/warning counts exceed the committed baseline.
// Lets the large pre-existing baseline stand while preventing NEW regressions.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const baselinePath = new URL('../.eslint-baseline.json', import.meta.url);
const writeMode = process.argv.includes('--update-baseline');

let raw = '[]';
try {
  raw = execSync('npx eslint src/ -f json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  // ESLint exits non-zero when there are errors; the JSON is still on stdout.
  raw = e.stdout?.toString() || '[]';
}
const results = JSON.parse(raw);
const errors = results.reduce((n, f) => n + f.errorCount, 0);
const warnings = results.reduce((n, f) => n + f.warningCount, 0);
const current = { errors, warnings };

if (writeMode) {
  writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n');
  console.log('Baseline updated:', current);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
console.log('ESLint current:', current, ' baseline:', baseline);
if (errors > baseline.errors || warnings > baseline.warnings) {
  console.error(`\n❌ ESLint regressed. errors ${baseline.errors}→${errors}, warnings ${baseline.warnings}→${warnings}.`);
  console.error('Fix the new findings, or if intentional run: npm run lint:gate -- --update-baseline');
  process.exit(1);
}
console.log('✅ No ESLint regression vs baseline.');
