/**
 * Bench mirror: onboarding overlap (QA-8 / QA-9).
 *
 * QA-8 — the intro splash's 3-node flowchart: decorative Lottie icon graphics
 * overlapped and obscured the card heading text below them ("Advisor Prep
 * Hero builds Client Maps", "Ask anything, with sources"), reproducing as a
 * duplicated/overlapping icon graphic. Root cause (confirmed by direct
 * measurement, not the "svg sized to its native canvas" theory that looked
 * plausible from the JSON assets' wildly different w/h — 150x150 / 500x500 /
 * 1920x1080 — but wasn't it): React StrictMode's dev-only double-invoke let a
 * shared cancellation ref un-cancel a stale mount's in-flight lottie-web
 * import, so TWO animation instances ended up appended into one fixed-height
 * container, overflowing onto the heading below. Fixed in LottiePlayer.tsx by
 * using a closure-local cancellation flag instead of a shared ref (see its
 * docblock). This test drives the REAL intro screen and asserts (a) each
 * icon's rendered svg never overlaps its own heading's box, and (b) the svg
 * is actually bounded to ~130px (not 500/1920px), at two viewport sizes.
 *
 * QA-9 — the model-download progress banner overlapped a scene's numbered
 * step header ("2. Connect your practice", "3. Setting up your firm").
 * Root cause: the banner was mounted as an independent `fixed inset-x-0
 * top-0 z-[60]` layer OUTSIDE the onboarding shell (itself `fixed inset-0
 * z-50`), so it floated on top of the shell's content with no reserved
 * space. Fixed via OnboardingShell's `topBanner` slot, rendered in normal
 * flow above the scrolling scene content (see OnboardingShell.tsx + its
 * unit test for the structural regression guard).
 *
 * IMPORTANT CAVEAT (documented, not glossed over): the actual
 * ModelDownloadCard / LocalAiDownloadCard banners never render outside a
 * real Tauri desktop build — useModelStatus / useLocalLlmModelStatus both
 * stay 'idle' off-Tauri by design (see their source docblocks), which is
 * exactly why this bug was only caught on a real Windows bench run, not in
 * this browser-only Playwright suite. So this spec's QA-9 coverage is a
 * real-browser regression guard on the scene header's own layout (full
 * visibility, no clipping, stable position) — it does NOT and CANNOT drive
 * the literal banner-over-header collision in this environment. The
 * authoritative regression guard for the actual fix is the unit test at
 * src/features/onboarding/v2/components/OnboardingShell.test.tsx, which
 * proves `topBanner` renders in normal flow, before the scene content, inside
 * the same shell (not as a competing fixed layer).
 */

import { test, expect } from '@playwright/test';
import { boxesOverlap } from './helpers/layout';

const VIEWPORTS = [
  { label: 'desktop', width: 1280, height: 800 },
  { label: 'compact', width: 1024, height: 700 },
];
const INTRO_FLOW_STEP_COUNT = 3;
const INTRO_FLOW_TITLES = ['Connect your firm', 'It builds a Client Map', 'Ask anything'];
const CONNECT_HEADLINE = '2. Connect your firm';
const FIRM_HEADLINE = '3. Setting up your firm';

