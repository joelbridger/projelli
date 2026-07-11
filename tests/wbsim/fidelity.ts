import { startSimulator } from './server';

const simulator = startSimulator();
const cargo = Bun.spawn(
  [
    'nice',
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
    cwd: import.meta.dir + '/../..',
    env: { ...process.env, WBSIM_BASE_URL: simulator.baseUrl },
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  }
);

try {
  const exitCode = await cargo.exited;
  if (exitCode !== 0)
    throw new Error(`fidelity drive failed with cargo exit code ${exitCode}`);
} finally {
  simulator.stop();
}
