#!/usr/bin/env node
/** Run Vitest in full by default; only a fully successful selector may narrow it. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rangeIndex = args.indexOf('--range');
const range = rangeIndex >= 0 ? args[rangeIndex + 1] : 'HEAD~1..HEAD';
const selector = fileURLToPath(new URL('./test-impact.mjs', import.meta.url));
const selectorTimeout = Number.parseInt(process.env.TEST_IMPACT_SELECTOR_TIMEOUT_MS ?? '60000', 10);
let result = {
  mode: 'full',
  range,
  testFiles: [],
  selectedCount: 0,
  fullCount: 0,
  reasons: ['Selector did not complete successfully; fail open to the full suite.'],
};

try {
  const selection = spawnSync(process.execPath, [selector, '--range', range, '--json'], {
    encoding: 'utf8',
    timeout: Number.isFinite(selectorTimeout) && selectorTimeout > 0 ? selectorTimeout : 60000,
    env: process.env,
  });
  const output = selection.stdout?.trim();
  if (selection.error || selection.status !== 0 || !output) {
    const detail = selection.error?.message ?? `selector exit ${selection.status ?? 'unknown'}`;
    result.reasons = [`Selector did not complete successfully (${detail}); fail open to the full suite.`];
  } else {
    const parsed = JSON.parse(output);
    if (parsed.mode === 'full') result = parsed;
    else if (parsed.mode === 'affected' && Array.isArray(parsed.testFiles) && parsed.testFiles.length > 0) result = parsed;
    else result.reasons = ['Selector returned an empty or invalid selection; fail open to the full suite.'];
  }
} catch (error) {
  result.reasons = [`Selector exception; fail open to the full suite: ${error instanceof Error ? error.message : String(error)}`];
}

console.log(`Test impact runner: ${result.mode}; ${result.selectedCount}/${result.fullCount} test files.`);
for (const reason of result.reasons) console.log(`- ${reason}`);
const command = ['vitest', 'run'];
if (result.mode === 'affected') command.push(...result.testFiles);
const child = spawnSync('npx', command, { stdio: 'inherit' });
if (child.error) {
  console.error(`Could not start Vitest: ${child.error.message}`);
  process.exit(1);
}
process.exit(child.status ?? 1);
