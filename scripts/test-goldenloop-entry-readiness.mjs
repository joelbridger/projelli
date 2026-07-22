#!/usr/bin/env node
/** Focused contract coverage for the real golden-loop entry readiness gate. */
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const controller = path.join(root, 'scripts', 'golden-loop.sh');
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function executable(file, contents) {
  await writeFile(file, contents, { mode: 0o700 });
  await chmod(file, 0o700);
}

async function gone(pid) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return true;
      throw error;
    }
    await pause(50);
  }
  return false;
}

async function runFixture(mode, { proxy = false, curlrc = false } = {}) {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'golden-loop-entry-readiness-'));
  const bin = path.join(fixture, 'bin');
  const repo = path.join(fixture, 'repo');
  const tmp = path.join(fixture, 'tmp');
  const server = path.join(fixture, 'screen-server.mjs');
  const launcher = path.join(fixture, 'launcher.sh');
  const driver = path.join(fixture, 'driver.mjs');
  const app = path.join(fixture, 'app');
  const requests = path.join(fixture, 'requests.jsonl');
  const serverPid = path.join(fixture, 'screen-server.pid');
  const launches = path.join(fixture, 'launches');
  const proxyRequests = path.join(fixture, 'proxy-requests.jsonl');
  const curlHome = path.join(fixture, 'curl-home');
  const port = await freePort();
  const lowerProxyPort = await freePort();
  const upperProxyPort = await freePort();

  await mkdir(path.join(repo, 'src-tauri'), { recursive: true });
  await mkdir(path.join(repo, 'node_modules'));
  await mkdir(bin);
  await mkdir(tmp);
  await mkdir(curlHome);
  if (curlrc) await writeFile(path.join(curlHome, '.curlrc'), 'location\n');
  await writeFile(path.join(repo, 'src-tauri', 'tauri.conf.json'), JSON.stringify({
    build: { devUrl: `http://localhost:${port}/ignored-by-entry-check?old=query#old-hash` },
  }));
  await writeFile(server, `
import { appendFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
const [mode, port, requestFile, pidFile] = process.argv.slice(2);
writeFileSync(pidFile, String(process.pid));
http.createServer((request, response) => {
  appendFileSync(requestFile, JSON.stringify({ host: request.headers.host, url: request.url }) + '\\n');
  if (request.url === '/src/main.tsx') {
    if (mode === 'hang') return;
    if (mode === 'redirect') { response.writeHead(302, { location: 'http://outside.invalid/not-allowed.tsx' }); response.end(); return; }
    if (mode === 'redirect-local') { response.writeHead(302, { location: '/redirect-target.tsx' }); response.end(); return; }
    if (['300', '302', '304'].includes(mode)) { response.writeHead(Number(mode)); response.end(); return; }
    response.writeHead(200, { 'content-type': 'application/javascript' }); response.end('export {};'); return;
  }
  if (request.url === '/redirect-target.tsx') {
    response.writeHead(200, { 'content-type': 'application/javascript' }); response.end('export {};'); return;
  }
  response.writeHead(200, { 'content-type': 'text/html' }); response.end('<div id="root"></div>');
}).listen(Number(port), '127.0.0.1');
`);
  const proxyServer = async (proxyPort) => {
    let requestCount = 0;
    const proxy = createHttpServer((request, response) => {
      requestCount += 1;
      appendFileSync(proxyRequests, JSON.stringify({ port: proxyPort, url: request.url }) + '\n');
      setTimeout(() => {
        if (requestCount === 1) {
          response.writeHead(503);
          response.end();
        } else {
          response.writeHead(200, { 'content-type': 'application/javascript' });
          response.end('export {};');
        }
      }, 250);
    });
    await new Promise((resolve, reject) => proxy.once('error', reject).listen(proxyPort, '127.0.0.1', resolve));
    return proxy;
  };
  let lowerProxy;
  let upperProxy;
  if (proxy) {
    lowerProxy = await proxyServer(lowerProxyPort);
    upperProxy = await proxyServer(upperProxyPort);
  }
  await executable(path.join(bin, 'git'), `#!/usr/bin/env bash
case " $* " in
  *" rev-parse HEAD "*) echo 0123456789012345678901234567890123456789 ;;
  *" status --porcelain "*) exit 0 ;;
  *) exit 2 ;;
esac
`);
  await executable(path.join(bin, 'npm'), `#!/usr/bin/env bash
exec node "$GOLDEN_LOOP_TEST_SERVER" "$GOLDEN_LOOP_TEST_MODE" "$GOLDEN_LOOP_TEST_PORT" "$GOLDEN_LOOP_TEST_REQUESTS" "$GOLDEN_LOOP_TEST_SERVER_PID"
`);
  await executable(launcher, `#!/usr/bin/env bash
set -euo pipefail
printf 'launch\\n' >>"$GOLDEN_LOOP_TEST_LAUNCHES"
setsid node -e 'require("node:http").createServer((_, response) => response.end("ok")).listen(Number(process.argv[1]), "127.0.0.1")' "$1" >/dev/null 2>&1 &
echo $! >"$LANTERN_APP_PID_FILE"
`);
  await executable(driver, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const progress = process.env.GOLDEN_LOOP_DRIVER_PROGRESS_FILE;
writeFileSync(progress, 'renderer-ready\\n');
writeFileSync(progress + '.1', 'later-driver\\n');
writeFileSync(progress + '.2', 'later-driver\\n');
`);
  await executable(app, '#!/usr/bin/env bash\nexit 0\n');

  let outcome;
  try {
    outcome = await execFile('bash', [controller, repo, app], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        TMPDIR: tmp,
        GOLDEN_LOOP_LAUNCHER: launcher,
        GOLDEN_LOOP_DRIVER: driver,
        GOLDEN_LOOP_TIMEOUT_SECONDS: '2',
        GOLDEN_LOOP_TEST_MODE: mode,
        GOLDEN_LOOP_TEST_PORT: String(port),
        GOLDEN_LOOP_TEST_SERVER: server,
        GOLDEN_LOOP_TEST_REQUESTS: requests,
        GOLDEN_LOOP_TEST_SERVER_PID: serverPid,
        GOLDEN_LOOP_TEST_LAUNCHES: launches,
        ...(curlrc ? { CURL_HOME: curlHome } : {}),
        ...(proxy ? {
          http_proxy: `http://127.0.0.1:${lowerProxyPort}`,
          HTTP_PROXY: `http://127.0.0.1:${upperProxyPort}`,
          https_proxy: `http://127.0.0.1:${lowerProxyPort}`,
          HTTPS_PROXY: `http://127.0.0.1:${upperProxyPort}`,
          no_proxy: '',
          NO_PROXY: '',
        } : {}),
      },
      timeout: 12_000,
    });
  } catch (error) {
    outcome = error;
  }
  const requestLog = (await readFile(requests, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const launchLog = await readFile(launches, 'utf8').catch(() => '');
  const proxyLog = (await readFile(proxyRequests, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const vitePid = Number(await readFile(serverPid, 'utf8').catch(() => ''));
  const viteStopped = Number.isSafeInteger(vitePid) && vitePid > 0 ? await gone(vitePid) : false;
  await Promise.all([lowerProxy?.close(), upperProxy?.close()].filter(Boolean).map((server) => new Promise((resolve) => server.close(resolve))));
  await rm(fixture, { recursive: true, force: true });
  return { outcome, requestLog, launchLog, proxyLog, port, viteStopped };
}

test('index and its fixed entry module both being 2xx reaches the real launcher seam', async () => {
  const result = await runFixture('ready');
  assert.equal(result.outcome.code ?? 0, 0, String(result.outcome.stderr));
  assert.match(result.launchLog, /launch/);
  assert.equal(result.viteStopped, true);
});

test('a hanging entry fails within the bounded Vite phase before launch and reaps its server', async () => {
  const started = Date.now();
  const result = await runFixture('hang');
  assert.notEqual(result.outcome.code, 0);
  assert.match(String(result.outcome.stderr), /timed out waiting for the matching app entry module/);
  assert.equal(result.launchLog, '');
  assert.equal(result.viteStopped, true);
  assert.ok(Date.now() - started < 10_000);
});

test('a redirected entry fails before launch without following the redirect', async () => {
  const result = await runFixture('redirect');
  assert.notEqual(result.outcome.code, 0);
  assert.match(String(result.outcome.stderr), /timed out waiting for the matching app entry module/);
  assert.equal(result.launchLog, '');
  assert.equal(result.viteStopped, true);
  assert.equal(result.requestLog.some(({ url }) => url.includes('not-allowed')), false);
});

test('a .curlrc that enables redirects cannot change the entry decision', async () => {
  const result = await runFixture('redirect-local', { curlrc: true });
  assert.notEqual(result.outcome.code, 0);
  assert.match(String(result.outcome.stderr), /timed out waiting for the matching app entry module/);
  assert.equal(result.launchLog, '');
  assert.equal(result.viteStopped, true);
  assert.equal(result.requestLog.some(({ url }) => url === '/redirect-target.tsx'), false);
});

for (const status of ['300', '302', '304']) {
  test(`an entry response of ${status} without Location fails before launch`, async () => {
    const result = await runFixture(status);
    assert.notEqual(result.outcome.code, 0);
    assert.match(String(result.outcome.stderr), /timed out waiting for the matching app entry module/);
    assert.equal(result.launchLog, '');
    assert.equal(result.viteStopped, true);
  });
}

test('hostile proxy variables cannot answer readiness; only the actual loopback 2xx launches', async () => {
  const result = await runFixture('ready', { proxy: true });
  assert.equal(result.outcome.code ?? 0, 0, String(result.outcome.stderr));
  assert.match(result.launchLog, /launch/);
  assert.equal(result.proxyLog.some(({ url }) => url.includes('/src/main.tsx')), false);
  assert.ok(result.requestLog.some(({ url }) => url === '/src/main.tsx'));
  assert.equal(result.viteStopped, true);
});

test('entry readiness requests only /src/main.tsx on the validated loopback origin', async () => {
  const result = await runFixture('ready');
  assert.equal(result.outcome.code ?? 0, 0, String(result.outcome.stderr));
  const entryRequests = result.requestLog.filter(({ url }) => url === '/src/main.tsx');
  assert.ok(entryRequests.length >= 1);
  assert.equal(result.requestLog.every(({ host }) => host === `localhost:${result.port}`), true);
  assert.deepEqual([...new Set(result.requestLog.map(({ url }) => url))].sort(), [
    '/ignored-by-entry-check?old=query',
    '/src/main.tsx',
  ]);
});
