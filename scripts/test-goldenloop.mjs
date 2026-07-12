#!/usr/bin/env node
/**
 * Self-contained, headless golden-loop runner. It owns every temporary
 * process and directory so CI can run it repeatedly without sharing state.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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
let sidecarFetch;
let vitePort;
let bridgePort;
let displayNumber;
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
    let settled = false;
    const done = (code) => {
      if (settled) return;
      settled = true;
      clearInterval(checkExit);
      resolve(code ?? 1);
    };
    const checkExit = setInterval(() => {
      if (child.exitCode !== null || child.signalCode !== null) {
        done(child.exitCode ?? 1);
      }
    }, 100);
    child.once('error', () => done(1));
    child.once('exit', done);
    child.once('close', done);
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
function freeDisplay(nearPort) {
  for (let offset = 0; offset < 800; offset += 1) {
    const candidate = 100 + ((nearPort + offset) % 800);
    if (!existsSync(`/tmp/.X11-unix/X${candidate}`)) return candidate;
  }
  throw new Error('Could not find an unused Xvfb display number.');
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
  return true;
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
        LANTERN_XVFB_DISPLAY: `:${displayNumber}`,
        LANTERN_XVFB_PID_FILE: xvfbPidFile,
        CRM_LOOP_WORKSPACE: workspace,
        CRM_LOOP_SCREENSHOTS_DIR: screenshots,
        // Always own a fresh virtual screen, even from an interactive shell.
        DISPLAY: '',
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
  await stop(sidecarFetch, 'Piper sidecar download');
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
  displayNumber = freeDisplay(bridgePort);
  console.log(
    `golden loop: vite=${vitePort} bridge=${bridgePort} display=:${displayNumber} workspace=${workspace}`
  );

  // Fresh worktrees omit this ignored runtime asset. Stage it automatically
  // so a clean CI machine does not need a person to prepare the app first.
  const binaries = path.join(root, 'src-tauri/binaries');
  const piper = path.join(binaries, 'piper-x86_64-unknown-linux-gnu');
  const llamaServer = path.join(
    binaries,
    'llama-server-x86_64-unknown-linux-gnu'
  );
  if (!existsSync(piper)) {
    sidecarFetch = command('bash', ['scripts/fetch-piper-sidecar.sh'], {
      env: { FETCH_PIPER_VOICE: '0' },
    });
    if (await exitCode(sidecarFetch)) {
      throw new Error(
        'Could not stage the Piper runtime required by the debug binary.'
      );
    }
  }
  if (!existsSync(llamaServer)) {
    sidecarFetch = command('bash', ['scripts/fetch-llama-sidecar.sh']);
    if (await exitCode(sidecarFetch)) {
      throw new Error(
        'Could not stage the local-AI runtime required by the debug binary.'
      );
    }
  }

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
  // `predev` may need to fetch the pinned OCR asset in a brand-new checkout.
  // Wait for the server's real HTTP response rather than assuming a startup
  // delay or racing the one-time preparation work.
  await waitFor('Vite', () => httpReady(vitePort), 120_000);

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
