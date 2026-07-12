#!/usr/bin/env node
/**
 * Real desktop proof for CRM Ask. Start the Vite server and a launched CRM loop
 * app first. This requires a working local model or an approved AI provider,
 * because it proves the real answer-and-citation path rather than a fixture.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const port = process.env.DESKTOP_CDP_PORT || '9250';
const base = 'http://127.0.0.1:' + port;
const workspace = process.env.CRM_LOOP_WORKSPACE || '/tmp/crm-ask-loop';
const question = 'What note says never to include something in a client draft?';

async function request(path, params = {}) {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error || path + ' failed');
  return body.result;
}

const click = (testid) => request('/click', { testid });
const fill = (testid, text) => request('/fill', { testid, text });
const evaluate = (js) => request('/eval', { js, timeout_ms: 20_000 });

async function waitFor(testid, seconds = 45) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await evaluate('Boolean(document.querySelector(' + JSON.stringify('[data-testid="' + testid + '"]') + '))')) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Timed out waiting for ' + testid + '. Check that an AI provider is ready and allowed to use this workspace.');
}

try {
  execFileSync(process.execPath, ['scripts/crm-loop/clients.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DESKTOP_CDP_PORT: port,
      CRM_LOOP_WORKSPACE: workspace,
    },
    stdio: 'inherit',
  });

  await click('spine-nav-search');
  await waitFor('crm-ask-surface', 20);
  await fill('ask-composer-input', question);
  await click('ask-composer-submit');
  await waitFor('ask-citation-chip-1');
  await click('ask-citation-chip-1');
  await waitFor('crm-citation-record');

  const record = await evaluate('document.querySelector("[data-testid=crm-citation-record]")?.innerText || ""');
  if (!String(record).includes('Never include this in a client draft')) {
    throw new Error('The citation did not open the exact saved CRM note.');
  }

  await waitFor('crm-ask-proposal');
  await fill('crm-ask-proposal-text', 'Review the internal drafting note');
  await click('crm-ask-proposal-submit');
  await waitFor('crm-ask-proposal-saved');
  const proposal = await evaluate('(async () => (await window.__TAURI_INTERNALS__.invoke("crm_live_list")).find((record) => record.kind === "proposalRecord" && record.proposalKind === "task_create" && record.proposedMutation?.task?.title === "Review the internal drafting note") || null)()');
  if (!proposal || proposal.state !== 'pending') {
    throw new Error('Ask did not save a pending ProposalRecord.');
  }

  const evidence = resolve(process.env.CRM_LOOP_SCREENSHOTS_DIR || 'docs/evidence/golden-loop');
  mkdirSync(evidence, { recursive: true });
  execFileSync('scrot', ['-o', resolve(evidence, '04-ask.png')], {
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':111' },
    stdio: 'ignore',
  });
  console.log('PASS: CRM Ask cited the exact encrypted note, opened it, and saved a pending proposal.');
} catch (error) {
  console.error('FAIL: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
