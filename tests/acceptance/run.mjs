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
  if (!child) return;
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
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
      detached: true,
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
    // The desktop debug launcher owns its own shutdown process tree. Reload the
    // real app shell here so the acceptance run can verify persisted records
    // without sending a signal into the test process group.
    await this.eval('location.reload(); true');
    await eventually(() => this.exists('spine-nav'), 'The reopened app did not restore CRM navigation');
  }
}

async function select(app, testid, value, advisorLabel) {
  await app.require(testid, advisorLabel);
  await app.eval(`(() => {
    const field = document.querySelector('[data-testid="${testid}"]');
    if (!field) throw new Error('missing ${testid}');
    field.value = ${JSON.stringify(value)};
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

async function clickFirst(app, selector, advisorLabel) {
  await requireAny(app, selector, advisorLabel);
  await app.eval(`(() => {
    const control = document.querySelector(${JSON.stringify(selector)});
    if (!control) throw new Error(${JSON.stringify(`missing ${advisorLabel}`)});
    control.click();
    return true;
  })()`);
}

async function openHome(app, section, advisorLabel) {
  await app.click('spine-nav-home', 'Home');
  await app.click(`crm-home-nav-${section}`, advisorLabel);
}

async function openDirectory(app) {
  await app.click('spine-nav-matters', 'Clients');
  if (await app.exists('crm-household-back')) {
    await app.click('crm-household-back', 'return to the client directory');
  }
  await app.require('crm-directory-surface', 'client directory');
}

const cases = [
  {
    name: 'client record keeps its complete picture after reopening',
    spec: '02 §§1.1–1.5; 04 §3',
    async run(app) {
      await openDirectory(app);
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
      await app.click('crm-household-add', 'open household actions again');
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
      await openHome(app, 'tasks', 'Home > Tasks');
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
      await openHome(app, 'tasks', 'Home > Tasks after reopening');
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
    name: 'a client can keep a company, trust role, and more than one contact route',
    spec: '02 §1.2; 04 §§3–4; 01 §1',
    async run(app) {
      await openDirectory(app);
      await clickFirst(app, '[data-testid^="crm-directory-household-"]', 'open a household from the directory');
      await app.click('crm-household-add', 'add to household');
      await app.click('crm-household-add-person', 'add a person, trust, or organization');
      await app.fill('crm-person-name', 'Redwood Family Trust', 'person or trust name');
      await app.fill('crm-person-company', 'Redwood Family Office', 'company');
      await app.fill('crm-person-relationship', 'Trustee', 'household role');
      await app.require('crm-person-type', 'person, trust, or organization type');
      await app.require('crm-person-external', 'external-party choice');
      await app.require('crm-person-roles', 'external role');
      await app.require('crm-person-save', 'save person or trust');
      await requireAny(app, '[data-testid^="crm-person-channel-"]', 'add more than one phone, email, or address');
    },
  },
  {
    name: 'task lists can save an advisor view without changing the shared task truth',
    spec: '02 §§1.6, 1.22; 04 §§5, 12',
    async run(app) {
      await openHome(app, 'tasks', 'Home > Tasks');
      await app.click('crm-task-save-view', 'save this task view');
      await app.fill('crm-task-view-name', 'My Harbor reviews', 'saved task-view name');
      await app.require('crm-task-save-view-open', 'choose whether to share a saved task view');
      await app.click('crm-task-save-view-open', 'save task view');
      await app.require('crm-task-saved-views', 'saved task views');
      await app.expectText('My Harbor reviews', 'saved personal task view');
    },
  },
  {
    name: 'workflow templates offer a starter library, schedules, and step outcomes',
    spec: '02 §§1.7–1.8; 03 §4; 04 §§6–7; 01 §5',
    async run(app) {
      await openHome(app, 'workflows', 'Home > Workflows');
      await app.require('crm-starter-workflow-library', 'starter workflow library');
      await clickFirst(app, '[data-testid="crm-live-workflow-create-template"], [data-testid="crm-live-workflow-new-template"]', 'create a workflow template');
      await app.fill('crm-live-workflow-name', 'Annual review with follow-up', 'workflow name');
      await app.click('crm-live-workflow-add-title', 'add a template step');
      await app.require('crm-live-workflow-schedule-enabled', 'template schedule editor');
      await requireAny(app, '[data-testid^="crm-live-workflow-add-outcome-"]', 'step outcomes and branching editor');
      await app.require('crm-live-workflow-publish', 'publish a named template update');
    },
  },
  {
    name: 'reports show their sources and can become an explicit personal or firm view',
    spec: '02 §1.22; 04 §9; 01 §10',
    async run(app) {
      await openHome(app, 'reports', 'Home > Reports');
      await app.click('crm-report-run', 'run a current report');
      await app.require('crm-report-results', 'computed report results');
      await app.require('crm-report-provenance', 'report sources, exclusions, and freshness');
      await app.click('crm-report-save', 'save report view');
      await app.fill('crm-report-save-name', 'Clients needing a check-in', 'saved report-view name');
      await app.require('crm-report-save-visibility', 'explicit personal or firm sharing choice');
      await app.click('crm-report-save-confirm', 'save report view');
      await app.expectText('Clients needing a check-in', 'saved report view');
    },
  },
  {
    name: 'firm setup manages shared labels while keeping member administration separate',
    spec: '02 §§1.9, 1.12–1.13, 1.17; 04 §§12–13; 01 §§2, 16',
    async run(app) {
      await openHome(app, 'firm', 'Home > Firm');
      await app.require('crm-firm-directory', 'read-only firm directory');
      await app.click('crm-firm-tab-fields', 'custom fields');
      await app.click('crm-field-create', 'new custom field');
      await app.fill('crm-field-label', 'Service region', 'custom field label');
      await app.fill('crm-field-key', 'service_region', 'custom field key');
      await app.require('crm-field-type', 'custom field type');
      await app.click('crm-field-save', 'save custom field');
      await app.click('crm-firm-tab-tags', 'tags');
      await app.click('crm-tag-create', 'new tag');
      await app.fill('crm-tag-name', 'Money movement', 'tag name');
      await app.click('crm-tag-save', 'save tag');
      await app.expectText('Money movement', 'saved firm tag');
    },
  },
  {
    name: 'a household exposes its linked email, meetings, and service-tier scheduling safely',
    spec: '02 §§1.1, 1.9; 04 §§3, 14; 01 §§8–9, 13',
    async run(app) {
      await openDirectory(app);
      await clickFirst(app, '[data-testid^="crm-directory-household-"]', 'open a household for connector links');
      await app.click('crm-household-tab-email', 'open household email');
      await app.require('crm-household-email', 'household email surface');
      await app.click('crm-household-tab-meetings', 'open household meetings');
      await app.require('crm-household-meetings', 'household meetings surface');
      await app.require('crm-household-schedule', 'schedule with this household');
      await app.require('crm-household-scheduling-link', 'configured service-tier scheduling link');
      await app.require('crm-household-email-open', 'open household email through the existing mail surface');
    },
  },
  {
    name: 'firm search and Ask show cited, scoped answers rather than unsupported claims',
    spec: '00 D9, D22; 02 §§1.15, 3; 04 §§1, 14; 01 §§9, 15',
    async run(app) {
      await app.click('spine-nav-search', 'Ask');
      await app.require('crm-ask-surface', 'CRM Ask route');
      await app.require('crm-ask-input', 'Ask question input');
      await app.require('crm-ask-answer-tab', 'cited answer view');
      await app.click('crm-record-search-tab', 'search firm records from Ask');
      await app.require('crm-search-surface', 'firm search route');
      await app.require('crm-search-query', 'firm search input');
      await app.require('crm-search-scope', 'search scope control');
      await app.fill('crm-search-query', 'Harbor', 'firm search query');
      await app.require('crm-search-submit', 'run firm search');
      await app.click('crm-search-submit', 'search firm records');
      await requireAny(app, '[data-testid^="crm-search-citation-"]', 'open a cited source record');
    },
  },
  {
    name: 'the pipeline can be configured and holds opportunities without becoming a project container',
    spec: '02 §§1.14, 1.16; 04 §8; 01 §§6–7',
    async run(app) {
      await openHome(app, 'pipeline', 'Home > Pipeline');
      await app.require('crm-pipeline-settings', 'pipeline settings');
      await clickFirst(app, '[data-testid="crm-pipeline-create-first"], [data-testid="crm-pipeline-new"]', 'create a pipeline or opportunity');
      await app.require('crm-pipeline-name', 'pipeline name');
      await app.fill('crm-pipeline-name', 'Retirement conversions', 'pipeline name');
      await app.click('crm-pipeline-save', 'save pipeline');
      await app.click('crm-pipeline-new', 'new opportunity');
      await app.fill('crm-opportunity-name', 'Harbor retirement conversion', 'opportunity name');
      await app.fill('crm-opportunity-amount', '400000', 'opportunity value');
      await app.click('crm-opportunity-save', 'save opportunity');
      await app.require('crm-pipeline-board', 'opportunity pipeline board');
      await app.expectText('Harbor retirement conversion', 'saved opportunity');
    },
  },
  {
    name: 'a household timeline and activity feed preserve readable history and local notification state',
    spec: '02 §§1.5, 1.10; 03 §2; 04 §§3, 10; 01 §11',
    async run(app) {
      await openDirectory(app);
      await clickFirst(app, '[data-testid^="crm-directory-household-"]', 'open a household history');
      await app.require('crm-household-tab-timeline', 'household timeline tab');
      await app.click('crm-household-tab-timeline', 'open household timeline');
      await app.require('crm-household-timeline', 'household timeline');
      await app.require('crm-timeline-type', 'timeline type filters');
      await app.require('crm-timeline-freshness', 'timeline source freshness');
      await app.require('crm-notifications-button', 'notification inbox');
      await app.click('crm-notifications-button', 'open notification inbox');
      await app.require('crm-notification-inbox', 'recipient notification inbox');
      await app.require('crm-notifications-read', 'mark notifications read only on this device');
    },
  },
  {
    name: 'a workflow change is offered one household at a time without erasing progress',
    spec: '03 §4 P1–P10; 04 §§6–7',
    async run(app) {
      await openHome(app, 'workflows', 'Home > Workflows');
      await clickFirst(app, '[data-testid="crm-live-workflow-create-template"], [data-testid="crm-live-workflow-new-template"]', 'create workflow template');
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
      await openHome(app, 'firm', 'Home > Firm');
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
      await openHome(app, 'firm', 'Home > Firm');
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
      await openHome(app, 'firm', 'Home > Firm');
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
    detached: true,
  });
  child.stdout.on('data', (chunk) => log(String(chunk).trim()));
  child.stderr.on('data', (chunk) => log(String(chunk).trim()));
  await eventually(async () => (await fetch(`http://127.0.0.1:${VITE_PORT}`)).ok, 'Vite did not start', APP_READY_MS);
  return { child, owned: true };
}

const logLines = [];
const log = (line) => { if (line) logLines.push(line); };
const workspace = await mkdtemp(path.join(os.tmpdir(), 'lantern-crm-acceptance-'));
const requestedPort = Number.parseInt(process.env.ACCEPTANCE_BRIDGE_PORT ?? '', 10);
const port = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : await freePort();
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
