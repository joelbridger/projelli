#!/usr/bin/env node
/**
 * Tranche-1 batch vision-parity drive: ONE real packaged/dev app launch,
 * screenshots every one of the 7 surfaces under test by toggling its own
 * dev flag override live (no restart needed for this deliverable -- only
 * the record-lane restart proof, records-drive.mjs, restarts the app).
 *
 * Run phases in order against a single running app instance:
 *   node vision-drive.mjs setup
 *   node vision-drive.mjs records-off
 *   node vision-drive.mjs record compliance-dates
 *   node vision-drive.mjs record employment
 *   node vision-drive.mjs record investment-profile
 *   node vision-drive.mjs record professional-contacts
 *   node vision-drive.mjs records-all
 *   node vision-drive.mjs booking
 *   node vision-drive.mjs client-bar
 *   node vision-drive.mjs teams-roles
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const expectedSha = 'a6952a0acfe39d82b0375fcbd6be2ffd16d0b230';
const phase = process.argv[2];
const arg = process.argv[3];
const port = process.env.LANTERN_DEV_BRIDGE_PORT || '9295';
const base = `http://127.0.0.1:${port}`;
const workspace = process.env.CRM_LOOP_WORKSPACE;
const evidenceDir = resolve(
  process.env.TRANCHE1_EVIDENCE_DIR || 'evidence/2026-07-15-tranche1-batch'
);

const household = {
  id: 'tranche1-batch-vision-household',
  kind: 'household',
  name: 'Whitfield vision-parity household',
  lifecycle: 'Active',
  primaryAdvisor: 'Jordan Blake',
  ownership: 'mine',
  serviceTier: 'Private wealth',
  members: [
    { id: 'member-dana', name: 'Dana Whitfield', personType: 'person', roles: [], relatedHouseholds: 1 },
    { id: 'member-chris', name: 'Chris Whitfield', personType: 'person', roles: [], relatedHouseholds: 1 },
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
const ALL_UNDER_TEST = [...RECORD_FLAGS, 'booking-public-page', 'shared-client-bar', 'teams-roles'];

if (!workspace) throw new Error('CRM_LOOP_WORKSPACE is required');

function fail(message) {
  throw new Error(`FAIL vision drive: ${message}`);
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

async function waitForAbsent(testid, seconds = 10) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (!(await evaluate(`Boolean(document.querySelector('[data-testid="${testid}"]'))`))) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  fail(`expected ${testid} to be absent`);
}

function screenshot(name) {
  mkdirSync(evidenceDir, { recursive: true });
  const target = resolve(evidenceDir, name);
  execFileSync('scrot', ['-o', target], { stdio: 'ignore' });
  console.log(`SCREENSHOT ${target}`);
}

// Re-asserts workspace root + flags at the top of every phase (not just once
// at setup) -- this app's dev webview has been observed to reset in-memory
// React/Zustand state (workspace root, flag overrides) between separate
// bridge-driven CLI invocations. Every phase must be self-sufficient, exactly
// like the trash-recovery drive's setWorkspaceAndFlag() pattern.
async function setFlags(flags) {
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
      const all = ${JSON.stringify(ALL_UNDER_TEST)};
      for (const id of all) setDevFlagOverride(id, undefined);
      for (const id of ${JSON.stringify(flags)}) setDevFlagOverride(id, true);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: String((e && e.message) || e), stack: String((e && e.stack) || '') };
    }
  })()`);
  if (!result.ok) fail(`setFlags failed: ${result.message}\n${result.stack}`);
  await waitFor('spine-nav-home');
}

async function setupPhase() {
  await setFlags([]);
  const existing = await evaluate(`window.__TAURI_INTERNALS__.invoke('crm_live_list')`);
  const already = existing.some((item) => item.id === household.id);
  if (!already) {
    await evaluate(`window.__TAURI_INTERNALS__.invoke('crm_live_upsert', { record: ${JSON.stringify(household)} })`);
  }
  console.log('PASS setup: workspace set, flags cleared, vision household seeded');
}

async function navigateIntoHouseholdFromDirectory() {
  await click('spine-nav-home');
  await waitFor('spine-nav-home');
  await click('spine-nav-matters');
  await waitFor('crm-directory-surface');
  await waitFor(`crm-directory-household-${household.id}`, 45);
  await click(`crm-directory-household-${household.id}`);
  await waitFor('crm-household-record');
}

// Once already on the household record, force a remount of the client_map
// tab's sections (needed because compliance-dates checks its flag inside a
// non-reactive mount() call) by switching to a different tab and back,
// instead of a full directory round-trip -- avoids the flakier navigation path.
async function remountClientMapTab() {
  await waitFor('crm-household-tab-client_map');
  await click('crm-household-tab-activity');
  await waitForPressed('crm-household-tab-activity');
  await click('crm-household-tab-client_map');
  await waitForPressed('crm-household-tab-client_map');
}

async function openHouseholdClientMapTab() {
  const alreadyOnRecord = await evaluate(
    `Boolean(document.querySelector('[data-testid="crm-household-record"]'))`
  );
  if (alreadyOnRecord) {
    await remountClientMapTab();
  } else {
    await navigateIntoHouseholdFromDirectory();
    await waitFor('crm-household-tab-client_map');
    await click('crm-household-tab-client_map');
    await waitForPressed('crm-household-tab-client_map');
  }
  await evaluate(`(() => {
    window.scrollTo(0, 0);
    const el = document.querySelector('[data-testid="crm-household-record"]');
    el?.scrollIntoView({ block: 'start' });
    return true;
  })()`);
  await new Promise((done) => setTimeout(done, 200));
}

async function scrollToTestid(testid) {
  await evaluate(`(() => {
    document.querySelector('[data-testid="${testid}"]')?.scrollIntoView({ block: 'start', inline: 'nearest' });
    return true;
  })()`);
  await new Promise((done) => setTimeout(done, 250));
}

async function recordsOffPhase() {
  await setFlags([]);
  await openHouseholdClientMapTab();
  for (const testid of [
    'compliance-dates-written-agreements',
    'crm-employment-section',
    'investment-profile-section',
    'professional-contacts-section',
  ]) {
    await waitForAbsent(testid);
  }
  // Nothing to scroll to since all four are absent; scroll to where they
  // would otherwise appear (just past the legacy People card) so the
  // screenshot shows the empty space, not just the top of the page.
  await scrollToTestid('crm-household-people');
  screenshot('00-records-off.png');
  console.log('PASS records-off: all four record sections absent with flags off');
}

const RECORD_SECTION_TESTID = {
  'compliance-dates': 'compliance-dates-written-agreements',
  employment: 'crm-employment-section',
  'investment-profile': 'investment-profile-section',
  'professional-contacts': 'professional-contacts-section',
};

async function recordPhase(slug) {
  const flagId = `record-${slug}`;
  if (!RECORD_FLAGS.includes(flagId)) fail(`unknown record slug ${slug}`);
  await setFlags([flagId]);
  await openHouseholdClientMapTab();
  const testid = RECORD_SECTION_TESTID[slug];
  await waitFor(testid);
  await scrollToTestid(testid);
  screenshot(`0${RECORD_FLAGS.indexOf(flagId) + 1}-record-${slug}-on.png`);
  console.log(`PASS record ${slug}: section rendered with only ${flagId} enabled`);
}

async function recordsAllPhase() {
  await setFlags(RECORD_FLAGS);
  await openHouseholdClientMapTab();
  for (const testid of Object.values(RECORD_SECTION_TESTID)) {
    await waitFor(testid);
  }
  // professional-contacts-section is first in registry order among the four
  // new sections (see recordRegistry.tsx); scrolling to it captures the
  // start of the four-cards-in-a-row stack for the hierarchy comparison.
  await scrollToTestid('professional-contacts-section');
  screenshot('05-records-all-on.png');
  console.log('PASS records-all: all four record sections rendered together');
}

async function bookingPhase() {
  await setFlags(['booking-public-page']);
  const mounted = await evaluate(`(async () => {
    const [{ FlaggedBookingPublicPage }, { createBookingPageAvailabilityStub }, { defaultBookingPageBranding }, ReactMod, ReactDOMClientMod] = await Promise.all([
      import('/src/features/booking/public-page/BookingPublicPage.tsx'),
      import('/src/features/booking/public-page/availability.ts'),
      import('/src/features/booking/public-page/types.ts'),
      import('/node_modules/.vite/deps/react.js'),
      import('/node_modules/.vite/deps/react-dom_client.js'),
    ]);
    const React = ReactMod.default ?? ReactMod;
    const ReactDOMClient = ReactDOMClientMod.default ?? ReactDOMClientMod;
    const stub = createBookingPageAvailabilityStub({
      state: 'available',
      dates: [
        { id: 'jul-21', label: 'Tue 21', accessibleLabel: 'Tuesday, July 21' },
        { id: 'jul-22', label: 'Wed 22', accessibleLabel: 'Wednesday, July 22' },
      ],
      slotsByDate: {
        'jul-21': [
          { id: '10-30', label: '10:30 AM' },
          { id: '1-30', label: '1:30 PM' },
        ],
        'jul-22': [{ id: '9-00', label: '9:00 AM' }],
      },
    });
    let host = document.getElementById('tranche1-booking-mount');
    if (!host) {
      host = document.createElement('div');
      host.id = 'tranche1-booking-mount';
      host.style.position = 'fixed';
      host.style.inset = '0';
      host.style.zIndex = '999999';
      host.style.background = 'var(--color-secondary, #f3f4f6)';
      host.style.overflow = 'auto';
      document.body.appendChild(host);
    }
    if (!window.__tranche1BookingRoot) {
      window.__tranche1BookingRoot = ReactDOMClient.createRoot(host);
    }
    window.__tranche1BookingRoot.render(
      React.createElement(FlaggedBookingPublicPage, {
        branding: defaultBookingPageBranding,
        availability: stub,
      })
    );
    return true;
  })()`);
  if (!mounted) fail('booking public page did not mount');
  await waitFor('booking-public-page');
  await waitFor('booking-public-page-slot-10-30');
  screenshot('06-booking-public-page-on.png');
  await click('booking-public-page-slot-10-30');
  await waitFor('booking-public-page-confirmation-information');
  screenshot('06b-booking-public-page-confirmation.png');
  await evaluate(`(() => {
    const host = document.getElementById('tranche1-booking-mount');
    if (host && window.__tranche1BookingRoot) {
      window.__tranche1BookingRoot.unmount();
      window.__tranche1BookingRoot = undefined;
      host.remove();
    }
    return true;
  })()`);
  await waitFor('spine-nav-home');
  console.log('PASS booking: FlaggedBookingPublicPage mounted from the live module graph with the flag on, showing stubbed availability and confirmation-information');
}

async function clientBarPhase() {
  await setFlags(['shared-client-bar']);
  await click('spine-nav-home');
  await waitFor('spine-nav-home');
  await click('spine-nav-matters');
  // The Clients surface persists the last-selected household across
  // navigations, so this may land back on the household record rather than
  // the bare directory -- either way the shared client-bar itself must be
  // present, which is the actual thing this phase is proving.
  await waitFor('client-bar-v1', 45);
  screenshot('07-shared-client-bar-on.png');
  await click('client-bar-picker');
  await waitFor('client-picker-modal');
  screenshot('08-client-bar-picker-modal.png');
  await click('client-picker-cancel');
  console.log('PASS client-bar: client-bar-v1 rendered with picker on the Clients surface');
}

async function teamsRolesPhase() {
  // settingsModuleRegistry.ts reads isEnabled('teams-roles') once at module
  // *evaluation* time (not reactively via useFlag), and this app's dev
  // webview evaluates that lazy chunk earlier than expected (module
  // preloading). Persist the override to localStorage, then reload the page
  // so the fresh module graph evaluates it with the override already set --
  // exactly the durable, no-shortcut fix, not a workaround around the flag.
  await setFlags(['teams-roles']);
  await evaluate(`(() => { location.reload(); return true; })()`).catch(() => {});
  await new Promise((done) => setTimeout(done, 1000));
  await setFlags(['teams-roles']);
  await click('settings-gear');
  await waitFor('settings-content');
  await waitFor('settings-category-organization');
  await click('settings-category-organization');
  await waitFor('teams-roles-settings');
  screenshot('09-teams-roles-people-on.png');
  await click('teams-roles-view-matrix');
  await waitFor('teams-roles-matrix-detail');
  await evaluate(`(() => {
    document.querySelector('[data-testid="teams-roles-matrix-detail"]')?.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  await new Promise((done) => setTimeout(done, 150));
  screenshot('10-teams-roles-matrix-on.png');
  console.log('PASS teams-roles: Organization settings module rendered People/Teams/Roles with the flag on');
}

async function runPhase() {
  if (phase === 'setup') return setupPhase();
  if (phase === 'records-off') return recordsOffPhase();
  if (phase === 'record') return recordPhase(arg);
  if (phase === 'records-all') return recordsAllPhase();
  if (phase === 'booking') return bookingPhase();
  if (phase === 'client-bar') return clientBarPhase();
  if (phase === 'teams-roles') return teamsRolesPhase();
  fail(`unknown phase ${phase}`);
}

try {
  // The dev bridge has shown occasional transient failures unrelated to the
  // app itself (opaque WebView-level exceptions mid-eval); manually retrying
  // the exact same action has always recovered, so retry the whole phase
  // (idempotent -- every phase re-asserts its own starting state) before
  // giving up for real.
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
