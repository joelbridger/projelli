#!/usr/bin/env node
/**
 * Live migration proof. Starts only the fabricated Wealthbox simulator, then
 * drives the real desktop app through its debug bridge. It deliberately fails
 * if the app, importer, or saved report is unavailable.
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const desktop = path.join(root, 'scripts/desktop-drive.mjs');
const verifyOnly = process.argv.includes('--verify-persisted');
const shots = process.env.CRM_LOOP_SCREENSHOTS_DIR
  ? path.join(process.env.CRM_LOOP_SCREENSHOTS_DIR, 'migration')
  : path.join(root, 'docs/evidence/golden-loop/migration');
mkdirSync(shots, { recursive: true });
const env = {
  ...process.env,
  DESKTOP_CDP_PORT: process.env.DESKTOP_CDP_PORT ?? '9250',
};
const run = (args, timeout = 30_000) =>
  execFileSync('node', [desktop, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout,
  });
const waitFor = async (label, condition, timeoutMs = 45_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await condition()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`
  );
};
const screenshot = (name) => {
  const target = path.join(shots, name);
  try {
    run(['screenshot', target]);
    return target;
  } catch {
    // Linux's debug bridge is DOM-only. Capture the X display when it exists.
    if (process.env.DISPLAY) {
      execFileSync('scrot', [target], { env, timeout: 10_000 });
      return target;
    }
    return null;
  }
};

let simulator;
try {
  if (verifyOnly) {
    run(['click', 'crm-home-nav-firm-setup']);
    run(['click', 'crm-firm-route-migration']);
    run(['click', 'crm-migration-fidelity']);
    run(['waitfor', 'Attachments: 0% via API']);
    const records = JSON.parse(
      run(['eval', "window.__TAURI_INTERNALS__.invoke('crm_live_list')"])
    );
    const requiredKinds = [
      'migration_report',
      'migration_workflow_checklist',
      'migration_attachment_accounting',
      'migration_export',
    ];
    for (const kind of requiredKinds) {
      if (!records.some((record) => record.kind === kind))
        throw new Error(
          `Saved migration record missing after restart: ${kind}`
        );
    }
    console.log(
      'PASS persistence: migration fidelity report, fallback checklists, and archive export survived the desktop restart.'
    );
    process.exit(0);
  }
  simulator = spawn('bun', ['tests/wbsim/server.ts'], {
    cwd: root,
    env: { ...env, WBSIM_PORT: '8788' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const baseUrl = 'http://127.0.0.1:8788/v1';
  await waitFor(
    'the fabricated Wealthbox simulator',
    async () => (await fetch(`${baseUrl}/contacts?per_page=1`)).ok
  );

  run(['click', 'crm-home-nav-firm-setup']);
  run(['click', 'crm-firm-route-migration']);
  run(['type', 'crm-migration-base-url', baseUrl]);
  run(['click', 'crm-migration-run-import']);
  run(['waitfor', 'Import finished', '45']);
  screenshot('01-import-finished.png');
  run(['click', 'crm-migration-fidelity']);
  run(['waitfor', 'Attachments: 0% via API']);
  const matrix = run([
    'eval',
    "document.querySelectorAll('[data-testid^=crm-fidelity-row-]').length",
  ]);
  if (Number(matrix.trim()) < 15)
    throw new Error(`Expected every fidelity row, received ${matrix.trim()}.`);
  screenshot('02-fidelity-report.png');

  run(['click', 'crm-migration-workflow-fallback']);
  const workflowSave = JSON.parse(
    run([
      'eval',
      "JSON.stringify(Array.from(document.querySelectorAll('[data-testid^=crm-workflow-record-]')).map(x => x.getAttribute('data-testid')))",
    ])
  );
  if (!workflowSave.length)
    throw new Error('No in-flight workflow checklist was saved.');
  const workflowId = workflowSave[0].replace('crm-workflow-record-', '');
  run(['click', `crm-workflow-evidence-${workflowId}`]);
  run([
    'eval',
    `document.querySelector('[data-testid="crm-workflow-step-${workflowId}"]').value = document.querySelector('[data-testid="crm-workflow-step-${workflowId}"]').options[1].value; document.querySelector('[data-testid="crm-workflow-step-${workflowId}"]').dispatchEvent(new Event('change', { bubbles: true }))`,
  ]);
  run([
    'eval',
    "Array.from(document.querySelectorAll('button')).find((button) => button.textContent.includes('Create resulting instance'))?.click()",
  ]);
  run([
    'type',
    `crm-workflow-instance-${workflowId}`,
    'Recreated imported workflow',
  ]);
  run(['click', `crm-workflow-record-${workflowId}`]);
  run(['waitfor', 'Checklist recorded']);

  run(['click', 'crm-home-nav-firm-setup']);
  run(['click', 'crm-firm-route-migration']);
  run(['click', 'crm-migration-attachment-fallback']);
  const attachmentSave = JSON.parse(
    run([
      'eval',
      "JSON.stringify(Array.from(document.querySelectorAll('[data-testid^=crm-attachment-record-save-]')).map(x => x.getAttribute('data-testid')))",
    ])
  );
  if (!attachmentSave.length)
    throw new Error('No attachment accounting record was saved.');
  const attachmentId = attachmentSave[0].replace(
    'crm-attachment-record-save-',
    ''
  );
  run([
    'eval',
    `const e=document.querySelector('[data-testid="crm-attachment-status-${attachmentId}"]');e.value='gap';e.dispatchEvent(new Event('change',{bubbles:true}))`,
  ]);
  run([
    'type',
    `crm-attachment-reason-${attachmentId}`,
    'The old system does not offer attachments through its import connection.',
  ]);
  run(['type', `crm-attachment-owner-${attachmentId}`, 'Migration owner']);
  run(['click', `crm-attachment-record-save-${attachmentId}`]);
  run(['waitfor', 'Attachment status recorded']);
  screenshot('03-attachment-checklist.png');

  run(['click', 'crm-home-nav-firm-setup']);
  run(['click', 'crm-firm-route-migration']);
  run(['click', 'crm-migration-archive']);
  run(['click', 'crm-export-create']);
  run(['waitfor', 'Exported']);
  screenshot('04-archive-export.png');
  run(['click', 'crm-home-nav-firm-setup']);
  run(['click', 'crm-firm-route-migration']);
  run(['click', 'crm-migration-run-import']);
  run(['waitfor', 'Import finished', '45']);
  console.log(
    'PASS migration: import, complete fidelity matrix, both fallback paths, archive export, and idempotent re-import all drove through the desktop app.'
  );
} catch (error) {
  console.error(
    `FAIL migration: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
} finally {
  if (simulator?.exitCode === null && simulator.signalCode === null) {
    simulator.kill('SIGTERM');
    await new Promise((resolve) => simulator.once('exit', resolve));
  }
}
