#!/usr/bin/env node
/**
 * Golden-loop-only Vite server. Readiness is a canonical, process-bound record
 * emitted only after the real entry graph has been warmed and Vite is idle.
 */
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open, lstat, realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const READY_KIND = 'lantern-golden-loop-vite-ready';
export const READY_SCHEMA = 1;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);
const REQUEST_TIMEOUT_MS = 3_000;
const MAX_READY_BYTES = 4_096;
const MAX_PATH_BYTES = 4_096;

function fail(message) {
  throw new Error(`golden-loop Vite server: ${message}`);
}

function parsePort(value) {
  if (!/^[1-9][0-9]{0,4}$/.test(value ?? '')) fail('port must be a canonical decimal value');
  const port = Number(value);
  if (port > 65_535 || String(port) !== value) fail('port is outside the allowed range');
  return port;
}

async function directoryIdentity(value, label) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_PATH_BYTES
    || !path.isAbsolute(value) || value.includes('\0')) {
    fail(`${label} must be an absolute path`);
  }
  const linkInfo = await lstat(value).catch(() => fail(`${label} does not exist`));
  if (!linkInfo.isDirectory() || linkInfo.isSymbolicLink()) fail(`${label} must be a real directory`);
  const canonical = await realpath(value);
  if (canonical !== path.normalize(value)) fail(`${label} must already be canonical`);
  const info = await stat(canonical, { bigint: true });
  return { path: canonical, device: String(info.dev), inode: String(info.ino) };
}

function processStartTime(pid = process.pid) {
  return import('node:fs').then(({ readFileSync }) => {
    const raw = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = raw.slice(raw.lastIndexOf(') ') + 2).trim().split(/\s+/);
    if (fields[0] === 'Z') fail('Vite process is no longer live');
    if (!/^[0-9]+$/.test(fields[19] ?? '')) fail('could not bind the Vite process start time');
    return fields[19];
  });
}

export async function validateControlInputs({ sourceRoot, host, port: portValue, cacheDir }) {
  if (!LOOPBACK_HOSTS.has(host)) fail('host must be an approved loopback name');
  const port = typeof portValue === 'number' ? parsePort(String(portValue)) : parsePort(portValue);
  const source = await directoryIdentity(sourceRoot, 'source root');
  const cache = await directoryIdentity(cacheDir, 'cache directory');
  const cacheParent = path.dirname(cache.path);
  const parentInfo = await lstat(cacheParent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()
    || !/^lantern-golden-loop\.[A-Za-z0-9_-]+$/.test(path.basename(cacheParent))
    || path.basename(cache.path) !== 'vite-cache') {
    fail('cache directory is not the fixed child of a golden-loop temporary root');
  }
  if (source.path === cache.path || cache.path.startsWith(`${source.path}${path.sep}`)) {
    fail('cache directory must be isolated from the source tree');
  }
  return { source, cache, host, port, origin: `http://${host}:${port}` };
}

function createClosedLogger(onError) {
  let errored = false;
  const error = () => {
    errored = true;
    onError();
  };
  return {
    info() {}, warn() {}, warnOnce() {}, clearScreen() {},
    error, errorOnce: error,
    hasWarned: false,
    hasErrorLogged: () => errored,
  };
}

async function directStatus(origin, pathname) {
  const url = new URL(pathname, origin);
  if (url.origin !== origin || url.protocol !== 'http:' || url.pathname !== pathname || url.search || url.hash) {
    fail('direct probe escaped the fixed loopback origin');
  }
  return await new Promise((resolve, reject) => {
    const request = http.request({
      protocol: 'http:', hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'GET', agent: false, timeout: REQUEST_TIMEOUT_MS,
      headers: { connection: 'close' },
    }, (response) => {
      const statusCode = response.statusCode ?? 0;
      const redirected = statusCode >= 300 && statusCode < 400;
      response.resume();
      response.once('end', () => {
        if (redirected || response.headers.location || statusCode < 200 || statusCode >= 300) {
          reject(new Error(`probe refused status ${statusCode}`));
        } else {
          resolve(statusCode);
        }
      });
    });
    request.once('timeout', () => request.destroy(new Error('probe timed out')));
    request.once('error', reject);
    request.end();
  });
}

