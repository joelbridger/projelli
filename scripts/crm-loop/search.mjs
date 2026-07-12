#!/usr/bin/env node
/**
 * Drives CRM retrieval in the real desktop app. Run after launch-app.sh, then
 * restart the app and run with --verify-persisted to prove the answer remains
 * backed by the encrypted saved record rather than browser state.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const base = `http://127.0.0.1:${process.env.DESKTOP_CDP_PORT || '9268'}`;
const verifyOnly = process.argv.includes('--verify-persisted');
const workspace = process.env.CRM_LOOP_WORKSPACE || '/tmp/crm-search-loop';
const query = 'Never include this in a client draft';

async function request(path, params = {}) {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error || `${path} failed`);
  return body.result;
}
const click = (testid) => request('/click', { testid });
const fill = (testid, text) => request('/fill', { testid, text });
const evaluate = (js) => request('/eval', { js, timeout_ms: 20_000 });

async function waitFor(testid, seconds = 20) {
  const deadline = Date.now() + seconds * 1_000;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(document.querySelector('[data-testid="${testid}"]'))`)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${testid}`);
}

try {
  // The Clients loop creates a real household and an internal note through
  // the UI. It is deliberately not a fixture or a direct database write.
  execFileSync(process.execPath, ['scripts/crm-loop/clients.mjs', ...(verifyOnly ? ['--verify-persisted'] : [])], {
    cwd: process.cwd(), env: { ...process.env, DESKTOP_CDP_PORT: process.env.DESKTOP_CDP_PORT || '9268', CRM_LOOP_WORKSPACE: workspace }, stdio: 'inherit',
  });
  await click('spine-nav-search');
  await waitFor('crm-ask-surface');
  await click('crm-record-search-tab');
  await waitFor('crm-search-surface');
  await fill('crm-search-query', query);
  await click('crm-search-submit');
  await waitFor('crm-search-answer');
  const answer = await evaluate('document.querySelector("[data-testid=crm-search-answer]")?.innerText || ""');
  if (!String(answer).includes('matching saved record')) throw new Error(`Search did not return a cited answer: ${answer}`);
  const citation = await evaluate('document.querySelector("[data-testid^=crm-search-citation-]")?.getAttribute("data-testid") || null');
  if (!citation) throw new Error('Search answer had no click-through citation');
  await click(citation);
  await waitFor('crm-search-record');
  const cited = await evaluate('document.querySelector("[data-testid=crm-search-record]")?.innerText || ""');
  if (!String(cited).includes('Never include this in a client draft')) throw new Error('Citation did not open the exact saved note record');
  const evidence = resolve(process.env.CRM_LOOP_SCREENSHOTS_DIR || 'docs/evidence/golden-loop');
  mkdirSync(evidence, { recursive: true });
  execFileSync('scrot', ['-o', resolve(evidence, '03-search.png')], { env: { ...process.env, DISPLAY: process.env.DISPLAY || ':111' }, stdio: 'ignore' });
  console.log(`PASS: CRM search returned a local cited answer${verifyOnly ? ' after restart' : ''}`);
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
