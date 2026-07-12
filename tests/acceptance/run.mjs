#!/usr/bin/env node
/**
 * Independent acceptance suite for the CRM.
 *
 * The assertions below intentionally use the advisor's vocabulary and the
 * frozen design documents. They do not import CRM product modules or seed CRM
 * records through private product APIs. The only browser escape hatch is the
 * standard local-storage setup needed to bypass the generic first-run tour and
 * open the test workspace through the normal workspace chooser.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const VITE_PORT = 5174;
const APP_READY_MS = 30_000;
const UI_READY_MS = 20_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function eventually(check, label, timeoutMs = UI_READY_MS) {
  const until = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < until) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(`${label}${lastError ? ` (${lastError.message})` : ''}`);
}

function stop(child) {
  if (child && !child.killed) child.kill('SIGTERM');
}

class DesktopApp {
  constructor({ port, workspace, log }) {
    this.port = port;
    this.workspace = workspace;
    this.log = log;
    this.child = undefined;
  }

  async request(route, query = {}) {
    const url = new URL(`http://127.0.0.1:${this.port}${route}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const response = await fetch(url);
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(body.error || `${route} failed`);
    return body.result;
  }

  eval(js) {
    return this.request('/eval', { js });
  }

  exists(testid) {
    return this.eval(`Boolean(document.querySelector('[data-testid="${testid}"]'))`);
  }

  async require(testid, context = testid) {
    await eventually(() => this.exists(testid), `Missing control for ${context}: [data-testid="${testid}"]`);
  }

  async click(testid, context = testid) {
    await this.require(testid, context);
    await this.request('/click', { testid });
  }

  async fill(testid, value, context = testid) {
    await this.require(testid, context);
    await this.request('/fill', { testid, text: value });
  }

  text() {
    return this.eval('document.body.innerText');
  }

  async expectText(phrase, context = phrase) {
    await eventually(async () => String(await this.text()).includes(phrase), `Expected ${context}`);
  }

  async launch() {
    this.child = spawn('bash', ['scripts/crm-loop/launch-app.sh', String(this.port), this.workspace], {
      cwd: ROOT,
      env: { ...process.env, LANTERN_DEV_BRIDGE_PORT: String(this.port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child.stdout.on('data', (chunk) => this.log(String(chunk).trim()));
    this.child.stderr.on('data', (chunk) => this.log(String(chunk).trim()));
    await eventually(() => this.request('/health').then(() => true), 'Desktop bridge did not start', APP_READY_MS);
  }

  async close() {
    stop(this.child);
    await sleep(300);
  }

  /**
   * Give the generic app shell its standard test-workspace bootstrap, then wait
   * for the normal automatic resume path to bring up the visible CRM shell.
   * CRM records themselves are never seeded this way.
   */
  async openFreshWorkspace() {
    await eventually(() => this.exists('workspace-selector-dialog'), 'The app did not show its workspace chooser');
    await this.eval(`(() => {
      localStorage.setItem('lantern_onboarding_complete', 'true');
      localStorage.setItem('keepance_feature_tour_dismissed', 'true');
      localStorage.setItem('keepance_feature_tour_completed', 'true');
      localStorage.setItem('lantern:settings', JSON.stringify({ state: { featuresTourCompleted: true, _migrated: true }, version: 0 }));
      localStorage.setItem('lantern_recent_workspaces', JSON.stringify([{ path: ${JSON.stringify(this.workspace)}, name: 'Independent acceptance firm', lastOpened: new Date().toISOString() }]));
      location.reload();
      return true;
    })()`);

    try {
      await eventually(() => this.exists('spine-nav'), 'CRM navigation never became available');
    } catch (error) {
      const stuck = await this.exists('workspace-auto-resume-loading');
      if (stuck) {
        throw new Error(
          'Fresh-workspace opening is stuck on “workspace-auto-resume-loading”; the app never reaches the promised Home, Clients, or Ask navigation.',
        );
      }
      throw error;
    }
  }

  async restartAndReopen() {
    await this.close();
    await this.launch();
    await this.openFreshWorkspace();
  }
}

async function select(app, testid, value, advisorLabel) {
  await app.require(testid, advisorLabel);
  await app.eval(`(() => {
    const field = document.querySelector('[data-testid="${testid}"]');
    if (!field) throw new Error('missing ${testid}');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return field.value;
  })()`);
}

async function requireAny(app, selector, advisorLabel) {
  await eventually(
    () => app.eval(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),
    `Missing control for ${advisorLabel}: ${selector}`,
  );
}

