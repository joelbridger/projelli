#!/usr/bin/env node
/** Focused contract coverage for the shell's canonical Vite readiness gate. */
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const realViteServer = path.join(root, 'scripts', 'golden-loop-vite-server.mjs');
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function executable(file, contents) {
  await writeFile(file, contents, { mode: 0o700 });
  await chmod(file, 0o700);
}

async function gone(pid) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { process.kill(pid, 0); } catch (error) {
      if (error.code === 'ESRCH') return true;
      throw error;
    }
    await pause(25);
  }
  return false;
}

async function runFixture(mode, { proxy = false, curlrc = false } = {}) {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'golden-loop-entry-readiness-'));
  const scripts = path.join(fixture, 'scripts');
  const bin = path.join(fixture, 'bin');
  const repo = path.join(fixture, 'repo');
  const tmp = path.join(fixture, 'tmp');
  const launcher = path.join(fixture, 'launcher.sh');
  const driver = path.join(fixture, 'driver.mjs');
  const app = path.join(fixture, 'app');
  const launches = path.join(fixture, 'launches');
  const readyMoment = path.join(fixture, 'ready-moment');
  const serverPid = path.join(fixture, 'server-pid');
  const verifyCount = path.join(fixture, 'verify-count');
  const curlHome = path.join(fixture, 'curl-home');
  await Promise.all([
    mkdir(path.join(repo, 'src-tauri'), { recursive: true }), mkdir(path.join(repo, 'node_modules'), { recursive: true }),
    mkdir(scripts), mkdir(bin), mkdir(tmp), mkdir(curlHome),
  ]);
  for (const name of ['golden-loop.sh', 'write-golden-loop-diagnostic.mjs', 'golden-loop-diagnostics.mjs']) {
    await cp(path.join(root, 'scripts', name), path.join(scripts, name));
  }
  await chmod(path.join(scripts, 'golden-loop.sh'), 0o700);
  if (curlrc) await writeFile(path.join(curlHome, '.curlrc'), 'location\n');
  await writeFile(path.join(repo, 'src-tauri', 'tauri.conf.json'), JSON.stringify({
    build: { devUrl: 'http://127.0.0.1:4173/ignored?query#fragment' },
  }));
  await executable(path.join(bin, 'git'), `#!/usr/bin/env bash
case " $* " in
  *" rev-parse HEAD "*) echo 0123456789012345678901234567890123456789 ;;
  *" status --porcelain "*) exit 0 ;;
  *) exit 2 ;;
esac
`);
  await executable(path.join(bin, 'curl'), `#!/usr/bin/env bash
url="\${!#}"
[[ "$url" == *health* ]] && exit 0
exit 1
`);
  await executable(launcher, `#!/usr/bin/env bash
set -euo pipefail
[[ -f "$GOLDEN_LOOP_TEST_READY_MOMENT" ]] || exit 91
printf '%s\n' "$(date +%s%N)" >>"$GOLDEN_LOOP_TEST_LAUNCHES"
setsid sleep 30 >/dev/null 2>&1 &
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
  await writeFile(path.join(scripts, 'golden-loop-vite-server.mjs'), `
import { readFileSync, writeFileSync, statSync, realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { verifyReadyFile } from ${JSON.stringify(pathToFileURL(realViteServer).href)};
const args = process.argv.slice(2);
if (args[0] === '--verify-ready') {
  let count = 0;
  try { count = Number(readFileSync(process.env.GOLDEN_LOOP_TEST_VERIFY_COUNT, 'utf8')); } catch {}
  count += 1; writeFileSync(process.env.GOLDEN_LOOP_TEST_VERIFY_COUNT, String(count));
  if (process.env.GOLDEN_LOOP_TEST_MODE === 'changed' && count === 2) {
    writeFileSync(args[1], readFileSync(args[1], 'utf8') + '\\n');
  }
  const digest = await verifyReadyFile({ readyFile: args[1], sourceRoot: args[2], host: args[3], port: args[4], cacheDir: args[5], serverPid: args[6] });
  process.stdout.write(digest + '\\n');
} else {
  const [sourceRoot, host, port, cacheDir] = args;
  writeFileSync(process.env.GOLDEN_LOOP_TEST_SERVER_PID, String(process.pid));
  const mode = process.env.GOLDEN_LOOP_TEST_MODE;
  if (mode === 'server-exit') process.exit(9);
  if (mode === 'delayed') await new Promise((resolve) => setTimeout(resolve, 500));
  const identity = (value) => { const resolved = realpathSync(value); const info = statSync(resolved, { bigint: true }); return { path: resolved, device: String(info.dev), inode: String(info.ino) }; };
  const source = identity(sourceRoot); const cache = identity(cacheDir);
  const raw = readFileSync('/proc/self/stat', 'utf8');
  const fields = raw.slice(raw.lastIndexOf(') ') + 2).trim().split(/\\s+/);
  const record = { schema: 1, kind: 'lantern-golden-loop-vite-ready', origin: 'http://' + host + ':' + port,
    sourceRoot: source.path, sourceDevice: source.device, sourceInode: source.inode,
    cacheDir: cache.path, cacheDevice: cache.device, cacheInode: cache.inode,
    serverPid: process.pid, serverStartTime: fields[19] };
  if (mode === 'wrong-origin') record.origin = 'http://127.0.0.1:4999';
  if (mode === 'wrong-root') record.sourceRoot += '-other';
  if (mode === 'wrong-cache') record.cacheDir += '-other';
  if (mode === 'stale') record.serverStartTime = String(Number(record.serverStartTime) + 1);
  let line = JSON.stringify(record);
  if (mode === 'malformed') line = '{bad-json';
  if (mode === 'reordered') line = JSON.stringify({ kind: record.kind, schema: record.schema, ...Object.fromEntries(Object.entries(record).slice(2)) });
  if (mode !== 'absent') {
    writeFileSync(process.env.GOLDEN_LOOP_TEST_READY_MOMENT, String(Date.now()));
    process.stdout.write(line + '\\n' + (mode === 'duplicate' ? line + '\\n' : ''));
  }
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => {}, 1_000);
}
`);

  let outcome;
  try {
    outcome = await execFile('bash', [path.join(scripts, 'golden-loop.sh'), repo, app], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        TMPDIR: tmp,
        GOLDEN_LOOP_LAUNCHER: launcher,
        GOLDEN_LOOP_DRIVER: driver,
        GOLDEN_LOOP_TIMEOUT_SECONDS: '2',
        GOLDEN_LOOP_TEST_MODE: mode,
        GOLDEN_LOOP_TEST_LAUNCHES: launches,
        GOLDEN_LOOP_TEST_READY_MOMENT: readyMoment,
        GOLDEN_LOOP_TEST_SERVER_PID: serverPid,
        GOLDEN_LOOP_TEST_VERIFY_COUNT: verifyCount,
        ...(curlrc ? { CURL_HOME: curlHome } : {}),
        ...(proxy ? {
          http_proxy: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1',
          https_proxy: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1',
          no_proxy: '', NO_PROXY: '',
        } : {}),
      },
      timeout: 12_000,
    });
  } catch (error) { outcome = error; }
  const launchLog = await readFile(launches, 'utf8').catch(() => '');
  const pid = Number(await readFile(serverPid, 'utf8').catch(() => ''));
  const stopped = Number.isSafeInteger(pid) && pid > 0 ? await gone(pid) : mode === 'server-exit';
  await rm(fixture, { recursive: true, force: true });
  return { outcome, launchLog, stopped };
}

for (const options of [{}, { proxy: true }, { curlrc: true }]) {
  test(`one exact readiness record reaches launch (${JSON.stringify(options)})`, async () => {
    const result = await runFixture('ready', options);
    assert.equal(result.outcome.code ?? 0, 0, String(result.outcome.stderr));
    assert.match(result.launchLog, /^[0-9]+/);
    assert.equal(result.stopped, true);
  });
}

test('a delayed readiness record cannot reach the native-launch seam early', async () => {
  const started = Date.now();
  const result = await runFixture('delayed');
  assert.equal(result.outcome.code ?? 0, 0, String(result.outcome.stderr));
  assert.ok(Date.now() - started >= 500);
  assert.match(result.launchLog, /^[0-9]+/);
});

for (const mode of ['absent', 'malformed', 'duplicate', 'reordered', 'stale', 'wrong-origin', 'wrong-root', 'wrong-cache', 'changed', 'server-exit']) {
  test(`${mode} readiness fails closed before native launch`, async () => {
    const result = await runFixture(mode);
    assert.notEqual(result.outcome.code, 0);
    assert.equal(result.launchLog, '');
    assert.equal(result.stopped, true);
  });
}
