#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  appLaunchInvocation,
  requireBuiltBinary,
  resolveCargoBinary,
} from './test-goldenloop.mjs';

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lantern-binary-path-'));

try {
  assert.equal(
    resolveCargoBinary('/repo', undefined, 'linux'),
    path.join('/repo', 'src-tauri/target/debug/lantern')
  );
  assert.equal(
    resolveCargoBinary('/repo', '/shared/cargo-target', 'linux'),
    path.join('/shared/cargo-target', 'debug/lantern')
  );
  assert.equal(
    resolveCargoBinary('/repo', '../cargo-target', 'linux'),
    path.resolve('/repo', '../cargo-target/debug/lantern')
  );
  assert.equal(
    resolveCargoBinary('/repo', 'target', 'win32'),
    path.join('/repo', 'target/debug/lantern.exe')
  );

  const executable = path.join(tempRoot, 'lantern');
  await writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.equal(await requireBuiltBinary(executable), executable);

  await assert.rejects(
    requireBuiltBinary(path.join(tempRoot, 'missing')),
    /did not produce the expected debug binary/
  );
  const directory = path.join(tempRoot, 'directory');
  await mkdir(directory);
  await assert.rejects(requireBuiltBinary(directory), /not a regular file/);
  const nonExecutable = path.join(tempRoot, 'non-executable');
  await writeFile(nonExecutable, 'not executable', { mode: 0o644 });
  await assert.rejects(requireBuiltBinary(nonExecutable), /not executable/);

  const invocation = appLaunchInvocation({
    binaryPath: executable,
    bridgePort: 9252,
    workspace: '/tmp/workspace',
    vitePort: 5174,
    displayNumber: 252,
    xvfbPidFile: '/tmp/xvfb.pid',
    screenshots: '/tmp/screenshots',
  });
  assert.equal(invocation.env.LANTERN_APP_BINARY, executable);
  assert.deepEqual(invocation.args, [
    'scripts/crm-loop/launch-app.sh',
    '9252',
    '/tmp/workspace',
  ]);

  console.log('binary path contract: all cases passed');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
