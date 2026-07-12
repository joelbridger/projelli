#!/usr/bin/env node
// Real desktop proof for pipeline settings, opportunity editing, stage moves,
// workflow proposals, and persistence. Start Vite plus launch-app.sh first.
import { execFileSync } from 'node:child_process';

const root = new URL('../..', import.meta.url).pathname;
const port = process.env.LANTERN_DEV_BRIDGE_PORT || process.env.DESKTOP_CDP_PORT || '9260';
const workspace = process.env.CRM_LOOP_WORKSPACE || '/tmp/crm-pipeline';
const base = `http://127.0.0.1:${port}`;
const stamp = Date.now();
const householdId = `pipeline-household-${stamp}`;
const pipelineId = `pipeline-${stamp}`;
const discoveryId = `pipeline-discovery-${stamp}`;
const decisionId = `pipeline-decision-${stamp}`;
const opportunityId = `pipeline-opportunity-${stamp}`;

function fail(message) { throw new Error(`FAIL: ${message}`); }
async function request(path, query = {}) {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body.ok) fail(body.error || `${path} failed`);
  return body.result;
}
const evaluate = (js) => request('/eval', { js });
const click = (testid) => request('/click', { testid });
const fill = (testid, text) => request('/fill', { testid, text });
async function waitFor(testid, seconds = 15) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    try { if (await evaluate(`Boolean(document.querySelector('[data-testid="${testid}"]'))`)) return; } catch { /* app is restarting */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  fail(`timed out waiting for ${testid}`);
}
async function setSelect(testid, value) {
  await evaluate(`(() => { const element = document.querySelector('[data-testid="${testid}"]'); if (!element) throw new Error('Missing ${testid}'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}
function restart() {
  try { execFileSync('node', ['scripts/desktop-drive.mjs', 'eval', "(async () => { const { relaunch } = await import('@tauri-apps/plugin-process'); await relaunch(); return true; })()"], { cwd: root, env: { ...process.env, DESKTOP_CDP_PORT: port }, stdio: 'ignore' }); } catch { /* expected: old process closes the bridge */ }
}

await request('/health');
await evaluate(`(async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke) throw new Error('Tauri invoke is unavailable');
  await invoke('crm_set_workspace', { path: ${JSON.stringify(workspace)} });
  const save = (record) => invoke('crm_live_upsert', { record });
  await save({ id: ${JSON.stringify(householdId)}, kind: 'household', matterId: ${JSON.stringify(householdId)}, name: 'Pipeline loop household', status: 'prospect' });
  await save({ id: ${JSON.stringify(pipelineId)}, kind: 'pipelineDef', matterId: 'firm_home', name: 'Pipeline loop path', stageIds: [${JSON.stringify(discoveryId)}, ${JSON.stringify(decisionId)}], stageOrder: [${JSON.stringify(discoveryId)}, ${JSON.stringify(decisionId)}], archived: false });
  await save({ id: ${JSON.stringify(discoveryId)}, kind: 'stageDef', matterId: 'firm_home', pipelineId: ${JSON.stringify(pipelineId)}, name: 'Discovery', statusEffect: 'open', triggerRules: [], archived: false });
  await save({ id: ${JSON.stringify(decisionId)}, kind: 'stageDef', matterId: 'firm_home', pipelineId: ${JSON.stringify(pipelineId)}, name: 'Decision', statusEffect: 'open', triggerRules: [{ id: 'loop-trigger', event: 'entered', workflowTemplateId: 'loop-template', proposalRequired: true, enabled: true }], archived: false });
  await save({ id: 'loop-template', kind: 'workflowTemplate', matterId: 'firm_home', name: 'Welcome workflow' });
  await save({ id: ${JSON.stringify(opportunityId)}, kind: 'opportunity', matterId: 'firm_home', householdId: ${JSON.stringify(householdId)}, name: 'Pipeline loop opportunity', pipelineId: ${JSON.stringify(pipelineId)}, stageId: ${JSON.stringify(discoveryId)}, amount: { value: 500000, currency: 'USD' }, fee: { value: 5000, currency: 'USD' }, status: 'open', contextRefs: [], tagIds: [], customFields: {} });
  const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts');
  useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)});
  return true;
})()`);

await waitFor('crm-home-nav-pipeline');
await click('crm-home-nav-pipeline');
await waitFor(`crm-opportunity-edit-${opportunityId}`);
await click(`crm-opportunity-edit-${opportunityId}`);
await fill('crm-opportunity-notes', 'Ready for the advisor to review.');
await setSelect('crm-opportunity-stage', decisionId);
await click('crm-opportunity-save');
await waitFor('crm-pipeline-result');
const records = await evaluate(`window.__TAURI_INTERNALS__.invoke('crm_live_list')`);
const savedOpportunity = records.find((record) => record.id === opportunityId);
const proposal = records.find((record) => record.kind === 'proposalRecord' && record.contextRefs?.some((ref) => ref.id === opportunityId));
if (!savedOpportunity || savedOpportunity.stageId !== decisionId || savedOpportunity.notes !== 'Ready for the advisor to review.') fail('edited opportunity was not saved in the real CRM store');
if (!proposal || proposal.state !== 'pending' || proposal.proposedMutation?.workflowTemplateId !== 'loop-template') fail('stage entry did not save the required workflow approval');
if (records.some((record) => record.kind === 'workflowInstance' && record.householdId === householdId)) fail('a workflow started without approval');

restart();
await waitFor('crm-home-nav-pipeline', 25);
await evaluate(`(async () => { const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts'); useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)}); return true; })()`);
await click('crm-home-nav-pipeline');
await waitFor(`crm-opportunity-edit-${opportunityId}`);
const afterRestart = await evaluate(`window.__TAURI_INTERNALS__.invoke('crm_live_list')`);
const persisted = afterRestart.find((record) => record.id === opportunityId);
if (!persisted || persisted.stageId !== decisionId || persisted.notes !== 'Ready for the advisor to review.') fail('opportunity did not survive the desktop app restart');
console.log('PASS: saved pipeline opportunity, stage-entry approval without auto-run, and desktop restart persistence all worked through the real app.');
