import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { startSimulator } from './server';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);

const simulator = startSimulator();
const cargo = spawn(
  'nice',
  [
    '-n',
    '10',
    'cargo',
    'test',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--lib',
    'fidelity_drive::wbsim_fidelity_drive_matches_the_frozen_matrix',
    '--',
    '--nocapture',
  ],
  {
    cwd: repoRoot,
    env: { ...process.env, WBSIM_BASE_URL: simulator.baseUrl },
    stdio: ['ignore', 'inherit', 'inherit'],
  }
);

try {
  const exitCode = await new Promise<number>((resolve, reject) => {
    cargo.on('error', reject);
    cargo.on('close', (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0)
    throw new Error(`fidelity drive failed with cargo exit code ${exitCode}`);
} finally {
  simulator.stop();
}