const cases = [
  {
    name: 'client record keeps its complete picture after reopening',
    spec: '02 §§1.1–1.5; 04 §3',
    async run(app) {
      await app.click('spine-nav-matters', 'Clients');
      await app.click('crm-directory-add', 'Add household');
      await app.fill('crm-household-name', 'Harbor Family', 'household name');
      await app.click('crm-household-save', 'save household');
      await app.require('crm-household-record', 'household record');

      await app.click('crm-household-edit', 'edit household');
      await app.fill('crm-household-edit-advisor', 'Maya', 'primary advisor');
      await app.fill('crm-household-edit-tier', 'Platinum', 'service tier');
      await app.fill('crm-household-edit-review', '2026-09-18', 'next review due');
      await app.click('crm-household-edit-save', 'save household details');

      await app.click('crm-household-add', 'add to household');
      await app.click('crm-household-add-account', 'add account');
      await app.fill('crm-account-custodian', 'Harbor Custody', 'account custodian');
      await app.fill('crm-account-type', 'Joint investment', 'account type');
      await app.fill('crm-account-last-four', '4821', 'masked account ending');
      await app.fill('crm-account-purpose', 'Retirement income', 'account purpose');
      await app.click('crm-account-save', 'save account');

      // The spec requires advisor-driven Fact and both audience-lane actions. A
      // stable handle is part of being able to independently verify those actions.
      await app.require('crm-household-add-fact', 'add a dated, sourced Fact');
      await app.require('crm-household-add-internal-note', 'add an internal-only note');
      await app.require('crm-household-add-client-note', 'add a client-facing note');

      await app.restartAndReopen();
      await app.expectText('Harbor Family', 'saved household after reopening');
      await app.expectText('Maya', 'saved primary advisor after reopening');
      await app.expectText('Platinum', 'saved service tier after reopening');
      await app.expectText('Retirement income', 'saved account purpose after reopening');
    },
  },
  {
    name: 'a commitment keeps its owner, date, urgency, and repeat rule',
    spec: '02 §1.6; 04 §5',
    async run(app) {
      await app.click('crm-home-nav-tasks', 'Home > Tasks');
      await app.click('crm-task-new', 'New task');
      await app.fill('crm-task-title-input', 'Prepare Harbor annual review', 'task title');
      await app.fill('crm-task-body', 'Bring tax and allocation questions.', 'task notes');
      await app.fill('crm-task-assignee', 'maya', 'single assignee');
      await app.fill('crm-task-due', '2026-09-18', 'due date');
      await select(app, 'crm-task-priority', 'high', 'priority');
      await select(app, 'crm-task-recurrence', 'annual', 'recurrence');
      await app.click('crm-task-save', 'save task');
      await app.expectText('Prepare Harbor annual review', 'new task in the list');

      await app.restartAndReopen();
      await app.click('crm-home-nav-tasks', 'Home > Tasks after reopening');
      const taskText = String(await app.text());
      for (const expected of ['Prepare Harbor annual review', 'maya', 'High', 'Sep']) {
        assert.ok(taskText.includes(expected), `Expected saved task to show ${expected}`);
      }

      await app.click('crm-task-new', 'open saved task for completion');
      await select(app, 'crm-task-status', 'done', 'complete task');
      await app.click('crm-task-save', 'save completed task');
      await app.expectText('recurring', 'next recurring task after completion');
    },
  },
  {
    name: 'a workflow change is offered one household at a time without erasing progress',
    spec: '03 §4 P1–P10; 04 §§6–7',
    async run(app) {
      await app.click('crm-home-nav-workflows', 'Home > Workflows');
      await app.click('crm-live-workflow-create-template', 'create workflow template');
      await app.fill('crm-live-workflow-name', 'Annual review', 'workflow name');
      await app.click('crm-live-workflow-add-title', 'add template step');
      await app.click('crm-live-workflow-publish', 'publish named workflow update');
      await app.click('crm-live-workflow-open-propagation', 'open propagation review');

      await app.require('crm-propagation-approve-all', 'approve eligible instance offers');
      await requireAny(app, '[data-testid^="crm-propagation-decision-"]', 'per-step accept or reject choice');
      await requireAny(app, '[data-testid^="crm-workflow-step-complete-"]', 'complete a workflow step');
      await app.require('crm-propagation-undo', 'conditional undo');
      await app.require('crm-propagation-undo-report', 'protected-cell undo report');

      const body = String(await app.text());
      assert.match(body, /offer/i, 'A template update must create an offer, not alter the instance immediately.');
      assert.match(body, /completed|progress/i, 'Propagation review must disclose protected progress.');
    },
  },
  {
    name: 'the migration report accounts for every source type, including attachments',
    spec: '05 §§2.5 and 3; 04 §11',
    async run(app) {
      await app.click('crm-home-nav-firm-setup', 'Home > Firm');
      await app.click('crm-firm-route-migration', 'Migration');
      await app.click('crm-migration-fidelity', 'Review fidelity report');
      await app.require('crm-fidelity-matrix', 'canonical fidelity report');
      const report = String(await app.text());
      for (const sourceType of [
        'Household', 'Note', 'Task', 'Event', 'Opportunity', 'Project',
        'Workflow template', 'Open workflow', 'Custom-field', 'Tags',
        'Contact roles', 'Users', 'Activity stream', 'Attachments',
      ]) {
        assert.ok(report.toLowerCase().includes(sourceType.toLowerCase()), `Fidelity report omits ${sourceType}`);
      }
      assert.match(report, /attachments[\s\S]{0,160}(0%|0 percent)[\s\S]{0,160}(API|api)/i,
        'Attachments must explicitly say they are 0% via the API.');
      assert.match(report, /exported|attachment gap/i,
        'Every affected client must be marked exported or attachment gap.');
      await app.require('crm-migration-workflow-fallback', 'in-flight workflow re-creation');
      await app.require('crm-migration-attachment-fallback', 'attachment accounting');
    },
  },
  {
    name: 'an advisor must approve an outside write',
    spec: '00 D5; 04 §§11 and 15',
    async run(app) {
      await app.click('crm-home-nav-firm-setup', 'Home > Firm');
      await app.click('crm-firm-route-migration', 'Migration');
      await app.click('crm-migration-start-parallel', 'start parallel run');
      await app.require('crm-approval-queue', 'approval queue');
      await requireAny(app, '[data-testid^="crm-approval-approve-"]', 'approve external write');
      const beforeApproval = String(await app.text());
      assert.doesNotMatch(beforeApproval, /sent to Wealthbox|write sent/i,
        'An external write appeared sent before an advisor approved it.');
      assert.match(beforeApproval, /approve|review/i, 'Outside change must wait for an advisor review.');
    },
  },
  {
    name: 'freshness is honest before complete source checks finish',
    spec: '00 D26; 04 §15',
    async run(app) {
      await app.click('crm-home-nav-firm-setup', 'Home > Firm');
      await app.click('crm-firm-route-migration', 'Migration');
      await app.require('crm-freshness-banner', 'freshness state');
      const freshness = String(await app.eval(`document.querySelector('[data-testid="crm-freshness-banner"]')?.innerText || ''`));
      assert.doesNotMatch(freshness, /^\s*Live\s*$/i,
        'A newly opened, unchecked connector screen must not claim only “Live”.');
      assert.match(freshness, /Syncing|Last synced|Offline|Needs attention|full check/i,
        'Freshness must say what is known or missing, not merely use a green status.');
    },
  },
];

