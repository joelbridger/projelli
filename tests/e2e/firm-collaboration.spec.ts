/**
 * firm-collaboration.spec.ts — Task 4 e2e: two-client convergence.
 *
 * IMPORTANT: This spec SKIPS cleanly when FIRM_E2E_BACKEND_URL is not set.
 * Run the local backend first (see scripts/run-firm-backend-local.sh) then
 * set FIRM_E2E_BACKEND_URL=http://127.0.0.1:5290 to execute the full suite.
 *
 * What this spec proves:
 *   1. Admin signs in, activates a seat, shares a matter, opens notes, types.
 *   2. Member (context B) signs in, activates a seat, opens the shared matter,
 *      opens notes, asserts admin's text appears (converged), types a reply.
 *   3. Admin asserts the member's reply appears (converged).
 *   4. A walled user cannot access the shared matter notes (fail-closed message).
 *
 * Architecture note:
 *   - Two Playwright browser CONTEXTS share the Vite dev server (port 5173).
 *   - The Vite proxy `/api/firm` forwards to FIRM_E2E_BACKEND_URL so both
 *     contexts hit the same seeded backend.
 *   - Each context has its own localStorage → separate device keys, separate
 *     matter key caches. That is exactly what we want: the key distribution
 *     path (admin publishes, member fetches) is exercised end-to-end.
 *   - firmKeychain falls back to localStorage in-browser; two contexts have
 *     separate storage, so each holds its own device key + matter key. No
 *     friction: the ECDH wrap/unwrap path handles the distribution.
 *
 * Navigation path (real):
 *   Sidebar "AI Assistant" tab → open/create a chat → AIChatViewer mounts →
 *   matter-scope-selector button in chat header → dropdown → matter-scope-manage
 *   → MatterManagerDialog opens.
 *
 * Admin console navigation:
 *   Settings gear → settings-category-firm → FirmAdminConsole appears below
 *   FirmSignIn (only for admins). Used for member invite + ethical wall.
 *
 * Selector strategy:
 *   - All selectors use data-testid (page.getByTestId()) where possible.
 *   - For FirmSignIn fields that already have testids (firm-email, firm-password,
 *     firm-signin-submit, firm-license-key, firm-activate-submit) we use those
 *     directly. See src/features/firm/FirmSignIn.tsx.
 *   - This spec runs in the `en` project only (locale-stable selectors).
 *
 * Timing:
 *   - Content convergence is polled for up to 15 seconds (assertTextConverged).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';

import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// ── Run ID — unique suffix so repeated backend runs don't collide ────────────
// Computed once at module load; safe in spec files (Playwright worker constant).
const RUN_ID = Date.now().toString(36);

// ── Environment guard ────────────────────────────────────────────────────────

const BACKEND_URL = process.env['FIRM_E2E_BACKEND_URL'];
const ADMIN_EMAIL = process.env['FIRM_E2E_ADMIN_EMAIL'] ?? 'admin@keepance-e2e.test';
const ADMIN_PASSWORD = process.env['FIRM_E2E_ADMIN_PASSWORD'] ?? 'e2e-admin-password-123';
const MEMBER_EMAIL = process.env['FIRM_E2E_MEMBER_EMAIL'] ?? 'member@keepance-e2e.test';
const MEMBER_PASSWORD = process.env['FIRM_E2E_MEMBER_PASSWORD'] ?? 'member-e2e-password-123';
const WALLED_EMAIL = process.env['FIRM_E2E_WALLED_EMAIL'] ?? 'walled@keepance-e2e.test';
const WALLED_PASSWORD = process.env['FIRM_E2E_WALLED_PASSWORD'] ?? 'walled-e2e-password-123';

function readLocalFirmBackendLicenseKey(): string {
  if (process.env['FIRM_E2E_LICENSE_KEY']) return process.env['FIRM_E2E_LICENSE_KEY'];

  try {
    const logs = readdirSync('/tmp')
      .filter((name) => /^keepance-e2e-backend-.*\.log$/.test(name))
      .map((name) => ({ path: `/tmp/${name}`, mtimeMs: statSync(`/tmp/${name}`).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const log of logs) {
      const match = readFileSync(log.path, 'utf8').match(/LICENSE KEY \(shown once\):\s*(\S+)/);
      if (match?.[1]) return match[1].trim();
    }
  } catch {
    // Fall through to the compatibility file written by older local-backend runs.
  }

  try {
    return readFileSync('/tmp/firm-e2e-license.txt', 'utf8').trim();
  } catch {
    return '';
  }
}

const LICENSE_KEY = readLocalFirmBackendLicenseKey();

// Unique per run so DB accumulation doesn't collide across repeated executions.
const MATTER_CLIENT_NAME = `E2E Convergence Client ${RUN_ID}`;
const MATTER_NAME = `Convergence Matter ${RUN_ID}`;

// Shared state across tests (serial suite).
let sharedFirmMatterId = '';   // set after admin shares the matter
let sharedLocalMatterIdA = ''; // admin's local matter ID (from matterStore)

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Open the 3.0 Account window on its Firm tab. */
async function openFirmAccountWindow(page: Page): Promise<void> {
  const firmSignin = page.getByTestId('firm-signin');
  if (await firmSignin.isVisible({ timeout: 500 }).catch(() => false)) {
    return;
  }

  const accountWindow = page.getByTestId('account-window');
  if (!(await accountWindow.isVisible({ timeout: 500 }).catch(() => false))) {
    // Close any other modal first, such as Matter Manager.
    await page.keyboard.press('Escape');
    await page.getByTestId('account-identity').waitFor({ state: 'visible', timeout: 8000 });
    await page.getByTestId('account-identity').click();
    await accountWindow.waitFor({ state: 'visible', timeout: 8000 });
  }

  const firmTab = page.getByTestId('account-tab-firm');
  await firmTab.waitFor({ state: 'visible', timeout: 5000 });
  if (!(await firmSignin.isVisible({ timeout: 500 }).catch(() => false))) {
    await firmTab.click();
  }
  await firmSignin.waitFor({ state: 'visible', timeout: 8000 });
}

