#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFlagRegistry } from './flag-registry.mjs';

const root = path.resolve('.');
const registryFile = 'src/platform/flags/registry.ts';
const preconditions = path.join(root, 'scripts/check-union-registry-preconditions.mjs');
const mergeHistory = path.join(root, 'scripts/check-union-registry-merge-history.mjs');
const currentRegistry = readFileSync(path.join(root, registryFile), 'utf8');

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function run(repo, command, args) {
  return spawnSync(command, args, {
    cwd: repo,
    encoding: 'utf8',
  });
}

function requirePass(result, label) {
  if (result.status !== 0)
    throw new Error(`${label} failed:\n${result.stdout}\n${result.stderr}`);
}

function requireFail(result, label, text) {
  if (result.status === 0)
    throw new Error(`${label} unexpectedly passed.`);
  const output = `${result.stdout}\n${result.stderr}`;
  if (text && !output.includes(text))
    throw new Error(`${label} failed for the wrong reason:\n${output}`);
}

function defineFlag(id, suffix = id) {
  return `  defineFlag('${id}', 'Complete descriptor ${suffix}.', 'merge-union-simulation', '2026-07-16', '2026-09-14'),`;
}

function addCall(source, id, suffix = id) {
  return source.replace(
    '] as const satisfies readonly FlagDescriptor[];',
    `${defineFlag(id, suffix)}\n] as const satisfies readonly FlagDescriptor[];`
  );
}

function insertCallAfterFirst(source, id) {
  const firstLine = source.match(/^  defineFlag\([^\n]+\),$/m)?.[0];
  if (!firstLine) throw new Error('Could not find the first atomic descriptor.');
  return source.replace(firstLine, `${firstLine}\n${defineFlag(id)}`);
}

function removeCall(source, id) {
  const line = source.match(new RegExp(`^.*defineFlag\\('${id.replaceAll('-', '\\-')}'[^\n]*\\n`, 'm'))?.[0];
  if (!line) throw new Error(`Could not find ${id}.`);
  return source.replace(line, '');
}

function legacyRegistrySource() {
  const descriptors = readFlagRegistry();
  const records = descriptors
    .map(
      (flag) => `  {
    id: '${flag.id}',
    description: '${flag.description.replaceAll("'", "\\'")}',
    ownerLane: '${flag.ownerLane}',
    createdAt: '${flag.createdAt}',
    expiresAt: '${flag.expiresAt}',
    defaultEnabled: false,
  },`
    )
    .join('\n');
  return `export interface FlagDescriptor {
  id: string;
  description: string;
  ownerLane: string;
  createdAt: string;
  expiresAt: string;
  defaultEnabled: false;
}

export const flagRegistry = [
${records}
] as const satisfies readonly FlagDescriptor[];

export type FlagId = (typeof flagRegistry)[number]['id'];
`;
}

function addLegacyObject(source, id) {
  const record = `  {
    id: '${id}',
    description: 'Complete descriptor ${id}.',
    ownerLane: 'merge-union-simulation',
    createdAt: '2026-07-16',
    expiresAt: '2026-09-14',
    defaultEnabled: false,
  },\n`;
  return source.replace('] as const satisfies readonly FlagDescriptor[];', `${record}] as const satisfies readonly FlagDescriptor[];`);
}

function makeRepo(baseRegistry = currentRegistry, attribute = true) {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'union-registry-merge-'));
  mkdirSync(path.join(repo, 'src/platform/flags'), { recursive: true });
  mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  cpSync(path.join(root, '.prettierignore'), path.join(repo, '.prettierignore'));
  cpSync(path.join(root, '.gitattributes'), path.join(repo, '.gitattributes'));
  if (!attribute) {
    writeFileSync(
      path.join(repo, '.gitattributes'),
      readFileSync(path.join(repo, '.gitattributes'), 'utf8').replace(
        /^.*src\/platform\/flags\/registry\.ts merge=union.*\n?/m,
        ''
      )
    );
  }
  for (const script of [
    'flag-registry.mjs',
    'check-union-registry-preconditions.mjs',
    'check-union-registry-merge-history.mjs',
  ]) {
    cpSync(path.join(root, 'scripts', script), path.join(repo, 'scripts', script));
  }
  symlinkSync(path.join(root, 'node_modules'), path.join(repo, 'node_modules'), 'dir');
  writeFileSync(path.join(repo, registryFile), baseRegistry);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'union-sim@example.test']);
  git(repo, ['config', 'user.name', 'Union simulation']);
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'simulation base']);
  return repo;
}

