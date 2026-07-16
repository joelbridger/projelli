#!/usr/bin/env node
/** Run exactly the Vitest files selected by test-impact.mjs; selection errors run all tests. */
import { spawnSync } from 'node:child_process';
import { selectImpact } from './test-impact.mjs';

const args = process.argv.slice(2);
const rangeIndex = args.indexOf('--range');
const range = rangeIndex >= 0 ? args[rangeIndex + 1] : 'HEAD~1..HEAD';
const result = selectImpact({ range });

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
