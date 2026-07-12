#!/usr/bin/env node
/**
 * Populate a test workspace through the same Tauri CRM commands used by the
 * app. This is intentionally not a JSON/database copy: it opens the encrypted
 * store and writes each record through `crm_live_upsert`.
 */
const workspace = process.env.CRM_LOOP_WORKSPACE;
const port = process.env.LANTERN_DEV_BRIDGE_PORT;

if (!workspace || !port) {
  throw new Error(
    'CRM_LOOP_WORKSPACE and LANTERN_DEV_BRIDGE_PORT are required.'
  );
}

const base = `http://127.0.0.1:${port}`;

async function bridge(path, query = {}) {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query))
    url.searchParams.set(key, String(value));
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error || `${path} failed`);
  return body.result;
}

const evaluate = (js) => bridge('/eval', { js, timeout_ms: 20_000 });

await bridge('/health');
const result = await evaluate(`(async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke) throw new Error('Tauri invoke is not ready');
  const workspace = ${JSON.stringify(workspace)};
  await invoke('crm_set_workspace', { path: workspace });

  const households = [
    { id: 'fixture-household-morgan', kind: 'household', matterId: 'fixture-household-morgan', name: 'Morgan Family', lifecycle: 'Active', serviceTier: 'Gold', primaryAdvisor: 'Maya Patel', ownership: 'mine', members: [], accounts: [], facts: [], externalParties: [], notes: [], customFields: [], tags: ['annual-review'] },
    { id: 'fixture-household-chen', kind: 'household', matterId: 'fixture-household-chen', name: 'Chen Family', lifecycle: 'Prospect', serviceTier: 'Silver', primaryAdvisor: 'Maya Patel', ownership: 'mine', members: [], accounts: [], facts: [], externalParties: [], notes: [], customFields: [], tags: ['referral'] },
  ];
  const records = [
    ...households,
    { id: 'fixture-task-review', kind: 'task', matterId: 'firm_home', householdRef: { kind: 'household', id: 'fixture-household-morgan' }, title: 'Prepare Morgan annual review', status: 'open', priority: 'high', due: '2026-07-15', contextRefs: [] },
    { id: 'fixture-task-welcome', kind: 'task', matterId: 'firm_home', householdRef: { kind: 'household', id: 'fixture-household-chen' }, title: 'Send Chen welcome packet', status: 'open', priority: 'normal', due: '2026-07-18', contextRefs: [] },
    { id: 'fixture-pipeline', kind: 'pipelineDef', matterId: 'firm_home', name: 'New client path', stageIds: ['fixture-stage-discovery', 'fixture-stage-decision'], stageOrder: ['fixture-stage-discovery', 'fixture-stage-decision'], archived: false },
    { id: 'fixture-stage-discovery', kind: 'stageDef', matterId: 'firm_home', pipelineId: 'fixture-pipeline', name: 'Discovery', statusEffect: 'open', triggerRules: [], archived: false },
    { id: 'fixture-stage-decision', kind: 'stageDef', matterId: 'firm_home', pipelineId: 'fixture-pipeline', name: 'Decision', statusEffect: 'open', triggerRules: [], archived: false },
    { id: 'fixture-opportunity', kind: 'opportunity', matterId: 'firm_home', householdId: 'fixture-household-chen', name: 'Chen planning engagement', pipelineId: 'fixture-pipeline', stageId: 'fixture-stage-discovery', amount: { value: 500000, currency: 'USD' }, fee: { value: 4500, currency: 'USD' }, status: 'open', contextRefs: [], tagIds: [], customFields: {} },
  ];
  const { createTemplate } = await import('/src/features/crm-home/workflowLive.ts');
  // Let the production workflow helper make the internally-linked revision
  // identifiers; replacing its id here would make a superficially populated
  // but invalid workflow fixture.
  records.push(createTemplate('Annual review', ['Prepare the agenda', 'Review household goals', 'Send follow-up']));
  await invoke('crm_live_upsert_many', { records });
  const saved = await invoke('crm_live_list');
  const ids = new Set(saved.map((record) => record.id));
  const missing = records.map((record) => record.id).filter((id) => !ids.has(id));
  if (missing.length) throw new Error('Fixture records missing after save: ' + missing.join(', '));
  return { records: records.length, workspace };
})()`);

console.log(`Seeded ${result.records} real CRM records in ${result.workspace}`);