async function optimizerPromises(environment) {
  const optimizer = environment.depsOptimizer;
  if (!optimizer) return [];
  await optimizer.init();
  if (optimizer.scanProcessing) await optimizer.scanProcessing;
  const metadata = optimizer.metadata;
  return [...Object.values(metadata.optimized ?? {}), ...Object.values(metadata.discovered ?? {})]
    .map((entry) => entry.processing)
    .filter((processing) => processing && typeof processing.then === 'function');
}

async function settleVite(server) {
  const environment = server.environments.client;
  const first = await optimizerPromises(environment);
  await environment.waitForRequestsIdle();
  await Promise.all(first);
  const second = await optimizerPromises(environment);
  await Promise.all(second);
  await environment.waitForRequestsIdle();
}

async function warmRequiredModule(server, url, state) {
  await server.warmupRequest(url);
  if (state.viteError) fail(`Vite reported an error while warming ${url}`);
  const transformed = await server.environments.client.transformRequest(url);
  if (!transformed || typeof transformed.code !== 'string') fail(`Vite could not transform ${url}`);
}

export function canonicalReadyRecord({ control, serverPid, serverStartTime }) {
  return {
    schema: READY_SCHEMA,
    kind: READY_KIND,
    origin: control.origin,
    sourceRoot: control.source.path,
    sourceDevice: control.source.device,
    sourceInode: control.source.inode,
    cacheDir: control.cache.path,
    cacheDevice: control.cache.device,
    cacheInode: control.cache.inode,
    serverPid,
    serverStartTime,
  };
}

export async function startGoldenLoopVite(options) {
  const control = await validateControlInputs(options);
  const state = { stopping: false, viteError: false, ready: false, closed: false, shutdownError: false };
  let server;
  let ownedHttpServer;
  let closePromise;
  const shutdown = async ({ failed = false } = {}) => {
    state.stopping = true;
    state.ready = false;
    if (failed) state.shutdownError = true;
    if (closePromise) return closePromise;
    closePromise = (async () => {
      if (!server || state.closed) return;
      try { await settleVite(server); } catch { state.shutdownError = true; }
      if (ownedHttpServer?.listening) {
        await new Promise((resolve, reject) => ownedHttpServer.close((error) => error ? reject(error) : resolve()));
      }
      await server.close();
      state.closed = true;
    })();
    return closePromise;
  };
  const logger = createClosedLogger(() => {
    state.viteError = true;
    state.ready = false;
    options.onInvalidate?.();
    if (server) void shutdown({ failed: true }).catch(() => { state.shutdownError = true; });
  });

  try {
    const { createServer } = await import('vite');
    server = await createServer({
      configFile: path.join(control.source.path, 'vite.config.ts'),
      root: control.source.path,
      cacheDir: control.cache.path,
      customLogger: logger,
      clearScreen: false,
      server: {
        host: control.host,
        port: control.port,
        strictPort: true,
        open: false,
        https: false,
        middlewareMode: true,
      },
    });
    ownedHttpServer = http.createServer(server.middlewares);
    await new Promise((resolve, reject) => {
      const onError = (error) => { ownedHttpServer.off('listening', onListening); reject(error); };
      const onListening = () => { ownedHttpServer.off('error', onError); resolve(); };
      ownedHttpServer.once('error', onError);
      ownedHttpServer.once('listening', onListening);
      ownedHttpServer.listen(control.port, control.host);
    });
    ownedHttpServer.on('error', () => logger.error());
    server.watcher.on('error', () => logger.error());
    if (state.stopping || state.viteError) fail('startup was stopped before warmup');
    await server.environments.client.depsOptimizer?.init();
    await warmRequiredModule(server, '/src/main.tsx', state);
    await warmRequiredModule(server, '/src/App.tsx', state);
    for (const file of server.config.server.warmup?.clientFiles ?? []) {
      await warmRequiredModule(server, file.startsWith('/') ? file : `/${file.replace(/^\.\//, '')}`, state);
    }
    await settleVite(server);
    await directStatus(control.origin, '/');
    await directStatus(control.origin, '/src/main.tsx');
    await settleVite(server);
    if (state.stopping || state.viteError) fail('startup did not remain healthy through quiescence');
    const record = canonicalReadyRecord({
      control,
      serverPid: process.pid,
      serverStartTime: await processStartTime(),
    });
    state.ready = true;
    return { server, httpServer: ownedHttpServer, state, record, line: `${JSON.stringify(record)}\n`, shutdown };
  } catch (error) {
    try { await shutdown({ failed: true }); } catch { state.shutdownError = true; }
    throw error;
  }
}

