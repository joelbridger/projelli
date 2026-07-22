import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { promisify } from 'node:util';
import { classifyDiagnostic, safeArtifact, writeDiagnosticArtifact } from '../golden-loop-diagnostics.mjs';

const execFileAsync = promisify(execFile);

const testDirectory = () => path.join(os.tmpdir(), `golden-loop-diagnostic-test-${process.pid}-${Date.now()}`);

async function installedRecorder(fetchImpl = async () => ({ status: 200 })) {
  const source = await readFile(new URL('../../src-tauri/src/dev_bridge.rs', import.meta.url), 'utf8');
  const script = source.match(/Some\(r#"([\s\S]*?)"#\.to_string\(\)\)/)?.[1];
  assert.ok(script, 'could not extract the installed initialization script');
  const listeners = new Map();
  const window = {
    location: { href: 'https://client-records.example/Clients/Jane-Doe/Plan.docx?token=secret#fragment' },
    addEventListener(type, listener) { listeners.set(type, listener); },
    console: undefined,
  };
  const console = { error() {} };
  window.fetch = fetchImpl;
  vm.runInNewContext(script, { window, console, URL });
  return { window, listeners, console };
}

test('installed early recorder preserves the browser fetch receiver', async () => {
  let window;
  const receiverSensitiveFetch = function () {
    if (this !== window) throw new TypeError('Illegal invocation');
    return Promise.resolve({ status: 200 });
  };
  ({ window } = await installedRecorder(receiverSensitiveFetch));

  const response = await window.fetch('/src/main.tsx');
  assert.equal(response.status, 200);
});

test('installed early recorder retains only categories, safe locations, and HTTP status', async () => {
  const { window, listeners, console } = await installedRecorder();
  const secret = 'Bearer very-secret-client-content';
  listeners.get('error')({ target: window, message: `Failed to import ${secret}`, filename: 'https://client-records.example/src/Jane-Doe/Plan.tsx?token=bad#x' });
  listeners.get('error')({ target: window, message: secret, error: { name: 'TypeError' }, filename: 'https://outside.example/client@example.test/Plan.docx?token=bad' });
  console.error(secret);
  listeners.get('unhandledrejection')({ reason: new Error(secret) });
  listeners.get('error')({ target: { tagName: 'SCRIPT', src: 'https://cdn.test/client-token.js?secret=bad' } });
  window.fetch = async () => { throw new Error(secret); };
  // Re-install with the failing fetch so the actual wrapper executes its reject path.
  const rejected = await installedRecorder();
  rejected.window.fetch = async () => { throw new Error(secret); };
  vm.runInNewContext((await readFile(new URL('../../src-tauri/src/dev_bridge.rs', import.meta.url), 'utf8')).match(/Some\(r#"([\s\S]*?)"#\.to_string\(\)\)/)[1], { window: rejected.window, console: rejected.console, URL });
  await assert.rejects(rejected.window.fetch('https://api.test/client?token=bad'));
  const http = await installedRecorder();
  http.window.fetch = async () => ({ status: 404 });
  vm.runInNewContext((await readFile(new URL('../../src-tauri/src/dev_bridge.rs', import.meta.url), 'utf8')).match(/Some\(r#"([\s\S]*?)"#\.to_string\(\)\)/)[1], { window: http.window, console: http.console, URL });
  await http.window.fetch('https://api.test/client?token=bad');
  const http500 = await installedRecorder();
  http500.window.fetch = async () => ({ status: 500 });
  vm.runInNewContext((await readFile(new URL('../../src-tauri/src/dev_bridge.rs', import.meta.url), 'utf8')).match(/Some\(r#"([\s\S]*?)"#\.to_string\(\)\)/)[1], { window: http500.window, console: http500.console, URL });
  await http500.window.fetch('https://api.test/client?token=bad');

  const directory = testDirectory();
  try {
    await mkdir(directory, { mode: 0o777 });
    await chmod(directory, 0o777);
    const result = await writeDiagnosticArtifact({
      phase: 'write',
      renderer: { url: window.location.href, pageUrl: 'http://localhost:5174/', rootPresent: true, rootHasChildren: false, dom: { elementCount: 12, tags: ['div', 'script', 'client-secret'] } },
      events: {
        ...window.__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__,
        pageErrors: [...window.__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__.pageErrors, { category: 'console-error', location: 'https://client@example.test/Secret.docx' }],
        consoleErrors: [{ category: 'forged-client-category', location: 'https://client@example.test/Secret.docx' }],
        unhandledRejections: [{ category: 'type-error', location: 'https://client@example.test/Secret.docx' }],
        resourceFailures: [{ category: 'http-response-failure', location: 'https://client@example.test/Secret.docx' }],
        networkFailures: [...rejected.window.__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__.networkFailures, ...http.window.__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__.networkFailures, ...http500.window.__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__.networkFailures],
      },
    }, directory);
    const encoded = await readFile(result.path, 'utf8');
    const saved = JSON.parse(encoded);
    assert.deepEqual({ sameOrigin: saved.renderer.sameOrigin, locationClass: saved.renderer.locationClass }, { sameOrigin: false, locationClass: 'other' });
    assert.equal(saved.classification, 'javascript-module-import-error');
    assert.deepEqual(saved.events.networkFailures.map(({ category, status }) => ({ category, status })), [
      { category: 'fetch-rejected', status: undefined },
      { category: 'http-response-failure', status: 404 },
      { category: 'http-response-failure', status: 500 },
    ]);
    assert.equal(saved.renderer.dom.tags.includes('other'), true);
    assert.equal(saved.events.consoleErrors[0].category, 'console-error');
    assert.equal(saved.events.pageErrors.at(-1).category, 'javascript-error');
    assert.equal(saved.events.unhandledRejections[0].category, 'unhandled-rejection');
    assert.equal(saved.events.resourceFailures[0].category, 'resource-load-failure');
    assert.deepEqual(saved.events.pageErrors.map(({ sameOrigin, locationClass }) => ({ sameOrigin, locationClass })), [
      { sameOrigin: true, locationClass: 'app-module' },
      { sameOrigin: false, locationClass: 'other' },
      { sameOrigin: false, locationClass: 'other' },
    ]);
    for (const forbidden of [secret, 'client-records.example', 'client@example.test', 'Jane-Doe', 'Plan.docx', '?token=', '#fragment', 'forged-client-category', '/src/']) {
      assert.equal(encoded.includes(forbidden), false, `artifact retained ${forbidden}`);
    }
    assert.equal(/"(?:url|origin|hostname|path|query|fragment|location|error|stack|message|value|reason|headers|body|storage|token)"\s*:/.test(encoded), false);
    assert.equal(result.sha256, createHash('sha256').update(encoded).digest('hex'));
    assert.equal((await stat(result.path)).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('empty React root is classified from the actual renderer snapshot shape', () => {
  assert.equal(classifyDiagnostic({}, { rootPresent: true, rootHasChildren: false }, 'write'), 'react-mount-did-not-run');
  assert.equal(safeArtifact({ phase: 'write', renderer: { rootPresent: true, rootHasChildren: false } }).classification, 'react-mount-did-not-run');
});

test('every non-renderer failure class writes a bounded surviving artifact', async () => {
  const directory = testDirectory();
  try {
    for (const [phase, classification] of Object.entries({
      preflight: 'runner-preflight-failure',
      'product-gate-build': 'product-gate-build-failure', 'product-gate-provenance': 'product-gate-provenance-failure',
      'diagnostic-writer-validation': 'diagnostic-writer-validation-failure', 'directory-creation': 'directory-creation-failure',
      'port-selection': 'port-selection-failure', 'pid-read': 'pid-read-failure', 'driver-startup': 'driver-startup-failure',
      'vite-startup': 'vite-startup-failure', launcher: 'launcher-failure', 'bridge-health': 'bridge-health-failure',
      'app-exit': 'app-exit-failure', restart: 'restart-failure',
    })) {
      const result = await writeDiagnosticArtifact({ phase }, directory);
      const encoded = await readFile(result.path, 'utf8');
      assert.equal(result.artifact.classification, classification);
      assert.equal(result.artifact.renderer.locationClass, 'unavailable');
      assert.deepEqual(result.artifact.renderer, { available: false, locationClass: 'unavailable' });
      assert.equal(encoded.includes('workspace'), false);
      assert.equal(result.sha256, createHash('sha256').update(encoded).digest('hex'));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function writeExecutable(target, source) {
  await writeFile(target, source);
  await chmod(target, 0o700);
}

async function runShellFailure(mode) {
  const root = testDirectory();
  const bin = path.join(root, 'bin');
  const repo = path.join(root, 'repo');
  const diagnostics = path.join(root, 'diagnostics');
  const temporaryDirectory = path.join(root, 'tmp');
  await mkdir(path.join(repo, 'src-tauri'), { recursive: true });
  await mkdir(path.join(repo, 'node_modules'));
  await mkdir(bin);
  await mkdir(temporaryDirectory);
  await writeFile(path.join(repo, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ build: { devUrl: 'http://127.0.0.1:4173/' } }));
  const app = path.join(root, 'app');
  const launcher = path.join(root, 'launcher');
  const driver = path.join(root, 'driver.mjs');
  const invalidWriter = path.join(root, 'invalid-writer.mjs');
  const failingWriter = path.join(root, 'failing-writer.mjs');
  await writeExecutable(app, '#!/usr/bin/env bash\nexit 0\n');
  await writeExecutable(path.join(bin, 'git'), `#!/usr/bin/env bash
case " $* " in
  *" rev-parse HEAD "*) echo 0123456789012345678901234567890123456789 ;;
  *" status --porcelain "*) : ;;
  *) exit 2 ;;
esac
`);
  await writeExecutable(path.join(bin, 'curl'), `#!/usr/bin/env bash
url="\${!#}"
if [[ "$url" == *health* ]]; then
  [[ "$GOLDEN_LOOP_TEST_MODE" == bridge-health || "$GOLDEN_LOOP_TEST_MODE" == app-exit ]] && exit 1
  exit 0
fi
[[ "$GOLDEN_LOOP_TEST_MODE" == vite-startup ]] && exit 1
count=0; [[ -f "$GOLDEN_LOOP_TEST_CURL_COUNT" ]] && count="$(<"$GOLDEN_LOOP_TEST_CURL_COUNT")"
count=$((count + 1)); echo "$count" >"$GOLDEN_LOOP_TEST_CURL_COUNT"
[[ "$count" -eq 1 ]] && exit 1
exit 0
`);
  await writeExecutable(path.join(bin, 'npm'), `#!/usr/bin/env bash
[[ "$GOLDEN_LOOP_TEST_MODE" == vite-startup ]] && exit 1
exec sleep 30
`);
  await writeExecutable(path.join(bin, 'python3'), `#!/usr/bin/env bash
[[ "$GOLDEN_LOOP_TEST_MODE" == port-selection ]] && exit 1
echo 45678
`);
  await writeExecutable(path.join(bin, 'date'), `#!/usr/bin/env bash
[[ "$GOLDEN_LOOP_TEST_MODE" == unexpected-trap ]] && exit 7
exec /usr/bin/date "$@"
`);
  await writeExecutable(path.join(bin, 'mkdir'), `#!/usr/bin/env bash
if [[ "$GOLDEN_LOOP_TEST_MODE" == directory-creation && " $* " == *"/workspace"* ]]; then exit 1; fi
exec /usr/bin/mkdir "$@"
`);
  await writeExecutable(path.join(bin, 'cat'), `#!/usr/bin/env bash
[[ "$GOLDEN_LOOP_TEST_MODE" == pid-read && "\${1:-}" == *app.pid ]] && exit 1
exec /usr/bin/cat "$@"
`);
  await writeExecutable(launcher, `#!/usr/bin/env bash
set -euo pipefail
count=0; [[ -f "$GOLDEN_LOOP_TEST_LAUNCH_COUNT" ]] && count="$(<"$GOLDEN_LOOP_TEST_LAUNCH_COUNT")"
count=$((count + 1)); echo "$count" >"$GOLDEN_LOOP_TEST_LAUNCH_COUNT"
[[ ("$GOLDEN_LOOP_TEST_MODE" == launcher-failure || "$GOLDEN_LOOP_TEST_MODE" == diagnostic-write-failure) && "$count" -eq 1 ]] && exit 2
[[ "$GOLDEN_LOOP_TEST_MODE" == restart && "$count" -eq 2 ]] && exit 2
if [[ "$GOLDEN_LOOP_TEST_MODE" == app-exit ]]; then echo 999999 >"$LANTERN_APP_PID_FILE"; exit 0; fi
setsid sleep 30 >/dev/null 2>&1 &
echo $! >"$LANTERN_APP_PID_FILE"
`);
  await writeExecutable(driver, `#!/usr/bin/env node
if (process.env.GOLDEN_LOOP_TEST_MODE === 'driver-startup') process.exit(1);
if (process.env.GOLDEN_LOOP_TEST_MODE === 'driver-timeout') {
  const { spawn } = await import('node:child_process');
  const { readFileSync, writeFileSync } = await import('node:fs');
  const processIdentity = () => {
    const stat = readFileSync(\`/proc/\${process.pid}/stat\`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\\s+/);
    const group = Number(fields[2]);
    const leaderStat = readFileSync(\`/proc/\${group}/stat\`, 'utf8');
    const leaderFields = leaderStat.slice(leaderStat.lastIndexOf(') ') + 2).trim().split(/\\s+/);
    return { group, leaderStartTime: leaderFields[19] };
  };
  writeFileSync(process.env.GOLDEN_LOOP_TEST_DRIVER_PID, String(process.pid));
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1_000)'], {
    stdio: 'ignore',
  });
  writeFileSync(process.env.GOLDEN_LOOP_TEST_DRIVER_CHILD_PID, String(child.pid));
  writeFileSync(process.env.GOLDEN_LOOP_TEST_DRIVER_LEADER_BEFORE, JSON.stringify(processIdentity()));
  process.on('SIGTERM', () => {
    writeFileSync(process.env.GOLDEN_LOOP_TEST_DRIVER_LEADER_AT_TERM, JSON.stringify(processIdentity()));
    setTimeout(() => {
      writeFileSync(process.env.GOLDEN_LOOP_TEST_DRIVER_LEADER_LATE, JSON.stringify(processIdentity()));
    }, 2_000);
  });
  setInterval(() => {}, 1_000);
}
`);
  await writeFile(invalidWriter, 'this is not valid JavaScript');
  await writeFile(failingWriter, `if (process.argv[2] === '--validate') process.exit(0); process.exit(9);`);

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GOLDEN_LOOP_TEST_MODE: mode,
    GOLDEN_LOOP_TEST_CURL_COUNT: path.join(root, 'curl-count'),
    GOLDEN_LOOP_TEST_LAUNCH_COUNT: path.join(root, 'launch-count'),
    GOLDEN_LOOP_TEST_DRIVER_PID: path.join(root, 'driver-pid'),
    GOLDEN_LOOP_TEST_DRIVER_CHILD_PID: path.join(root, 'driver-child-pid'),
    GOLDEN_LOOP_TEST_DRIVER_LEADER_BEFORE: path.join(root, 'driver-leader-before.json'),
    GOLDEN_LOOP_TEST_DRIVER_LEADER_AT_TERM: path.join(root, 'driver-leader-at-term.json'),
    GOLDEN_LOOP_TEST_DRIVER_LEADER_LATE: path.join(root, 'driver-leader-late.json'),
    GOLDEN_LOOP_DIAGNOSTIC_DIR: diagnostics,
    GOLDEN_LOOP_LAUNCHER: launcher,
    GOLDEN_LOOP_DRIVER: driver,
    GOLDEN_LOOP_TIMEOUT_SECONDS: '1',
    GOLDEN_LOOP_TERM_GRACE_SECONDS: '3',
    TMPDIR: temporaryDirectory,
    ...(mode === 'diagnostic-writer-validation' ? { GOLDEN_LOOP_DIAGNOSTIC_WRITER: invalidWriter } : {}),
    ...(mode === 'diagnostic-write-failure' ? { GOLDEN_LOOP_DIAGNOSTIC_WRITER: failingWriter } : {}),
  };
  try {
    let failure;
    try {
      await execFileAsync('bash', [new URL('../golden-loop.sh', import.meta.url).pathname, repo, app], {
        env,
        timeout: mode === 'driver-timeout' ? 20_000 : 10_000,
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, `${mode} unexpectedly turned green`);
    assert.notEqual(failure.code, 0);
    const names = await (await import('node:fs/promises')).readdir(diagnostics);
    assert.ok(names.length >= 1, `${mode} left no artifact`);
    const artifact = JSON.parse(await readFile(path.join(diagnostics, names.at(-1)), 'utf8'));
    assert.match(failure.stderr, /GOLDEN LOOP DIAGNOSTIC: path=.* sha256=[a-f0-9]{64} classification=/);
    if (mode === 'driver-timeout') {
      const driverPid = Number(await readFile(env.GOLDEN_LOOP_TEST_DRIVER_PID, 'utf8'));
      const childPid = Number(await readFile(env.GOLDEN_LOOP_TEST_DRIVER_CHILD_PID, 'utf8'));
      const leaderBefore = JSON.parse(await readFile(env.GOLDEN_LOOP_TEST_DRIVER_LEADER_BEFORE, 'utf8'));
      const leaderAtTerm = JSON.parse(await readFile(env.GOLDEN_LOOP_TEST_DRIVER_LEADER_AT_TERM, 'utf8'));
      const leaderLate = JSON.parse(await readFile(env.GOLDEN_LOOP_TEST_DRIVER_LEADER_LATE, 'utf8'));
      assert.notEqual(leaderBefore.group, driverPid, 'driver unexpectedly owned its process group');
      assert.deepEqual(leaderAtTerm, leaderBefore, 'TERM changed the owned group leader');
      assert.deepEqual(leaderLate, leaderBefore, 'owned group leader did not survive the TERM grace period');
      assert.throws(() => process.kill(leaderBefore.group, 0), { code: 'ESRCH' });
      assert.throws(() => process.kill(driverPid, 0), { code: 'ESRCH' });
      assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
      assert.deepEqual(await (await import('node:fs/promises')).readdir(temporaryDirectory), []);
    }
    return artifact;
  } finally {
    if (mode === 'driver-timeout') {
      for (const pidFile of [env.GOLDEN_LOOP_TEST_DRIVER_PID, env.GOLDEN_LOOP_TEST_DRIVER_CHILD_PID]) {
        try { process.kill(Number(await readFile(pidFile, 'utf8')), 'SIGKILL'); } catch (error) {
          if (error.code !== 'ESRCH' && error.code !== 'ENOENT') throw error;
        }
      }
    }
    await rm(root, { recursive: true, force: true });
  }
}

test('real shell routes every injected early failure to a red, bounded artifact', async () => {
  const expected = {
    'diagnostic-writer-validation': 'diagnostic-writer-validation-failure',
    'diagnostic-write-failure': 'launcher-failure',
    'unexpected-trap': 'runner-preflight-failure',
    'vite-startup': 'vite-startup-failure',
    'port-selection': 'port-selection-failure',
    'directory-creation': 'directory-creation-failure',
    'pid-read': 'pid-read-failure',
    'driver-startup': 'driver-startup-failure',
    'launcher-failure': 'launcher-failure',
    'bridge-health': 'bridge-health-failure',
    'app-exit': 'app-exit-failure',
    restart: 'restart-failure',
  };
  for (const [mode, classification] of Object.entries(expected)) {
    const artifact = await runShellFailure(mode);
    assert.equal(artifact.classification, classification, mode);
    assert.equal(artifact.renderer.locationClass, 'unavailable', mode);
    assert.equal(JSON.stringify(artifact).includes('client'), false, mode);
  }
});

test('the owned group leader survives TERM grace before escalation removes every descendant', async () => {
  const startedAt = Date.now();
  const artifact = await runShellFailure('driver-timeout');
  assert.equal(artifact.classification, 'driver-startup-failure');
  assert.ok(Date.now() - startedAt >= 3_000, 'cleanup escalated before the configured TERM grace elapsed');
  assert.ok(Date.now() - startedAt < 15_000, 'driver timeout exceeded its TERM plus KILL grace');
  const shellSource = await readFile(new URL('../golden-loop.sh', import.meta.url), 'utf8');
  assert.match(shellSource, /setsid bash -c[\s\S]*DRIVER_PGID=\$DRIVER_PID/, 'driver must have a tracked dedicated process group');
  assert.match(shellSource, /driver_group_is_owned[\s\S]*kill -TERM -- "-\$DRIVER_PGID"[\s\S]*driver_group_is_owned[\s\S]*kill -KILL -- "-\$DRIVER_PGID"/, 'each group signal must immediately follow an ownership check');
  assert.doesNotMatch(shellSource, /timeout[^\n]*\n\s*node "\$DRIVER"/, 'timeout must not own only the direct Node process');
});

test('real product-gate shell routes build and provenance failures to artifacts', async () => {
  for (const [mode, classification] of Object.entries({ build: 'product-gate-build-failure', provenance: 'product-gate-provenance-failure' })) {
    const root = testDirectory();
    const scripts = path.join(root, 'scripts');
    const bin = path.join(root, 'bin');
    const diagnostics = path.join(root, 'diagnostics');
    await mkdir(path.join(root, 'src-tauri'), { recursive: true });
    await mkdir(scripts);
    await mkdir(bin);
    for (const name of ['gate.sh', 'write-golden-loop-diagnostic.mjs', 'golden-loop-diagnostics.mjs']) {
      await writeFile(path.join(scripts, name), await readFile(new URL(`../${name}`, import.meta.url)));
    }
    await writeExecutable(path.join(bin, 'cargo'), `#!/usr/bin/env bash
[[ "$GOLDEN_LOOP_GATE_TEST_MODE" == build ]] && exit 1
mkdir -p target/debug
printf '#!/usr/bin/env bash\\nexit 0\\n' >target/debug/lantern
chmod 700 target/debug/lantern
`);
    await writeExecutable(path.join(scripts, 'golden-loop-launch-app.sh'), `#!/usr/bin/env bash
[[ "$GOLDEN_LOOP_GATE_TEST_MODE" == provenance ]] && exit 2
exit 0
`);
    await writeExecutable(path.join(scripts, 'golden-loop.sh'), '#!/usr/bin/env bash\nexit 0\n');
    try {
      let failure;
      try {
        await execFileAsync('bash', ['-c', 'source "$1"; run_golden_loop_gate', '_', path.join(scripts, 'gate.sh')], {
          cwd: root,
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GOLDEN_LOOP_GATE_TEST_MODE: mode, GOLDEN_LOOP_DIAGNOSTIC_DIR: diagnostics },
        });
      } catch (error) { failure = error; }
      assert.ok(failure, `${mode} product-gate failure turned green`);
      const names = await (await import('node:fs/promises')).readdir(diagnostics);
      const artifact = JSON.parse(await readFile(path.join(diagnostics, names.at(-1)), 'utf8'));
      assert.equal(artifact.classification, classification);
      assert.match(failure.stderr, /sha256=[a-f0-9]{64}/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('early capture remains debug-only and diagnostics cannot change pass checks', async () => {
  const lib = await readFile(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  const driver = await readFile(new URL('../golden-loop-driver.mjs', import.meta.url), 'utf8');
  assert.match(lib, /#\[cfg\(debug_assertions\)\][\s\S]*golden_loop_diagnostics_initialization_script/);
  assert.match(driver, /await waitFor\('the explicitly opened workspace'/);
  assert.doesNotMatch(driver, /diagnostic pass/);
});
