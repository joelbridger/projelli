/**
 * 20-firm-lifecycle — real desktop Firm claim/sign-in/seat hydration path.
 *
 * This spec drives the REAL Tauri app. It intentionally uses the Account window
 * Firm tab and the real org-claim UI. It never targets production: the backend
 * must be a disposable local firm backend/relay.
 *
 * Runnable setup:
 *   1. Start ./scripts/run-firm-backend-local.sh in another shell.
 *   2. Run the desktop suite with that backend still alive. The Vite proxy
 *      defaults /api/firm to http://127.0.0.1:5290.
 *
 * The existing backend script seeds an already-claimed admin org. For this
 * one-time claim journey, this spec provisions a second unclaimed disposable org
 * by sending a signed synthetic LemonSqueezy subscription_created webhook to the
 * local backend, then claims that org through the app UI.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const RUN_ID = Date.now().toString(36);
const DEFAULT_LOCAL_BACKEND = 'http://127.0.0.1:5290';
const BACKEND_URL = (process.env['FIRM_E2E_BACKEND_URL'] ?? DEFAULT_LOCAL_BACKEND).replace(/\/+$/, '');
const WEBHOOK_SECRET = process.env['FIRM_E2E_WEBHOOK_SECRET'] ?? 'test-webhook-secret-e2e';

const WORKSPACE_NAME = `firm-lifecycle-${RUN_ID}`;
const CLAIM_LICENSE_KEY = `KEEP-DESKTOP-${RUN_ID}-FIRM`;
const CLAIM_EMAIL = `desktop-admin-${RUN_ID}@keepance-e2e.test`;
const CLAIM_PASSWORD = `desktop-admin-password-${RUN_ID}`;
const CLAIM_ORG_NAME = `Desktop Firm Lifecycle ${RUN_ID}`;
const MACHINE_LABEL = `Desktop harness ${RUN_ID}`;

function isLoopbackHttp(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function hmacHex(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function block(message) {
  throw new Error(`BLOCKED: ${message}`);
}

async function requireDisposableBackend() {
  if (!isLoopbackHttp(BACKEND_URL)) {
    block(
      `needs a disposable local Firm backend, not ${BACKEND_URL}. Do not run this destructive org-claim/seat test against production.`,
    );
  }

  let health;
  try {
    health = await fetch(`${BACKEND_URL}/healthz`, { signal: AbortSignal.timeout(2500) });
  } catch (err) {
    block(
      `needs local Firm backend at ${BACKEND_URL}. Start ./scripts/run-firm-backend-local.sh so /healthz, /webhooks/lemonsqueezy, /org/claim, /auth/login, /org/activate, /seat/validate, and /seat/heartbeat are reachable. Last error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!health.ok) {
    block(`needs healthy local Firm backend at ${BACKEND_URL}; /healthz returned HTTP ${health.status}.`);
  }

  const proxyTarget = process.env['FIRM_BACKEND_TARGET'] ?? process.env['VITE_FIRM_API_BASE'] ?? DEFAULT_LOCAL_BACKEND;
  if (BACKEND_URL !== DEFAULT_LOCAL_BACKEND && proxyTarget.replace(/\/+$/, '') !== BACKEND_URL) {
    block(
      `needs the app dev server pointed at ${BACKEND_URL}. Start Vite with FIRM_BACKEND_TARGET=${BACKEND_URL} or VITE_FIRM_API_BASE=${BACKEND_URL}; otherwise the UI /api/firm proxy will not hit the disposable backend.`,
    );
  }
}

async function provisionUnclaimedOrg() {
  await requireDisposableBackend();

  const payload = JSON.stringify({
    meta: {
      event_name: 'subscription_created',
      webhook_id: `desktop-firm-${RUN_ID}`,
      custom_data: { license_key: CLAIM_LICENSE_KEY },
    },
    data: {
      id: `sub-desktop-firm-${RUN_ID}`,
      attributes: {
        first_subscription_item: {
          variant_id: `desktop-${RUN_ID}`,
          variant_name: 'Lantern Firm Annual',
          quantity: 3,
        },
        customer_name: CLAIM_ORG_NAME,
        user_email: CLAIM_EMAIL,
      },
    },
  });

  const resp = await fetch(`${BACKEND_URL}/webhooks/lemonsqueezy`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature': hmacHex(payload, WEBHOOK_SECRET),
    },
    body: payload,
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    block(
      `needs a local backend configured with LEMONSQUEEZY_WEBHOOK_SECRET=${WEBHOOK_SECRET} and Firm webhook provisioning enabled. POST /webhooks/lemonsqueezy returned HTTP ${resp.status}: ${body.slice(0, 300)}`,
    );
  }
}

async function seedRecentWorkspaceAndForceOnboarding(session, workspace) {
  await session.execute(
    `
      localStorage.removeItem('lantern_onboarding_complete');
      localStorage.removeItem('lantern_profession');
      localStorage.setItem('keepance_feature_tour_dismissed', 'true');
      localStorage.setItem('keepance_feature_tour_completed', 'true');
      localStorage.setItem('lantern_recent_workspaces', JSON.stringify([{
        path: arguments[0],
        name: arguments[1],
        lastOpened: new Date().toISOString()
      }]));
      window.location.href = window.location.origin + window.location.pathname + '?forceOnboarding=true';
    `,
    [workspace, WORKSPACE_NAME],
  );
}

async function openSeededRecentWorkspace(session, _app) {
  await session.testid('workspace-selector-dialog', 30_000);
  await session.clickTestid('recent-workspaces-toggle', 15_000);
  // After onboarding the recent entry shows under the real workspace folder name,
  // not the seeded display name, so open the recent row by its testid.
  await session.clickTestid('recent-workspace-row', 20_000);
  await session.testid('spine-nav', 45_000);
  await session.testid('status-bar', 15_000);
  await session.maybeClickTestid('feature-tour-skip');
}

/**
 * Walk first-run OnboardingV2 to completion without resolving AI or
 * connectors (mirrors the old "decide later" / "connect later" paths). The
 * 4-step flow has no firm-claim step — claiming a firm now happens in the
 * Account window's Firm tab (see openAccountFirmTab / claimOrgThroughUi
 * below), reached only after onboarding finishes and a workspace is open.
 */