/** Navigate to the firm sign-in surface. */
async function navigateToFirmSignIn(page: Page): Promise<void> {
  // Open the app in test mode — bypasses FirstRunWizard and WorkspaceSelector
  // (IS_TEST_MODE in App.tsx checks `window.location.search.includes('testMode=true')`).
  await page.goto('/?testMode=true');
  await page.waitForLoadState('networkidle');
  await openFirmAccountWindow(page);
}

/** Sign in to the firm backend. */
async function signInFirm(page: Page, email: string, password: string): Promise<void> {
  await navigateToFirmSignIn(page);
  await page.getByTestId('firm-email').fill(email);
  await page.getByTestId('firm-password').fill(password);
  await page.getByTestId('firm-signin-submit').click();
  // Wait for the signed-in state (email display appears).
  await page.getByTestId('firm-email-display').waitFor({ state: 'visible', timeout: 10000 });
}

/** Activate a firm seat with the given license key. */
async function activateSeat(page: Page, licenseKey: string): Promise<void> {
  // Check if the seat is already active — if so, skip activation.
  const seatStatus = page.getByTestId('firm-seat-status');
  const statusDataState = await seatStatus.getAttribute('data-state', { timeout: 3000 }).catch(() => null);
  if (statusDataState === 'subscription-active' || statusDataState === 'offline-grace') {
    return; // Already activated.
  }

  const activateForm = page.getByTestId('firm-activate-form');
  if (!(await activateForm.isVisible({ timeout: 4000 }).catch(() => false))) {
    // Form not visible — seat may already be active in a different state or
    // the page hasn't loaded the firm section yet. Return and let the caller
    // assert the seat status.
    return;
  }
  // Fill the license key into the visible input inside the activate form.
  const licenseInput = activateForm.getByTestId('firm-license-key');
  await licenseInput.fill(licenseKey);
  await activateForm.getByTestId('firm-activate-submit').click();

  // Wait until seat becomes active (subscription-active or offline-grace state).
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="firm-seat-status"]');
      if (!el) return false;
      const state = el.getAttribute('data-state');
      return state === 'subscription-active' || state === 'offline-grace';
    },
    undefined,
    { timeout: 20000 },
  );
}

/**
 * Close the settings modal if open, then ensure an AIChatViewer is mounted in
 * the main panel so MatterManagerDialog can be reached via matter-scope-selector.
 *
 * Real path:
 *   Ctrl+Shift+a → opens ai-assistant type tab in main panel →
 *   AIChatViewer mounts → matter-scope-selector visible in chat header.
 *
 * The keyboard shortcut always works regardless of whether API keys are
 * configured, making it the most reliable path for test mode.
 *
 * Returns once the matter-scope-selector is visible in the chat header.
 */
