#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFlagRegistrySource } from './flag-registry.mjs';

const registryFile = 'src/platform/flags/registry.ts';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function gitOrUndefined(args) {
  try {
    return git(args);
  } catch {
    return undefined;
  }
}

function registryAt(revision) {
  const source = gitOrUndefined(['show', `${revision}:${registryFile}`]);
  return source === undefined
    ? []
    : readFlagRegistrySource(source, `${revision}:${registryFile}`);
}

function mergeParents() {
  const mergeHead = gitOrUndefined(['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
  if (mergeHead) return [git(['rev-parse', 'HEAD']), mergeHead];
  const parents = git(['show', '-s', '--format=%P', 'HEAD'])
    .split(/\s+/)
    .filter(Boolean);
  return parents.length === 2 ? parents : undefined;
}

export function findResurrectedFlagIds({ baseFlags, parentFlags, resultFlags }) {
  const resultIds = new Set(resultFlags.map((flag) => flag.id));
  const parentIds = parentFlags.map((flags) => new Set(flags.map((flag) => flag.id)));
  return baseFlags
    .map((flag) => flag.id)
    .filter(
      (id) =>
        resultIds.has(id) && parentIds.some((ids) => !ids.has(id))
    );
}

export function checkMergeHistory({ resultSource, parents, readAt }) {
  if (!parents) return [];
  const base = git(['merge-base', parents[0], parents[1]]);
  return findResurrectedFlagIds({
    baseFlags: readAt(base),
    parentFlags: parents.map(readAt),
    resultFlags: readFlagRegistrySource(resultSource, registryFile),
  });
}

export function main() {
  const parents = mergeParents();
  if (!parents) {
    console.log('merge=union merge-history check skipped: this is not a two-parent merge.');
    return 0;
  }

  const resurrected = checkMergeHistory({
    resultSource: fs.readFileSync(path.resolve(registryFile), 'utf8'),
    parents,
    readAt: registryAt,
  });
  if (resurrected.length > 0) {
    console.error(
      `merge=union merge-history check failed: a flag deleted in a merge parent was resurrected: ${resurrected.join(', ')}.`
    );
    return 1;
  }
  console.log('merge=union merge-history check pass: no deleted flag was resurrected.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main();
