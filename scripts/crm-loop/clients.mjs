#!/usr/bin/env node
/**
 * Drives the real Tauri dev bridge. Start the app first, then run once to
 * create the fixture and again with --verify-persisted after restarting it.
 */
const base = `http://127.0.0.1:${process.env.DESKTOP_CDP_PORT || '9250'}`;
const verifyOnly = process.argv.includes('--verify-persisted');
const suffix = 'CRM loop household';

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

async function waitFor(testid, seconds = 15) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const exists = await evaluate(`Boolean(document.querySelector('[data-testid="${testid}"]'))`);
    if (exists) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${testid}`);
}

async function findHousehold() {
  return evaluate(`Array.from(document.querySelectorAll('[data-testid^="crm-directory-household-"]')).map((node) => node.getAttribute('data-testid')).find((id) => document.querySelector('[data-testid="' + id + '"]')?.textContent?.includes(${JSON.stringify(suffix)})) || null`);
}

async function openFixture() {
  await click('spine-nav-matters');
  await waitFor('crm-directory-surface');
  let id = await findHousehold();
  if (!id) {
    await click('crm-directory-add');
    await fill('crm-household-name', suffix);
    await click('crm-household-save');
    await waitFor('crm-household-record');
  } else {
    await click(id);
    await waitFor('crm-household-record');
  }
}

async function createAndEdit() {
  await openFixture();
  await click('crm-household-edit');
  await waitFor('crm-household-editor');
  await fill('crm-household-edit-tier', 'Platinum');
  await fill('crm-household-edit-advisor', 'Maya Patel');
  await click('crm-household-edit-save');

  await click('crm-household-add');
  await click('crm-household-add-person');
  await waitFor('crm-person-editor');
  await fill('crm-person-name', 'Avery CRM Loop');
  await fill('crm-person-roles', 'CPA, tax planner');
  await fill('crm-person-relationship', 'Spouse');
  await click('crm-person-save');

  await click('crm-household-add');
  await click('crm-household-add-account');
  await waitFor('crm-account-editor');
  await fill('crm-account-custodian', 'Northcrest Custody');
  await fill('crm-account-type', 'Investment');
  await fill('crm-account-purpose', 'Retirement income');
  await fill('crm-account-last-four', '4821');
  await click('crm-account-save');

  await click('crm-household-add');
  await click('crm-household-add-note');
  await waitFor('crm-note-editor');
  await fill('crm-note-body', 'Internal CRM loop note. Never include this in a client draft.');
  await click('crm-note-save');

  await click('crm-household-metadata');
  await waitFor('crm-record-metadata-editor');
  await fill('crm-tag-input', 'crm-loop');
  await evaluate(`Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Add tag')?.click()`);
  await click('crm-save-metadata');
}

async function assertSaved() {
  await openFixture();
  const text = await evaluate('document.body.innerText');
  for (const expected of ['Platinum', 'Maya Patel', 'Avery CRM Loop', 'Northcrest Custody', 'Internal CRM loop note.', 'crm-loop']) {
    if (!String(text).includes(expected)) throw new Error(`Saved record is missing: ${expected}`);
  }
  await click('crm-household-back');
  await waitFor('crm-directory-surface');
  // Use the visible People toggle rather than assuming a generated DOM id.
  await evaluate(`Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'People')?.click()`);
  await fill('crm-directory-search', 'Avery CRM Loop');
  const directoryText = await evaluate('document.body.innerText');
  if (!String(directoryText).includes('Avery CRM Loop')) throw new Error('Directory search did not return the saved person');
}

try {
  if (!verifyOnly) await createAndEdit();
  await assertSaved();
  console.log(`PASS: ${verifyOnly ? 'saved Clients records survived the restart' : 'Clients create/edit flow completed; now restart the app and rerun with --verify-persisted'}`);
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