async function openAIChatForMatterManager(page: Page): Promise<void> {
  // Close settings modal if it is still open (press Escape).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Check if the matter-scope-selector is already visible (a chat is already
  // open in the main panel from a prior step).
  const scopeSelector = page.getByTestId('matter-scope-selector');
  if (await scopeSelector.isVisible({ timeout: 1000 }).catch(() => false)) {
    return;
  }

  // Blur any focused element so the keyboard shortcut fires on the document.
  // (Same pattern used by ai-assistant-tab.spec.ts.)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

  // Use Ctrl+Shift+a (lowercase 'a' — that is what e.key returns even with
  // Shift held in most browsers / jsdom; App.tsx checks e.key === 'a').
  await page.keyboard.press('Control+Shift+a');

  // Wait for the ai-assistant-tab to mount (the main panel wrapper).
  await page.getByTestId('ai-assistant-tab').waitFor({ state: 'visible', timeout: 8000 });

  // Wait for the matter-scope-selector to appear in the AIChatViewer header.
  await scopeSelector.waitFor({ state: 'visible', timeout: 8000 });
}

/**
 * Open the MatterManagerDialog via the real path:
 *   AI chat header matter-scope-selector → dropdown → matter-scope-manage.
 *
 * Prerequisite: call openAIChatForMatterManager first.
 */
async function openMatterManager(page: Page): Promise<void> {
  const scopeSelector = page.getByTestId('matter-scope-selector');
  await scopeSelector.waitFor({ state: 'visible', timeout: 6000 });
  await scopeSelector.click();

  // Click the "Manage matters" item in the dropdown.
  const manageItem = page.getByTestId('matter-scope-manage');
  await manageItem.waitFor({ state: 'visible', timeout: 4000 });
  await manageItem.click();

  // Wait for the dialog to open.
  await page.getByTestId('matter-manager-dialog').waitFor({ state: 'visible', timeout: 6000 });
}

/**
 * Navigate to the Matter Manager dialog, create a new matter, share it with the
 * firm, and capture the local matter ID + firm matter ID.
 */
async function shareNewMatter(
  page: Page,
  matterName: string,
  clientName: string,
): Promise<void> {
  await openAIChatForMatterManager(page);
  await openMatterManager(page);

  // Fill in matter name and client name.
  await page.getByTestId('matter-new-name').fill(matterName);
  await page.getByTestId('matter-new-client').fill(clientName);
  await page.getByTestId('matter-create-button').click();

  // Wait for the new matter row to appear — it should show a firm-section once
  // the firm session is active. The firm-share-* button will be present for the
  // most recently created matter (last item in matter-list).
  // Use a locator that finds the share button anywhere in the dialog.
  const shareBtn = page.locator('[data-testid^="firm-share-"]').last();
  await shareBtn.waitFor({ state: 'visible', timeout: 8000 });
  await shareBtn.click();

  // Wait for the shared badge to appear (matter is now shared).
  await page.getByTestId('matter-firm-shared-badge').waitFor({ state: 'visible', timeout: 15000 });

  // Capture the local matter ID from the open-notes button that just appeared.
  // The testid pattern is matter-open-notes-<localId>.
  const openNotesBtn = page.locator('[data-testid^="matter-open-notes-"]').last();
  await openNotesBtn.waitFor({ state: 'visible', timeout: 6000 });
  const testId = await openNotesBtn.getAttribute('data-testid') ?? '';
  sharedLocalMatterIdA = testId.replace('matter-open-notes-', '');

  // Capture the firm matter ID from the Zustand store via localStorage.
  // The matterStore persists to localStorage under the key "lantern:matters".
  sharedFirmMatterId = await page.evaluate((localId: string) => {
    try {
      const raw = localStorage.getItem('lantern:matters');
      if (raw) {
        const parsed = JSON.parse(raw) as {
          state?: { matters?: Array<{ id: string; firmMatterId?: string }> };
        };
        const matter = parsed.state?.matters?.find((m) => m.id === localId);
        return matter?.firmMatterId ?? '';
      }
    } catch { /* ignore */ }
    return '';
  }, sharedLocalMatterIdA);
}

/**
 * After shareNewMatter, invite the member to the shared matter via the
 * FirmAdminConsole (Settings → Firm tab). The admin console loads all org users
 * into the email→userId cache, allowing invite-by-email for existing accounts.
 *
 * This must be called while the admin (pageA) is active and signed in.
 */