async function driveOnboardingThroughV2(session) {
  await session.testid('onboarding-v2', 45_000);
  await session.testid('onboarding-v2-intro', 15_000);
  await session.clickTestid('onboarding-v2-go', 15_000);

  await session.testid('onboarding-v2-ai', 15_000);
  await session.clickTestid('onboarding-v2-continue', 15_000);

  await session.testid('onboarding-v2-connect', 15_000);
  await session.clickTestid('onboarding-v2-continue', 15_000);

  // Last scene's Continue reads "Continue to the app" and completes
  // onboarding directly (no separate "Done" step).
  await session.testid('onboarding-v2-firm', 15_000);
  await session.clickTestid('onboarding-v2-continue', 15_000);
}

async function claimOrgThroughUi(session) {
  // Reached via the Account window's Firm tab now (see openAccountFirmTab),
  // starting from the default sign-in panel — switch to the claim panel first.
  await session.clickTestid('firm-just-bought', 15_000);
  await session.testid('firm-claim-form', 15_000);

  await session.typeTestid('firm-claim-license-key', CLAIM_LICENSE_KEY, 15_000);
  await session.typeTestid('firm-claim-email', CLAIM_EMAIL, 15_000);
  await session.typeTestid('firm-claim-password', CLAIM_PASSWORD, 15_000);
  await session.typeTestid('firm-claim-confirm-password', CLAIM_PASSWORD, 15_000);
  await session.typeTestid('firm-claim-org-name', CLAIM_ORG_NAME, 15_000);
  await session.clickTestid('firm-claim-submit', 15_000);

  // A successful claim switches FirmSignIn to its signed-in branch
  // (firm-email-display) and reveals the sibling FirmAdminConsole
  // (firm-admin-console) in the same Firm tab. The transient
  // firm-claim-success message is quickly replaced by it, so accept either.
  await session.waitFor(
    async (s) =>
      (await s.hasTestid('firm-admin-console', 500)) ||
      (await s.hasTestid('firm-claim-success', 500)) ||
      (await s.hasTestid('firm-claim-error', 500)),
    { timeoutMs: 30_000, label: 'firm claim admin console or error' },
  );
  if (await session.hasTestid('firm-claim-error', 500)) {
    const body = await session.bodyText();
    throw new Error(`firm org claim failed in UI. Visible body:\n${body}`);
  }
  await session.testid('firm-admin-console', 20_000);
}

async function activateSeatThroughUi(session) {
  const licenseInput = await session.testid('firm-license-key', 15_000);
  await session.clear(licenseInput);
  await session.type(licenseInput, CLAIM_LICENSE_KEY);
  await session.typeTestid('firm-machine-label', MACHINE_LABEL, 15_000);
  await session.clickTestid('firm-activate-submit', 15_000);

  await session.waitFor(
    async (s) => s.execute(`
      const el = document.querySelector('[data-testid="firm-seat-status"]');
      const state = el?.getAttribute('data-state');
      return state === 'subscription-active' || state === 'offline-grace';
    `),
    { timeoutMs: 30_000, label: 'active firm seat status' },
  );
  await session.testid('firm-seat-id', 15_000);
  await session.testid('firm-admin-console', 20_000);
  await session.testid('firm-seat-list', 20_000);
}

