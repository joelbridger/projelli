#!/usr/bin/env node
/**
 * Packaged-app restart proof for the 4 record-depth lanes (compliance-dates,
 * employment, investment-profile, professional-contacts) at a6952a0a.
 *
 * Run phases against two separate launches sharing the same workspace:
 *   node records-drive.mjs enter
 *   node records-drive.mjs verify-after-restart
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const expectedSha = 'a6952a0acfe39d82b0375fcbd6be2ffd16d0b230';
const phase = process.argv[2];
const port = process.env.LANTERN_DEV_BRIDGE_PORT || '9296';
const base = `http://127.0.0.1:${port}`;
const workspace = process.env.CRM_LOOP_WORKSPACE;
const evidenceDir = resolve(
  process.env.TRANCHE1_EVIDENCE_DIR || 'evidence/2026-07-15-tranche1-batch'
);
const statePath = resolve(evidenceDir, 'records-drive-state.json');

const household = {
  id: 'tranche1-batch-records-household',
  kind: 'household',
  name: 'Okafor record-lanes household',
  lifecycle: 'Active',
  primaryAdvisor: 'Priya Shah',
  ownership: 'mine',
  serviceTier: 'Private wealth',
  members: [
    { id: 'member-amara', name: 'Amara Okafor', personType: 'person', roles: [], relatedHouseholds: 1 },
    { id: 'member-chidi', name: 'Chidi Okafor', personType: 'person', roles: [], relatedHouseholds: 1 },
  ],
  externalParties: [],
  facts: [],
  accounts: [],
  notes: [],
  customFields: [],
  tags: [],
  contextRefs: [],
};

const RECORD_FLAGS = [
  'record-compliance-dates',
  'record-employment',
  'record-investment-profile',
  'record-professional-contacts',
];

const compliance = {
  advisoryAgreementSignedOn: '2017-01-18',
  investmentPolicyStatementUpdatedOn: '2026-06-20',
  formAdvDeliveredOn: '2026-03-12',
  formCrsDeliveredOn: '2026-03-12',
  privacyNoticeDeliveredOn: '2026-01-08',
  financialPlanningAgreementRenewedOn: '2026-01-18',
};

const employment = {
  occupation: 'Managing partner, Okafor & Lane Architects',
  employer: 'Okafor & Lane Architects',
  occupationStart: '2002-04-01',
  plannedRetirement: '2027-03-01',
  reducedScheduleContext: 'reduced schedule first',
  income: '284000',
};

const investment = {
  investmentObjective: 'growth',
  riskTolerance: 'moderate',
  timeHorizon: 'over-10-years',
  liquidityNeed: '$180K over next 3 years',
};

const professionalContact = {
  kind: 'cpa',
  name: 'Thomas Lee, CPA',
  relationship: 'Accountant',
  organization: 'Lee & Partners',
  email: 'thomas.lee@example.com',
  phone: '555-0142',
  notes: 'Coordinates year-end tax filing.',
};

if (!workspace) throw new Error('CRM_LOOP_WORKSPACE is required');
if (!['enter', 'verify-after-restart'].includes(phase)) {
  throw new Error('phase must be enter or verify-after-restart');
}

function fail(message) {
  throw new Error(`FAIL records restart drive: ${message}`);
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
  const diagnostic = await evaluate(`document.body.innerText.slice(0, 400)`).catch(() => '(diagnostic eval also failed)');
  console.error(`DIAGNOSTIC body text at failure:\n${diagnostic}`);
  fail(`timed out waiting for ${testid}`);
}

async function waitForPressed(testid, seconds = 15) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await evaluate(`document.querySelector('[data-testid="${testid}"]')?.getAttribute('aria-pressed') === 'true'`)) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  fail(`timed out waiting for ${testid} to become active`);
}

async function waitForGone(testid, seconds = 15) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (!(await evaluate(`Boolean(document.querySelector('[data-testid="${testid}"]'))`))) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  fail(`expected ${testid} to disappear`);
}

async function type(testid, value) {
  await evaluate(`(() => {
    const el = document.querySelector('[data-testid="${testid}"]');
    if (!el) throw new Error('missing input ${testid}');
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc.set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

function screenshot(name) {
  mkdirSync(evidenceDir, { recursive: true });
  const target = resolve(evidenceDir, name);
  execFileSync('scrot', ['-o', target], { stdio: 'ignore' });
  console.log(`SCREENSHOT ${target}`);
}

async function scrollToTestid(testid) {
  await evaluate(`(() => {
    document.querySelector('[data-testid="${testid}"]')?.scrollIntoView({ block: 'start', inline: 'nearest' });
    return true;
  })()`);
  await new Promise((done) => setTimeout(done, 250));
}

async function setWorkspaceAndFlags() {
  await request('/health');
  await new Promise((done) => setTimeout(done, 300));
  const result = await evaluate(`(async () => {
    try {
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (!invoke) throw new Error('Tauri invoke is not ready');
      await invoke('crm_set_workspace', { path: ${JSON.stringify(workspace)} });
      const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts');
      useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)});
      const { setDevFlagOverride } = await import('/src/platform/flags/index.ts');
      for (const id of ${JSON.stringify(RECORD_FLAGS)}) setDevFlagOverride(id, true);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: String((e && e.message) || e), stack: String((e && e.stack) || '') };
    }
  })()`);
  if (!result.ok) fail(`setWorkspaceAndFlags failed: ${result.message}\n${result.stack}`);
  await waitFor('spine-nav-home');
}

async function nativeList() {
  return evaluate(`window.__TAURI_INTERNALS__.invoke('crm_live_list')`);
}

// The Clients surface persists the last-selected household across
// navigations (readSelectedCrmHousehold/writeSelectedCrmHousehold), so
// clicking spine-nav-matters again -- even after visiting Home first -- can
// land straight back on the record page instead of the bare directory. Poll
// for whichever of the two actually shows up instead of assuming the
// directory always appears.
// Checked BEFORE any navigation click (not after) to avoid a race against
// the Clients surface's persisted-selection auto-navigation, which can
// briefly show the bare directory before routing straight into the
// previously-selected household.
async function openHouseholdClientMapTab() {
  const alreadyOnRecord = await evaluate(
    `Boolean(document.querySelector('[data-testid="crm-household-record"]'))`
  );
  if (alreadyOnRecord) {
    await waitFor('crm-household-tab-client_map');
    await click('crm-household-tab-activity');
    await waitForPressed('crm-household-tab-activity');
    await click('crm-household-tab-client_map');
    await waitForPressed('crm-household-tab-client_map');
  } else {
    await click('spine-nav-home');
    await waitFor('spine-nav-home');
    await click('spine-nav-matters');
    // Give the persisted-selection auto-navigation (if any) a moment to
    // route straight into the record before falling back to the directory.
    const quickDeadline = Date.now() + 3_000;
    let landedOnRecord = false;
    while (Date.now() < quickDeadline) {
      landedOnRecord = await evaluate(`Boolean(document.querySelector('[data-testid="crm-household-record"]'))`);
      if (landedOnRecord) break;
      await new Promise((done) => setTimeout(done, 150));
    }
    if (!landedOnRecord) {
      await waitFor('crm-directory-surface');
      await waitFor(`crm-directory-household-${household.id}`, 45);
      await click(`crm-directory-household-${household.id}`);
      await waitFor('crm-household-record');
    }
    await waitFor('crm-household-tab-client_map');
    await click('crm-household-tab-client_map');
    await waitForPressed('crm-household-tab-client_map');
  }
  await evaluate(`(() => { window.scrollTo(0, 0); return true; })()`);
}

async function enterComplianceDates() {
  await waitFor('compliance-dates-written-agreements');
  await click('compliance-dates-edit');
  for (const [field, value] of Object.entries(compliance)) {
    await type(`compliance-dates-input-${field}`, value);
  }
  await click('compliance-dates-save');
  await waitFor('compliance-dates-edit');
}

async function enterEmployment() {
  await waitFor('crm-employment-section');
  await click('crm-employment-edit');
  await type('crm-employment-occupation', employment.occupation);
  await type('crm-employment-employer', employment.employer);
  await type('crm-employment-start', employment.occupationStart);
  await type('crm-employment-retirement', employment.plannedRetirement);
  await type('crm-employment-reduced-schedule', employment.reducedScheduleContext);
  await type('crm-employment-income', employment.income);
  await click('crm-employment-save');
  await waitFor('crm-employment-occupation-value');
}

async function enterInvestmentProfile() {
  await waitFor('investment-profile-section');
  await evaluate(`(() => {
    const section = document.querySelector('[data-testid="investment-profile-section"]');
    const selects = Array.from(section.querySelectorAll('select'));
    const values = ${JSON.stringify([
      investment.investmentObjective,
      investment.riskTolerance,
      investment.timeHorizon,
    ])};
    selects.forEach((select, index) => {
      const proto = Object.getPrototypeOf(select);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc.set.call(select, values[index]);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const liquidity = section.querySelector('#liquidity-need');
    const liqProto = Object.getPrototypeOf(liquidity);
    const liqDesc = Object.getOwnPropertyDescriptor(liqProto, 'value');
    liqDesc.set.call(liquidity, ${JSON.stringify(investment.liquidityNeed)});
    liquidity.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await click('investment-profile-save');
  await new Promise((done) => setTimeout(done, 300));
}

async function enterProfessionalContacts() {
  await waitFor('professional-contacts-section');
  await click(`professional-contacts-edit-${professionalContact.kind}`);
  await waitFor(`professional-contacts-editor-${professionalContact.kind}`);
  await type(`professional-contacts-name-${professionalContact.kind}`, professionalContact.name);
  await type(`professional-contacts-relationship-${professionalContact.kind}`, professionalContact.relationship);
  await type(`professional-contacts-organization-${professionalContact.kind}`, professionalContact.organization);
  await type(`professional-contacts-email-${professionalContact.kind}`, professionalContact.email);
  await type(`professional-contacts-phone-${professionalContact.kind}`, professionalContact.phone);
  await type(`professional-contacts-notes-${professionalContact.kind}`, professionalContact.notes);
  await click(`professional-contacts-save-${professionalContact.kind}`);
  await waitFor(`professional-contacts-summary-${professionalContact.kind}`);
}

async function enterPhase() {
  await setWorkspaceAndFlags();
  const existing = await nativeList();
  const already = existing.some((item) => item.id === household.id);
  if (!already) {
    await evaluate(`window.__TAURI_INTERNALS__.invoke('crm_live_upsert', { record: ${JSON.stringify(household)} })`);
  }
  await openHouseholdClientMapTab();
  await enterComplianceDates();
  await enterEmployment();
  await enterInvestmentProfile();
  await enterProfessionalContacts();

  // Re-open to confirm this render reflects the saved store, then screenshot.
  await openHouseholdClientMapTab();
  await waitFor('compliance-dates-written-agreements');
  await waitFor('crm-employment-section');
  await waitFor('investment-profile-section');
  await waitFor('professional-contacts-section');
  await scrollToTestid('professional-contacts-section');
  screenshot('11-records-entered-before-restart.png');

  const record = (await nativeList()).find((item) => item.id === household.id);
  if (!record) fail('household record not found after entering data');
  writeFileSync(
    statePath,
    `${JSON.stringify({ expectedSha, householdId: household.id, extensionData: record.extensionData ?? null }, null, 2)}\n`
  );
  console.log(`PASS enter: real data entered into all four record sections via their Save actions and saved state to ${statePath}`);
}

async function verifyAfterRestartPhase() {
  await setWorkspaceAndFlags();
  const expected = JSON.parse(readFileSync(statePath, 'utf8'));
  const record = (await nativeList()).find((item) => item.id === household.id);
  if (!record) fail('household record missing after restart');
  const actualExtensionData = record.extensionData ?? null;
  if (JSON.stringify(actualExtensionData) !== JSON.stringify(expected.extensionData)) {
    fail(`extensionData changed across restart:\nexpected=${JSON.stringify(expected.extensionData)}\nactual=${JSON.stringify(actualExtensionData)}`);
  }
  await openHouseholdClientMapTab();
  await waitFor('compliance-dates-written-agreements');
  await waitFor('crm-employment-section');
  await waitFor('investment-profile-section');
  await waitFor('professional-contacts-section');
  const proof = await evaluate(`(() => ({
    compliance: document.querySelector('[data-testid="compliance-dates-written-agreements"]')?.textContent || '',
    employmentOccupation: document.querySelector('[data-testid="crm-employment-occupation-value"]')?.textContent || '',
    employmentIncome: document.querySelector('[data-testid="crm-employment-income-value"]')?.textContent || '',
    investment: document.querySelector('[data-testid="investment-profile-section"]')?.textContent || '',
    contact: document.querySelector('[data-testid="professional-contacts-summary-${professionalContact.kind}"]')?.textContent || '',
  }))()`);
  for (const [label, needle] of [
    ['compliance advisory-agreement date', 'Jan 18, 2017'],
    ['employment occupation', employment.occupation],
    ['professional contact name', professionalContact.name],
  ]) {
    const haystack = `${proof.compliance} ${proof.employmentOccupation} ${proof.investment} ${proof.contact}`;
    if (!haystack.includes(needle)) fail(`missing rehydrated ${label}: expected to find "${needle}"`);
  }
  if (!proof.contact.includes(professionalContact.organization)) {
    fail('professional contact organization did not rehydrate');
  }
  await scrollToTestid('professional-contacts-section');
  screenshot('12-records-rehydrated-after-restart.png');
  console.log('PASS verify-after-restart: extensionData byte-identical across restart and all four sections rehydrated their real values in the UI');
}

async function runPhase() {
  mkdirSync(dirname(statePath), { recursive: true });
  if (phase === 'enter') return enterPhase();
  if (phase === 'verify-after-restart') return verifyAfterRestartPhase();
}

try {
  // Mirrors vision-drive.mjs: the dev bridge has shown occasional transient
  // failures unrelated to the app itself; retry the whole phase (idempotent)
  // before giving up for real.
  let lastError;
  let succeeded = false;
  for (let attempt = 1; attempt <= 3 && !succeeded; attempt += 1) {
    try {
      await runPhase();
      succeeded = true;
    } catch (error) {
      lastError = error;
      console.error(`attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`);
      if (attempt < 3) await new Promise((done) => setTimeout(done, 2000));
    }
  }
  if (!succeeded) throw lastError;
} catch (error) {
  console.error(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
  process.exitCode = 1;
}
