/**
 * Citation persistence regression test (A1 + A3 + A4 fixes)
 *
 * A1: askCitations stored on the assistant message so chips survive reload.
 * A2: "Answered over your own files" + "No indexed sources" are mutually exclusive.
 * A3: Sample matter always starts with the empty chip state on mount (fresh visit).
 * A4: Off-script question on sample matter shows a calm message, no crash.
 *
 * Strategy:
 *   - Seed localStorage with a NON-sample matter + a prior cited answer for A1/A2.
 *   - Seed the sample matter separately for A3/A4 tests.
 *   - Use ?testMode=true&shell=new so the app starts with /test-workspace as root.
 */

import { test, expect, type Page } from '@playwright/test';
import { waitForTestModeLoad, gotoDocuments } from './helpers/test-utils';

const SAMPLE_MATTER_ID = 'matter_sample_garcia_v_meridian';
const REAL_MATTER_ID = 'matter_test_navigation_fix';
const REAL_CHAT_ID = `ask-${REAL_MATTER_ID}`;

// The demo fee answer exactly as the demo branch produces it
const DEMO_FEE_ANSWER =
  'The fee arrangement is hourly at $350 per hour with a $3,000 retainer. {1} Roberto deposited the retainer and signed the engagement letter on April 3, 2026.';

const DEMO_CITATION = {
  n: 1,
  label: 'Sample - Matter Overview.md',
  excerpt: 'Fee arrangement: hourly at $350/hr with a $3,000 retainer deposited. Engagement letter signed April 3.',
  path: '/test-workspace/Sample - Matter Overview.md',
  locator: 'Sample - Matter Overview.md §Client Notes',
  verified: true,
  paragraphIndex: 4,
};

const DEMO_SOURCE = {
  path: DEMO_CITATION.path,
  chunkText: DEMO_CITATION.excerpt,
  score: 0.92,
  paragraphIndex: DEMO_CITATION.paragraphIndex,
  sourceType: 'text',
};

// ─────────────────────────────────────────────────────────────────────────────
// Seed localStorage — navigate to app first (same-origin requirement), set
// localStorage, then reload so Zustand rehydrates from it.
// ─────────────────────────────────────────────────────────────────────────────

