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
const fixtureName = 'offline-mode-gate-local-data.txt';
const fixtureText = 'Lantern Offline Mode gate: this local file must remain readable.\n';
const cachedLicensePayload = {
  tier: 'professional',
  exp: Math.floor(Date.now() / 1000) + 60 * 60,
  status: 'active',
  type: 'subscription',
};

function syntheticJwt(payload) {
  const segment = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `offline-gate.${segment}.fixture`;
}

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

async function seedCachedEntitlement(page) {
  const token = syntheticJwt(cachedLicensePayload);
  return page.evaluate(({ token }) => {
    localStorage.setItem('lantern_license_token', token);
    localStorage.setItem('lantern_license_last_good_at', new Date().toISOString());
    return {
      tokenStored: localStorage.getItem('lantern_license_token') === token,
      lastGoodAt: localStorage.getItem('lantern_license_last_good_at'),
    };
  }, { token });
}

async function readSeededLocalFileThroughApp(page) {
  return page.evaluate(async ({ workspace, fixtureName, fixtureText }) => {
    // This is Lantern's actual Tauri filesystem plugin used by TauriFSBackend,
    // rather than Node reading the workspace from outside the application.
    const tauriFs = await import('/src/platform/fs/tauriFsPlugin.ts');
    const entries = await tauriFs.getTauriFsModule().then((fs) => fs.readDir(workspace));
    const content = await tauriFs.readTauriTextFile(`${workspace}\\${fixtureName}`);
    return {
      listed: entries.some((entry) => entry.name === fixtureName && entry.isFile),
      readable: content === fixtureText,
      content,
    };
  }, { workspace, fixtureName, fixtureText });
}

async function verifyCachedEntitlementInUi(page) {
  try {
    // License has moved out of Settings into the account panel.
    await page.getByTestId('account-identity').click({ timeout: 8_000 });
    await page.getByTestId('account-tab-account').click({ timeout: 8_000 });
    const tier = await page.getByTestId('license-tier-name').textContent({ timeout: 8_000 });
    const offlineStatus = await page.getByTestId('license-offline-mode-status').textContent({ timeout: 8_000 });
    const degradedNoticeVisible = await page.getByTestId('license-degraded-notice').isVisible().catch(() => false);
    return {
      activated: Boolean(tier?.trim()),
      tier: tier?.trim() ?? null,
      offlineStatus: offlineStatus?.trim() ?? null,
      degradedNoticeVisible,
    };
  } catch (error) {
    return { activated: false, error: String(error) };
  }
}

async function run() {
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, fixtureName), fixtureText, 'utf8');
  const startedAt = new Date().toISOString();
  const { browser, page } = await pageForBench();
  try {
    // Seed a structurally valid, cached subscription fixture before exercising
    // Offline Mode. The production hook uses these same two persisted keys and
    // deliberately trusts last-known-good while its native policy is offline.
    const cachedEntitlementSeed = await seedCachedEntitlement(page);
    // Reload so the production React hook initializes from the just-seeded
    // disposable profile (rather than merely proving the keys can be written).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__TAURI__?.core?.invoke), null, { timeout: 15_000 });
    // This binds the real encrypted audit database to our isolated disposable
    // workspace before any native guard is called.
    const auditSetup = await invoke(page, 'audit_set_workspace', { path: workspace });
    const initialStatus = await invoke(page, 'network_policy_status');
    // Do not rewrite the policy file when the fresh app already has the desired
    // startup state. This avoids a needless Windows file-lock race and still
    // makes the control run explicitly turn Offline Mode off.
    const desiredOffline = mode === 'offline';
    const modeSet = initialStatus.ok && initialStatus.value?.offlineMode === desiredOffline
      ? { ok: true, value: 'already-set' }
      : await invoke(page, 'set_offline_mode', { enabled: desiredOffline });
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
    if (mode === 'offline') {
      actions.ragDownload = expectedOffline(await invoke(page, 'model_ensure'), 'RAG model download');
      actions.localModelDownload = expectedOffline(await invoke(page, 'local_llm_model_ensure'), 'local LLM model download');
      actions.meetingJoin = expectedOffline(await invoke(page, 'notice_card_open', {
        label: 'offline-gate-meeting', joinUrl: 'https://teams.microsoft.com/l/meetup-join/offline-gate', initScript: '',
      }), 'meeting auto-join');
      actions.mcpAccess = expectedOffline(await invoke(page, 'mcp_approve_write', { token: 'abcdef', approved: false }), 'MCP access');
    }

    // A real local-model attempt when the disposable bench already has one.
    // The status path is entirely local; start/health/stop only run when a
    // verified model is already present, so this gate never downloads one.
    if (mode === 'offline') {
      actions.localModelStatus = await invoke(page, 'local_llm_model_status');
      if (actions.localModelStatus.ok && actions.localModelStatus.value === 'ready') {
        actions.localModelStart = await invoke(page, 'local_llm_sidecar_start');
        actions.localModelHealth = await invoke(page, 'local_llm_sidecar_health');
        actions.localModelStop = await invoke(page, 'local_llm_sidecar_stop');
      }
    }

    // Validate the disposable local-data fixture through the app's own Tauri
    // filesystem bridge after all offline actions, not through Node/PowerShell.
    const localData = await readSeededLocalFileThroughApp(page);
    const cachedEntitlementUi = await verifyCachedEntitlementInUi(page);

    // A visible proof that the real settings UI reflected the native state.
    await page.screenshot({ path: path.join(outDir, `${mode}-app.jpeg`), type: 'jpeg', quality: 80 });
    const receipts = await invoke(page, 'audit_list', { limit: null, offset: null });
    const integrity = await invoke(page, 'audit_verify_integrity');
    const result = { startedAt, finishedAt: new Date().toISOString(), mode, workspace, fixture: { name: fixtureName, expectedText: fixtureText }, cachedEntitlementSeed, auditSetup, initialStatus, modeSet, status, actions, localData, cachedEntitlementUi, receipts, integrity };
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
