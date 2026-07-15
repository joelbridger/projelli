#!/usr/bin/env node
// Real desktop proof. This is deliberately separate from the visual fixture:
// it enables the public flag, uses liveRecords, and reloads the running app.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = process.env.LANTERN_DEV_BRIDGE_PORT || '9284';
const base = `http://127.0.0.1:${port}`;
const workspace =
  process.env.CRM_LOOP_WORKSPACE ||
  mkdtempSync(join(tmpdir(), 'form-activity-live-'));
const token = Date.now();
const formId = `form-activity-form-${token}`;
const householdId = `form-activity-household-${token}`;
const newestId = `form-activity-newest-${token}`;
const olderId = `form-activity-older-${token}`;

function fail(message) {
  throw new Error(`FAIL form activity: ${message}`);
}
async function request(path, query = {}) {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query))
    url.searchParams.set(key, String(value));
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body.ok) fail(body.error || `${path} failed`);
  return body.result;
}
const evaluate = (js) => request('/eval', { js, timeout_ms: 20_000 });
const click = (testid) => request('/click', { testid });
async function waitFor(testid, seconds = 30) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    try {
      if (
        await evaluate(
          `Boolean(document.querySelector('[data-testid="${testid}"]'))`
        )
      )
        return;
    } catch {
      /* the real app may be reloading */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  fail(`timed out waiting for ${testid}`);
}

const records = [
  {
    id: formId,
    kind: 'intakeLink',
    matterId: 'firm_home',
    name: 'Annual review questionnaire',
    audience: 'client-facing',
    fields: {
      client_name: {
        id: 'client_name',
        label: 'Full name',
        kind: 'text',
        required: true,
      },
      client_email: {
        id: 'client_email',
        label: 'Email address',
        kind: 'email',
        required: true,
      },
      account_number: {
        id: 'account_number',
        label: 'Account number',
        kind: 'text',
        required: true,
      },
    },
    confirmationCopy: 'Thank you.',
    status: 'active',
  },
  {
    id: householdId,
    kind: 'household',
    matterId: householdId,
    name: 'Chen household',
  },
  {
    id: newestId,
    kind: 'intakeSubmission',
    matterId: 'firm_home',
    intakeLinkId: formId,
    audience: 'client-facing',
    submittedAt: '2026-07-15T14:00:00Z',
    payload: {
      values: { client_name: 'Avery Chen', account_number: '001234567890' },
    },
    matchingDecisions: {
      match: {
        decision: 'match',
        decidedAt: '2026-07-15T14:01:00Z',
        householdRef: { id: householdId },
      },
    },
  },
  {
    id: olderId,
    kind: 'intakeSubmission',
    matterId: 'firm_home',
    intakeLinkId: formId,
    audience: 'internal',
    submittedAt: '2026-07-14T14:00:00Z',
    payload: { values: { client_email: 'advisor@example.com' } },
    matchingDecisions: {},
  },
];

async function prepareAndRead() {
  return evaluate(`(async () => {
    const { setDevFlagOverride } = await import('/src/platform/flags/index.ts');
    const { saveLiveCrmRecord, loadLiveCrmRecords } = await import('/src/platform/crm/liveRecords.ts');
    const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts');
    setDevFlagOverride('form-activity', true);
    for (const record of ${JSON.stringify(records)}) await saveLiveCrmRecord(${JSON.stringify(workspace)}, record);
    useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)});
    return loadLiveCrmRecords(${JSON.stringify(workspace)});
  })()`);
}

try {
  await request('/health');
  const beforeReload = await prepareAndRead();
  if (!beforeReload.some((record) => record.id === newestId))
    fail('liveRecords did not return the seeded submission');
  await waitFor('spine-nav-home');
  await click('spine-nav-home');
  await waitFor('crm-home-nav-form-activity');
  await click('crm-home-nav-form-activity');
  await waitFor(`form-activity-row-${newestId}`);
  const beforeRows = await evaluate(
    `Array.from(document.querySelectorAll('[data-testid^="form-activity-row-"]')).map((row) => row.getAttribute('data-testid'))`
  );
  if (beforeRows[0] !== `form-activity-row-${newestId}`)
    fail('newest submission was not first before reload');
  const beforeFilteredRows = await evaluate(`(() => {
    const select = document.querySelector('[data-testid="form-activity-audience-filter"]');
    if (!(select instanceof HTMLSelectElement)) throw new Error('missing form activity audience filter');
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    set.call(select, 'client-facing');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return Array.from(document.querySelectorAll('[data-testid^="form-activity-row-"]')).map((row) => row.getAttribute('data-testid'));
  })()`);
  if (
    JSON.stringify(beforeFilteredRows) !==
    JSON.stringify([`form-activity-row-${newestId}`])
  )
    fail(
      'client-facing filter did not return only the expected row before reload'
    );

  await evaluate('location.reload()');
  await waitFor('spine-nav-home');
  const afterReload = await evaluate(`(async () => {
    const { setDevFlagOverride } = await import('/src/platform/flags/index.ts');
    const { loadLiveCrmRecords } = await import('/src/platform/crm/liveRecords.ts');
    const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts');
    setDevFlagOverride('form-activity', true);
    useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)});
    return loadLiveCrmRecords(${JSON.stringify(workspace)});
  })()`);
  if (
    !afterReload.some((record) => record.id === newestId) ||
    !afterReload.some((record) => record.id === olderId)
  )
    fail('seeded submissions did not survive the real app reload');
  await click('spine-nav-home');
  await click('crm-home-nav-form-activity');
  await waitFor(`form-activity-row-${newestId}`);
  const afterRows = await evaluate(
    `Array.from(document.querySelectorAll('[data-testid^="form-activity-row-"]')).map((row) => row.getAttribute('data-testid'))`
  );
  if (JSON.stringify(beforeRows) !== JSON.stringify(afterRows))
    fail('form activity order changed after the real app reload');
  const afterFilteredRows = await evaluate(`(() => {
    const select = document.querySelector('[data-testid="form-activity-audience-filter"]');
    if (!(select instanceof HTMLSelectElement)) throw new Error('missing form activity audience filter after reload');
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    set.call(select, 'client-facing');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return Array.from(document.querySelectorAll('[data-testid^="form-activity-row-"]')).map((row) => row.getAttribute('data-testid'));
  })()`);
  if (JSON.stringify(beforeFilteredRows) !== JSON.stringify(afterFilteredRows))
    fail('client-facing filter output changed after the real app reload');
  console.log(
    `PASS: liveRecords seed/read/reload/read preserved form activity rows in ${workspace}.`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
