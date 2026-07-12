#!/usr/bin/env node
/**
 * Design/03 §1.3 release gate. This deliberately runs the desktop application,
 * not a browser mock. A red PERF line is a finding: do not raise a ceiling to
 * turn it green.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBigFirmCorpus, corpusSummary } from '../fixtures/bigfirm/generate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const corpus = createBigFirmCorpus();
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lantern-crm-scale-'));
const workspace = path.join(tempRoot, 'northstar-ridge');
const pidFile = path.join(tempRoot, 'xvfb.pid');
const results = [];
let vite;
let app;
let vitePort;
let bridgePort;
let xDisplay;
let failed = false;

const LIMITS = Object.freeze({ bootstrapSeconds: 45, bootstrapMiB: 64, restartSeconds: 60, restartMiB: 20, offlineSeconds: 90, offlineMiB: 32, wallSeconds: 30, wallMiB: 8, interactionSeconds: 10 });
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const now = () => performance.now();

function assertCorpusShape(value) {
  const count = (kind) => value.records.filter((record) => record.kind === kind).length;
  if (value.counts.seats !== 10 || value.counts.households < 300 || count('activityEvent') < 3_000 || count('workflowInstance') < 300 || count('task') < 500) {
    throw new Error('The fabricated big-firm corpus no longer meets the scale-test minimums.');
  }
  if (!value.records.some((record) => record.restoredAt) || !value.records.some((record) => record.kind === 'legacyLink') || !value.records.some((record) => String(record.name ?? '').includes('😀') || JSON.stringify(record).includes('😀'))) {
    throw new Error('The fabricated big-firm corpus lost required messy-history cases.');
  }
}

function record(name, measured, ceiling, unit, pass, detail = '') {
  results.push({ name, measured, ceiling, unit, pass, detail });
  const shown = measured === null ? 'not measurable' : `${measured}${unit}`;
  const limit = ceiling === null ? 'n/a' : `${ceiling}${unit}`;
  console.log(`${pass ? 'PASS' : 'PERF'}: ${name}: ${shown} (ceiling ${limit})${detail ? ` — ${detail}` : ''}`);
  if (!pass) failed = true;
}

function child(command, args, env = {}) {
  return spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
}
function watch(label, process) {
  process.stdout.on('data', (data) => process.stdout.write(`[${label}] ${data}`));
  process.stderr.on('data', (data) => process.stderr.write(`[${label}] ${data}`));
  // A child can disappear while its pipe is still being drained. That is a
  // normal startup failure we report through waitFor, not an uncaught Node error.
  process.stdout.on('error', () => {});
  process.stderr.on('error', () => {});
  return process;
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local port');
  return address.port;
}
async function waitFor(label, condition, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await condition()) return; } catch (error) { lastError = error; }
    await pause(125);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}
async function request(port, pathname, query = {}) {
  const url = new URL(pathname, `http://127.0.0.1:${port}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error || `${pathname} failed`);
  return body.result;
}
const evaluate = (code, timeoutMs = 20_000) => request(bridgePort, '/eval', { js: code, timeout_ms: timeoutMs });
const click = (testid) => request(bridgePort, '/click', { testid });
const fill = (testid, text) => request(bridgePort, '/fill', { testid, text });
async function exists(testid) { return Boolean(await evaluate(`Boolean(document.querySelector('[data-testid="${testid}"]'))`)); }
async function waitForTestId(testid, timeout = 25_000) { await waitFor(testid, () => exists(testid), timeout); }
async function stop(process, label) {
  if (!process || process.exitCode !== null || process.signalCode !== null) return;
  process.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => process.once('exit', resolve)), pause(6_000)]);
  if (process.exitCode === null && process.signalCode === null) process.kill(process.pid, 'SIGKILL');
  console.log(`scale teardown: ${label} stopped`);
}
async function startVite() {
  vite = watch('vite', child('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort']));
  await waitFor('Vite', async () => (await fetch(`http://127.0.0.1:${vitePort}`)).ok);
}
async function startApp() {
  app = watch('app', child('bash', ['scripts/crm-loop/launch-app.sh', String(bridgePort), workspace], {
    LANTERN_VITE_PORT: String(vitePort), LANTERN_XVFB_DISPLAY: xDisplay, LANTERN_XVFB_PID_FILE: pidFile, CRM_LOOP_WORKSPACE: workspace,
  }));
  await waitFor('desktop bridge', async () => (await fetch(`http://127.0.0.1:${bridgePort}/health`)).ok);
}
async function selectWorkspace() {
  await evaluate(`(async () => {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (!invoke) throw new Error('Tauri bridge is unavailable');
    await invoke('crm_set_workspace', { path: ${JSON.stringify(workspace)} });
    const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts');
    useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)});
    return true;
  })()`, 30_000);
  await waitForTestId('spine-nav-matters', 30_000);
}
async function usableHome() {
  await click('spine-nav-matters');
  await waitForTestId('crm-home-nav-today', 30_000);
  await click('crm-home-nav-today');
  await waitFor('usable Today', async () => (await exists('crm-today-triage')) || (await exists('crm-today-first-use')), 30_000);
}
async function seedCorpus() {
  console.log(`Seeding real encrypted CRM store: ${corpusSummary(corpus)}`);
  for (let index = 0; index < corpus.records.length; index += 1) {
    const record = corpus.records[index];
    await evaluate(`window.__TAURI_INTERNALS__.invoke('crm_live_upsert', { record: ${JSON.stringify(record)} })`, 30_000);
    if ((index + 1) % 250 === 0 || index + 1 === corpus.records.length) console.log(`scale seed: ${index + 1}/${corpus.records.length} real records saved`);
  }
}
async function interaction(name, work) {
  const started = now();
  try {
    await work();
    const seconds = Number(((now() - started) / 1000).toFixed(2));
    record(name, seconds, LIMITS.interactionSeconds, 's', seconds <= LIMITS.interactionSeconds, 'real desktop interaction');
  } catch (error) {
    const seconds = Number(((now() - started) / 1000).toFixed(2));
    record(name, seconds, LIMITS.interactionSeconds, 's', false, error instanceof Error ? error.message : String(error));
  }
}
async function runInteractions() {
  await interaction('10-year household timeline', async () => {
    await click('spine-nav-matters'); await waitForTestId('crm-directory-surface');
    await fill('crm-directory-search', corpus.targetHouseholdName);
    await waitForTestId(`crm-directory-household-${corpus.targetHouseholdId}`);
    await click(`crm-directory-household-${corpus.targetHouseholdId}`); await waitForTestId('crm-household-record');
    await evaluate(`Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Timeline')?.click()`);
    await waitForTestId('crm-household-timeline');
    const body = String(await evaluate('document.body.innerText'));
    if (!body.includes('legacy import corrected') && !body.includes('review completed')) throw new Error('timeline did not render seeded decade history');
  });
  await interaction('search across all records', async () => {
    await click('spine-nav-search'); await waitForTestId('crm-search-surface');
    await fill('crm-search-query', corpus.searchNeedle); await click('crm-search-submit'); await waitForTestId('crm-search-answer');
    if (!String(await evaluate('document.body.innerText')).includes(corpus.searchNeedle)) throw new Error('search did not return fabricated scale record');
  });
  await interaction('Today render', async () => {
    await click('spine-nav-matters'); await waitForTestId('crm-home-nav-today'); await click('crm-home-nav-today'); await waitForTestId('crm-today-triage');
  });
  await interaction('report render', async () => {
    await click('spine-nav-matters'); await waitForTestId('crm-home-nav-reports'); await click('crm-home-nav-reports');
    await waitForTestId('crm-screen-reports'); await click('crm-report-no_contact_6mo'); await click('crm-report-run');
    await waitFor('report results', async () => String(await evaluate('document.body.innerText')).includes('Computed just now'));
  });
}
async function documentBytes() {
  // Storage is deliberately NOT reported as downloaded bytes. The current app
  // does not expose its CRM relay transfer counters to the desktop harness.
  const paths = ['.data', '.config'];
  let bytes = 0;
  for (const childPath of paths) {
    try { bytes += Number((await stat(path.join(workspace, childPath))).size) || 0; } catch { /* directory size is non-portable */ }
  }
  return bytes;
}
function unavailableSyncMetric(name, ceiling, unit, reason) { record(name, null, ceiling, unit, false, reason); }

