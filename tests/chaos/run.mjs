#!/usr/bin/env node
/**
 * Crash proof for the REAL desktop application. This file intentionally has
 * no Vitest wrapper: killing the application is the subject under test, so a
 * normal test runner's worker lifecycle would hide the process boundary.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RealApp, assert, dataloss } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const findings = [];
const stamp = `chaos-${Date.now()}`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scenarioNames = [
  'client record save: confirmed then SIGKILL',
  'client record save: request in flight then SIGKILL',
  'task create and complete: SIGKILL at both save boundaries',
  'migration import: SIGKILL while records are landing',
  'propagation apply: instance and notification stay together',
  'offline edits queued: SIGKILL then relay return',
  'checkpoint / compaction: SIGKILL and reopen',
  'disk full and read-only workspace fail loudly',
];

// Do this once, before a destructive test. The known folder-picker failure
// must not be disguised by calling Tauri commands behind an unmounted screen.
// It also keeps the command deterministic when a broken app launch would make
// every independent test wait for its own timeout.
const preflight = new RealApp(root, 'preflight');
let preflightError = null;
try {
  await preflight.start();
  await preflight.bootCrmHome();
} catch (error) {
  preflightError = error instanceof Error ? error.message : String(error);
} finally {
  await preflight.close();
}

if (preflightError) {
  for (const name of scenarioNames) {
    const detail = `DATALOSS: real desktop preflight cannot reach the mounted CRM screen (${preflightError}); this scenario is blocked rather than faked through hidden commands`;
    findings.push({ name, status: 'DATALOSS', detail });
    console.error(detail);
  }
  console.log('\nCHAOS FINDINGS');
  for (const finding of findings) console.log(`${finding.status}: ${finding.name} — ${finding.detail}`);
  process.exitCode = 1;
} else {

async function scenario(name, body) {
  const app = new RealApp(root, name.replace(/[^a-z0-9]+/gi, '-'));
  try {
    await body(app);
    findings.push({ name, status: 'PASS', detail: 'The app reopened its real encrypted workspace with an honest result.' });
    console.log(`PASS ${name}`);
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const detail = raw.startsWith('DATALOSS:') ? raw : `DATALOSS: ${raw}`;
    findings.push({ name, status: 'DATALOSS', detail });
    console.error(detail);
  } finally { await app.close(); }
}

async function seedHousehold(app, id = `household-${stamp}`) {
  await app.eval(`window.__TAURI_INTERNALS__.invoke('crm_live_upsert', { record: {
    id: ${JSON.stringify(id)}, kind: 'household', matterId: ${JSON.stringify(id)}, name: 'Chaos household', lifecycle: 'Active', primaryAdvisor: 'Chaos advisor', serviceTier: 'Standard', ownership: 'mine', facts: [], accounts: [], members: [], externalParties: [], notes: [], customFields: [], tags: []
  }})`);
  return id;
}

async function assertCleanRecordSet(app) {
  const records = await app.records();
  assert(Array.isArray(records), 'the store did not reopen as a readable record list');
  for (const record of records) assert(record && typeof record.id === 'string' && typeof record.kind === 'string', 'relaunch exposed a partial CRM record');
  return records;
}

await scenario('client record save: confirmed then SIGKILL', async (app) => {
  await app.start(); await app.bootCrmHome();
  const id = await seedHousehold(app);
  // The UI-facing save command has returned. Kill the whole desktop process,
  // then use a fresh process to read the same workspace.
  await app.kill(); await app.relaunch(); await app.bootCrmHome();
  const records = await assertCleanRecordSet(app);
  assert(records.some((record) => record.id === id && record.name === 'Chaos household'), 'the UI-confirmed client record disappeared after a hard kill');
});

await scenario('client record save: request in flight then SIGKILL', async (app) => {
  await app.start(); await app.bootCrmHome();
  const id = `household-before-${stamp}`;
  // Start a real command without awaiting it, then cut power. Either no record
  // or a complete record is honest; a malformed store or half object is not.
  await app.eval(`window.__TAURI_INTERNALS__.invoke('crm_live_upsert', { record: { id: ${JSON.stringify(id)}, kind: 'household', matterId: ${JSON.stringify(id)}, name: 'Before-confirm client' } }).catch(() => null); true`);
  await app.kill(); await app.relaunch(); await app.bootCrmHome();
  const records = await assertCleanRecordSet(app);
  const record = records.find((item) => item.id === id);
  assert(!record || (record.name === 'Before-confirm client' && record.kind === 'household'), 'client save was half-written when the app died before confirmation');
});

await scenario('task create and complete: SIGKILL at both save boundaries', async (app) => {
  await app.start(); await app.bootCrmHome();
  const householdId = await seedHousehold(app);
  const taskId = `task-${stamp}`;
  await app.eval(`window.__TAURI_INTERNALS__.invoke('crm_live_upsert', { record: { id: ${JSON.stringify(taskId)}, kind: 'task', matterId: 'firm_home', title: 'Crash-safe task', status: 'open', priority: 'high', householdRef: { kind: 'household', id: ${JSON.stringify(householdId)}, matterId: ${JSON.stringify(householdId)} }, contextRefs: [] }})`);
  await app.kill(); await app.relaunch(); await app.bootCrmHome();
  let records = await assertCleanRecordSet(app);
  assert(records.some((record) => record.id === taskId && record.status === 'open'), 'a confirmed task create disappeared after a hard kill');
  await app.eval(`window.__TAURI_INTERNALS__.invoke('crm_live_upsert', { record: { ...(await window.__TAURI_INTERNALS__.invoke('crm_live_list')).find((r) => r.id === ${JSON.stringify(taskId)}), status: 'done' } }).catch(() => null); true`);
  await app.kill(); await app.relaunch(); await app.bootCrmHome();
  records = await assertCleanRecordSet(app);
  const task = records.find((record) => record.id === taskId);
  assert(task && (task.status === 'open' || task.status === 'done'), 'task completion left an invalid or missing task after a hard kill');
});

await scenario('migration import: SIGKILL while records are landing', async (app) => {
  const simulator = spawn('bun', ['tests/wbsim/server.ts'], { cwd: root, env: { ...process.env, WBSIM_PORT: '8788' }, stdio: 'ignore' });
  try {
    await app.start(); await app.bootCrmHome();
    await pause(500);
    // Start the real importer command, observe its first landed records, then kill.
    await app.eval(`window.__TAURI_INTERNALS__.invoke('crm_migration_import', { baseUrl: 'http://127.0.0.1:8788/v1' }).catch(() => null); true`);
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline && (await app.records()).length === 0) await pause(60);
    await app.kill(); await app.relaunch(); await app.bootCrmHome();
    const partial = await assertCleanRecordSet(app);
    await app.eval(`window.__TAURI_INTERNALS__.invoke('crm_migration_import', { baseUrl: 'http://127.0.0.1:8788/v1' })`);
    const after = await assertCleanRecordSet(app);
    assert(after.length >= partial.length, 'resuming an interrupted migration removed landed records');
    const report = after.find((record) => record.kind === 'migration_report');
    assert(report && Array.isArray(report.matrix) && report.matrix.some((row) => row.sourceType === 'attachment'), 'resumed migration did not publish the honest attachment row in its fidelity report');
  } finally { simulator.kill('SIGKILL'); }
});

await scenario('propagation apply: instance and notification stay together', async (app) => {
  await app.start(); await app.bootCrmHome();
  // This is the actual atomic boundary promised by the CRM core. The UI is
  // required to use it; if it does not, the absence of the paired rows is data loss.
  await app.eval(`window.__TAURI_INTERNALS__.invoke('crm_core_commit_propagation', { payload: { kind: 'apply', instance: { id: 'instance-${stamp}', kind: 'workflow_instance' }, event: { eventId: 'event-${stamp}' }, immutableOperations: ['operation-${stamp}'], activityOutbox: { idempotencyKey: 'activity-${stamp}' }, notificationOutbox: { idempotencyKey: 'notice-${stamp}' }, notificationRows: [{ orgId: 'org-${stamp}', envelopeId: 'envelope-${stamp}' }] } })`);
  await app.kill(); await app.relaunch(); await app.bootCrmHome();
  // The bridge intentionally never gives the renderer a DB handle. The visible
  // workflow route currently writes independent live records, so it cannot prove
  // notification/instance atomicity. Leave this red until that wiring exists.
  throw dataloss('the running workflow apply screen does not call the transactional propagation outbox boundary, so a real UI crash can still split instance state from notification delivery');
});

await scenario('offline edits queued: SIGKILL then relay return', async (app) => {
  await app.start(); await app.bootCrmHome();
  await seedHousehold(app, `offline-household-${stamp}`);
  await app.kill(); await app.relaunch(); await app.bootCrmHome();
  await assertCleanRecordSet(app);
  throw dataloss('the live desktop CRM has no persisted offline mutation queue or relay acknowledgement wired to its screens, so it cannot prove queued edits sync after a crash');
});

await scenario('checkpoint / compaction: SIGKILL and reopen', async (app) => {
  await app.start(); await app.bootCrmHome();
  await seedHousehold(app, `checkpoint-household-${stamp}`);
  await app.kill(); await app.relaunch(); await app.bootCrmHome();
  await assertCleanRecordSet(app);
  throw dataloss('no real-app checkpoint or compaction command is wired to the CRM workspace, so this product cannot yet be crash-proven at that boundary');
});

await scenario('disk full and read-only workspace fail loudly', async (app) => {
  await app.start(); await app.bootCrmHome();
  // Read-only/disk-full need deterministic filesystem fault injection. The
  // app has none, and chmod is not a disk-full simulation. Calling this pass
  // without a real write failure would be a false claim.
  throw dataloss('there is no deterministic store write-failure hook for disk-full or read-only media; this safety promise is untested rather than assumed');
});

console.log('\nCHAOS FINDINGS');
for (const finding of findings) console.log(`${finding.status}: ${finding.name} — ${finding.detail}`);
const red = findings.filter((finding) => finding.status !== 'PASS');
process.exitCode = red.length ? 1 : 0;
}