test.describe('Bench mirror: Onboarding overlap (QA-8, QA-9)', () => {
  for (const viewport of VIEWPORTS) {
    test(`qa8-intro-flowchart-icons-never-overlap-their-headings @ ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/?forceOnboarding=true');
      await expect(page.getByTestId('onboarding-v2-intro')).toBeVisible({ timeout: 30_000 });

      await expect(page.locator('[data-testid^="intro-flow-heading-"]')).toHaveCount(INTRO_FLOW_STEP_COUNT);
      await expect(page.locator('[data-testid^="intro-flow-heading-"]')).toHaveText(INTRO_FLOW_TITLES);

      for (let i = 0; i < INTRO_FLOW_STEP_COUNT; i++) {
        const icon = page.getByTestId(`intro-flow-icon-${String(i)}`);
        const heading = page.getByTestId(`intro-flow-heading-${String(i)}`);
        // The icon's own container is a fixed 130x130 box regardless of what
        // lottie-web renders inside it, so comparing IT against the heading
        // would never catch the real bug (see LottiePlayer.tsx's docblock):
        // a StrictMode double-mount race could leave TWO lottie svg
        // instances appended into one fixed-height container, the second
        // overflowing onto the heading below — a bug the outer container's
        // own (unaffected) box can never reveal. The <svg> itself is the
        // element that must be measured to catch that.
        // .first(): pins to one instance in case any such race ever
        // recurs, so the assertion stays meaningful rather than failing on
        // strict-mode-locator ambiguity.
        // Generous explicit timeouts (not Playwright's 5s default): lottie-web
        // is dynamically imported and fetches its JSON over the dev server,
        // and this shared, variably-loaded box can make that first render
        // slow — the same reasoning behind this repo's existing 30s dev-server
        // cold-start allowances (see playwright.config.ts, waitForTestModeLoad).
        const iconSvg = icon.locator('svg').first();
        await expect(iconSvg).toBeVisible({ timeout: 20_000 });
        await expect(heading).toBeVisible({ timeout: 20_000 });
        const iconBox = await iconSvg.boundingBox();
        const headingBox = await heading.boundingBox();
        expect(iconBox, `icon ${String(i)} svg must have a real box`).toBeTruthy();
        expect(headingBox, `heading ${String(i)} must have a real box`).toBeTruthy();
        if (!iconBox || !headingBox) continue;

        // The heading must have real, non-degenerate height (a squashed-to-zero
        // box would trivially "not overlap" anything without actually being legible).
        expect(headingBox.height).toBeGreaterThan(8);
        // The icon's own rendered svg must actually be bounded to its 130px
        // slot (not a bug-shaped coincidence of never overlapping this one
        // heading) — width/height are each expected to be ~130 (+/- a few px
        // for the injected preserveAspectRatio scaling), never 500/1920.
        expect(iconBox.width).toBeLessThan(140);
        expect(iconBox.height).toBeLessThan(140);
        expect(boxesOverlap(iconBox, headingBox)).toBe(false);
      }
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`qa9-step-headers-render-fully-visible-and-unclipped @ ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      // The real ChooseStart "sample"/"own data" paths both open a genuine
      // native folder picker (Tauri dialog, or the browser File System Access
      // API off-desktop) that Playwright cannot drive headlessly. `testMode`
      // pre-seeds a mock workspace (see useTestModeWorkspace), which makes
      // OnboardingV2's own `hasWorkspace` gate start the wizard directly at
      // the compliance beat — skipping the intro/ChooseStart folder-picker
      // steps entirely, with no mocking of browser APIs required.
      await page.goto('/?testMode=true&forceOnboarding=true');
      await expect(page.getByTestId('onboarding-v2-compliance')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('onboarding-v2-continue').click();
      await expect(page.getByTestId('onboarding-v2-ai')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('onboarding-v2-continue').click();

      await expect(page.getByTestId('onboarding-v2-connect')).toBeVisible({ timeout: 15_000 });
      const connectHeader = page.getByRole('heading', { name: CONNECT_HEADLINE, exact: true });
      await expect(connectHeader).toBeVisible();
      const connectBox = await connectHeader.boundingBox();
      expect(connectBox, 'connect step header must have a real box').toBeTruthy();
      if (connectBox) {
        expect(connectBox.height).toBeGreaterThan(8);
        // The header must render below the shell's corner logo/back button row
        // (y > 0 within a reasonable band) and fully within the viewport —
        // i.e. nothing has pushed or clipped it off-screen.
        expect(connectBox.y).toBeGreaterThan(0);
        expect(connectBox.y + connectBox.height).toBeLessThanOrEqual(viewport.height);
      }

      await page.getByTestId('onboarding-v2-continue').click();
      await expect(page.getByTestId('onboarding-v2-firm')).toBeVisible({ timeout: 15_000 });
      const firmHeader = page.getByRole('heading', { name: FIRM_HEADLINE, exact: true });
      await expect(firmHeader).toBeVisible();
      const firmBox = await firmHeader.boundingBox();
      expect(firmBox, 'firm step header must have a real box').toBeTruthy();
      if (firmBox) {
        expect(firmBox.height).toBeGreaterThan(8);
        expect(firmBox.y).toBeGreaterThan(0);
        expect(firmBox.y + firmBox.height).toBeLessThanOrEqual(viewport.height);
      }
    });
  }
});
