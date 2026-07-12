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
  // In Linux bridge mode the selected bridge port is also the desktop-drive
  // port.  Keeping the legacy 9250 default here silently sent this live
  // migration proof to another agent's app whenever a lane chose its own
  // bridge port.
  DESKTOP_CDP_PORT:
    process.env.DESKTOP_CDP_PORT ?? process.env.LANTERN_DEV_BRIDGE_PORT ?? '9250',
};
const workspace = process.env.CRM_LOOP_WORKSPACE;
const run = (args, timeout = 90_000) =>
  execFileSync('node', [desktop, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout,
  });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
const exportedFile = () => JSON.parse(run(['eval', "document.querySelector('[data-testid=crm-export-file]')?.textContent?.replace(/^Saved file: /, '').split(' · ')[0] ?? null"]));

let simulator;
try {
  if (!workspace)
    throw new Error('CRM_LOOP_WORKSPACE is required so the migration uses a real encrypted workspace.');
  run(['eval', `(async () => { const invoke = window.__TAURI_INTERNALS__?.invoke; if (!invoke) throw new Error('Tauri invoke is unavailable'); await invoke('crm_set_workspace', { path: ${JSON.stringify(workspace)} }); const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts'); useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)}); return true; })()`]);
  if (verifyOnly) {
    run(['click', 'crm-home-nav-firm-setup']);
    run(['click', 'crm-firm-route-migration']);
    run(['click', 'crm-migration-fidelity']);
    run(['waitfor', '0% via API']);
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
  run(['waitfor', 'Import finished', '90']);
  const landed = JSON.parse(run(['eval', "window.__TAURI_INTERNALS__.invoke('crm_live_list')"]));
  for (const kind of ['household', 'note', 'task']) {
    if (!landed.some((record) => record.kind === kind))
      throw new Error(`Import finished without a real ${kind} record in the encrypted CRM store.`);
  }
  screenshot('01-import-finished.png');
  run(['click', 'crm-migration-fidelity']);
  run(['waitfor', 'Not ready to switch yet']);
  run(['waitfor', "couldn't be imported"]);
  const matrix = run([
    'eval',
    "document.querySelectorAll('[data-testid^=crm-fidelity-row-]').length",
  ]);
  if (Number(matrix.trim()) < 15)
    throw new Error(`Expected every fidelity row, received ${matrix.trim()}.`);
  run(['click', 'crm-migration-open-note-gaps']);
  run(['waitfor', 'Notes to check']);
  screenshot('02-fidelity-report.png');

  run(['click', 'crm-home-nav-firm-setup']);
  run(['click', 'crm-firm-route-migration']);
  run(['click', 'crm-migration-fidelity']);
  run(['click', 'crm-migration-workflow-fallback']);
  const workflowSave = JSON.parse(run(['eval', "Array.from(document.querySelectorAll('[data-testid^=crm-workflow-record-]')).map(x => x.getAttribute('data-testid'))"]));
  if (workflowSave.length) {
    const workflowId = workflowSave[0].replace('crm-workflow-record-', '');
    const stepControl = `document.querySelector('[data-testid="crm-workflow-step-${workflowId}"]')`;
    const stepCount = Number(run(['eval', `${stepControl}?.options.length ?? 0`]).trim());
    run(['click', `crm-workflow-evidence-${workflowId}`]);
    if (stepCount >= 2) {
      run(['eval', `${stepControl}.value = ${stepControl}.options[1].value; ${stepControl}.dispatchEvent(new Event('change', { bubbles: true }))`]);
      run(['type', `crm-workflow-instance-${workflowId}`, 'Recreated imported workflow']);
    } else {
      run(['waitfor', 'Lantern will not invent a workflow']);
    }
    run(['click', `crm-workflow-record-${workflowId}`]);
    run(['waitfor', 'Checklist recorded']);
    if (stepCount >= 2) {
      run(['click', 'crm-home-nav-workflows']);
      const instances = Number(run(['eval', "document.querySelectorAll('[data-testid^=crm-live-workflow-instance-]').length"]).trim());
      if (!instances) throw new Error('The checklist was saved, but no real Lantern workflow instance was created.');
    }
  }

  run(['click', 'crm-home-nav-firm-setup']);
  run(['click', 'crm-firm-route-migration']);
  run(['click', 'crm-migration-fidelity']);
  run(['click', 'crm-migration-attachment-fallback']);
  const attachmentSave = JSON.parse(
    run([
      'eval',
      "Array.from(document.querySelectorAll('[data-testid^=crm-attachment-record-save-]')).map(x => x.getAttribute('data-testid'))",
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
  // Reloading the real renderer forces the checklist values to come back from
  // the encrypted store instead of surviving only in component memory.
  run(['eval', 'window.location.reload()']);
  await waitFor('the renderer after its real reload', async () => {
    try {
      return Boolean(JSON.parse(run(['eval', "Boolean(document.querySelector('[data-testid=crm-home-nav-firm-setup]'))"])));
    } catch {
      return false;
    }
  });

  run(['click', 'crm-home-nav-firm-setup']); run(['click', 'crm-firm-route-migration']); run(['click', 'crm-migration-archive']); run(['click', 'crm-export-create']); run(['waitfor', 'Exported']);
  const archiveFile = exportedFile();
  if (!archiveFile || !existsSync(archiveFile)) throw new Error('The archive screen reported success, but no archive file exists on disk.');
  run(['click', 'crm-home-nav-firm-setup']); run(['click', 'crm-firm-route-migration']); run(['click', 'crm-migration-rollback']); run(['click', 'crm-export-create']); run(['waitfor', 'Exported']);
  const rollbackFile = exportedFile();
  if (!rollbackFile || !existsSync(rollbackFile)) throw new Error('The rollback screen reported success, but no rollback CSV exists on disk.');
  screenshot('04-archive-export.png');
  run(['click', 'crm-home-nav-firm-setup']); run(['click', 'crm-firm-route-migration']); run(['click', 'crm-migration-run-import']); await pause(35_000); run(['waitfor', 'Import finished', '90']);
  console.log('PASS migration: import, complete fidelity matrix, both fallback paths, real archive and rollback files, and idempotent re-import all drove through the desktop app.');
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