async function inviteMemberViaAdminConsole(
  page: Page,
  firmMatterId: string,
  memberEmail: string,
): Promise<void> {
  // Open the Account window on the Firm tab.
  const firmAdminConsole = page.getByTestId('firm-admin-console');
  if (!(await firmAdminConsole.isVisible({ timeout: 500 }).catch(() => false))) {
    await openFirmAccountWindow(page);
    await firmAdminConsole.waitFor({ state: 'visible', timeout: 8000 });
  }

  // Wait for the matter list to load (confirms listOrgUsers has run, seeding the cache).
  await page.getByTestId('firm-matter-list').waitFor({ state: 'visible', timeout: 8000 });

  // Select the shared matter by its firm matter ID.
  let matterBtn = page.getByTestId(`firm-matter-${firmMatterId}`);
  const matterBtnVisible = await matterBtn.isVisible({ timeout: 3000 }).catch(() => false);
  if (!matterBtnVisible) {
    // Fall back: click the first matter in the list.
    matterBtn = page.locator('[data-testid^="firm-matter-"]').first();
    await matterBtn.waitFor({ state: 'visible', timeout: 5000 });
  }
  await matterBtn.click();

  // Wait for the member management section to appear.
  await page.getByTestId('firm-member-email').waitFor({ state: 'visible', timeout: 6000 });

  // Invite the member by email.
  await page.getByTestId('firm-member-email').fill(memberEmail);
  await page.getByTestId('firm-add-member').click();

  // Wait for success notice (invite-ok) or error response.
  // A 409 from createUser means the user already exists — the admin console
  // looks them up from the org cache, so handleInvite succeeds or shows an error.
  await Promise.race([
    page.getByTestId('firm-admin-notice').waitFor({ state: 'visible', timeout: 10000 }),
    page.getByTestId('firm-admin-error').waitFor({ state: 'visible', timeout: 10000 }),
  ]);
}

/** Open the notes for the active shared matter using the "Open notes" button in the dialog. */
async function openSharedNotesByLocalId(page: Page, localMatterId: string): Promise<void> {
  const notesBtn = page.getByTestId(`matter-open-notes-${localMatterId}`);
  await notesBtn.waitFor({ state: 'visible', timeout: 6000 });
  await notesBtn.click();
  // The dialog closes and the notes tab opens in the main panel.
  await page.getByTestId('matter-notes-editor').waitFor({ state: 'visible', timeout: 15000 });
}

/** Open the notes for the first shared matter found in the dialog (generic helper). */
async function openSharedNotesFirst(page: Page): Promise<void> {
  const notesBtn = page.locator('[data-testid^="matter-open-notes-"]').first();
  await notesBtn.waitFor({ state: 'visible', timeout: 20000 });
  await notesBtn.click();
  // The dialog closes and the notes tab opens in the main panel.
  await page.getByTestId('matter-notes-editor').waitFor({ state: 'visible', timeout: 15000 });
}

/** Type text into the MatterNotesEditor CodeMirror editor. */
async function typeIntoNotes(page: Page, text: string): Promise<void> {
  const editor = page.getByTestId('matter-notes-cm-editor');
  await editor.click();
  // CodeMirror focuses on the .cm-content div; type into it.
  await editor.locator('.cm-content').click();
  await page.keyboard.type(text);
}

/**
 * Poll until the notes editor's text matches the expected content.
 * Checks the Yjs-bound CodeMirror content via the .cm-content innerText.
 * Polls for up to 15 seconds (content-based convergence, not event-count).
 */
async function assertTextConverged(page: Page, expectedSubstring: string): Promise<void> {
  const editor = page.getByTestId('matter-notes-cm-editor');
  await expect(editor.locator('.cm-content')).toContainText(expectedSubstring, { timeout: 15000 });
}

// ── The convergence spec ──────────────────────────────────────────────────────

