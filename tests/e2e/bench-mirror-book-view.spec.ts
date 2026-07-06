/**
 * Browser mirror of the Windows bench smoke checklist's Wave 4 Track B
 * checks (scripts/bench-smoke/checks/wave4.mjs: wave4-whole-book-view,
 * wave4-estate-beneficiary-gap, wave4-estate-beneficiary-gap-dismiss-live —
 * see docs/qa/E2E-SMOKE-MIRROR.md for the full mapping).
 *
 * BookView (src/features/matters/book/BookView.tsx) is pure client-side
 * derived state (useActiveMatters + useClientMapStore, no Tauri/network), so
 * unlike the docx-editor-toolbar and connector checks in this checklist, it
 * is fully drivable in the browser dev build.
 */

import { test, expect, type Page } from '@playwright/test';
import { hardClick, waitForTestModeLoad } from './helpers/test-utils';

const GAP_MATTER_ID = 'matter_bench_mirror_gap_household';
const GAP_TEXT = 'Two documents name different beneficiaries: Jane Doe (will) vs. John Doe Jr. (401k form).';

function bookRow(matterId: string) {
  return `book-row-${matterId}`;
}

/** Seed one non-sample matter whose Client Map already carries a
 *  "Beneficiary check:" gap question — the same shape ClientMapStore's
 *  beneficiary-consistency merge (clientMapStore.ts's withSections) produces
 *  from real conflicting estate documents. Seeded directly via localStorage
 *  before the app boots, then reloaded so Zustand rehydrates — the same
 *  technique tests/e2e/citation-persistence.spec.ts already uses for
 *  `lantern:matters`; `lantern:client-maps` is the sibling persisted store
 *  (src/config/identity.ts's SK_MATTERS / SK_CLIENT_MAPS, clientMapStore.ts's
 *  persist version 3). No product source is modified by this — only
 *  localStorage the app itself would have written. */
async function seedGapMatterAndReload(page: Page) {
  await page.goto('/?testMode=true');
  await waitForTestModeLoad(page);

  await page.evaluate(
    ({ matterId, gapText }) => {
      const ts = new Date().toISOString();
      // QA-93: the app persists per workspace; with the test workspace open it
      // reads the SCOPED key. Seed the scoped key (published on window) so the
      // app hydrates this fixture instead of an empty scoped store.
      const suffix =
        (window as unknown as { __lanternWorkspaceScopeSuffix?: string }).__lanternWorkspaceScopeSuffix ?? '';
      localStorage.setItem(
        'lantern:matters' + suffix,
        JSON.stringify({
          state: {
            matters: [
              {
                id: matterId,
                name: 'Beneficiary gap test household',
                client: 'Doe Household',
                folderPaths: ['/test-workspace/Doe Household'],
                isSample: false,
                createdAt: ts,
                updatedAt: ts,
                status: 'active',
              },
            ],
            activeMatterId: null,
          },
          version: 2,
        }),
      );

      const mkItem = (id: string, text: string) => ({
        id,
        text,
        origin: 'ai',
        isAssumption: false,
        sources: [{ kind: 'document', ref: '/test-workspace/Doe Household/Will.pdf', snippet: text }],
        updatedAt: ts,
      });
      const sections = [
        { id: 'household', kind: 'core', key: 'household', title: 'Household', items: [mkItem('h1', 'John Doe Sr. — 64, retired.'), mkItem('h2', 'Spouse: Jane Doe, 61.'), mkItem('h3', 'Son: John Doe Jr., 30.')] },
        { id: 'goals', kind: 'core', key: 'goals', title: 'Goals', items: [mkItem('g1', 'Retire fully by 2028.')] },
        { id: 'money', kind: 'core', key: 'money', title: 'Money', items: [mkItem('m1', 'Investable assets $1.1M.')] },
        { id: 'followups', kind: 'core', key: 'followups', title: 'Follow-ups', items: [] },
      ];
      localStorage.setItem(
        'lantern:client-maps' + suffix,
        JSON.stringify({
          state: {
            maps: {
              [matterId]: {
                matterId,
                sections,
                completeness: {
                  level: 'getting-there',
                  know: [],
                  assuming: [],
                  ask: [{ text: `Beneficiary check: ${gapText} Flagged for your review. Not legal advice.`, sectionKey: 'household' }],
                },
                pendingUpdates: [],
                lastBuiltAt: ts,
                lastSourceFingerprint: 'bench-mirror-gap-fixture',
              },
            },
            clientQuestions: {},
          },
          version: 3,
        }),
      );
    },
    { matterId: GAP_MATTER_ID, gapText: GAP_TEXT },
  );

  await page.reload();
  await waitForTestModeLoad(page);
}