async function openAccountFirmTab(session) {
  await session.clickTestid('account-identity', 20_000);
  await session.testid('account-window', 15_000);
  await session.clickTestid('account-tab-firm', 15_000);
  await session.testid('firm-signin', 15_000);
}

async function assertFirmHydrated(session) {
  await session.testid('firm-email-display', 30_000);
  await session.waitForBodyText(CLAIM_EMAIL, { timeoutMs: 15_000 });
  await session.waitForBodyText(CLAIM_ORG_NAME, { timeoutMs: 15_000 });
  await session.waitFor(
    async (s) => s.execute(`
      const el = document.querySelector('[data-testid="firm-seat-status"]');
      const state = el?.getAttribute('data-state');
      return state === 'subscription-active' || state === 'offline-grace';
    `),
    { timeoutMs: 30_000, label: 'hydrated active firm seat status' },
  );
  await session.testid('firm-seat-id', 15_000);
  await session.testid('firm-admin-console', 20_000);
}

export default {
  name: '20-firm-lifecycle',
  async run({ session, workspace, app, log }) {
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'firm-lifecycle-probe.md'), '# Firm lifecycle desktop probe\n');

    await session.newSession();
    await session.testid('welcome-dialog-pitch', 45_000);
    const hasTauri = await session.execute('return Boolean(window.__TAURI__);');
    if (!hasTauri) throw new Error('window.__TAURI__ missing; not the desktop webview.');

    await seedRecentWorkspaceAndForceOnboarding(session, workspace);
    await driveOnboardingThroughV2(session);
    await openSeededRecentWorkspace(session, app);

    await provisionUnclaimedOrg();
    log(`Provisioned disposable local org ${CLAIM_ORG_NAME} with license ${CLAIM_LICENSE_KEY}.`);

    // Claiming a firm now happens in the Account window's Firm tab (onboarding
    // no longer has a firm-claim step) — open it, then claim.
    await openAccountFirmTab(session);
    await claimOrgThroughUi(session);

    // Seat activation + the full firm console live in the same Firm tab.
    await activateSeatThroughUi(session);
    await assertFirmHydrated(session);

    await session.close();

    // Reopen the same isolated desktop profile. This verifies persisted non-secret
    // session metadata + OS keychain/fallback secrets hydrate back into Firm UI.
    await session.newSession();
    await openSeededRecentWorkspace(session, app);
    await openAccountFirmTab(session);
    await assertFirmHydrated(session);
  },
};

/*
 * TWO-INSTANCE FIRM CO-EDITING / ETHICAL-WALL SCAFFOLD
 *
 * The current desktop runner starts one tauri-driver per spec, so a true
 * two-client desktop test needs a harness enhancement: allocate a second
 * tauri-driver port and expose a second app binary Session, for example:
 *
 *   const admin = session;
 *   const member = new Session({ app: process.env.TAURI_APP, driverPort: Number(process.env.TAURI_DRIVER_PORT_2), log });
 *   await admin.newSession();
 *   await member.newSession();
 *
 * Required local services:
 *   - disposable firm backend + relay at /api/firm with WebSocket proxy enabled
 *   - admin org/license + admin/member/walled users
 *   - isolated HOME/XDG roots per Session so OS keychain/device keys are separate
 *
 * Shared-matter notes co-editing path:
 *   1. Admin signs in and activates a seat.
 *   2. Member signs in and activates a seat in the second Session.
 *   3. Admin creates a firm matter, invites member, opens matter notes.
 *   4. Member opens Firm shared matters, opens the same notes.
 *   5. Type distinct text in both notes editors, restart both apps, assert both
 *      texts are visible in both `matter-notes-cm-editor` surfaces.
 *
 * Ethical-wall path:
 *   1. With the member notes open, admin sets an ethical wall for that member.
 *   2. Member refreshes/reopens the matter.
 *   3. Assert `matter-notes-no-access` or a visible fail-closed error.
 *   4. Assert member edits no longer converge. A deeper L3 check should also
 *      verify the stale matter key was purged from the member OS keychain.
 *
 * Live .docx co-editing remains blocked until production UI calls
 * `openCoeditSession` and passes `coedit` into `DocxEditor`; transport and
 * component support exist, but the inventory did not find a mounted UI path.
 */
