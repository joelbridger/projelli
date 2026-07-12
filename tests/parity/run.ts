#!/usr/bin/env bun
/**
 * Runs the parity manifest against a real Tauri process. It deliberately does
 * not use React test doubles or browser storage: every write goes through the
 * desktop bridge, and every passing assertion must restart the native app.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURES, SKIPPED_FEATURES, type ParityApp, type ParityFeature } from './manifest';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const port = Number(process.env.PARITY_BRIDGE_PORT ?? '9279');
const workspaceRoot = process.env.PARITY_WORKSPACE ?? `/tmp/lantern-parity-${process.pid}`;
const reportPath = resolve(root, 'tests/parity/parity-report.json');
const base = `http://127.0.0.1:${port}`;
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));

type Result = { id: string; name: string; area: string; verdict: string; status: 'BUILT' | 'FAILING' | 'PENDING'; detail: string };

function fail(message: string): never { throw new Error(message); }

async function http(path: string, query: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url);
  const body = await response.json() as { ok?: boolean; result?: unknown; error?: string };
  if (!response.ok || !body.ok) fail(body.error ?? `${path} failed`);
  return body.result;
}

async function waitForBridge(seconds = 30): Promise<void> {
  const end = Date.now() + seconds * 1_000;
  let last = 'not started';
  while (Date.now() < end) {
    try { await http('/health'); return; } catch (error) { last = error instanceof Error ? error.message : String(error); }
    await delay(150);
  }
  fail(`Desktop bridge did not start: ${last}`);
}

async function portReady(target: number): Promise<boolean> {
  try { return (await fetch(`http://127.0.0.1:${target}`)).ok; } catch { return false; }
}

function start(command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

function stop(child: ChildProcess | undefined): void {
  if (child && !child.killed) child.kill('SIGTERM');
}

function matrixInventory(): { active: string[]; skipped: string[] } {
  const active: string[] = [];
  const skipped: string[] = [];
  for (const line of readFileSync(resolve(root, 'design/01-wealthbox-feature-matrix.md'), 'utf8').split('\n')) {
    if (!line.startsWith('|')) continue;
    const columns = line.split('|').map((value) => value.trim());
    const verdict = columns.at(-2) ?? '';
    if (!/^(REPLICATE|IMPROVE|SKIP)/.test(verdict)) continue;
    (verdict.startsWith('SKIP') ? skipped : active).push(columns[1]);
  }
  return { active, skipped };
}

function sameMultiset(actual: readonly string[], expected: readonly string[]): boolean {
  return [...actual].sort().join('\u0000') === [...expected].sort().join('\u0000');
}

function validateManifest(): void {
  const matrix = matrixInventory();
  const active = FEATURES.map((feature) => feature.matrixFeature);
  const skipped = SKIPPED_FEATURES.map((feature) => feature.matrixFeature);
  if (!sameMultiset(active, matrix.active)) fail(`Manifest does not match every REPLICATE/IMPROVE matrix row. Manifest=${active.length}, matrix=${matrix.active.length}`);
  if (!sameMultiset(skipped, matrix.skipped)) fail(`Skipped feature list does not match every SKIP matrix row. Manifest=${skipped.length}, matrix=${matrix.skipped.length}`);
  for (const feature of FEATURES) {
    if (!feature.assert && !feature.pending) fail(`${feature.id} has neither an assertion nor a pending reason`);
    if (feature.assert && feature.pending) fail(`${feature.id} cannot be both live and pending`);
  }
}

class DesktopParityApp implements ParityApp {
  restarts = 0;
  private sequence = 0;

  private async eval(js: string): Promise<unknown> { return http('/eval', { js }); }
  private async exists(testid: string): Promise<boolean> { return Boolean(await this.eval(`Boolean(document.querySelector('[data-testid="${testid}"]'))`)); }
  private async require(testid: string): Promise<void> {
    if (!await this.exists(testid)) fail(`Missing required control: ${testid}`);
  }
  private async click(testid: string): Promise<void> { await this.require(testid); await http('/click', { testid }); }
  private async fill(testid: string, value: string): Promise<void> { await this.require(testid); await http('/fill', { testid, text: value }); }
  private async select(testid: string, value: string): Promise<void> {
    await this.require(testid);
    await this.eval(`(() => { const element = document.querySelector('[data-testid="${testid}"]'); if (!(element instanceof HTMLSelectElement)) throw new Error('Not a select: ${testid}'); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event('change', { bubbles: true })); return element.value; })()`);
  }
  private async text(): Promise<string> { return String(await this.eval('document.body.innerText')); }
  private async requireText(value: string): Promise<void> { if (!(await this.text()).includes(value)) fail(`Expected visible text: ${value}`); }
  private token(prefix: string): string { this.sequence += 1; return `${prefix}-${Date.now()}-${this.sequence}`; }

  async ready(): Promise<void> {
    // Open the first workspace through the same normal auto-resume path an
    // advisor uses.  Setting only Zustand's rootPath leaves the picker open,
    // because that skips the lifecycle commit which dismisses it.  The old
    // shortcut therefore made every parity feature fail before a CRM screen
    // could mount.
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
      location.reload();
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
    if (!await this.exists('spine-nav')) {
      fail('The desktop app never completed its normal fresh-workspace open');
    }
    await this.setWorkspace('startup');
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      if (await this.exists('spine-nav-matters')) return;
      await delay(150);
    }
    fail('The desktop app stayed on the workspace chooser after selecting a workspace');
  }

  private async setWorkspace(name: string): Promise<{ path: string; householdId: string }> {
    const path = `${workspaceRoot}/${name}`;
    const householdId = `parity-household-${this.token(name)}`;
    await this.eval(`(async () => {
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (!invoke) throw new Error('Tauri invoke is unavailable');
      await invoke('crm_set_workspace', { path: ${JSON.stringify(path)} });
      const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts');
      useWorkspaceStore.getState().setRootPath(${JSON.stringify(path)});
      await invoke('crm_live_upsert', { record: { id: ${JSON.stringify(householdId)}, kind: 'household', matterId: ${JSON.stringify(householdId)}, name: 'Parity household', status: 'active' } });
      return true;
    })()`);
    await delay(250);
    return { path, householdId };
  }

  private async records(): Promise<Array<Record<string, unknown>>> {
    const result = await this.eval(`window.__TAURI_INTERNALS__.invoke('crm_live_list')`);
    if (!Array.isArray(result)) fail('CRM record store did not return a list');
    return result as Array<Record<string, unknown>>;
  }

  async restart(): Promise<void> {
    // A renderer reload is not enough. This triggers Tauri's real relaunch and
    // waits for its fresh local bridge before the assertion continues.
    try { await this.eval(`(async () => { const { relaunch } = await import('@tauri-apps/plugin-process'); await relaunch(); return true; })()`); } catch { /* expected: old bridge dies first */ }
    await waitForBridge(30);
    this.restarts += 1;
    await delay(400);
  }

  async task(options: { recurrence?: boolean; priority?: boolean; assignee?: boolean; activity?: boolean; unified?: boolean; triage?: boolean }): Promise<void> {
    const { householdId } = await this.setWorkspace('tasks');
    const title = this.token('Parity task');
    await this.click('crm-home-nav-tasks');
    await this.click('crm-task-new');
    await this.fill('crm-task-title-input', title);
    await this.fill('crm-task-body', 'Created by the parity acceptance check.');
    await this.select('crm-task-household', householdId);
    if (options.assignee) await this.fill('crm-task-assignee', 'parity-user');
    if (options.priority) await this.select('crm-task-priority', 'high');
    if (options.recurrence) await this.select('crm-task-recurrence', 'weekly');
    await this.click('crm-task-save');
    await this.requireText(title);
    const beforeRestart = await this.records();
    const saved = beforeRestart.find((record) => record.kind === 'task' && record.title === title);
    if (!saved) fail('Saving the task did not create a CRM task record');
    if (options.recurrence) {
      await this.click(`crm-task-complete-${String(saved.id)}`);
      await delay(200);
      const afterCompletion = await this.records();
      if (!afterCompletion.some((record) => record.kind === 'task' && record.title === title && record.id !== saved.id && record.status !== 'done')) {
        fail('Completing a recurring task did not create its next open instance');
      }
    }
    if (options.activity && !beforeRestart.some((record) => record.kind === 'activityEvent')) fail('Task creation did not add a real activity event');
    if (options.unified && !beforeRestart.some((record) => record.kind === 'workflowStep')) fail('Workflow steps are not present in the unified task store');
    await this.restart();
    const afterRestart = await this.records();
    if (!afterRestart.some((record) => record.kind === 'task' && record.title === title)) fail('Saved task disappeared after native restart');
    if (options.triage) {
      await this.click('crm-home-nav-today');
      await this.requireText(title);
    }
  }

  async contact(options: { person?: boolean; household?: boolean; relationship?: boolean; roles?: boolean; ownership?: boolean; tags?: boolean; notes?: boolean; internal?: boolean; account?: boolean; addresses?: boolean; facts?: boolean }): Promise<void> {
    const { path } = await this.setWorkspace('contacts');
    const household = this.token('Parity household');
    const person = this.token('Parity person');
    await this.click('spine-nav-matters');
    await this.click('crm-directory-add');
    await this.fill('crm-household-name', household);
    await this.click('crm-household-save');
    await this.requireText(household);
    if (options.ownership) {
      await this.click('crm-household-edit'); await this.fill('crm-household-edit-tier', 'Platinum'); await this.fill('crm-household-edit-advisor', 'Parity advisor'); await this.click('crm-household-edit-save');
    }
    if (options.person) {
      await this.click('crm-household-add'); await this.click('crm-household-add-person'); await this.fill('crm-person-name', person);
      if (options.roles) await this.fill('crm-person-roles', 'CPA');
      if (options.relationship) await this.fill('crm-person-relationship', 'Spouse');
      if (options.addresses) { await this.require('crm-person-email-add'); await this.click('crm-person-email-add'); }
      await this.click('crm-person-save'); await this.requireText(person);
    }
    if (options.account) { await this.click('crm-household-add'); await this.click('crm-household-add-account'); await this.fill('crm-account-custodian', 'Parity custody'); await this.fill('crm-account-type', 'Investment'); await this.fill('crm-account-purpose', 'Parity purpose'); await this.fill('crm-account-last-four', '1234'); await this.click('crm-account-save'); }
    if (options.notes) { await this.click('crm-household-add'); await this.click('crm-household-add-note'); await this.fill('crm-note-body', 'Parity note'); if (options.internal) { await this.require('crm-note-audience-internal'); await this.click('crm-note-audience-internal'); } await this.click('crm-note-save'); }
    if (options.tags) { await this.click('crm-household-metadata'); await this.fill('crm-tag-input', 'parity-tag'); await this.eval(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Add tag')?.click()`); await this.click('crm-save-metadata'); }
    if (options.facts) { await this.require('crm-household-add-fact'); await this.click('crm-household-add-fact'); }
    await this.restart();
    await this.eval(`(async () => { const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts'); useWorkspaceStore.getState().setRootPath(${JSON.stringify(path)}); return true; })()`);
    await this.click('spine-nav-matters');
    await this.requireText(household);
    if (options.person) await this.requireText(person);
    if (options.ownership) { await this.requireText('Platinum'); await this.requireText('Parity advisor'); }
    if (options.tags) await this.requireText('parity-tag');
    if (options.notes) await this.requireText('Parity note');
  }

  async workflow(options: { template?: boolean; instance?: boolean; schedule?: boolean; outcomes?: boolean; comments?: boolean; library?: boolean; meetingProposal?: boolean }): Promise<void> {
    await this.setWorkspace('workflows');
    await this.click('crm-home-nav-workflows');
    const controls = ['crm-live-workflow-name', 'crm-live-workflow-step-title-1', 'crm-live-workflow-create-template'];
    for (const control of controls) await this.require(control);
    const title = this.token('Parity workflow');
    await this.fill('crm-live-workflow-name', title);
    await this.fill('crm-live-workflow-step-title-1', 'Prove restart persistence');
    if (options.schedule) await this.require('crm-live-workflow-schedule');
    if (options.outcomes) await this.require('crm-live-workflow-outcome-add');
    if (options.comments) await this.require('crm-live-workflow-step-comment');
    if (options.library) await this.require('crm-live-workflow-library');
    if (options.meetingProposal) await this.require('crm-live-workflow-meeting-proposal');
    await this.click('crm-live-workflow-create-template');
    if (options.instance) { await this.require('crm-live-workflow-start'); await this.click('crm-live-workflow-start'); }
    await this.restart();
    await this.click('crm-home-nav-workflows');
    await this.requireText(title);
  }

  async durableFeature(options: { route: string; controls: string[]; action?: string; result?: string; recordKind?: string }): Promise<void> {
    await this.setWorkspace(`feature-${this.token('route')}`);
    await this.click(options.route);
    for (const control of options.controls) await this.require(control);
    if (options.action) await this.click(options.action);
    if (options.result) await this.requireText(options.result);
    if (options.recordKind && !(await this.records()).some((record) => record.kind === options.recordKind)) fail(`Action did not create a ${options.recordKind} record`);
    await this.restart();
    await this.click(options.route);
    for (const control of options.controls) await this.require(control);
    if (options.recordKind && !(await this.records()).some((record) => record.kind === options.recordKind)) fail(`${options.recordKind} record disappeared after native restart`);
  }
}

function printScoreboard(results: readonly Result[]): void {
  const built = results.filter((result) => result.status === 'BUILT');
  const failing = results.filter((result) => result.status === 'FAILING');
  const pending = results.filter((result) => result.status === 'PENDING');
  const percent = results.length === 0 ? 0 : Math.round((built.length / results.length) * 100);
  const names = (items: readonly Result[]) => items.length ? items.map((item) => item.id).join(', ') : 'none';
  console.log(`PARITY: ${built.length}/${results.length} features verified (${percent}%) — BUILT: ${names(built)} | FAILING: ${names(failing)} | PENDING: ${names(pending)}`);
}

let vite: ChildProcess | undefined;
let desktop: ChildProcess | undefined;
const results: Result[] = [];
let infrastructureError: string | undefined;
try {
  validateManifest();
  mkdirSync(workspaceRoot, { recursive: true });
  if (!await portReady(5174)) {
    vite = start('npm', ['run', 'dev', '--', '--port', '5174', '--strictPort'], process.env);
    const end = Date.now() + 30_000;
    while (!await portReady(5174)) { if (Date.now() > end) fail('Vite did not start on port 5174'); await delay(200); }
  }
  desktop = start('bash', ['scripts/crm-loop/launch-app.sh', String(port), workspaceRoot], { ...process.env, LANTERN_DEV_BRIDGE_PORT: String(port) });
  await waitForBridge();
  const app = new DesktopParityApp();
  await app.ready();
  for (const feature of FEATURES) {
    if (feature.pending) { results.push({ id: feature.id, name: feature.name, area: feature.area, verdict: feature.verdict, status: 'PENDING', detail: feature.pending }); continue; }
    const before = app.restarts;
    try {
      await feature.assert!(app);
      if (app.restarts === before) fail('Assertion did not prove a native restart');
      results.push({ id: feature.id, name: feature.name, area: feature.area, verdict: feature.verdict, status: 'BUILT', detail: 'Passed against the running desktop app and survived native restart.' });
    } catch (error) {
      results.push({ id: feature.id, name: feature.name, area: feature.area, verdict: feature.verdict, status: 'FAILING', detail: error instanceof Error ? error.message : String(error) });
    }
  }
} catch (error) {
  infrastructureError = error instanceof Error ? error.message : String(error);
  for (const feature of FEATURES.filter((feature) => !feature.pending)) results.push({ id: feature.id, name: feature.name, area: feature.area, verdict: feature.verdict, status: 'FAILING', detail: `Runner setup failed: ${infrastructureError}` });
  for (const feature of FEATURES.filter((feature) => feature.pending)) results.push({ id: feature.id, name: feature.name, area: feature.area, verdict: feature.verdict, status: 'PENDING', detail: feature.pending! });
} finally {
  const built = results.filter((result) => result.status === 'BUILT').length;
  const report = { generatedAt: new Date().toISOString(), source: 'design/01-wealthbox-feature-matrix.md', totalFeatures: FEATURES.length, skippedFeatures: SKIPPED_FEATURES.length, verified: built, results, skipped: SKIPPED_FEATURES, infrastructureError: infrastructureError ?? null };
  mkdirSync(resolve(root, 'tests/parity'), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  printScoreboard(results);
  try { await http('/eval', { js: 'window.close(); true' }); } catch { /* app never reached a closable window */ }
  stop(desktop); stop(vite);
}

process.exitCode = results.some((result) => result.status === 'FAILING') || infrastructureError ? 1 : 0;