async function openWholeBookView(page: Page) {
  await hardClick(page.getByTestId('spine-nav-matters'));
  const viewGroup = page.getByRole('group', { name: 'Client Map view' });
  await hardClick(viewGroup.getByRole('button', { name: 'Whole book' }));
  await expect(page.getByTestId('book-view')).toBeVisible({ timeout: 10_000 });
}

test.describe('Bench mirror: Wave 4 Track B — whole-book Client Map', () => {
  test('wave4-whole-book-view: ranks clients and a row opens the client hub', async ({ page }) => {
    await page.goto('/?testMode=true&seedDemo=1');
    await waitForTestModeLoad(page);
    await openWholeBookView(page);

    // seedDemoClients.ts's Tran/Whitman matters are NOT flagged isSample, so
    // (unlike Brennan/Okafor) BookView's buildBookRows includes them.
    const row = page.getByTestId('book-row-matter_demo_tran');
    await expect(row).toBeVisible({ timeout: 10_000 });

    await hardClick(row);
    await expect(page.getByTestId('hub-subtab-bar')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('hub-subtab-documents')).toBeVisible();
  });

  test('wave4-estate-beneficiary-gap: gap chip renders and the client\'s Client Map shows a resolvable row', async ({ page }) => {
    await seedGapMatterAndReload(page);
    await openWholeBookView(page);

    const row = page.getByTestId(bookRow(GAP_MATTER_ID));
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByTestId('book-gap-chip')).toBeVisible();

    await hardClick(row);
    await hardClick(page.getByTestId('hub-subtab-overview'));
    // The gap question is filed under 'household' (where the ANSWER would be
    // recorded), but it only renders in the "What I'm missing" section of the
    // Client Map (ClientMapPanel.tsx's clientmap-tab-__missing), not the
    // Household section tab itself.
    await hardClick(page.getByTestId('clientmap-tab-__missing'));
    await expect(page.getByTestId('clientmap-ask-flag').first()).toBeVisible({ timeout: 10_000 });
  });

  test('wave4-gap-sync regression: a flagged client lands directly on a resolvable gap row, no extra tab click', async ({ page }) => {
    // Reproduces the real Windows bench finding (2026-07-04 RUN-LOG): the bench
    // script's client-detail navigation (openSmokeClientOverview in
    // scripts/bench-smoke/checks/_util.mjs) only switches to the "Client Map"
    // hub sub-tab — it never clicks the inner "What I'm missing" tab
    // (clientmap-tab-__missing) the way the test above does. Book view and
    // client detail must agree WITHOUT that extra click: whenever the client
    // has an unresolved gap, ClientMapPanel now defaults straight to "What I'm
    // missing" (ClientMapPanel.tsx), so this must be visible immediately.
    await seedGapMatterAndReload(page);
    await openWholeBookView(page);

    const row = page.getByTestId(bookRow(GAP_MATTER_ID));
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByTestId('book-gap-chip')).toBeVisible();

    await hardClick(row);
    await hardClick(page.getByTestId('hub-subtab-overview'));
    await expect(page.getByTestId('clientmap-ask-flag').first()).toBeVisible({ timeout: 10_000 });
  });

  test('wave4-estate-beneficiary-gap-dismiss-live: resolving the gap clears it', async ({ page }) => {
    // Upgraded from the bench's --live gate: on the bench this mutation is
    // gated because it would permanently alter shared physical-bench demo
    // data other runs depend on. Here the fixture is seeded fresh per test
    // (a throwaway browser context), so there is no shared state to protect
    // — the real user-visible resolve flow can run unconditionally.
    await seedGapMatterAndReload(page);
    await openWholeBookView(page);
    await hardClick(page.getByTestId(bookRow(GAP_MATTER_ID)));
    await hardClick(page.getByTestId('hub-subtab-overview'));
    await hardClick(page.getByTestId('clientmap-tab-__missing'));

    const resolveButton = page.getByTestId('clientmap-ask-flag').first();
    await expect(resolveButton).toBeVisible({ timeout: 10_000 });
    await hardClick(resolveButton);
    await expect(page.getByTestId('clientmap-ask-flag')).toHaveCount(0);

    await hardClick(page.getByTestId('spine-nav-matters'));
    await openWholeBookView(page);
    await expect(page.getByTestId(bookRow(GAP_MATTER_ID)).getByTestId('book-gap-chip')).not.toBeVisible();
  });
});
