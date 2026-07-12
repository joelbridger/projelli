#!/usr/bin/env node
/**
 * Self-contained, headless golden-loop runner. It owns every temporary
 * process and directory so CI can run it repeatedly without sharing state.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await mkdtemp(
  path.join(os.tmpdir(), 'lantern-crm-golden-loop-')
);
const workspace = path.join(tempRoot, 'workspace');
const screenshots = path.join(tempRoot, 'screenshots');
const xvfbPidFile = path.join(tempRoot, 'xvfb.pid');
let vite;
let app;
let build;
let vitePort;
let bridgePort;
const ownedXvfbPids = new Set();
let tornDown = false;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const command = (file, args, options = {}) =>
  spawn(file, args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
    detached: true,
  });
const exitCode = (child) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(child.exitCode ?? 1);
  }
  return new Promise((resolve) => {
    child.once('error', () => resolve(1));
    child.once('exit', (code) => resolve(code ?? 1));
  });
};
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(0, '127.0.0.1', resolve)
  );
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === 'string')
    throw new Error('Could not reserve a local port.');
  return address.port;
}
async function waitFor(label, condition, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await condition()) return;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`
  );
}
async function httpReady(port, pathName = '/') {
  const response = await fetch(`http://127.0.0.1:${port}${pathName}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
async function stop(child, name) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  await Promise.race([exitCode(child), delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
    await exitCode(child);
  }
  console.log(`teardown: ${name} stopped`);
}
async function startApp() {
  app = command(
    'bash',
    ['scripts/crm-loop/launch-app.sh', String(bridgePort), workspace],
    {
      env: {
        LANTERN_VITE_PORT: String(vitePort),
        LANTERN_XVFB_DISPLAY: `:${bridgePort}`,
        LANTERN_XVFB_PID_FILE: xvfbPidFile,
        CRM_LOOP_WORKSPACE: workspace,
        CRM_LOOP_SCREENSHOTS_DIR: screenshots,
      },
    }
  );
  await waitFor('desktop bridge', () => httpReady(bridgePort, '/health'));
  await waitFor('owned virtual display', async () => {
    const pid = Number((await readFile(xvfbPidFile, 'utf8')).trim());
    if (!Number.isInteger(pid) || pid < 1) throw new Error('invalid Xvfb pid');
    ownedXvfbPids.add(pid);
    return true;
  });
}
async function runLoop(phase) {
  const child = command(
    'node',
    [
      'scripts/crm-loop/run-all.mjs',
      ...(phase === 'persistence' ? ['--verify-persisted'] : []),
    ],
    {
      env: {
        LANTERN_DEV_BRIDGE_PORT: String(bridgePort),
        DESKTOP_CDP_PORT: String(bridgePort),
        CRM_LOOP_WORKSPACE: workspace,
        CRM_LOOP_SCREENSHOTS_DIR: screenshots,
      },
    }
  );
  return exitCode(child);
}
async function ensureNoXvfb() {
  for (const pid of ownedXvfbPids) {
    try {
      process.kill(pid, 0);
    } catch {
      continue;
    }
    throw new Error(`Xvfb process ${pid} survived teardown.`);
  }
}
async function teardown() {
  if (tornDown) return;
  tornDown = true;
  await stop(app, 'desktop app');
  await stop(vite, 'Vite');
  await stop(build, 'debug-binary build');
  await ensureNoXvfb();
  await rm(tempRoot, { recursive: true, force: true });
  try {
    await stat(tempRoot);
    throw new Error(`Temporary directory survived teardown: ${tempRoot}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  console.log(
    'teardown: no owned app, Vite, Xvfb, debug build, or temporary workspace remains'
  );
}
function handleSignal() {
  process.exitCode = 128;
  void teardown()
    .catch((error) =>
      console.error(`teardown failed after signal: ${error.message}`)
    )
    .finally(() => process.exit(128));
}
process.once('SIGINT', handleSignal);
process.once('SIGTERM', handleSignal);

try {
  vitePort = await freePort();
  bridgePort = await freePort();
  if (vitePort === bridgePort) bridgePort = await freePort();
  console.log(
    `golden loop: vite=${vitePort} bridge=${bridgePort} workspace=${workspace}`
  );

  // The binary is always a normal debug binary. TAURI_CONFIG only gives this
  // isolated run its own dev-server address, so concurrent CI jobs never share
  // Vite's old fixed :5174 port.
  build = command(
    'cargo',
    ['build', '--manifest-path', 'src-tauri/Cargo.toml', '--locked'],
    {
      env: {
        TAURI_CONFIG: JSON.stringify({
          build: { devUrl: `http://127.0.0.1:${vitePort}` },
        }),
      },
    }
  );
  if (await exitCode(build))
    throw new Error('Could not build the debug desktop binary.');

  vite = command('npm', [
    'run',
    'dev',
    '--',
    '--host',
    '127.0.0.1',
    '--port',
    String(vitePort),
    '--strictPort',
  ]);
  await waitFor('Vite', () => httpReady(vitePort));

  await startApp();
  const writeCode = await runLoop('write');
  await stop(app, 'first desktop app');
  app = undefined;

  await startApp();
  const persistenceCode = await runLoop('persistence');
  if (writeCode || persistenceCode) {
    throw new Error(
      `golden loop failed (write=${writeCode}, persistence=${persistenceCode})`
    );
  }
  console.log('🟢 GOLDEN LOOP: app flows and restart persistence both passed.');
} finally {
  await teardown();
}
