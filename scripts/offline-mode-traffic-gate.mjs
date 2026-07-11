#!/usr/bin/env node
// Offline Mode release-gate driver. Runs on the Windows bench against the
// real WebView2 through CDP; it deliberately uses production Tauri commands
// where a credentialed UI flow cannot be completed on a disposable bench.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const outDir = process.env.OFFLINE_GATE_OUT || 'C:/offline-mode-gate/evidence';
const workspace = process.env.OFFLINE_GATE_WORKSPACE || 'C:/offline-mode-gate/workspace';
const mode = process.env.OFFLINE_GATE_MODE || 'offline';
const port = process.env.DESKTOP_CDP_PORT || '9223';
const vitePort = process.env.OFFLINE_GATE_VITE_PORT || '5173';

async function pageForBench() {
  const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = info.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//, `ws://127.0.0.1:${port}/`);
  const browser = await chromium.connectOverCDP(ws);
  const page = browser.contexts().flatMap((context) => context.pages())
    .find((candidate) => new RegExp(`(?:127\\.0\\.0\\.1|localhost|\\[::1\\]):${vitePort}`).test(candidate.url()));
  if (!page) throw new Error('Lantern WebView2 page was not found on the CDP port.');
  return { browser, page };
}

async function invoke(page, command, args = {}) {
  return page.evaluate(async ({ command, args }) => {
    const tauri = window.__TAURI__?.core;
    if (!tauri?.invoke) throw new Error('Tauri invoke bridge is unavailable.');
    try {
      return { ok: true, value: await tauri.invoke(command, args) };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }, { command, args });
}

function expectedOffline(result, label) {
  const message = result.ok ? '' : String(result.error || '');
  return {
    ...result,
    expectedBlocked: mode === 'offline'
      ? message.includes('Offline Mode is on. Lantern cannot connect to the internet.') && message.includes(label)
      : undefined,
  };
}

async function run() {
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  const startedAt = new Date().toISOString();
  const { browser, page } = await pageForBench();
  try {
    // This binds the real encrypted audit database to our isolated disposable
    // workspace before any native guard is called.
    const auditSetup = await invoke(page, 'audit_set_workspace', { path: workspace });
    // Make the requested mode explicit in the already-running native process.
    // This removes restart timing and policy-file escaping from the gate itself.
    const modeSet = await invoke(page, 'set_offline_mode', { enabled: mode === 'offline' });
    const status = await invoke(page, 'network_policy_status');
    const actions = {};

    // All of these are the same production command surfaces their UI controls
    // use. They are invoked directly because the bench intentionally has no
    // live OAuth/CRM identities to complete the interactive dialogs.
    actions.mailLogin = expectedOffline(await invoke(page, 'mail_begin_login'), 'Outlook mail sign-in');
    if (mode === 'offline') actions.calendarLogin = expectedOffline(await invoke(page, 'calendar_connect_outlook'), 'Outlook Calendar sign-in');
    actions.crm = expectedOffline(await invoke(page, 'crm_connect', {
      provider: 'wealthbox', token: 'offline-gate-disposable-token', username: null, password: null,
    }), 'Wealthbox sync');
    actions.ragDownload = expectedOffline(await invoke(page, 'model_ensure'), 'RAG model download');
    if (mode === 'offline') actions.localModelDownload = expectedOffline(await invoke(page, 'local_llm_model_ensure'), 'local LLM model download');
    if (mode === 'offline') actions.meetingJoin = expectedOffline(await invoke(page, 'notice_card_open', {
      label: 'offline-gate-meeting', joinUrl: 'https://teams.microsoft.com/l/meetup-join/offline-gate', initScript: '',
    }), 'meeting auto-join');
    actions.mcpAccess = expectedOffline(await invoke(page, 'mcp_approve_write', { token: 'abcdef', approved: false }), 'MCP access');

    // A visible proof that the real settings UI reflected the native state.
    await page.screenshot({ path: path.join(outDir, `${mode}-app.jpeg`), type: 'jpeg', quality: 80 });
    const receipts = await invoke(page, 'audit_list', { limit: null, offset: null });
    const integrity = await invoke(page, 'audit_verify_integrity');
    const result = { startedAt, finishedAt: new Date().toISOString(), mode, workspace, auditSetup, modeSet, status, actions, receipts, integrity };
    await fs.writeFile(path.join(outDir, `${mode}-driver-result.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close().catch(() => {});
  }
}

run().catch(async (error) => {
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, `${mode}-driver-failure.txt`), `${error.stack || error}\n`);
  console.error(error);
  process.exitCode = 1;
});
