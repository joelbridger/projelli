/**
 * persona-firm.spec.ts — Task 6 of the Diane Marchetti study: the FIRM scenario.
 *
 * Two browser contexts (admin = Diane, member = her associate) over the shared
 * dev server + /api/firm proxy → seeded firm backend at 127.0.0.1:5290. Proves
 * the moderated protocol's firm path: admin signs in + activates a seat, shares
 * a matter, invites the member by email, opens shared notes and types; member
 * activates, opens the shared matter + notes, sees the admin's text, replies;
 * admin sees the reply. Screenshots/dumps drive the think-aloud.
 *
 * Run (1536 project):
 *   FIRM_E2E_BACKEND_URL=http://127.0.0.1:5290 \
 *   FIRM_E2E_LICENSE_KEY="$(cat /tmp/firm-e2e-license.txt)" \
 *   CAMPAIGN_KEEP_SHOTS=1 npx playwright test -c playwright.campaign.config.ts \
 *     tests/campaign/persona-firm.spec.ts --project=1536 -g "Task 6"
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { snap, collectConsoleErrors } from './helpers/campaign';

const RUN_ID = Date.now().toString(36);
const BACKEND_URL = process.env['FIRM_E2E_BACKEND_URL'];
const ADMIN_EMAIL = 'admin@keepance-e2e.test';
const ADMIN_PASSWORD = 'e2e-admin-password-123';
const MEMBER_EMAIL = 'member@keepance-e2e.test';
const MEMBER_PASSWORD = 'member-e2e-password-123';
const LICENSE_KEY = process.env['FIRM_E2E_LICENSE_KEY'] ?? '';

const MATTER_NAME = `Okafor v. Lakeshore ${RUN_ID}`;
const CLIENT_NAME = `Teresa Okafor ${RUN_ID}`;

let firmMatterId = '';
let localMatterIdA = '';

async function dump(page: Page, label: string, selector?: string): Promise<void> {
  const text = await page.evaluate((sel) => {
    const el = sel ? document.querySelector(sel) : document.body;
    return el ? (el as HTMLElement).innerText : `(selector not found: ${sel ?? 'body'})`;
  }, selector ?? null);
  console.log(`\n===PERSONA-DUMP[${label}]===\n${text}\n===END-DUMP[${label}]===`);
}

async function navigateToFirmSignIn(page: Page): Promise<void> {
  await page.goto('/?testMode=true');
  await page.waitForLoadState('networkidle');
  const settingsGear = page.getByTestId('settings-gear');
  await settingsGear.waitFor({ state: 'visible', timeout: 8000 });
  const firmSignin = page.getByTestId('firm-signin');
  if (!(await firmSignin.isVisible({ timeout: 500 }).catch(() => false))) {
    await settingsGear.click();
    const firmCategory = page.getByTestId('settings-category-firm');
    await firmCategory.waitFor({ state: 'visible', timeout: 5000 });
    await firmCategory.click();
  }
  await firmSignin.waitFor({ state: 'visible', timeout: 8000 });
}

async function signInFirm(page: Page, email: string, password: string): Promise<void> {
  await navigateToFirmSignIn(page);
  await page.getByTestId('firm-email').fill(email);
  await page.getByTestId('firm-password').fill(password);
  await page.getByTestId('firm-signin-submit').click();
  await page.getByTestId('firm-email-display').waitFor({ state: 'visible', timeout: 10000 });
}

async function activateSeat(page: Page, licenseKey: string): Promise<void> {
  const seatStatus = page.getByTestId('firm-seat-status');
  const statusDataState = await seatStatus.getAttribute('data-state', { timeout: 3000 }).catch(() => null);
  if (statusDataState === 'subscription-active' || statusDataState === 'offline-grace') return;
  const activateForm = page.getByTestId('firm-activate-form');
  if (!(await activateForm.isVisible({ timeout: 4000 }).catch(() => false))) return;
  await activateForm.getByTestId('firm-license-key').fill(licenseKey);
  await activateForm.getByTestId('firm-activate-submit').click();
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="firm-seat-status"]');
    const state = el?.getAttribute('data-state');
    return state === 'subscription-active' || state === 'offline-grace';
  }, undefined, { timeout: 20000 });
}

async function openAIChatForMatterManager(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const scopeSelector = page.getByTestId('matter-scope-selector');
  if (await scopeSelector.isVisible({ timeout: 1000 }).catch(() => false)) return;
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Control+Shift+a');
  await page.getByTestId('ai-assistant-tab').waitFor({ state: 'visible', timeout: 8000 });
  await scopeSelector.waitFor({ state: 'visible', timeout: 8000 });
}

async function openMatterManager(page: Page): Promise<void> {
  const scopeSelector = page.getByTestId('matter-scope-selector');
  await scopeSelector.waitFor({ state: 'visible', timeout: 6000 });
  await scopeSelector.click();
  const manageItem = page.getByTestId('matter-scope-manage');
  await manageItem.waitFor({ state: 'visible', timeout: 4000 });
  await manageItem.click();
  await page.getByTestId('matter-manager-dialog').waitFor({ state: 'visible', timeout: 6000 });
}

async function inviteMember(page: Page, fMatterId: string, memberEmail: string): Promise<string> {
  const settingsGear = page.getByTestId('settings-gear');
  await settingsGear.waitFor({ state: 'visible', timeout: 6000 });
  const firmAdminConsole = page.getByTestId('firm-admin-console');
  if (!(await firmAdminConsole.isVisible({ timeout: 500 }).catch(() => false))) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await settingsGear.click();
    const firmCategory = page.getByTestId('settings-category-firm');
    await firmCategory.waitFor({ state: 'visible', timeout: 5000 });
    await firmCategory.click();
    await firmAdminConsole.waitFor({ state: 'visible', timeout: 8000 });
  }
  await page.getByTestId('firm-matter-list').waitFor({ state: 'visible', timeout: 8000 });
  // The just-shared matter can take a beat to appear in listMatters; poll.
  let matterBtn = page.getByTestId(`firm-matter-${fMatterId}`);
  await page.waitForFunction((id) => {
    const specific = document.querySelector(`[data-testid="firm-matter-${id}"]`);
    const any = document.querySelector('[data-testid^="firm-matter-"]');
    return !!(specific || any);
  }, fMatterId, { timeout: 10000 }).catch(() => {});
  if (!(await matterBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
    matterBtn = page.locator('[data-testid^="firm-matter-"]').first();
    await matterBtn.waitFor({ state: 'visible', timeout: 5000 });
  }
  const mattersDump = await page.getByTestId('firm-matter-list').innerText().catch(() => '(none)');
  console.log(`PERSONA-NOTE: admin console matters = "${mattersDump.replace(/\n/g, ' / ')}"`);
  await matterBtn.click();
  await page.waitForTimeout(800);
  const emailField = page.getByTestId('firm-member-email');
  if (!(await emailField.isVisible({ timeout: 6000 }).catch(() => false))) {
    console.log('PERSONA-NOTE: firm-member-email not visible after matter click; console text follows');
    console.log((await page.getByTestId('firm-admin-console').innerText().catch(() => '(no console)')).slice(0, 600));
    throw new Error('firm-member-email did not appear');
  }
  await page.getByTestId('firm-member-email').fill(memberEmail);
  await page.getByTestId('firm-add-member').click();
  await Promise.race([
    page.getByTestId('firm-admin-notice').waitFor({ state: 'visible', timeout: 10000 }),
    page.getByTestId('firm-admin-error').waitFor({ state: 'visible', timeout: 10000 }),
  ]);
  const noticeVisible = await page.getByTestId('firm-admin-notice').isVisible().catch(() => false);
  const txt = noticeVisible
    ? await page.getByTestId('firm-admin-notice').innerText().catch(() => '')
    : await page.getByTestId('firm-admin-error').innerText().catch(() => '');
  return txt;
}

async function republishKeys(page: Page): Promise<void> {
  const btn = page.getByTestId('firm-republish-keys');
  if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(1500);
  }
}

async function openSharedNotesFirst(page: Page): Promise<void> {
  const notesBtn = page.locator('[data-testid^="matter-open-notes-"]').first();
  await notesBtn.waitFor({ state: 'visible', timeout: 20000 });
  await notesBtn.click();
  await page.getByTestId('matter-notes-editor').waitFor({ state: 'visible', timeout: 15000 });
}

async function typeIntoNotes(page: Page, text: string): Promise<void> {
  const editor = page.getByTestId('matter-notes-cm-editor');
  await editor.click();
  await editor.locator('.cm-content').click();
  await page.keyboard.type(text);
}

async function assertTextConverged(page: Page, sub: string): Promise<void> {
  const editor = page.getByTestId('matter-notes-cm-editor');
  await expect(editor.locator('.cm-content')).toContainText(sub, { timeout: 20000 });
}

test.describe('Task 6 — firm scenario (two contexts)', () => {
  test.skip(!BACKEND_URL, 'FIRM_E2E_BACKEND_URL not set.');
  test.describe.configure({ mode: 'serial' });

  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  test.beforeAll(async ({ browser, request }) => {
    // Free seats so activation always has a slot.
    if (BACKEND_URL) {
      try {
        const login = await request.post(`${BACKEND_URL}/auth/login`, {
          data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
        });
        const token = (await login.json() as { access_token?: string }).access_token;
        if (token) {
          const seatsRes = await request.post(`${BACKEND_URL}/org/seats`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const seats = (await seatsRes.json() as { seats?: Array<{ seat_id: string }> }).seats ?? [];
          for (const s of seats) {
            await request.post(`${BACKEND_URL}/org/seat/revoke`, {
              headers: { Authorization: `Bearer ${token}` },
              data: { seat_id: s.seat_id, reason: 'persona_cleanup' },
            });
          }
        }
      } catch { /* non-fatal */ }
    }
    ctxA = await browser.newContext({ baseURL: 'http://localhost:5173', viewport: { width: 1536, height: 864 } });
    ctxB = await browser.newContext({ baseURL: 'http://localhost:5173', viewport: { width: 1536, height: 864 } });
    pageA = await ctxA.newPage();
    pageB = await ctxB.newPage();
  });

  test.afterAll(async () => {
    await ctxA?.close();
    await ctxB?.close();
  });

  test('Task 6: firm convergence end-to-end', async ({}, testInfo) => {
    test.setTimeout(300_000);
    const errA = collectConsoleErrors(pageA);
    const errB = collectConsoleErrors(pageB);

    // ── Admin (Diane) signs in + activates seat ──
    await signInFirm(pageA, ADMIN_EMAIL, ADMIN_PASSWORD);
    await dump(pageA, 't6-admin-signed-in', '[data-testid="firm-signin"]');
    await snap(pageA, testInfo, 't6-01-admin-signed-in');
    await activateSeat(pageA, LICENSE_KEY);
    await dump(pageA, 't6-admin-seat', '[data-testid="firm-seat-status"]');
    await snap(pageA, testInfo, 't6-02-admin-seat-active');
    await expect(pageA.getByTestId('firm-seat-status')).toHaveAttribute(
      'data-state', /subscription-active|offline-grace/, { timeout: 10000 });

    // ── Admin shares a matter ──
    await openAIChatForMatterManager(pageA);
    await openMatterManager(pageA);
    await dump(pageA, 't6-matter-manager', '[data-testid="matter-manager-dialog"]');
    await snap(pageA, testInfo, 't6-03-matter-manager');
    await pageA.getByTestId('matter-new-name').fill(MATTER_NAME);
    await pageA.getByTestId('matter-new-client').fill(CLIENT_NAME);
    await pageA.getByTestId('matter-create-button').click();
    const shareBtn = pageA.locator('[data-testid^="firm-share-"]').last();
    await shareBtn.waitFor({ state: 'visible', timeout: 8000 });
    await snap(pageA, testInfo, 't6-04-before-share');
    await shareBtn.click();
    await pageA.getByTestId('matter-firm-shared-badge').waitFor({ state: 'visible', timeout: 15000 });
    await dump(pageA, 't6-shared', '[data-testid="matter-manager-dialog"]');
    await snap(pageA, testInfo, 't6-05-matter-shared');

    const openNotesBtn = pageA.locator('[data-testid^="matter-open-notes-"]').last();
    await openNotesBtn.waitFor({ state: 'visible', timeout: 6000 });
    localMatterIdA = (await openNotesBtn.getAttribute('data-testid') ?? '').replace('matter-open-notes-', '');
    firmMatterId = await pageA.evaluate((localId: string) => {
      try {
        const raw = localStorage.getItem('keepance:matters');
        const parsed = raw ? JSON.parse(raw) as { state?: { matters?: Array<{ id: string; firmMatterId?: string }> } } : null;
        return parsed?.state?.matters?.find((m) => m.id === localId)?.firmMatterId ?? '';
      } catch { return ''; }
    }, localMatterIdA);
    console.log(`PERSONA-NOTE: firmMatterId=${firmMatterId} localMatterIdA=${localMatterIdA}`);

    // ── Admin opens shared notes + types ──
    await openSharedNotesFirst(pageA);
    await dump(pageA, 't6-admin-notes', '[data-testid="matter-notes-editor"]');
    await snap(pageA, testInfo, 't6-06-admin-notes-open');
    const adminText = 'Diane (admin): Associate, please pull the April compliance emails and verify the Ohio whistleblower 90-day window before our call.';
    await typeIntoNotes(pageA, adminText);
    await pageA.waitForTimeout(1500);
    await snap(pageA, testInfo, 't6-07-admin-typed');

    // ── Admin invites the member by email ──
    const inviteResult = await inviteMember(pageA, firmMatterId, MEMBER_EMAIL);
    console.log(`PERSONA-NOTE: invite result = "${inviteResult.replace(/\n/g, ' | ')}"`);
    await dump(pageA, 't6-admin-console', '[data-testid="firm-admin-console"]');
    await snap(pageA, testInfo, 't6-08-member-invited');

    // ── Member (associate) signs in + activates seat ──
    await signInFirm(pageB, MEMBER_EMAIL, MEMBER_PASSWORD);
    await dump(pageB, 't6-member-signed-in', '[data-testid="firm-signin"]');
    await snap(pageB, testInfo, 't6-09-member-signed-in');
    await activateSeat(pageB, LICENSE_KEY);
    await expect(pageB.getByTestId('firm-seat-status')).toHaveAttribute(
      'data-state', /subscription-active|offline-grace/, { timeout: 10000 });
    await snap(pageB, testInfo, 't6-10-member-seat-active');

    // ── Member opens the shared matter (with admin key-publish dance) ──
    await openAIChatForMatterManager(pageB);
    await openMatterManager(pageB);
    await dump(pageB, 't6-member-matter-manager', '[data-testid="matter-manager-dialog"]');
    await snap(pageB, testInfo, 't6-11-member-remote-matters');

    const openRemote = pageB.getByTestId(`firm-open-remote-${firmMatterId}`);
    if (await openRemote.isVisible({ timeout: 8000 }).catch(() => false)) {
      await openRemote.click();
      const outcome = await Promise.race([
        pageB.getByTestId('firm-mine-empty').waitFor({ state: 'visible', timeout: 20000 }).then(() => 'success'),
        pageB.getByTestId('firm-open-error').waitFor({ state: 'visible', timeout: 20000 }).then(() => 'error'),
      ]).catch(() => 'timeout');
      console.log(`PERSONA-NOTE: member first open => ${outcome}`);
      if (outcome === 'error') {
        // Admin republishes keys so the member's device gets the wrapped matter key.
        await republishKeys(pageA);
        await pageB.waitForTimeout(1500);
        const retry = pageB.getByTestId(`firm-open-remote-${firmMatterId}`);
        if (await retry.isVisible({ timeout: 8000 }).catch(() => false)) {
          await retry.click();
          await pageB.getByTestId('firm-mine-empty').waitFor({ state: 'visible', timeout: 20000 }).catch(() => null);
        }
      }
      await pageB.keyboard.press('Escape');
      await pageB.waitForTimeout(300);
      await openAIChatForMatterManager(pageB);
      await openMatterManager(pageB);
    } else {
      console.log('PERSONA-NOTE: firm-open-remote not visible (already linked?)');
    }
    await snap(pageB, testInfo, 't6-12-member-after-open');

    // ── Member opens notes, sees admin text ──
    await openSharedNotesFirst(pageB);
    await assertTextConverged(pageB, 'pull the April compliance emails');
    await dump(pageB, 't6-member-sees-admin', '[data-testid="matter-notes-editor"]');
    await snap(pageB, testInfo, 't6-13-member-sees-admin-text');

    // ── Member replies ──
    const memberReply = ' || Associate: Confirmed — 90-day clock runs from the May 27 termination, so the window closes Aug 25. Compliance emails are in the April folder; flagged two from Dana Whitfield.';
    await typeIntoNotes(pageB, memberReply);
    await assertTextConverged(pageB, '90-day clock runs from the May 27 termination');
    await snap(pageB, testInfo, 't6-14-member-replied');

    // ── Admin sees the reply ──
    await assertTextConverged(pageA, '90-day clock runs from the May 27 termination');
    await dump(pageA, 't6-admin-sees-reply', '[data-testid="matter-notes-editor"]');
    await snap(pageA, testInfo, 't6-15-admin-sees-reply');

    console.log(`\n===PERSONA-CONSOLE[t6-admin]=== count=${errA().length}`);
    for (const e of errA()) console.log(e.slice(0, 300));
    console.log(`===PERSONA-CONSOLE[t6-member]=== count=${errB().length}`);
    for (const e of errB()) console.log(e.slice(0, 300));
    expect(true).toBe(true);
  });
});
