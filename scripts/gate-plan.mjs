#!/usr/bin/env node
/**
 * Prints the conservative proof plan for files changed from a base commit.
 * Unknown paths fail closed into the full frontend suite.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const json = args.includes('--json');
const requestedBase = args.find((arg, index) => args[index - 1] === '--base') ?? process.env.GATE_BASE;

function git(...command) {
  return execFileSync('git', command, { cwd: root, encoding: 'utf8' }).trim();
}

function resolves(ref) {
  try {
    git('rev-parse', '--verify', `${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

function chooseBase() {
  if (requestedBase) {
    if (!resolves(requestedBase)) throw new Error(`Cannot resolve requested base: ${requestedBase}`);
    return requestedBase;
  }

  try {
    const upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}');
    if (upstream && resolves(upstream)) return upstream;
  } catch {
    // A local branch without an upstream falls through to the known bases.
  }

  // A new local lane has no upstream yet. Its immediately preceding commit is
  // the only base we can prove without guessing a possibly unrelated branch.
  for (const candidate of ['HEAD~1', 'origin/lantern-plus', 'origin/keepance-3.0', 'origin/main', 'main']) {
    if (resolves(candidate)) return candidate;
  }
  throw new Error('Cannot find a base commit. Pass --base <commit> or set GATE_BASE.');
}

function globToRegExp(glob) {
  let expression = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*') {
      if (glob[index + 1] === '*') {
        index += 1;
        if (glob[index + 1] === '/') {
          index += 1;
          expression += '(?:.*/)?';
        } else {
          expression += '.*';
        }
      } else {
        expression += '[^/]*';
      }
    } else if (char === '?') {
      expression += '[^/]';
    } else if (char === '{') {
      const close = glob.indexOf('}', index);
      if (close === -1) throw new Error(`Unclosed brace in pattern: ${glob}`);
      expression += `(${glob.slice(index + 1, close).split(',').map((entry) => entry.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')).join('|')})`;
      index = close;
    } else {
      expression += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${expression}$`);
}

const impactMap = JSON.parse(readFileSync(path.join(root, 'scripts/test-impact-map.json'), 'utf8'));
const rules = impactMap.rules.map((rule) => ({ ...rule, matcher: globToRegExp(rule.pattern) }));
const base = chooseBase();
const mergeBase = git('merge-base', base, 'HEAD');
const files = git('diff', '--name-only', '--diff-filter=ACMR', `${mergeBase}...HEAD`)
  .split('\n')
  .filter(Boolean);

const plan = {
  base,
  mergeBase,
  files,
  changedVitest: false,
  fullVitest: false,
  contracts: false,
  backend: false,
  rustPackages: [],
  reasons: [],
  unknownFiles: [],
};
const rustPackages = new Set();

for (const file of files) {
  const matched = rules.filter((rule) => rule.matcher.test(file));
  if (matched.length === 0) {
    plan.fullVitest = true;
    plan.unknownFiles.push(file);
    plan.reasons.push(`${file}: unclassified path; full Vitest selected`);
    continue;
  }
  for (const rule of matched) {
    for (const impact of rule.impacts) {
      if (impact === 'changed-vitest') plan.changedVitest = true;
      if (impact === 'full-vitest') plan.fullVitest = true;
      if (impact === 'contracts') plan.contracts = true;
      if (impact === 'backend') plan.backend = true;
      if (impact.startsWith('rust:')) rustPackages.add(impact.slice('rust:'.length));
    }
    if (rule.impacts.length > 0) plan.reasons.push(`${file}: ${rule.reason}`);
  }
}

if (plan.fullVitest) plan.changedVitest = false;
plan.rustPackages = [...rustPackages].sort();

if (json) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
} else {
  console.log(`Gate base: ${base} (merge base ${mergeBase})`);
  console.log(`Changed files: ${files.length}`);
  for (const reason of plan.reasons) console.log(`- ${reason}`);
  if (plan.fullVitest) console.log('Vitest: full suite (fail-closed)');
  else if (plan.changedVitest) console.log(`Vitest: changed mode against ${mergeBase}`);
  else console.log('Vitest: no frontend impact selected');
  console.log(`Contracts: ${plan.contracts ? 'selected by Intake/CI change' : 'always run by the changed gate'}`);
  console.log(`Backend: ${plan.backend ? 'selected' : 'not selected'}`);
  console.log(`Rust packages: ${plan.rustPackages.length ? plan.rustPackages.join(', ') : 'not selected'}`);
}
