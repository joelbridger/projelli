#!/usr/bin/env bun
/**
 * Runs the parity manifest against a real Tauri process. It deliberately does
 * not use React test doubles or browser storage: every write goes through the
 * desktop bridge, and every passing assertion must restart the native app.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FEATURES,
  SKIPPED_FEATURES,
  type ParityApp,
  type ParityFeature,
} from './manifest';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
// A parity run owns both ports. Fixed defaults let two simultaneous runs talk
// to the wrong app, which turns a setup problem into a fake score.
const defaultBridgePort = 20_000 + (process.pid % 20_000) * 2;
const port = Number(
  process.env['PARITY_BRIDGE_PORT'] ?? String(defaultBridgePort)
);
// The debug desktop binary has Tauri's development address compiled in as
// :5174. A different Vite port means the bridge can start while its renderer
// is blank, then every feature falsely fails.
const vitePort = 5174;
const requestedVitePort = process.env['PARITY_VITE_PORT'];
// A lane may deliberately share the one compatible Vite server while keeping
// its desktop bridge and encrypted workspace private. This is opt-in: the
// default still rejects a competing server so an accidental collision cannot
// turn into a misleading score.
// DEFAULT TO REUSE (2026-07-12): the binary's dev address is compiled to :5174, and
// build crews legitimately hold that port with their own app instances. Demanding an
// exclusive Vite made the scoreboard fail with an INFRASTRUCTURE ERROR whenever a crew
// was working — and this scoreboard is the merge trigger for the whole combined product,
// so it must run at any time. Each run still gets its OWN bridge port + OWN encrypted
// workspace, so scores stay isolated. Set PARITY_REUSE_VITE=0 to force an exclusive server.
const reuseVite = process.env['PARITY_REUSE_VITE'] !== '0';
const workspaceRoot =
  process.env['PARITY_WORKSPACE'] ?? `/tmp/lantern-parity-${process.pid}`;
const reportPath = resolve(root, 'tests/parity/parity-report.json');
const base = `http://127.0.0.1:${port}`;
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
let migrationBaseUrl: string | undefined;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Could not reserve a simulator port'));
      });
    });
  });
}
// The desktop bridge accepts a timeout per request. Use the same generous
// ceiling as the launch harness so a cold encrypted store is not confused
// with a failing feature.
const bridgeTimeoutMs = process.env['LANTERN_DEV_BRIDGE_TIMEOUT_MS'] ?? '20000';

type Result = {
  id: string;
  name: string;
  area: string;
  verdict: string;
  status: 'BUILT' | 'FAILING' | 'PENDING';
  detail: string;
};

function fail(message: string): never {
  throw new Error(message);
}

class InfrastructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InfrastructureError';
  }
}

async function http(
  path: string,
  query: Record<string, string> = {}
): Promise<unknown> {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query))
    url.searchParams.set(key, value);
  if (path !== '/health') url.searchParams.set('timeout_ms', bridgeTimeoutMs);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new InfrastructureError(
      `Cannot reach the desktop bridge at ${base}${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  let body: { ok?: boolean; result?: unknown; error?: string };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new InfrastructureError(
      `Desktop bridge returned an invalid response for ${path}`
    );
  }
  if (!response.ok || !body.ok) {
    if (
      path === '/health' ||
      /timed out|renderer.*unavailable|bridge.*closed/i.test(body.error ?? '')
    ) {
      throw new InfrastructureError(body.error ?? `${path} failed`);
    }
    fail(body.error ?? `${path} failed`);
  }
  return body.result;
}

async function waitForBridge(seconds = 30): Promise<void> {
  const end = Date.now() + seconds * 1_000;
  let last = 'not started';
  while (Date.now() < end) {
    try {
      await http('/health');
      return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(150);
  }
  throw new InfrastructureError(`Desktop bridge did not start: ${last}`);
}

async function portReady(target: number): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${target}`)).ok;
  } catch {
    return false;
  }
}

function start(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): ChildProcess {
  return spawn(command, args, {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Each helper owns a process group, so cleanup also reaches Vite's child
    // process instead of leaving :5174 occupied for the next parity run.
    detached: true,
  });
}

function stop(child: ChildProcess | undefined): void {
  if (!child?.pid || child.killed) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

function matrixInventory(): { active: string[]; skipped: string[] } {
  const active: string[] = [];
  const skipped: string[] = [];
  for (const line of readFileSync(
    resolve(root, 'design/01-wealthbox-feature-matrix.md'),
    'utf8'
  ).split('\n')) {
    if (!line.startsWith('|')) continue;
    const columns = line.split('|').map((value) => value.trim());
    const verdict = columns.at(-2) ?? '';
    if (!/^(REPLICATE|IMPROVE|SKIP)/.test(verdict)) continue;
    (verdict.startsWith('SKIP') ? skipped : active).push(columns[1] ?? '');
  }
  return { active, skipped };
}

function sameMultiset(
  actual: readonly string[],
  expected: readonly string[]
): boolean {
  return (
    [...actual].sort().join('\u0000') === [...expected].sort().join('\u0000')
  );
}

function validateManifest(): void {
  const matrix = matrixInventory();
  const active = FEATURES.map((feature) => feature.matrixFeature);
  const skipped = SKIPPED_FEATURES.map((feature) => feature.matrixFeature);
  if (!sameMultiset(active, matrix.active))
    fail(
      `Manifest does not match every REPLICATE/IMPROVE matrix row. Manifest=${active.length}, matrix=${matrix.active.length}`
    );
  if (!sameMultiset(skipped, matrix.skipped))
    fail(
      `Skipped feature list does not match every SKIP matrix row. Manifest=${skipped.length}, matrix=${matrix.skipped.length}`
    );
  for (const feature of FEATURES) {
    if (!feature.assert && !feature.pending)
      fail(`${feature.id} has neither an assertion nor a pending reason`);
    if (feature.assert && feature.pending)
      fail(`${feature.id} cannot be both live and pending`);
  }
}

class DesktopParityApp implements ParityApp {
  restarts = 0;
  private sequence = 0;

  private async eval(js: string): Promise<unknown> {
    return http('/eval', { js });
  }
  private async exists(testid: string): Promise<boolean> {
    return Boolean(
      await this.eval(
        `Boolean(document.querySelector('[data-testid="${testid}"]'))`
      )
    );
  }
  private async require(testid: string): Promise<void> {
    if (!(await this.exists(testid)))
      fail(`Missing required control: ${testid}`);
  }
  private async click(testid: string): Promise<void> {
    await this.require(testid);
    await http('/click', { testid });
  }
  private async fill(testid: string, value: string): Promise<void> {
    await this.require(testid);
    await http('/fill', { testid, text: value });
  }
  private async select(testid: string, value: string): Promise<void> {
    await this.require(testid);
    await this.eval(
      `(() => { const element = document.querySelector('[data-testid="${testid}"]'); if (!(element instanceof HTMLSelectElement)) throw new Error('Not a select: ${testid}'); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event('change', { bubbles: true })); return element.value; })()`
    );
  }
  private async text(): Promise<string> {
    return String(await this.eval('document.body.innerText'));
  }
  private async requireText(value: string): Promise<void> {
    if (!(await this.text()).includes(value))
      fail(`Expected visible text: ${value}`);
  }
  private async waitForText(value: string): Promise<void> {
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      if ((await this.text()).includes(value)) return;
      await delay(150);
    }
    fail(`Expected visible text: ${value}`);
  }
  private async waitForControl(testid: string): Promise<void> {
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      if (await this.exists(testid)) return;
      await delay(150);
    }
    fail(`Missing required control: ${testid}`);
  }
  private token(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${Date.now()}-${this.sequence}`;
  }

  async ready(): Promise<void> {
    // Open the first workspace through the same normal auto-resume path an
    // advisor uses.  Setting only Zustand's rootPath leaves the picker open,
    // because that skips the lifecycle commit which dismisses it.  The old
    // shortcut therefore made every parity feature fail before a CRM screen
    // could mount.
    const firstRendererDeadline = Date.now() + 30_000;
    let rendererReady = false;
    while (Date.now() < firstRendererDeadline) {
      try {
        await this.eval('document.readyState');
        rendererReady = true;
        break;
      } catch {
        // The desktop bridge comes up before the WebView has its first page.
        // Polling the real renderer prevents a slow cold start from becoming
        // a fictional feature failure.
        await delay(150);
      }
    }
    if (!rendererReady)
      throw new InfrastructureError('The desktop renderer did not become ready');
    await this.eval(`(() => {
      localStorage.setItem('lantern_onboarding_complete', 'true');
      localStorage.setItem('keepance_feature_tour_dismissed', 'true');
      localStorage.setItem('keepance_feature_tour_completed', 'true');
      localStorage.setItem('lantern:settings', JSON.stringify({ state: { featuresTourCompleted: true, _migrated: true }, version: 0 }));
      localStorage.setItem('lantern_recent_workspaces', JSON.stringify([{
        path: ${JSON.stringify(workspaceRoot)},
        name: 'Parity verification firm',
        lastOpened: new Date().toISOString(),
      }]));
      // Returning from an in-page evaluation after calling reload directly is
      // racy: WebKit tears down the evaluation before the dev bridge can send
      // its success response. Schedule the normal reload for the next turn so
      // this is still a real fresh renderer, but the driver can observe it.
      setTimeout(() => location.reload(), 0);
      return true;
    })()`);
    const shellDeadline = Date.now() + 30_000;
    while (Date.now() < shellDeadline) {
      try {
        if (await this.exists('spine-nav')) break;
      } catch {
        // The WebView is briefly unavailable while the real page reloads.
      }
      await delay(150);
    }
    if (!(await this.exists('spine-nav'))) {
      fail('The desktop app never completed its normal fresh-workspace open');
    }
    await this.setWorkspace('startup');
    await this.openHome();
  }

  private async setWorkspace(
    name: string
  ): Promise<{ path: string; householdId: string }> {
    const path = `${workspaceRoot}/${name}`;
    const householdId = `parity-household-${this.token(name)}`;
    await this.eval(`(async () => {
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (!invoke) throw new Error('Tauri invoke is unavailable');
      await invoke('crm_set_workspace', { path: ${JSON.stringify(path)} });
      const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts');
      useWorkspaceStore.getState().setRootPath(${JSON.stringify(path)});
      await invoke('crm_live_upsert', { record: { id: ${JSON.stringify(householdId)}, kind: 'household', matterId: ${JSON.stringify(householdId)}, name: 'Parity household', status: 'active' } });
      await invoke('crm_live_upsert', { record: { id: 'parity-firm-member', kind: 'firmDirectoryEntry', matterId: 'firm_home', userId: 'parity-user', displayName: 'Parity teammate', title: 'Owner', teamLabels: ['Client service'], active: true } });
      await invoke('crm_live_upsert', { record: { id: 'parity-meeting', kind: 'activityEvent', matterId: 'firm_home', verb: 'meeting.captured', summary: 'Parity review meeting', at: new Date().toISOString() } });
      return true;
    })()`);
    // Switching the live CRM store also remounts the app surface. Let that
    // visible transition settle before asking the newly mounted Home rail for
    // a control. A short quarter-second wait observed the old surface and
    // produced a false "missing control" verdict.
    await delay(1_000);
    return { path, householdId };
  }

  private async records(): Promise<Array<Record<string, unknown>>> {
    const result = await this.eval(
      `window.__TAURI_INTERNALS__.invoke('crm_live_list')`
    );
    if (!Array.isArray(result)) fail('CRM record store did not return a list');
    return result as Array<Record<string, unknown>>;
  }

  /** Open the visible Home destination after a workspace switch or restart. */
  private async openHome(): Promise<void> {
    if (await this.exists('crm-home-nav-tasks')) return;
    await this.click('spine-nav-home');
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      if (await this.exists('crm-home-nav-tasks')) return;
      await delay(150);
    }
    fail('The desktop app did not show Home work surfaces');
  }

  async restart(): Promise<void> {
    // A renderer reload is not enough. This triggers Tauri's real relaunch and
    // waits for its fresh local bridge before the assertion continues.
    try {
      await this.eval(
        `(async () => { const { relaunch } = await import('@tauri-apps/plugin-process'); await relaunch(); return true; })()`
      );
    } catch {
      /* expected: old bridge dies first */
    }
    await waitForBridge(30);
    this.restarts += 1;
    const shellDeadline = Date.now() + 15_000;
    while (Date.now() < shellDeadline) {
      if (await this.exists('spine-nav')) break;
      await delay(150);
    }
    await this.openHome();
  }

  async task(options: {
    recurrence?: boolean;
    priority?: boolean;
    assignee?: boolean;
    activity?: boolean;
    unified?: boolean;
    triage?: boolean;
  }): Promise<void> {
    const { householdId } = await this.setWorkspace('tasks');
    await this.openHome();
    const title = this.token('Parity task');
    await this.click('crm-home-nav-tasks');
    await this.click('crm-task-new');
    await this.fill('crm-task-title-input', title);
    await this.fill('crm-task-body', 'Created by the parity acceptance check.');
    await this.select('crm-task-household', householdId);
    if (options.assignee) await this.select('crm-task-assignee', 'parity-user');
    if (options.priority) await this.select('crm-task-priority', 'high');
    if (options.recurrence) await this.select('crm-task-recurrence', 'weekly');
    await this.click('crm-task-save');
    await this.waitForText(title);
    const beforeRestart = await this.records();
    const saved = beforeRestart.find(
      (record) => record.kind === 'task' && record.title === title
    );
    if (!saved) fail('Saving the task did not create a CRM task record');
    if (options.assignee && saved.assigneeUserId !== 'parity-user')
      fail('Task assignee did not save');
    if (options.priority && saved.priority !== 'high')
      fail('Task priority did not save');
    if (
      options.recurrence &&
      (saved.recurrence as { freq?: unknown } | undefined)?.freq !== 'weekly'
    )
      fail('Task recurrence did not save');
    if (options.recurrence) {
      await this.click(`crm-task-complete-${String(saved.id)}`);
      const end = Date.now() + 10_000;
      let nextCreated = false;
      while (Date.now() < end) {
        const afterCompletion = await this.records();
        nextCreated = afterCompletion.some(
          (record) =>
            record.kind === 'task' &&
            record.title === title &&
            record.id !== saved.id &&
            record.status !== 'done'
        );
        if (nextCreated) break;
        await delay(150);
      }
      if (!nextCreated)
        fail(
          'Completing a recurring task did not create its next open instance'
        );
    }
    if (
      options.activity &&
      !beforeRestart.some((record) => record.kind === 'activityEvent')
    )
      fail('Task creation did not add a real activity event');
    if (options.unified) {
      await this.click('crm-home-nav-workflows');
      await this.click('crm-live-workflow-new-template');
      await this.fill(
        'crm-live-workflow-name',
        this.token('Parity unified workflow')
      );
      await this.fill(
        'crm-live-workflow-step-title-1',
        'A workflow step in the shared list'
      );
      await this.click('crm-live-workflow-create-template');
      await this.waitForControl('crm-live-workflow-start');
      await this.click('crm-live-workflow-start');
      await this.openHome();
      await this.click('crm-home-nav-tasks');
      const sharedWork = await this.eval(
        `Boolean(document.querySelector('[data-testid^="crm-workflow-work-"]'))`
      );
      if (!sharedWork)
        fail('A real workflow step did not appear in the shared work list');
    }
    await this.restart();
    const afterRestart = await this.records();
    if (
      !afterRestart.some(
        (record) => record.kind === 'task' && record.title === title
      )
    )
      fail('Saved task disappeared after native restart');
    if (options.triage) {
      await this.openHome();
      await this.click('crm-home-nav-today');
      await this.requireText(title);
    }
  }

  async contact(options: {
    person?: boolean;
    household?: boolean;
    relationship?: boolean;
    roles?: boolean;
    ownership?: boolean;
    tags?: boolean;
    notes?: boolean;
    internal?: boolean;
    account?: boolean;
    addresses?: boolean;
    facts?: boolean;
    timeline?: boolean;
  }): Promise<void> {
    const { path } = await this.setWorkspace('contacts');
    const household = this.token('Parity household');
    const person = this.token('Parity person');
    await this.click('spine-nav-matters');
    await this.waitForControl('crm-directory-surface');
    await this.click('crm-directory-add');
    await this.fill('crm-household-name', household);
    await this.click('crm-household-save');
    // Saving goes through SQLCipher and remounts Clients as the household
    // record.  Seeing the name in the directory is not enough: wait for the
    // actual record surface before trying its contact controls.
    await this.waitForControl('crm-household-record');
    await this.requireText(household);
    if (options.ownership) {
      await this.click('crm-household-edit');
      await this.fill('crm-household-edit-tier', 'Platinum');
      await this.fill('crm-household-edit-advisor', 'Parity advisor');
      await this.click('crm-household-edit-save');
    }
    if (options.person) {
      await this.click('crm-household-add');
      await this.click('crm-household-add-person');
      await this.fill('crm-person-name', person);
      if (options.roles) await this.fill('crm-person-roles', 'CPA');
      if (options.relationship)
        await this.fill('crm-person-relationship', 'Spouse');
      if (options.addresses) {
        await this.require('crm-person-email-add');
        await this.click('crm-person-email-add');
      }
      await this.click('crm-person-save');
      await this.requireText(person);
    }
    if (options.account) {
      await this.click('crm-household-add');
      await this.click('crm-household-add-account');
      await this.fill('crm-account-custodian', 'Parity custody');
      await this.fill('crm-account-type', 'Investment');
      await this.fill('crm-account-purpose', 'Parity purpose');
      await this.fill('crm-account-last-four', '1234');
      await this.click('crm-account-save');
    }
    if (options.notes) {
      await this.click('crm-household-add');
      await this.click('crm-household-add-note');
      await this.fill('crm-note-body', 'Parity note');
      if (options.internal) {
        await this.require('crm-note-audience-internal');
        await this.click('crm-note-audience-internal');
      }
      await this.click('crm-note-save');
    }
    if (options.tags) {
      await this.click('crm-household-metadata');
      await this.fill('crm-tag-input', 'parity-tag');
      await this.eval(
        `Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Add tag')?.click()`
      );
      await this.click('crm-save-metadata');
    }
    if (options.facts) {
      await this.require('crm-household-add-fact');
      await this.click('crm-household-add-fact');
      await this.fill('crm-fact-label', 'Parity remembered fact');
      await this.fill('crm-fact-value', 'October');
      await this.fill('crm-fact-source', 'Parity review meeting');
      await this.click('crm-fact-save');
    }
    if (options.timeline) {
      await this.click('crm-household-tab-timeline');
      await this.require('crm-household-timeline');
      if (options.notes) await this.requireText('Parity note');
    }
    await this.restart();
    await this.eval(
      `(async () => { const invoke = window.__TAURI_INTERNALS__?.invoke; if (!invoke) throw new Error('Tauri invoke is unavailable'); await invoke('crm_set_workspace', { path: ${JSON.stringify(path)} }); const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts'); useWorkspaceStore.getState().setRootPath(${JSON.stringify(path)}); return true; })()`
    );
    await this.click('spine-nav-matters');
    await this.waitForControl('crm-directory-surface');
    await this.requireText(household);
    if (options.person) await this.requireText(person);
    if (options.ownership) {
      await this.requireText('Platinum');
      await this.requireText('Parity advisor');
    }
    if (options.tags) await this.requireText('parity-tag');
    if (options.notes) await this.requireText('Parity note');
  }

  async workflow(options: {
    template?: boolean;
    instance?: boolean;
    schedule?: boolean;
    outcomes?: boolean;
    comments?: boolean;
    library?: boolean;
    meetingProposal?: boolean;
  }): Promise<void> {
    const { path, householdId } = await this.setWorkspace(
      `workflows-${this.token('workspace')}`
    );
    await this.openHome();
    await this.click('crm-home-nav-workflows');
    if (options.library) await this.require('crm-live-workflow-library');
    if (!(await this.exists('crm-live-workflow-name'))) {
      await this.click('crm-live-workflow-new-template');
    }
    const controls = [
      'crm-live-workflow-name',
      'crm-live-workflow-step-title-1',
      'crm-live-workflow-create-template',
    ];
    for (const control of controls) await this.require(control);
    const title = this.token('Parity workflow');
    await this.fill('crm-live-workflow-name', title);
    await this.fill(
      'crm-live-workflow-step-title-1',
      'Prove restart persistence'
    );
    await this.click('crm-live-workflow-create-template');
    await this.waitForControl('crm-live-workflow-start');
    if (options.schedule || options.outcomes) {
      await this.waitForControl('crm-live-workflow-edit-template');
      await this.click('crm-live-workflow-edit-template');
      if (options.schedule)
        await this.waitForControl('crm-live-workflow-schedule');
      if (options.outcomes)
        await this.waitForControl('crm-live-workflow-outcome-add');
    }
    if (options.meetingProposal) {
      await this.waitForControl('crm-live-workflow-meeting-proposal');
      await this.select('crm-live-meeting-select', 'parity-meeting');
      await this.select('crm-live-meeting-household', householdId);
      await this.click('crm-live-meeting-propose-workflow');
      if (
        !(await this.records()).some(
          (record) =>
            record.kind === 'proposalRecord' &&
            record.proposalKind === 'workflow_launch'
        )
      )
        fail('Meeting did not create an approval-visible workflow proposal');
    }
    if (options.instance) {
      await this.click('crm-live-workflow-start');
      await delay(200);
      if (
        !(await this.records()).some(
          (record) => record.kind === 'crm_workflow_instance'
        )
      )
        fail('Starting a workflow did not create an open household workflow');
      if (options.comments)
        await this.waitForControl('crm-live-workflow-step-comment');
    }
    await this.restart();
    await this.eval(
      `(async () => { const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts'); useWorkspaceStore.getState().setRootPath(${JSON.stringify(path)}); return true; })()`
    );
    await this.openHome();
    await this.click('crm-home-nav-workflows');
    await this.waitForText(title);
  }

  async pipeline(options: {
    opportunity?: boolean;
    pipeline?: boolean;
    stage?: boolean;
    workflowTrigger?: boolean;
  }): Promise<void> {
    const { householdId } = await this.setWorkspace(
      `pipeline-${this.token('setup')}`
    );
    await this.openHome();
    const pipelineName = this.token('Parity pipeline');
    const stageName = this.token('Parity stage');
    const templateId = `parity-workflow-template-${this.token('pipeline')}`;
    if (options.workflowTrigger) {
      await this.eval(
        `window.__TAURI_INTERNALS__.invoke('crm_live_upsert', { record: { id: ${JSON.stringify(templateId)}, kind: 'workflowTemplate', matterId: 'firm_home', name: 'Parity workflow template' } })`
      );
    }
    await this.click('crm-home-nav-pipeline');
    await this.click('crm-pipeline-settings');
    await this.fill('crm-pipeline-name', pipelineName);
    await this.click('crm-pipeline-save');
    await delay(200);
    const pipeline = (await this.records()).find(
      (record) => record.kind === 'pipelineDef' && record.name === pipelineName
    );
    if (!pipeline || typeof pipeline.id !== 'string')
      fail('Saving a pipeline did not create a pipeline record');
    await this.fill(`crm-stage-name-${pipeline.id}`, stageName);
    await this.click(`crm-stage-save-${pipeline.id}`);
    await delay(200);
    const stage = (await this.records()).find(
      (record) =>
        record.kind === 'stageDef' &&
        record.pipelineId === pipeline.id &&
        record.name === stageName
    );
    if (!stage || typeof stage.id !== 'string')
      fail('Saving a stage did not create a stage record');
    if (options.workflowTrigger) {
      await this.select(`crm-stage-workflow-${stage.id}`, templateId);
      await this.click(`crm-stage-trigger-${stage.id}`);
      await this.click(`crm-stage-trigger-save-${stage.id}`);
      await delay(200);
      const storedStage = (await this.records()).find(
        (record) => record.id === stage.id
      );
      const hasTrigger =
        Array.isArray(storedStage?.triggerRules) &&
        storedStage.triggerRules.some(
          (rule: unknown) =>
            typeof rule === 'object' &&
            rule !== null &&
            (rule as { enabled?: unknown; workflowTemplateId?: unknown })
              .enabled === true &&
            (rule as { workflowTemplateId?: unknown }).workflowTemplateId ===
              templateId
        );
      if (!hasTrigger)
        fail(
          'Saving the workflow suggestion did not persist the stage trigger'
        );
    }
    if (options.opportunity) {
      await this.click('crm-pipeline-back');
      await this.click('crm-pipeline-new');
      const opportunityName = this.token('Parity opportunity');
      await this.fill('crm-opportunity-name', opportunityName);
      await this.select('crm-opportunity-household', householdId);
      await this.click('crm-opportunity-save');
      await delay(200);
      if (
        !(await this.records()).some(
          (record) =>
            record.kind === 'opportunity' &&
            record.name === opportunityName &&
            record.pipelineId === pipeline.id
        )
      )
        fail('Saving the opportunity did not create an opportunity record');
    }
    await this.restart();
    const afterRestart = await this.records();
    if (
      !afterRestart.some(
        (record) => record.id === pipeline.id && record.kind === 'pipelineDef'
      )
    )
      fail('Pipeline disappeared after native restart');
    if (
      !afterRestart.some(
        (record) => record.id === stage.id && record.kind === 'stageDef'
      )
    )
      fail('Stage disappeared after native restart');
  }

  async report(options: {
    kind: 'no_contact_6mo' | 'attention_vs_fee' | 'custom' | 'ai';
  }): Promise<void> {
    const { householdId } = await this.setWorkspace(
      `report-${this.token('setup')}`
    );
    await this.openHome();
    await this.eval(
      `window.__TAURI_INTERNALS__.invoke('crm_live_upsert', { record: { id: ${JSON.stringify(householdId)}, kind: 'household', matterId: ${JSON.stringify(householdId)}, name: 'Parity reporting household', status: 'active', annualFee: { value: 1200, currency: 'USD' } } })`
    );
    await this.click('crm-home-nav-reports');
    if (options.kind === 'ai') {
      await this.fill('crm-report-ai-prompt', 'Which clients need attention?');
      await this.click('crm-report-ai-run');
      await this.click('crm-report-ai-use-proposal');
    } else if (options.kind === 'attention_vs_fee') {
      await this.click('crm-report-attention-vs-fee');
    } else if (options.kind === 'custom') {
      await this.click('crm-report-builder');
    } else {
      await this.click('crm-report-no-contact-in-6-months');
    }
    await this.click('crm-report-run');
    await this.requireText('Computed just now');
    await delay(200);
    if (!(await this.records()).some((record) => record.kind === 'reportRun'))
      fail('Running the report did not create a report-run record');
    let savedReportName: string | undefined;
    if (options.kind === 'custom') {
      savedReportName = this.token('Parity saved report');
      await this.click('crm-report-save');
      await this.fill('crm-report-save-name', savedReportName);
      await this.click('crm-report-save-confirm');
      await delay(200);
      if (
        !(await this.records()).some(
          (record) =>
            record.kind === 'savedReport' && record.name === savedReportName
        )
      )
        fail('Saving the report recipe did not create a saved report');
    }
    await this.restart();
    const afterRestart = await this.records();
    if (!afterRestart.some((record) => record.kind === 'reportRun'))
      fail('Report-run record disappeared after native restart');
    if (
      savedReportName &&
      !afterRestart.some(
        (record) =>
          record.kind === 'savedReport' && record.name === savedReportName
      )
    )
      fail('Saved report disappeared after native restart');
  }

  private async openFirm(tab: 'setup' | 'fields' | 'tags' | 'values' = 'setup'): Promise<void> {
    await this.openHome();
    await this.click('crm-home-nav-firm-setup');
    await this.waitForControl('crm-firm-surface');
    if (tab !== 'setup') {
      await this.click(`crm-firm-tab-${tab}`);
      await delay(150);
    }
  }

  private async waitForRecord(
    predicate: (record: Record<string, unknown>) => boolean,
    message: string
  ): Promise<Record<string, unknown>> {
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      const record = (await this.records()).find(predicate);
      if (record) return record;
      await delay(150);
    }
    fail(message);
  }

  async firmDirectory(): Promise<void> {
    await this.setWorkspace(`firm-directory-${this.token('setup')}`);
    await this.openFirm();
    for (const control of [
      'crm-firm-directory',
      'crm-firm-access-read-model',
      'crm-firm-visibility-read-model',
      'crm-firm-permissions-read-model',
      'crm-firm-open-admin',
    ]) await this.require(control);
    for (const text of ['Parity teammate', 'Owner', 'Client service'])
      await this.requireText(text);
    if (!(await this.records()).some((record) => record.kind === 'firmDirectoryEntry'))
      fail('The existing firm-admin directory did not provide a member read-model');
    await this.restart();
    await this.openFirm();
    for (const text of ['Parity teammate', 'Owner', 'Client service'])
      await this.requireText(text);
    if (!(await this.records()).some((record) => record.kind === 'firmDirectoryEntry'))
      fail('The firm-admin member read-model disappeared after native restart');
  }

  async firmSetup(): Promise<void> {
    const { householdId } = await this.setWorkspace(`firm-setup-${this.token('setup')}`);
    const fieldLabel = this.token('Parity custom field');
    const fieldKey = `parity_${this.sequence}`;
    const tagName = this.token('Parity tag');

    await this.openFirm('fields');
    await this.click('crm-field-create');
    await this.fill('crm-field-label', fieldLabel);
    await this.fill('crm-field-key', fieldKey);
    await this.click('crm-field-save');
    await this.waitForText(fieldLabel);
    const field = await this.waitForRecord(
      (record) => record.kind === 'customFieldDef' && record.label === fieldLabel,
      'Saving a custom field did not create a field definition'
    );

    await this.openFirm('tags');
    await this.click('crm-tag-create');
    await this.fill('crm-tag-name', tagName);
    await this.click('crm-tag-save');
    await this.waitForText(tagName);
    const tag = await this.waitForRecord(
      (record) => record.kind === 'tag' && record.name === tagName,
      'Saving a tag did not create a tag record'
    );

    await this.openFirm('values');
    await this.select('crm-record-values-select', householdId);
    await this.waitForControl(`crm-record-value-${fieldKey}`);
    await this.fill(`crm-record-value-${fieldKey}`, 'North');
    await this.click(`crm-record-tag-${String(tag.id)}`);
    await this.click('crm-record-values-save');
    await this.waitForRecord(
      (record) => record.id === householdId &&
        (record.customFields as Record<string, { value?: unknown }> | undefined)?.[fieldKey]?.value === 'North' &&
        Array.isArray(record.tagIds) && record.tagIds.includes(tag.id),
      'Saving a custom-field value and tag did not update the selected record'
    );

    await this.restart();
    await this.openFirm('fields');
    await this.requireText(fieldLabel);
    await this.openFirm('tags');
    await this.requireText(tagName);
    await this.openFirm('values');
    await this.select('crm-record-values-select', householdId);
    let value: unknown;
    let appliedTag: unknown;
    const restoredValueDeadline = Date.now() + 10_000;
    do {
      value = await this.eval(`document.querySelector('[data-testid="crm-record-value-${fieldKey}"]')?.value`);
      appliedTag = await this.eval(`Boolean(document.querySelector('[data-testid="crm-record-tag-${String(tag.id)}"]:checked'))`);
      if (value === 'North' && appliedTag) break;
      await delay(150);
    } while (Date.now() < restoredValueDeadline);
    if (value !== 'North' || !appliedTag)
      fail('The custom-field value or tag disappeared after native restart');
    await this.waitForRecord(
      (record) => record.id === householdId &&
        (record.customFields as Record<string, { value?: unknown }> | undefined)?.[fieldKey]?.value === 'North' &&
        Array.isArray(record.tagIds) && record.tagIds.includes(tag.id),
      'The saved custom-field value or tag record disappeared after native restart'
    );
    if (field.kind !== 'customFieldDef') fail('Custom field definition changed kind unexpectedly');
  }

  async durableFeature(options: {
    route: string;
    controls: string[];
    action?: string;
    result?: string;
    recordKind?: string;
  }): Promise<void> {
    await this.setWorkspace(`feature-${this.token('route')}`);
    await this.openHome();
    await this.click(options.route);
    for (const control of options.controls) await this.require(control);
    if (options.action) await this.click(options.action);
    if (options.result) await this.requireText(options.result);
    if (
      options.recordKind &&
      !(await this.records()).some(
        (record) => record.kind === options.recordKind
      )
    )
      fail(`Action did not create a ${options.recordKind} record`);
    await this.restart();
    await this.click(options.route);
    for (const control of options.controls) await this.require(control);
    if (
      options.recordKind &&
      !(await this.records()).some(
        (record) => record.kind === options.recordKind
      )
    )
      fail(`${options.recordKind} record disappeared after native restart`);
  }

  async migration(options: {
    action: 'crm-migration-run-import' | 'crm-redtail-import' | 'crm-salesforce-import';
    externalId?: boolean;
    exportFile?: boolean;
    fullReview?: boolean;
  }): Promise<void> {
    if (!migrationBaseUrl) fail('Migration simulator was not started');
    await this.setWorkspace(`migration-${this.token('workspace')}`);
    await this.openHome();
    await this.click('crm-home-nav-firm-setup');
    await this.click('crm-firm-route-migration');
    for (const control of [
      'crm-migration-base-url',
      'crm-migration-source-id-map',
      options.action,
      'crm-migration-fidelity',
    ]) await this.require(control);
    await this.fill('crm-migration-base-url', migrationBaseUrl);
    if (options.externalId) {
      await this.fill('crm-migration-source-id-map', 'wealthbox_external_id');
      if (await this.eval(`document.querySelector('[data-testid="crm-migration-source-id-map"]')?.value`) !== 'wealthbox_external_id')
        fail('The outside-ID mapping field did not retain its value');
    }
    await this.click(options.action);
    await this.waitForText('Import finished');
    const imported = await this.records();
    for (const kind of ['household', 'note', 'task', 'migration_report'])
      if (!imported.some((record) => record.kind === kind))
        fail(`Migration did not create a real ${kind} record`);

    await this.click('crm-migration-fidelity');
    await this.require('crm-migration-fidelity-report');
    await this.requireText('0% via API');
    const fidelityRows = Number(await this.eval(
      `document.querySelectorAll('[data-testid^="crm-fidelity-row-"]').length`
    ));
    if (fidelityRows < 15)
      fail(`The fidelity report hid rows: expected every source type, saw ${String(fidelityRows)}`);

    if (options.fullReview) {
      await this.click('crm-migration-workflow-fallback');
      const workflowFallbacks = Number(await this.eval(
        `document.querySelectorAll('[data-testid^="crm-workflow-record-"]').length`
      ));
      if (!workflowFallbacks)
        fail('The open-workflow fallback did not present a saved checklist');
      await this.click('crm-home-nav-firm-setup');
      await this.click('crm-firm-route-migration');
      await this.click('crm-migration-fidelity');
      await this.click('crm-migration-attachment-fallback');
      const attachmentFallbacks = Number(await this.eval(
        `document.querySelectorAll('[data-testid^="crm-attachment-record-save-"]').length`
      ));
      if (!attachmentFallbacks)
        fail('The attachment fallback did not present a saved accounting record');
    }

    if (options.exportFile) {
      await this.click('crm-home-nav-firm-setup');
      await this.click('crm-firm-route-migration');
      await this.click('crm-migration-archive');
      await this.click('crm-export-create');
      await this.waitForText('Exported archive file.');
      const archive = (await this.records()).find(
        (record) => record.kind === 'migration_export' && record.exportKind === 'archive'
      );
      if (typeof archive?.filePath !== 'string' || !existsSync(archive.filePath))
        fail('Archive export reported success but did not create a real file');
    }

    await this.restart();
    await this.click('crm-home-nav-firm-setup');
    await this.click('crm-firm-route-migration');
    await this.require('crm-migration-run-import');
    if (!(await this.records()).some((record) => record.kind === 'migration_report'))
      fail('Migration report disappeared after native restart');
  }
}

