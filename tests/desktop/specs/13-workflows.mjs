/**
 * 13-workflows - runs a real workflow through interview -> artifact -> Office exports.
 *
 * This is intentionally a real-desktop path. The spec keeps the real Tauri
 * filesystem workspace, pins the chosen template to local Ollama, and blocks
 * honestly if the local model runtime is not available in the isolated profile.
 */

import fs from 'node:fs';
import path from 'node:path';

const TEMPLATE_ID = 'legal-client-intake-synthesizer';
const TEMPLATE_NAME = 'Client Intake Synthesizer';
const OLLAMA_MODEL = 'llama3.2:3b';

export default {
  name: '13-workflows',
  async run({ session, workspace, app }) {
    await bootWithWorkflowOverride(session, workspace, app);

    await app.gotoSurface(session, 'Workflows');
    await session.testid('associate-home', 20_000);
    await session.testid('associate-search', 10_000);
    await session.typeTestid('associate-search', 'Client Intake', 10_000);
    await session.waitForBodyText(TEMPLATE_NAME, { timeoutMs: 20_000 });

    await session.clickTestid(`associate-run-${TEMPLATE_ID}`, 20_000);

    const startState = await session.waitFor(
      async (s) => {
        if (await s.hasTestid('associate-provider-error', 500)) return 'provider-error';
        const body = await s.bodyText();
        if (body.includes('Prospective client name')) return 'interview';
        return false;
      },
      { timeoutMs: 35_000, intervalMs: 500, label: 'workflow interview or provider block' },
    );

    if (startState === 'provider-error') {
      const body = await session.bodyText();
      const reason = body.includes('Local AI unreachable')
        ? `Ollama running locally with model ${OLLAMA_MODEL} available`
        : `a configured AI provider, or Ollama pinned to ${OLLAMA_MODEL}`;
      throw new Error(`BLOCKED: needs ${reason} to run ${TEMPLATE_NAME} in the real Tauri app`);
    }

    await fillClientIntakeInterview(session);
    await clickButtonText(session, app, 'Continue');

    const record = await waitForWorkflowRecord(workspace, TEMPLATE_NAME, 240_000);
    if (record.status === 'failed') {
      const error = record.execution?.error ?? record.error ?? 'unknown workflow failure';
      if (/ollama|model|provider|api|connection|not found|404|refused/i.test(error)) {
        throw new Error(`BLOCKED: needs Ollama running locally with model ${OLLAMA_MODEL}; workflow failed with: ${error}`);
      }
      throw new Error(`Workflow failed after interview: ${error}`);
    }

    const generatedDocx = path.join(path.dirname(record.file), 'CLIENT_INTAKE_PACKAGE.docx');
    assertNonEmptyFile(generatedDocx, 'workflow-generated CLIENT_INTAKE_PACKAGE.docx');

    await app.gotoSurface(session, 'Documents');
    await openWorkflowFolderFromDocuments(session, record);
    await session.waitForBodyText('CLIENT_INTAKE_PACKAGE.docx', { timeoutMs: 30_000 });
    await session.waitForBodyText(path.basename(record.file), { timeoutMs: 30_000 });
    await session.clickTestid(`grid-card-${workflowRelativePath(record, path.basename(record.file))}`, 30_000);
    await session.testid('workflow-execution-tab-wrapper', 30_000);
    await assertWorkspaceSelectorNotMounted(session);

    await app.gotoSurface(session, 'Documents');
    await session.clickTestid(`grid-card-${workflowRelativePath(record, 'CLIENT_INTAKE_PACKAGE.docx')}`, 30_000);
    await session.testid('docx-run', 30_000);
  },
};