try {
  assertCorpusShape(corpus);
  vitePort = await freePort(); bridgePort = await freePort(); xDisplay = `:${1000 + (bridgePort % 1000)}`;
  const sharedBinary = path.resolve(root, '../..', 'src-tauri/target/debug/lantern');
  if (!existsSync(path.join(root, 'src-tauri/target/debug/lantern')) && !existsSync(sharedBinary)) throw new Error('The real debug app is missing. Build it once with: cargo build --manifest-path src-tauri/Cargo.toml --locked');
  console.log(`SCALE FIXTURE: ${corpusSummary(corpus)}`);
  console.log(`SCALE APP: Vite ${vitePort}, desktop bridge ${bridgePort}, isolated workspace ${workspace}`);
  await startVite(); await startApp(); await selectWorkspace(); await seedCorpus(); await stop(app, 'seed app'); app = undefined;

  const bootStarted = now(); await startApp(); await selectWorkspace(); await usableHome();
  const bootSeconds = Number(((now() - bootStarted) / 1000).toFixed(2));
  record('fresh bootstrap to usable Home', bootSeconds, LIMITS.bootstrapSeconds, 's', bootSeconds <= LIMITS.bootstrapSeconds, 'real app, seeded encrypted workspace');
  await documentBytes();
  unavailableSyncMetric('fresh bootstrap downloaded bytes', LIMITS.bootstrapMiB, ' MiB', 'CRM sync transfer counters are not wired into the real desktop app; local database size is not a download measurement.');
  await runInteractions();

  // These three are intentionally red until the production CRM sync client is
  // mounted by the app. Restarting a UI process is not a relay restart, and a
  // fake wall would hide a missing security path.
  unavailableSyncMetric('relay restart recovery', LIMITS.restartSeconds, 's', 'the real app does not mount a CRM relay subscription, so this cannot honestly exercise a relay restart.');
  unavailableSyncMetric('relay restart redownload', LIMITS.restartMiB, ' MiB', 'no live CRM transfer metric is available from the real app.');
  unavailableSyncMetric('30-days-offline return', LIMITS.offlineSeconds, 's', 'the real app has no controllable CRM sync/offline clock in this harness.');
  unavailableSyncMetric('30-days-offline tail bytes', LIMITS.offlineMiB, ' MiB', 'no live CRM transfer metric is available from the real app.');
  unavailableSyncMetric('ethical-wall/key-change', LIMITS.wallSeconds, 's', 'the real app does not expose a mounted CRM key/wall lifecycle to this test.');
  unavailableSyncMetric('ethical-wall/key recovery bytes', LIMITS.wallMiB, ' MiB', 'no live CRM transfer metric is available from the real app.');
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  record('real-app scale harness', null, null, '', false, detail);
} finally {
  await stop(app, 'desktop app'); await stop(vite, 'Vite');
  await rm(tempRoot, { recursive: true, force: true });
}

console.log('\nMeasured versus ceiling');
console.log('| Check | Measured | Ceiling | Result |');
console.log('| --- | ---: | ---: | --- |');
for (const result of results) console.log(`| ${result.name} | ${result.measured === null ? 'not measurable' : `${result.measured}${result.unit}`} | ${result.ceiling === null ? 'n/a' : `${result.ceiling}${result.unit}`} | ${result.pass ? 'PASS' : 'PERF'} |`);
process.exit(failed ? 1 : 0);