function printScoreboard(results: readonly Result[]): void {
  const built = results.filter((result) => result.status === 'BUILT');
  const failing = results.filter((result) => result.status === 'FAILING');
  const pending = results.filter((result) => result.status === 'PENDING');
  const percent =
    results.length === 0
      ? 0
      : Math.round((built.length / results.length) * 100);
  const names = (items: readonly Result[]) =>
    items.length ? items.map((item) => item.id).join(', ') : 'none';
  console.log(
    `PARITY: ${built.length}/${results.length} features verified (${percent}%) — BUILT: ${names(built)} | FAILING: ${names(failing)} | PENDING: ${names(pending)}`
  );
}

let vite: ChildProcess | undefined;
let desktop: ChildProcess | undefined;
let wbsim: ChildProcess | undefined;
let viteOutput = '';
const results: Result[] = [];
let infrastructureError: string | undefined;
try {
  validateManifest();
  mkdirSync(workspaceRoot, { recursive: true });
  if (requestedVitePort && Number(requestedVitePort) !== vitePort) {
    throw new InfrastructureError(
      `The debug desktop binary is wired to Vite on ${vitePort}; PARITY_VITE_PORT=${requestedVitePort} cannot be used.`
    );
  }
  if ((await portReady(port)) || (!reuseVite && (await portReady(vitePort)))) {
    throw new InfrastructureError(
      reuseVite
        ? `Parity needs unused bridge port ${port}. Another desktop bridge is already answering there.`
        : `Parity needs unused ports ${port} and ${vitePort}. Another app is already answering on one of them.`
    );
  }
  if (!reuseVite) {
    vite = start(
      'npm',
      ['run', 'dev', '--', '--port', String(vitePort), '--strictPort'],
      process.env
    );
    vite.stdout?.on('data', (chunk: Buffer) => {
      viteOutput = `${viteOutput}${chunk.toString()}`.slice(-4_000);
    });
    vite.stderr?.on('data', (chunk: Buffer) => {
      viteOutput = `${viteOutput}${chunk.toString()}`.slice(-4_000);
    });
    // A cold Vite cache can take a little over thirty seconds on the shared
    // build machine. Keep the parity runner honest by waiting for the real
    // server instead of calling a healthy app an infrastructure failure.
    const end = Date.now() + 60_000;
    while (!(await portReady(vitePort))) {
      if (Date.now() > end) {
        throw new InfrastructureError(
          `Vite did not start on port ${vitePort}${viteOutput ? `: ${viteOutput.trim()}` : ''}`
        );
      }
      await delay(200);
    }
  } else if (!(await portReady(vitePort))) {
    throw new InfrastructureError(
      `Parity expected a shared Vite server on port ${vitePort}, but none is running.`
    );
  }
  desktop = start(
    'bash',
    ['scripts/crm-loop/launch-app.sh', String(port), workspaceRoot],
    {
      ...process.env,
      LANTERN_DEV_BRIDGE_PORT: String(port),
      LANTERN_VITE_PORT: String(vitePort),
    }
  );
  await waitForBridge();
  const app = new DesktopParityApp();
  await app.ready();
  const simulatorPort = await freePort();
  migrationBaseUrl = `http://127.0.0.1:${String(simulatorPort)}/v1`;
  wbsim = start('bun', ['tests/wbsim/server.ts'], {
    ...process.env,
    WBSIM_PORT: String(simulatorPort),
  });
  const simulatorDeadline = Date.now() + 30_000;
  while (Date.now() < simulatorDeadline) {
    try {
      if ((await fetch(`${migrationBaseUrl}/contacts?per_page=1`)).ok) break;
    } catch {
      // The simulator has not bound its local port yet.
    }
    await delay(150);
  }
  try {
    if (!(await fetch(`${migrationBaseUrl}/contacts?per_page=1`)).ok)
      throw new InfrastructureError('The fabricated Wealthbox source did not become ready');
  } catch (error) {
    if (error instanceof InfrastructureError) throw error;
    throw new InfrastructureError('The fabricated Wealthbox source did not become ready');
  }
  for (const feature of FEATURES) {
    if (feature.pending) {
      results.push({
        id: feature.id,
        name: feature.name,
        area: feature.area,
        verdict: feature.verdict,
        status: 'PENDING',
        detail: feature.pending,
      });
      continue;
    }
    const before = app.restarts;
    try {
      await feature.assert!(app);
      if (app.restarts === before) {
        fail('Assertion did not prove a native restart');
      }
      results.push({
        id: feature.id,
        name: feature.name,
        area: feature.area,
        verdict: feature.verdict,
        status: 'BUILT',
        detail:
          'Passed against the running desktop app and survived native restart.',
      });
    } catch (error) {
      if (error instanceof InfrastructureError) throw error;
      results.push({
        id: feature.id,
        name: feature.name,
        area: feature.area,
        verdict: feature.verdict,
        status: 'FAILING',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
} catch (error) {
  infrastructureError = error instanceof Error ? error.message : String(error);
  // A score is only meaningful if every assertion had a working desktop app.
  // Do not turn a dead harness into dozens of fictional feature failures.
  results.length = 0;
} finally {
  const built = results.filter((result) => result.status === 'BUILT').length;
  const report = {
    generatedAt: new Date().toISOString(),
    source: 'design/01-wealthbox-feature-matrix.md',
    totalFeatures: FEATURES.length,
    skippedFeatures: SKIPPED_FEATURES.length,
    verified: infrastructureError ? null : built,
    results,
    skipped: SKIPPED_FEATURES,
    infrastructureError: infrastructureError ?? null,
  };
  mkdirSync(resolve(root, 'tests/parity'), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (infrastructureError) {
    console.error(`INFRASTRUCTURE ERROR: ${infrastructureError}`);
  } else {
    printScoreboard(results);
  }
  try {
    await http('/eval', { js: 'window.close(); true' });
  } catch {
    /* app never reached a closable window */
  }
  stop(desktop);
  stop(vite);
  stop(wbsim);
}

process.exitCode =
  results.some((result) => result.status === 'FAILING') || infrastructureError
    ? 1
    : 0;