async function startVite(log) {
  try {
    const response = await fetch(`http://127.0.0.1:${VITE_PORT}`);
    if (response.ok) return { child: undefined, owned: false };
  } catch {
    // Start the server below.
  }
  const child = spawn('npm', ['run', 'dev', '--', '--port', String(VITE_PORT)], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => log(String(chunk).trim()));
  child.stderr.on('data', (chunk) => log(String(chunk).trim()));
  await eventually(async () => (await fetch(`http://127.0.0.1:${VITE_PORT}`)).ok, 'Vite did not start', APP_READY_MS);
  return { child, owned: true };
}

const logLines = [];
const log = (line) => { if (line) logLines.push(line); };
const workspace = await mkdtemp(path.join(os.tmpdir(), 'lantern-crm-acceptance-'));
const port = await freePort();
let vite;
let app;
const results = [];

try {
  vite = await startVite(log);
  app = new DesktopApp({ port, workspace, log });
  await app.launch();
  await app.openFreshWorkspace();

  for (const test of cases) {
    try {
      await test.run(app);
      results.push({ ...test, status: 'PASS' });
    } catch (error) {
      results.push({ ...test, status: 'FAIL', error: error instanceof Error ? error.message : String(error) });
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  for (const test of cases) results.push({ ...test, status: 'BLOCKED', error: message });
} finally {
  await app?.close();
  if (vite?.owned) stop(vite.child);
  await rm(workspace, { recursive: true, force: true });
}

for (const result of results) {
  console.log(`${result.status}: ${result.name} (${result.spec})${result.error ? `\n  ${result.error}` : ''}`);
}
const failed = results.filter((result) => result.status !== 'PASS');
console.log(`ACCEPTANCE: ${results.length - failed.length}/${results.length} passed; bridge port ${port}; fresh temporary workspace used.`);
if (failed.length) process.exitCode = 1;