export async function verifyReadyFile({ readyFile, sourceRoot, host, port, cacheDir, serverPid }) {
  const control = await validateControlInputs({ sourceRoot, host, port, cacheDir });
  const readyInfo = await lstat(readyFile).catch(() => fail('readiness record is missing'));
  if (!readyInfo.isFile() || readyInfo.isSymbolicLink() || readyInfo.size < 2 || readyInfo.size > MAX_READY_BYTES) {
    fail('readiness record is not one bounded regular file');
  }
  const handle = await open(readyFile, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  let contents;
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== BigInt(readyInfo.dev) || opened.ino !== BigInt(readyInfo.ino)
      || opened.size !== BigInt(readyInfo.size)) fail('readiness record changed while opening');
    contents = await handle.readFile({ encoding: 'utf8' });
    const after = await handle.stat({ bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) {
      fail('readiness record changed while reading');
    }
  } finally { await handle.close(); }
  const pid = Number(serverPid);
  if (!Number.isSafeInteger(pid) || pid < 1 || String(pid) !== String(serverPid)) fail('server pid is invalid');
  const expected = canonicalReadyRecord({ control, serverPid: pid, serverStartTime: await processStartTime(pid) });
  const canonical = `${JSON.stringify(expected)}\n`;
  if (contents !== canonical) fail('readiness record is malformed, stale, reordered, duplicated, or mismatched');
  return createHash('sha256').update(contents).digest('hex');
}

async function runCli() {
  if (process.argv[2] === '--verify-ready') {
    if (process.argv.length !== 9) fail('invalid readiness verification arguments');
    const digest = await verifyReadyFile({
      readyFile: process.argv[3], sourceRoot: process.argv[4], host: process.argv[5],
      port: process.argv[6], cacheDir: process.argv[7], serverPid: process.argv[8],
    });
    process.stdout.write(`${digest}\n`);
    return;
  }
  if (process.argv.length !== 6) fail('usage: golden-loop-vite-server.mjs <source-root> <host> <port> <cache-dir>');
  let lifecycle;
  let stopping = false;
  let signalCount = 0;
  let readyEmitted = false;
  const revokeReadiness = () => {
    if (readyEmitted) process.stdout.write('\n');
    readyEmitted = false;
  };
  const onSignal = () => {
    signalCount += 1;
    if (signalCount > 1) process.exitCode = 1;
    stopping = true;
    revokeReadiness();
    void lifecycle?.shutdown({ failed: signalCount > 1 }).then(() => {
      if (lifecycle.state.shutdownError) process.exitCode = 1;
    }).catch(() => { process.exitCode = 1; });
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
  const fatal = () => {
    process.exitCode = 1;
    stopping = true;
    revokeReadiness();
    void lifecycle?.shutdown({ failed: true }).catch(() => { process.exitCode = 1; });
  };
  process.once('unhandledRejection', fatal);
  process.once('uncaughtException', fatal);
  lifecycle = await startGoldenLoopVite({
    sourceRoot: process.argv[2], host: process.argv[3], port: process.argv[4], cacheDir: process.argv[5],
    onInvalidate: revokeReadiness,
  });
  if (stopping || !lifecycle.state.ready) {
    await lifecycle.shutdown({ failed: true });
    return;
  }
  process.stdout.write(lifecycle.line);
  readyEmitted = true;
  await new Promise((resolve) => {
    const wait = setInterval(() => {
      if (lifecycle.state.closed) { clearInterval(wait); resolve(); }
    }, 20);
    wait.unref();
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runCli().catch((error) => {
    process.exitCode = 1;
    process.stderr.write(`${error?.message?.startsWith('golden-loop Vite server:') ? error.message : 'golden-loop Vite server: startup failed'}\n`);
  });
}