test.describe('Firm shared matter notes — two-client convergence', () => {
  // Skip the entire suite when the backend env var is absent.
  test.skip(
    !BACKEND_URL || !LICENSE_KEY,
    'Firm backend or license key missing. Run scripts/run-firm-backend-local.sh first, then set FIRM_E2E_BACKEND_URL and FIRM_E2E_LICENSE_KEY; the spec also reads /tmp/firm-e2e-license.txt.',
  );

  // Only run in the `en` locale project to avoid i18n flakes on selector text.
  // (Playwright projects are configured in playwright.config.ts; the test runner
  // passes `--project=en` when the env var is set.)
  test.describe.configure({ mode: 'serial' }); // serial so contextA/B share state safely.

  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let contextWalled: BrowserContext;
  let pageA: Page;
  let pageB: Page;
  let pageWalled: Page;

  test.beforeAll(async ({ browser, request }) => {
    // ── Seat cleanup ─────────────────────────────────────────────────────────
    // Each activation consumes a seat. With a 5-seat key and repeated test runs,
    // seats accumulate. Before each run, revoke all existing seats via the admin
    // API so activation always has a free slot.
    if (BACKEND_URL) {
      try {
        const loginRes = await request.post(`${BACKEND_URL}/auth/login`, {
          data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
        });
        const loginJson = await loginRes.json() as { access_token?: string };
        const token = loginJson.access_token;
        if (token) {
          const seatsRes = await request.post(`${BACKEND_URL}/org/seats`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const seatsJson = await seatsRes.json() as { seats?: Array<{ seat_id: string }> };
          for (const seat of seatsJson.seats ?? []) {
            await request.post(`${BACKEND_URL}/org/seat/revoke`, {
              headers: { Authorization: `Bearer ${token}` },
              data: { seat_id: seat.seat_id, reason: 'e2e_cleanup' },
            });
          }
        }
      } catch { /* non-fatal: tests will surface the problem */ }
    }

    // Two isolated browser contexts — separate localStorage, separate device keys.
    const appBaseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:5173';
    contextA = await browser.newContext({ baseURL: appBaseURL });
    contextB = await browser.newContext({ baseURL: appBaseURL });
    contextWalled = await browser.newContext({ baseURL: appBaseURL });
    pageA = await contextA.newPage();
    pageB = await contextB.newPage();
    pageWalled = await contextWalled.newPage();
  });

  test.afterAll(async () => {
    await contextA.close();
    await contextB.close();
    await contextWalled.close();
  });

  test('context A: sign in as admin and activate seat', async () => {
    await signInFirm(pageA, ADMIN_EMAIL, ADMIN_PASSWORD);
    await activateSeat(pageA, LICENSE_KEY);
    // Confirm seat is active (subscription-active or offline-grace state).
    await expect(pageA.getByTestId('firm-seat-status')).toHaveAttribute(
      'data-state',
      /subscription-active|offline-grace/,
      { timeout: 5000 },
    );
  });

  test('context B: sign in as member and activate seat', async () => {
    await signInFirm(pageB, MEMBER_EMAIL, MEMBER_PASSWORD);
    await activateSeat(pageB, LICENSE_KEY);
    await expect(pageB.getByTestId('firm-seat-status')).toHaveAttribute(
      'data-state',
      /subscription-active|offline-grace/,
      { timeout: 5000 },
    );
  });

  test('context WalledUser: sign in', async () => {
    await signInFirm(pageWalled, WALLED_EMAIL, WALLED_PASSWORD);
    await activateSeat(pageWalled, LICENSE_KEY);
    await expect(pageWalled.getByTestId('firm-seat-status')).toHaveAttribute(
      'data-state',
      /subscription-active|offline-grace/,
      { timeout: 5000 },
    );
  });

  test('admin shares a matter and opens notes', async () => {
    // shareNewMatter navigates: Settings close → AI sidebar tab → new chat →
    // matter-scope-selector → matter-scope-manage → create matter → share.
    await shareNewMatter(pageA, MATTER_NAME, MATTER_CLIENT_NAME);
    // sharedLocalMatterIdA and sharedFirmMatterId are now set.

    // Invite the member to the shared matter via the admin console.
    // This must happen before member tries to open the matter.
    await inviteMemberViaAdminConsole(pageA, sharedFirmMatterId, MEMBER_EMAIL);

    // Close settings and open the notes via the dialog button.
    await pageA.keyboard.press('Escape');
    await openAIChatForMatterManager(pageA);
    await openMatterManager(pageA);
    await openSharedNotesByLocalId(pageA, sharedLocalMatterIdA);
    await expect(pageA.getByTestId('matter-notes-editor')).toBeVisible();
  });

  test('admin types a sentence into notes', async () => {
    const adminText = 'Admin initial note: convergence test sentence.';
    await typeIntoNotes(pageA, adminText);
    // Confirm the text is in the editor locally.
    await assertTextConverged(pageA, adminText);
  });

  test('member opens the shared matter and sees admin text', async () => {
    // Close settings if open, navigate to AI chat, open matter manager.
    await openAIChatForMatterManager(pageB);
    await openMatterManager(pageB);

    // The "Shared matters I can access" section shows the admin's shared matter.
    // Use the specific firm matter ID button to avoid accidentally clicking
    // old-run matters from previous test executions that the member is not in.
    const specificOpenRemoteBtn = pageB.getByTestId(`firm-open-remote-${sharedFirmMatterId}`);
    const specificBtnVisible = await specificOpenRemoteBtn.isVisible({ timeout: 10000 }).catch(() => false);

    if (specificBtnVisible) {
      // First click: registers the member's device. The key won't be published for
      // this device yet, so handleOpenShared returns a firm-open-error.
      // We then switch to admin to re-publish keys for the newly registered device,
      // then retry the open on the member side.
      await specificOpenRemoteBtn.click();

      // Wait for the open attempt to complete (either success or error).
      // Success: firm-mine-empty appears (matter linked, removed from remote list).
      // Error: firm-open-error appears (key not yet published for this device).
      const openResult = await Promise.race([
        pageB.getByTestId('firm-mine-empty').waitFor({ state: 'visible', timeout: 20000 }).then(() => 'success'),
        pageB.getByTestId('firm-open-error').waitFor({ state: 'visible', timeout: 20000 }).then(() => 'error'),
      ]).catch(() => 'timeout');

      if (openResult === 'error' || openResult === 'timeout') {
        // Key not yet published for the member's device. Switch to admin to re-publish.
        // The first click registered the member's device via registerDevice(client),
        // so the admin can now wrap and publish the key for it.
        await pageB.keyboard.press('Escape');
        await pageB.waitForTimeout(300);

        // Admin: open admin console, select the matter, re-publish keys.
        const firmAdminConsole = pageA.getByTestId('firm-admin-console');
        if (!(await firmAdminConsole.isVisible({ timeout: 500 }).catch(() => false))) {
          await openFirmAccountWindow(pageA);
          await firmAdminConsole.waitFor({ state: 'visible', timeout: 8000 });
        }

        await pageA.getByTestId('firm-matter-list').waitFor({ state: 'visible', timeout: 8000 });
        let matterBtn = pageA.getByTestId(`firm-matter-${sharedFirmMatterId}`);
        if (!(await matterBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
          matterBtn = pageA.locator('[data-testid^="firm-matter-"]').first();
        }
        await matterBtn.click();

        // Wait for the member list to load (confirms loadMembers completed + members.key_epoch is set).
        await pageA.getByTestId('firm-member-list').waitFor({ state: 'visible', timeout: 20000 });

        // Click the re-publish keys button (registered after handleOpenShared registered the device).
        const republishBtn = pageA.getByTestId('firm-republish-keys');
        await republishBtn.waitFor({ state: 'visible', timeout: 6000 });
        await republishBtn.click();
        // Wait for either the success notice or error notice.
        await Promise.race([
          pageA.getByTestId('firm-admin-notice').waitFor({ state: 'visible', timeout: 15000 }),
          pageA.getByTestId('firm-admin-error').waitFor({ state: 'visible', timeout: 15000 }),
        ]).catch(() => null);

        // Now retry the open on the member side.
        await openAIChatForMatterManager(pageB);
        await openMatterManager(pageB);

        // Try the open again — key should now be published for the member's device.
        const retryBtn = pageB.getByTestId(`firm-open-remote-${sharedFirmMatterId}`);
        const retryVisible = await retryBtn.isVisible({ timeout: 8000 }).catch(() => false);
        if (retryVisible) {
          await retryBtn.click();
          await pageB.getByTestId('firm-mine-empty').waitFor({ state: 'visible', timeout: 20000 }).catch(() => null);
        }
      }
      // If openResult === 'success': matter was already linked. Fall through.

      // Close and reopen the dialog to force a fresh render with the updated matters list.
      await pageB.keyboard.press('Escape');
      await pageB.waitForTimeout(300);
      await openAIChatForMatterManager(pageB);
      await openMatterManager(pageB);
    }
    // If the button wasn't visible, the matter is already linked in the local store
    // (e.g. a retry run). The matter-open-notes-* button should already be present.

    // After opening, the matter is linked locally and the matter-open-notes-<id>
    // button appears for it in the existing matters section of the dialog.
    await openSharedNotesFirst(pageB);

    // Assert admin's sentence converged (content-based, up to 15s).
    await assertTextConverged(pageB, 'Admin initial note: convergence test sentence.');
  });

  test('member types a reply and admin sees it', async () => {
    const memberReply = ' | Member reply: bidirectional convergence confirmed.';
    await typeIntoNotes(pageB, memberReply);
    await assertTextConverged(pageB, 'Member reply: bidirectional convergence confirmed.');
    // Admin should see the member's text (converges back).
    await assertTextConverged(pageA, 'Member reply: bidirectional convergence confirmed.');
  });

  test('admin walls the walled user, who then sees fail-closed message', async () => {
    // Full flow:
    //  1. Admin invites the walled user to the matter.
    //  2. Walled user's first open attempt: registers their device, gets 404
    //     (key not yet published for their device).
    //  3. Admin re-publishes keys → walled user's device now has a wrapped key.
    //  4. Walled user retries open → succeeds → matter linked locally.
    //  5. Admin sets the ethical wall → key epoch rotates, walled user's key deleted.
    //  6. Walled user opens notes for the locally-linked matter → fail-closed panel.
    // Helper: ensure the firm admin console is open and the correct matter is selected.
    const ensureFirmAdminOnMatter = async (): Promise<void> => {
      const firmAdminConsole = pageA.getByTestId('firm-admin-console');
      if (!(await firmAdminConsole.isVisible({ timeout: 500 }).catch(() => false))) {
        await openFirmAccountWindow(pageA);
        await firmAdminConsole.waitFor({ state: 'visible', timeout: 8000 });
      }
      await pageA.getByTestId('firm-matter-list').waitFor({ state: 'visible', timeout: 8000 });
      let matterBtn = sharedFirmMatterId
        ? pageA.getByTestId(`firm-matter-${sharedFirmMatterId}`)
        : null;
      const matterBtnVisible = matterBtn
        ? await matterBtn.isVisible({ timeout: 3000 }).catch(() => false)
        : false;
      if (!matterBtnVisible) {
        matterBtn = pageA.locator('[data-testid^="firm-matter-"]').first();
        await matterBtn.waitFor({ state: 'visible', timeout: 5000 });
      }
      await matterBtn!.click();
    };

    // Step 1: Invite the walled user to the shared matter.
    await ensureFirmAdminOnMatter();
    await pageA.getByTestId('firm-member-email').waitFor({ state: 'visible', timeout: 6000 });
    await pageA.getByTestId('firm-member-email').fill(WALLED_EMAIL);
    await pageA.getByTestId('firm-add-member').click();
    await Promise.race([
      pageA.getByTestId('firm-admin-notice').waitFor({ state: 'visible', timeout: 10000 }),
      pageA.getByTestId('firm-admin-error').waitFor({ state: 'visible', timeout: 10000 }),
    ]).catch(() => null);

    // Step 2: Walled user opens matter manager and clicks Open to register their device.
    // The first click likely returns 404 (not_published) since key isn't wrapped for
    // their device yet. This registers their device on the server.
    await openAIChatForMatterManager(pageWalled);
    await openMatterManager(pageWalled);
    const walledOpenBtnFirst = sharedFirmMatterId
      ? pageWalled.getByTestId(`firm-open-remote-${sharedFirmMatterId}`)
      : pageWalled.locator('[data-testid^="firm-open-remote-"]').first();
    if (await walledOpenBtnFirst.isVisible({ timeout: 5000 }).catch(() => false)) {
      await walledOpenBtnFirst.click();
      // Allow the 404 error to surface and be dismissed.
      await pageWalled.getByTestId('firm-open-error').waitFor({ state: 'visible', timeout: 10000 }).catch(() => null);
    }

    // Step 3: Admin re-publishes keys → wraps key for walled user's newly registered device.
    await ensureFirmAdminOnMatter();
    await pageA.getByTestId('firm-member-list').waitFor({ state: 'visible', timeout: 20000 });
    const republishBtn2 = pageA.getByTestId('firm-republish-keys');
    await republishBtn2.waitFor({ state: 'visible', timeout: 6000 });
    await republishBtn2.click();
    await Promise.race([
      pageA.getByTestId('firm-admin-notice').waitFor({ state: 'visible', timeout: 15000 }),
      pageA.getByTestId('firm-admin-error').waitFor({ state: 'visible', timeout: 15000 }),
    ]).catch(() => null);

    // Step 4: Walled user retries open → should succeed now that key is published.
    // Close and reopen matter manager so remoteMineMatters reloads.
    await pageWalled.keyboard.press('Escape');
    await pageWalled.waitForTimeout(300);
    await openMatterManager(pageWalled);
    const walledOpenBtnRetry = sharedFirmMatterId
      ? pageWalled.getByTestId(`firm-open-remote-${sharedFirmMatterId}`)
      : pageWalled.locator('[data-testid^="firm-open-remote-"]').first();
    if (await walledOpenBtnRetry.isVisible({ timeout: 5000 }).catch(() => false)) {
      await walledOpenBtnRetry.click();
      // This time expect either notes-editor (success) or no-access (fail-closed).
      // Do not await error — if key was published, this succeeds and links the matter.
      await Promise.race([
        pageWalled.getByTestId('matter-notes-editor').waitFor({ state: 'visible', timeout: 12000 }),
        pageWalled.getByTestId('matter-notes-no-access').waitFor({ state: 'visible', timeout: 12000 }),
      ]).catch(() => null);
      // Close notes and go back to dialog state for the wall step.
      await pageWalled.keyboard.press('Escape');
      await pageWalled.waitForTimeout(200);
    }

    // Step 5: Admin sets the ethical wall on the walled user.
    // The wall rotates the key epoch and deletes all wrapped keys, so the walled
    // user can no longer decrypt future content.
    await ensureFirmAdminOnMatter();
    const wallInput = pageA.getByTestId('firm-wall-user-id');
    await wallInput.waitFor({ state: 'visible', timeout: 6000 });
    await wallInput.fill(WALLED_EMAIL);
    await pageA.getByTestId('firm-set-wall').click();
    await pageA.getByTestId('firm-admin-notice').waitFor({ state: 'visible', timeout: 8000 }).catch(() => null);

    // Step 6: Walled user opens the locally-linked matter's notes.
    // The matter is now linked (from step 4), so the dialog shows matter-open-notes-.
    // obtainMatterKey will return null (403 walled) → fail-closed no-access panel.
    //
    // We must clear the cached matter key from the walled user's local keychain
    // (localStorage fallback in browser) so obtainMatterKey goes to the server.
    // In production, the sync client receives an epoch-advanced message and
    // automatically clears the stale cached key via stopMatterSync. In the test,
    // we simulate that by purging the key directly, so the next open triggers a
    // fresh server fetch that returns 403 (walled).
    if (sharedFirmMatterId) {
      await pageWalled.evaluate((matterId) => {
        const PREFIX = 'lantern_kc_fallback::';
        const keyToClear = `${PREFIX}com.keepance.matter.${matterId}::content_key`;
        localStorage.removeItem(keyToClear);
      }, sharedFirmMatterId);
    }
    await openMatterManager(pageWalled);

    // The matter should be linked (shows matter-open-notes-) OR
    // still remote (shows firm-open-remote- which will 403 immediately).
    const localNotesBtn = sharedFirmMatterId
      ? pageWalled.locator(`[data-testid^="matter-open-notes-"]`).first()
      : pageWalled.locator('[data-testid^="matter-open-notes-"]').first();
    const remoteOpenBtn = sharedFirmMatterId
      ? pageWalled.getByTestId(`firm-open-remote-${sharedFirmMatterId}`)
      : pageWalled.locator('[data-testid^="firm-open-remote-"]').first();

    const localVisible = await localNotesBtn.isVisible({ timeout: 3000 }).catch(() => false);
    const remoteVisible = await remoteOpenBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (localVisible) {
      // Matter was linked in step 4. Open notes → should show no-access.
      await localNotesBtn.click();
      await expect(
        pageWalled.getByTestId('matter-notes-no-access'),
      ).toBeVisible({ timeout: 12000 });
    } else if (remoteVisible) {
      // Matter was never linked (step 4 was skipped or failed). A click now
      // goes through handleOpenShared which calls obtainMatterKey → 403 walled.
      await remoteOpenBtn.click();
      await pageWalled.getByTestId('firm-open-error').waitFor({ state: 'visible', timeout: 10000 });
    } else {
      // Neither button is visible — the matter may already be open in the main panel
      // from a previous step. In that case the notes should show the no-access panel.
      await pageWalled.keyboard.press('Escape');
      await expect(
        pageWalled.getByTestId('matter-notes-no-access'),
      ).toBeVisible({ timeout: 12000 });
    }
  });
});