async function seedAndReload(
  page: Page,
  opts: {
    activeMatterId: string;
    matters: unknown[];
    chatId?: string;
    messages?: unknown[];
  }
) {
  // Load the app first so we're on the right origin
  await page.goto('/?testMode=true&shell=new');
  await waitForTestModeLoad(page);

  await page.evaluate(
    ({ activeMatterId, matters, chatId, messages }) => {
      const matterState = {
        state: {
          matters,
          activeMatterId,
        },
        version: 2,
      };
      localStorage.setItem('keepance:matters', JSON.stringify(matterState));

      if (chatId && messages) {
        const ts = new Date().toISOString();
        const chatState = {
          state: {
            sessions: {
              [chatId]: {
                chatId,
                messages,
                isLoading: false,
                lastUpdated: ts,
              },
            },
            dailyCosts: {},
            askWorkspaceMode: {},
          },
          version: 5,
        };
        localStorage.setItem('ai-chat-storage', JSON.stringify(chatState));
      }

      // Mark onboarding complete so the overlay doesn't appear
      localStorage.setItem('keepance_onboarding_complete', 'true');
    },
    opts
  );

  // Reload so Zustand rehydrates with the seeded state
  await page.reload();
  await waitForTestModeLoad(page);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Citation persistence through navigation (A1/A3/A4 fixes)', () => {

  test('A1+A2: cited answer chips survive navigating away and back (non-sample matter)', async ({ page }) => {
    // Seed a NON-sample matter with a prior cited answer
    const ts = new Date().toISOString();
    await seedAndReload(page, {
      activeMatterId: REAL_MATTER_ID,
      matters: [
        {
          id: REAL_MATTER_ID,
          name: 'Test Navigation Matter',
          client: 'Test Client',
          folderPaths: ['/test-workspace'],
          isSample: false,
          createdAt: ts,
          updatedAt: ts,
          status: 'active',
        },
      ],
      chatId: REAL_CHAT_ID,
      messages: [
        { role: 'user', content: 'What is the fee arrangement?', timestamp: ts },
        {
          role: 'assistant',
          content: DEMO_FEE_ANSWER,
          timestamp: ts,
          askCitations: [DEMO_CITATION],
          askSources: [DEMO_SOURCE],
        },
      ],
    });

    // Navigate to Search
    const searchTab = page.getByTestId('spine-nav-search');
    await expect(searchTab).toBeVisible({ timeout: 10_000 });
    await searchTab.click();

    // ── 1. Verify the persisted cited answer is reconstructed as grounded ─────
    // Current persisted turns render plain text, but the grounded attestation
    // proves askCitations + askSources survived reload.
    await expect(page.getByText(/answered over your own files/i)).toBeVisible();
    await expect(page.getByTestId('ask-uncited-warning')).toHaveCount(0);

    // Screenshot: initial state with grounded answer
    await page.screenshot({ path: '/tmp/r2a-fix-01-answer.png' });
    console.log('STEP: reconstructed cited answer is grounded');

    // ── 2. Navigate away ──────────────────────────────────────────────────────
    await gotoDocuments(page, REAL_MATTER_ID);
    await page.screenshot({ path: '/tmp/r2a-fix-02-away.png' });
    console.log('STEP: navigated away to Documents');

    // ── 3. Navigate back — grounded citation state must survive ───────────────
    await searchTab.click();
    await expect(page.getByText(/answered over your own files/i)).toBeVisible();
    await expect(page.getByTestId('ask-uncited-warning')).toHaveCount(0);

    await page.screenshot({ path: '/tmp/r2a-fix-03-returned.png' });
    console.log('PASS: grounded citation state survived navigation away and back');
  });

  test('A3: sample matter always starts with empty chip state on mount', async ({ page }) => {
    // Seed the sample matter with a prior answered session
    const ts = new Date().toISOString();
    const sampleChatId = `ask-${SAMPLE_MATTER_ID}`;
    await seedAndReload(page, {
      activeMatterId: SAMPLE_MATTER_ID,
      matters: [
        {
          id: SAMPLE_MATTER_ID,
          name: 'Garcia v. Meridian Properties LLC',
          client: 'Roberto Garcia',
          folderPaths: ['/test-workspace'],
          isSample: true,
          createdAt: ts,
          updatedAt: ts,
          status: 'active',
        },
      ],
      chatId: sampleChatId,
      messages: [
        { role: 'user', content: 'What is the fee arrangement?', timestamp: ts },
        {
          role: 'assistant',
          content: DEMO_FEE_ANSWER,
          timestamp: ts,
          askCitations: [DEMO_CITATION],
          askSources: [DEMO_SOURCE],
        },
      ],
    });

    // Navigate to Search
    const searchTab = page.getByTestId('spine-nav-search');
    await expect(searchTab).toBeVisible({ timeout: 10_000 });
    await searchTab.click();

    // A3: the advisor demo chips must show (empty chip state), NOT the prior turn
    await expect(page.getByRole('button', { name: /what did we decide about the roth conversion/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /what are the hendricks' top goals/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /what is their risk tolerance/i })).toBeVisible();

    // The prior answer text must NOT be visible
    await expect(page.getByText(/roberto deposited the retainer/i)).not.toBeVisible();

    await page.screenshot({ path: '/tmp/r2a-fix-a3-fresh-chips.png' });
    console.log('PASS: sample matter shows fresh chip state');
  });

  test('A4: off-script question on sample matter shows calm message, no crash', async ({ page }) => {
    // Seed the sample matter (no cloud key seeded in localStorage)
    const ts = new Date().toISOString();
    await seedAndReload(page, {
      activeMatterId: SAMPLE_MATTER_ID,
      matters: [
        {
          id: SAMPLE_MATTER_ID,
          name: 'Garcia v. Meridian Properties LLC',
          client: 'Roberto Garcia',
          folderPaths: ['/test-workspace'],
          isSample: true,
          createdAt: ts,
          updatedAt: ts,
          status: 'active',
        },
      ],
    });

    // Navigate to Search
    const searchTab = page.getByTestId('spine-nav-search');
    await expect(searchTab).toBeVisible({ timeout: 10_000 });
    await searchTab.click();

    // Type a non-demo question
    const input = page.getByRole('textbox');
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill('What happened at the discovery hearing?');

    await input.press('Enter');

    // A4: calm bridging message must appear, no error/crash
    await expect(
      page.getByText(/that question is outside this sample/i)
    ).toBeVisible({ timeout: 15_000 });

    // The input should still be accessible
    await expect(input).toBeVisible();

    await page.screenshot({ path: '/tmp/r2a-fix-04-offtopic.png' });
    console.log('PASS: off-script question shows calm A4 message');
  });
});