function commitRegistry(repo, message, source, extra = {}) {
  writeFileSync(path.join(repo, registryFile), source);
  for (const [file, contents] of Object.entries(extra))
    writeFileSync(path.join(repo, file), contents);
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', message]);
}

function merge(repo, oursSource, theirsSource, { theirsExtra } = {}) {
  git(repo, ['checkout', '-qb', 'ours']);
  commitRegistry(repo, 'ours', oursSource);
  git(repo, ['checkout', '-qb', 'theirs', 'main']);
  commitRegistry(repo, 'theirs', theirsSource, theirsExtra);
  git(repo, ['checkout', '-q', 'ours']);
  requirePass(run(repo, 'git', ['merge', '--no-edit', 'theirs']), 'ordinary merge');
}

function expectClean(repo, label, ids) {
  requirePass(run(repo, process.execPath, [preconditions]), `${label} precondition gate`);
  requirePass(run(repo, process.execPath, [mergeHistory]), `${label} merge-history gate`);
  const output = readFileSync(path.join(repo, registryFile), 'utf8');
  for (const id of ids) {
    const count = output.split(`'${id}'`).length - 1;
    if (count !== 1) throw new Error(`${label}: expected ${id} exactly once, got ${count}.`);
  }
}

function simulate(label, action) {
  const repo = makeRepo();
  try {
    action(repo);
    console.log(`PASS: ${label}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

function simulateOldStyleLane() {
  const repo = makeRepo(legacyRegistrySource(), false);
  try {
    git(repo, ['checkout', '-qb', 'old-style-lane']);
    commitRegistry(repo, 'old style append', addLegacyObject(legacyRegistrySource(), 'union-sim-old-style-lane'));
    git(repo, ['checkout', '-qb', 'adopt-union', 'main']);
    commitRegistry(repo, 'adopt atomic registry', currentRegistry, {
      '.gitattributes': readFileSync(path.join(root, '.gitattributes'), 'utf8'),
    });
    requirePass(run(repo, 'git', ['merge', '--no-edit', 'old-style-lane']), 'old-style ordinary merge');
    requireFail(
      run(repo, process.execPath, [preconditions]),
      'old-style lane automatic gate',
      'duplicate flag id'
    );
    console.log('PASS: old-style in-flight lane merge is build-failing, never silently accepted');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

simulate('two end appends are clean and correct', (repo) => {
  merge(repo, addCall(currentRegistry, 'union-sim-at-end-ours'), addCall(currentRegistry, 'union-sim-at-end-theirs'));
  expectClean(repo, 'two end appends', ['union-sim-at-end-ours', 'union-sim-at-end-theirs']);
});

simulate('insert plus append is clean and correct', (repo) => {
  merge(repo, insertCallAfterFirst(currentRegistry, 'union-sim-insert-ours'), addCall(currentRegistry, 'union-sim-append-theirs'));
  expectClean(repo, 'insert plus append', ['union-sim-insert-ours', 'union-sim-append-theirs']);
});

simulate('delete versus append fails the merge-history gate', (repo) => {
  const deletedId = readFlagRegistry().at(-1).id;
  merge(repo, removeCall(currentRegistry, deletedId), addCall(currentRegistry, 'union-sim-delete-peer'));
  requirePass(run(repo, process.execPath, [preconditions]), 'delete-versus-append structural gate');
  requireFail(
    run(repo, process.execPath, [mergeHistory]),
    'delete-versus-append merge-history gate',
    deletedId
  );
});

simulate('the exact same line is clean and retained once', (repo) => {
  const shared = addCall(currentRegistry, 'union-sim-identical');
  merge(repo, shared, shared);
  expectClean(repo, 'same full line', ['union-sim-identical']);
});

simulate('same id with different metadata fails the automatic gate', (repo) => {
  merge(repo, addCall(currentRegistry, 'union-sim-same-id', 'ours'), addCall(currentRegistry, 'union-sim-same-id', 'theirs'));
  requireFail(
    run(repo, process.execPath, [preconditions]),
    'same-id automatic gate',
    'duplicate flag id: union-sim-same-id'
  );
});

simulateOldStyleLane();
console.log('merge=union simulations pass: every case was clean-correct or rejected by an automatic gate.');