async function bootWithWorkflowOverride(session, workspacePath, app) {
  await session.newSession();
  await session.testid('welcome-dialog-pitch', 30_000);

  const hasTauri = await session.execute('return Boolean(window.__TAURI__);');
  if (!hasTauri) throw new Error('window.__TAURI__ missing; not the desktop webview.');

  await session.execute(
    `
      const settings = {
        state: {
          values: {
            templateModelOverrides: {
              [arguments[0]]: { provider: 'ollama', model: arguments[1] }
            }
          },
          _migrated: true,
          featuresTourCompleted: true,
          language: null
        },
        version: 0
      };
      localStorage.setItem('keepance:settings', JSON.stringify(settings));
    `,
    [TEMPLATE_ID, OLLAMA_MODEL],
  );

  await app.seedReadyState(session, workspacePath, { workspaceName: 'wd-workspace' });
  await session.refresh();

  await session.clickTestid('recent-workspaces-toggle', 30_000);
  const recent = await session.find(
    'xpath',
    `//button[.//div[normalize-space()=${app.xpathLiteral('wd-workspace')}]]`,
    20_000,
  );
  await session.click(recent);

  await session.testid('spine-nav', 45_000);
  await session.testid('status-bar', 15_000);
  await session.maybeClickTestid('feature-tour-skip');
}

async function openWorkflowFolderFromDocuments(session, record) {
  const folderName = path.basename(record.workflowFolderPath ?? path.dirname(record.file));
  await session.clickTestid(`grid-card-${folderName}`, 30_000);
}

function workflowRelativePath(record, filename) {
  const folderName = path.basename(record.workflowFolderPath ?? path.dirname(record.file));
  return `${folderName}/${filename}`;
}

async function assertWorkspaceSelectorNotMounted(session) {
  const selectorVisible = await session.hasTestid('welcome-dialog-pitch', 1_000);
  if (selectorVisible) {
    throw new Error('Opening a saved .workflow record returned to the workspace selector.');
  }
}

async function fillClientIntakeInterview(session) {
  await session.waitForBodyText('Intake call notes', { timeoutMs: 20_000 });
  const filled = await session.execute(`
    const form = [...document.querySelectorAll('form')]
      .find((f) => f.innerText.includes('Prospective client name'));
    if (!form) return false;

    function setValue(el, value) {
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const textInputs = [...form.querySelectorAll('input[type="text"]')];
    if (textInputs[0]) setValue(textInputs[0], 'Robert Tran');

    const selects = [...form.querySelectorAll('select')];
    for (const select of selects) {
      const fallback = select.options[1]?.value || select.options[0]?.value || '';
      setValue(select, select.value || fallback);
    }

    const textareas = [...form.querySelectorAll('textarea')];
    if (textareas[0]) {
      setValue(textareas[0], 'Robert Tran called about a dispute with former business partner David Kowalski. Kowalski allegedly withdrew $80,000 from Kowalski-Tran Ventures LLC before dissolution in June 2025. Tran has emails, the operating agreement, and bank statements. He wants recovery options and needs a conflict check before engagement.');
    }
    if (textareas[1]) {
      setValue(textareas[1], 'Check David Kowalski, Kowalski-Tran Ventures LLC, and accountant Linda Park.');
    }
    return true;
  `);
  if (!filled) throw new Error('Client intake interview form did not render.');
}

async function clickButtonText(session, app, text) {
  const literal = app.xpathLiteral(text);
  const button = await session.find(
    'xpath',
    `//button[normalize-space(.)=${literal} or .//*[normalize-space()=${literal}]]`,
    20_000,
  );
  await session.click(button);
}

async function waitForWorkflowRecord(workspace, templateName, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const files = listFiles(workspace).filter((file) => file.endsWith('.workflow'));
    for (const file of files) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        const name = parsed.template?.name ?? parsed.execution?.template?.name;
        const status = parsed.status ?? parsed.execution?.status;
        if (name === templateName && (status === 'completed' || status === 'failed')) {
          return { file, status, ...parsed };
        }
      } catch {
        // The workflow file is written repeatedly while running; ignore partial reads.
      }
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${templateName} .workflow record to complete.`);
}

function assertNonEmptyFile(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} missing at ${file}`);
  const size = fs.statSync(file).size;
  if (size <= 0) throw new Error(`${label} is empty at ${file}`);
}

function listFiles(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(full));
    else result.push(full);
  }
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
