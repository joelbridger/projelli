#!/usr/bin/env node
/**
 * Packaged-app restart proof for CRM Trash & recovery at 5c78629e.
 *
 * Run phases against three separate launches that share the same workspace:
 *   node drive.mjs delete
 *   node drive.mjs recover-after-restart
 *   node drive.mjs verify-restored-after-restart
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const expectedSha = '5c78629e27f2a886e5b041b6736d779c24216c5f';
const phase = process.argv[2];
const port = process.env.LANTERN_DEV_BRIDGE_PORT || '9292';
const base = `http://127.0.0.1:${port}`;
const workspace = process.env.CRM_LOOP_WORKSPACE;
const evidenceDir = resolve(
  process.env.CRM_TRASH_EVIDENCE_DIR ||
    'evidence/2026-07-15-trash-recovery'
);
const statePath = resolve(evidenceDir, 'drive-state.json');
const record = {
  id: 'trash-drive-household-5c78629e',
  kind: 'household',
  matterId: 'trash-drive-matter-5c78629e',
  name: 'Rivera recovery proof household',
  status: 'active',
  primaryAdvisor: 'Maya Patel',
};

if (!workspace) throw new Error('CRM_LOOP_WORKSPACE is required');
if (!['delete', 'recover-after-restart', 'verify-restored-after-restart'].includes(phase)) {
  throw new Error('phase must be delete, recover-after-restart, or verify-restored-after-restart');
}

function fail(message) {
  throw new Error(`FAIL trash restart drive: ${message}`);
}

async function request(path, params = {}) {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      const body = await response.json();
      if (response.ok && body.ok) return body.result;
      lastError = new Error(body.error || `${path} failed`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((done) => setTimeout(done, 150));
  }
  throw lastError ?? new Error(`${path} failed`);
}

const evaluate = (js) => request('/eval', { js, timeout_ms: 20_000 });
const click = (testid) => request('/click', { testid });

async function waitFor(testid, seconds = 30) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(document.querySelector('[data-testid="${testid}"]'))`)) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  fail(`timed out waiting for ${testid}`);
}

async function setWorkspaceAndFlag() {
  await evaluate(`(async () => {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (!invoke) throw new Error('Tauri invoke is not ready');
    await invoke('crm_set_workspace', { path: ${JSON.stringify(workspace)} });
    const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts');
    useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)});
    const { setDevFlagOverride } = await import('/src/platform/flags/index.ts');
    setDevFlagOverride('crm-trash-recovery', true);
    return true;
  })()`);
  await waitFor('spine-nav-home');
}

async function nativeList() {
  return evaluate(`window.__TAURI_INTERNALS__.invoke('crm_trash_list')`);
}

async function liveList() {
  return evaluate(`window.__TAURI_INTERNALS__.invoke('crm_live_list')`);
}

async function openTrash() {
  await click('spine-nav-home');
  await waitFor('crm-home');
  await waitFor('crm-home-nav-trash');
  await click('crm-home-nav-trash');
  await waitFor('crm-trash-recovery');
}

async function assertTrashSurface(expectedMetadata) {
  await openTrash();
  const rowDeadline = Date.now() + 20_000;
  while (Date.now() < rowDeadline) {
    const rendered = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="crm-trash-row-"]')).some((node) => node.textContent?.includes(${JSON.stringify(record.name)}))`);
    if (rendered) break;
    await new Promise((done) => setTimeout(done, 150));
  }
  const proof = await evaluate(`(() => {
    const text = document.body.innerText;
    const columns = Array.from(document.querySelectorAll('[data-testid="crm-trash-table"] th')).map((node) => node.textContent?.trim());
    const row = Array.from(document.querySelectorAll('[data-testid^="crm-trash-row-"]')).find((node) => node.textContent?.includes(${JSON.stringify(record.name)}));
    const meter = row?.querySelector('[data-testid^="crm-trash-meter-"]');
    return {
      columns,
      rowText: row?.textContent || '',
      meterLabel: meter?.getAttribute('aria-label') || '',
      meterWidth: meter?.querySelector('span')?.style.width || '',
      guard: document.querySelector('[data-testid="crm-trash-admin-guard"]')?.textContent?.trim() || '',
      pageText: text,
    };
  })()`);
  const expectedColumns = ['Record', 'Type', 'Deleted', 'Time remaining', 'Deleted by', 'Recover'];
  if (JSON.stringify(proof.columns) !== JSON.stringify(expectedColumns)) {
    fail(`column mismatch: ${JSON.stringify(proof.columns)}`);
  }
  for (const text of [record.name, 'household', '30 days remaining', 'drive-reviewer', 'Recover']) {
    if (!proof.rowText.includes(text)) fail(`trash row is missing ${text}`);
  }
  if (proof.meterLabel !== 'Recovery time remaining' || !proof.meterWidth) {
    fail(`recovery meter is missing (${JSON.stringify(proof)})`);
  }
  if (!proof.guard.includes('Permanent deletion requires a firm admin')) {
    fail('firm-admin guard is missing');
  }
  const trash = await nativeList();
  const saved = trash.find((item) => item.recordId === record.id && item.matterId === record.matterId);
  if (!saved) fail('native trash list does not contain the record');
  if (saved.deletedBy !== 'drive-reviewer') fail('deleted-by metadata changed');
  const retentionMs = new Date(saved.expiresAt).getTime() - new Date(saved.deletedAt).getTime();
  if (retentionMs !== 30 * 24 * 60 * 60 * 1000) fail(`retention is not exactly 30 days: ${retentionMs}ms`);
  if (expectedMetadata && (saved.deletedAt !== expectedMetadata.deletedAt || saved.expiresAt !== expectedMetadata.expiresAt)) {
    fail('delete and expiry timestamps changed across restart');
  }
  await evaluate(`(() => {
    const surface = document.querySelector('[data-testid="crm-trash-recovery"]');
    for (const node of document.querySelectorAll('*')) {
      if ('scrollTop' in node) node.scrollTop = 0;
      if ('scrollLeft' in node) node.scrollLeft = 0;
    }
    window.scrollTo(0, 0);
    surface?.scrollIntoView({ block: 'start', inline: 'nearest' });
    return true;
  })()`);
  await new Promise((done) => setTimeout(done, 150));
  return saved;
}

function screenshot(name) {
  mkdirSync(evidenceDir, { recursive: true });
  const target = resolve(evidenceDir, name);
  execFileSync('scrot', ['-o', target], { stdio: 'ignore' });
  console.log(`SCREENSHOT ${target}`);
}

async function deletePhase() {
  const existingTrash = await nativeList();
  const resumable = existingTrash.some(
    (item) => item.recordId === record.id && item.matterId === record.matterId
  );
  if (!resumable) {
    await evaluate(`window.__TAURI_INTERNALS__.invoke('crm_live_upsert', { record: ${JSON.stringify(record)} })`);
    const before = await liveList();
    if (!before.some((item) => item.id === record.id)) fail('created record was not live');
    await evaluate(`(async () => {
      const { softDeleteCrmRecord } = await import('/src/features/crm-trash/trashClient.ts');
      return softDeleteCrmRecord({
        workspaceRoot: ${JSON.stringify(workspace)},
        recordId: ${JSON.stringify(record.id)},
        matterId: ${JSON.stringify(record.matterId)},
        actorId: 'drive-reviewer',
      });
    })()`);
  }
  const after = await liveList();
  if (after.some((item) => item.id === record.id)) fail('soft-deleted record is still live');
  const deleted = await assertTrashSurface();
  writeFileSync(
    statePath,
    `${JSON.stringify({ expectedSha, record, deletedAt: deleted.deletedAt, expiresAt: deleted.expiresAt }, null, 2)}\n`
  );
  screenshot('01-deleted-before-restart.png');
  console.log(`PASS delete: ${resumable ? 'resumed the real tombstone created by this phase, ' : 'created a real CRM record and soft-deleted it through trashClient, '}rendered it with exactly 30 days of recovery, and saved ${statePath}`);
}

async function recoverAfterRestartPhase() {
  const metadata = JSON.parse(readFileSync(statePath, 'utf8'));
  const deleted = await assertTrashSurface(metadata);
  screenshot('02-trash-after-restart.png');
  const identity = `${encodeURIComponent(deleted.matterId)}--${encodeURIComponent(deleted.recordId)}`;
  await click(`crm-trash-recover-${identity}`);
  await waitFor('crm-trash-empty');
  const trash = await nativeList();
  if (trash.some((item) => item.recordId === record.id)) fail('record remained in trash after Recover');
  const live = await liveList();
  if (!live.some((item) => item.id === record.id && item.name === record.name)) fail('Recover did not put the record back in the live CRM store');
  screenshot('03-recovered-before-restart.png');
  console.log('PASS recover-after-restart: timestamps were unchanged, the surface still showed 30 days remaining, and Recover returned the record to the live store');
}

async function verifyRestoredAfterRestartPhase() {
  const trash = await nativeList();
  if (trash.some((item) => item.recordId === record.id)) fail('record returned to trash after the second restart');
  const live = await liveList();
  if (!live.some((item) => item.id === record.id && item.name === record.name)) fail('restored record did not survive the second restart');
  await click('spine-nav-matters');
  await waitFor('crm-directory-surface');
  const directoryDeadline = Date.now() + 20_000;
  let visible = false;
  while (Date.now() < directoryDeadline) {
    visible = await evaluate(`document.body.innerText.includes(${JSON.stringify(record.name)})`);
    if (visible) break;
    await new Promise((done) => setTimeout(done, 150));
  }
  if (!visible) fail('restored record is not visible in the Clients directory');
  screenshot('04-record-back-after-restart.png');
  console.log('PASS verify-restored-after-restart: the record stayed out of trash and is visible again in Clients after the second restart');
}

try {
  mkdirSync(dirname(statePath), { recursive: true });
  await request('/health');
  await setWorkspaceAndFlag();
  if (phase === 'delete') await deletePhase();
  if (phase === 'recover-after-restart') await recoverAfterRestartPhase();
  if (phase === 'verify-restored-after-restart') await verifyRestoredAfterRestartPhase();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
