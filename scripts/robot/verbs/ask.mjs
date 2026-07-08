import { installAIReplay } from '../fixtures/aiReplay.mjs';
import { installEgressGuard, egressVerdict } from '../fixtures/egressGuard.mjs';
import { resolveMatterId } from './matters.mjs';
import { dismissKnownBlockingDialogs, waitForPdfIndexing } from './workspace.mjs';

const ATT = '[data-testid="ask-cited-attestation"]';
const WARN = '[data-testid="ask-uncited-warning"]';
const STATUS_SELECTOR = `${WARN},${ATT}`;
const CHIP = '[data-testid^="ask-citation-chip-"]';

/**
 * Ask one grounded question and prove the NEWEST answer came back cited.
 *
 * Guards against false greens (Codex review): instead of comparing TOTAL
 * attestation vs warning counts — which can pass on a stale attestation left by a
 * previous turn — this snapshots before-counts and requires the new turn to add a
 * cited attestation AND at least one new citation chip.
 *
 * When `deterministic:true`, the model call is served by the recorded `replay`
 * fixture and an egress guard asserts NOTHING reached a live provider (and that
 * the fixture was actually used). The verdict lands in `out.egress` and is folded
 * into `out.ok`, so a deterministic run that leaks to live AI — or never uses the
 * fixture — fails loudly instead of silently spending money / going flaky.
 *
 * @param {import('playwright').Page} page
 * @param {{ question?: string, deterministic?: boolean, replay?: string, matterId?: string }} args
 */
export async function askQuestion(page, args = {}) {
  const question = args.question || 'What is the total portfolio value for this household?';
  const deterministic = args.deterministic ?? false;
  const replay = args.replay ?? 'ask-portfolio';
  // matter ids are fresh random UUIDs on every CRM reseed (see matters.mjs) —
  // the fixture was recorded against Hollings Family specifically, so resolve
  // ITS current id rather than falling through to whichever matter sorts first.
  const matterId = args.matterId || (await resolveMatterId(page, 'Hollings Family'));

  const out = {
    ok: false,
    deterministic,
    settled: false,
    newCitedAttestation: false,
    newCitationChips: 0,
    attestationsBefore: 0, attestationsAfter: 0,
    uncitedBefore: 0, uncitedAfter: 0,
    chipsBefore: 0, chipsAfter: 0,
    lastAnswer: null,
    egress: null,
  };

  const count = (sel) => page.$$eval(sel, (els) => els.length).catch(() => 0);

  // In deterministic mode the egress guard is installed FIRST (tripwire) and the
  // replay AFTER, so the replay wins for the URLs it covers and the guard fires
  // only on real egress. Hold both controllers to assert after the run.
  let guard = null;
  let replayCtl = null;

  try {
    // The separate, slower PDF-indexing pass re-runs on every workspace boot
    // (even restoring an already-fully-indexed snapshot doesn't skip it) — see
    // waitForPdfIndexing's doc comment. Asking before it finishes is silently
    // flaky: the answer text is right but its citation can't resolve yet.
    out.pdfIndex = await waitForPdfIndexing(page);

    if (deterministic) {
      guard = await installEgressGuard(page);
      replayCtl = await installAIReplay(page, replay);
    }

    // Self-navigate to a client's Ask if no ask input is on the current screen.
    if (!(await page.$('[data-testid="ask-composer-input"]')) && !(await page.$('[data-testid="hub-ask-input"]'))) {
      // The RightCapital-export consent dialog (no data-testid) can appear
      // between steps and silently block every click below (each .catch(()
      // => {}) would otherwise swallow the real cause and leave `served: 0`
      // with no error — see dismissKnownBlockingDialogs's doc comment).
      await dismissKnownBlockingDialogs(page);
      await page.click('[data-testid="spine-nav-matters"]', { timeout: 8000 }).catch(() => {});
      await dismissKnownBlockingDialogs(page);
      await page.waitForTimeout(800);
      const menu = page.locator(`[data-testid="matter-actions-menu-${matterId}"]`).first();
      if (await menu.count()) {
        await menu.click({ timeout: 8000 }).catch(() => {});
        await page.locator(`[data-testid="matter-launch-ask-${matterId}"]`).first().click({ timeout: 8000 }).catch(() => {});
      } else {
        const fallbackMenu = page.locator('[data-testid^="matter-actions-menu-"]').first();
        const fallbackMenuId = await fallbackMenu.getAttribute('data-testid', { timeout: 8000 }).catch(() => null);
        if (fallbackMenuId) {
          const fallbackMatterId = fallbackMenuId.replace('matter-actions-menu-', '');
          await fallbackMenu.click({ timeout: 8000 }).catch(() => {});
          await page.locator(`[data-testid="matter-launch-ask-${fallbackMatterId}"]`).first().click({ timeout: 8000 }).catch(() => {});
        }
      }
      await dismissKnownBlockingDialogs(page);
      await page
        .waitForSelector('[data-testid="ask-composer-input"],[data-testid="hub-ask-input"]', { timeout: 15000 })
        .catch(() => {});
    }

    // Snapshot BEFORE so we can require a NEW cited turn, not rely on totals.
    out.attestationsBefore = await count(ATT);
    out.uncitedBefore = await count(WARN);
    out.chipsBefore = await count(CHIP);
    const statusBefore = out.attestationsBefore + out.uncitedBefore;

    let sel = '[data-testid="ask-composer-input"]';
    if (!(await page.$(sel))) sel = '[data-testid="hub-ask-input"]';
    await page.fill(sel, question);
    await page.press(sel, 'Enter').catch(async () => {
      await page.click('[data-testid="hub-ask-submit"]').catch(() => {});
    });

    // Wait until a NEW turn settles: status count grows and no "Answering".
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(1000);
      await dismissKnownBlockingDialogs(page);
      const cur = await count(STATUS_SELECTOR);
      const answering = await page
        .evaluate(() => /Answering…|Answering\.\.\./.test(document.body.innerText))
        .catch(() => false);
      if (cur > statusBefore && !answering) {
        out.settled = true;
        break;
      }
    }

    out.attestationsAfter = await count(ATT);
    out.uncitedAfter = await count(WARN);
    out.chipsAfter = await count(CHIP);
    out.newCitedAttestation = out.attestationsAfter > out.attestationsBefore;
    out.newCitationChips = out.chipsAfter - out.chipsBefore;

    out.lastAnswer = await page
      .evaluate(() => {
        const warns = [
          ...document.querySelectorAll('[data-testid="ask-uncited-warning"],[data-testid="ask-cited-attestation"]'),
        ];
        const last = warns[warns.length - 1];
        if (!last) return null;
        let p = last.parentElement;
        let txt = '';
        while (p && txt.length < 400) {
          txt = (p.innerText || '').trim();
          p = p.parentElement;
          if (txt.length > 40) break;
        }
        return txt.slice(0, 400);
      })
      .catch(() => null);

    // Egress assertion (deterministic only): the fixture must have served the
    // model call (served >= 1) AND nothing may have reached a live provider.
    if (deterministic) {
      out.egress = egressVerdict({
        served: replayCtl ? replayCtl.served : 0,
        violations: guard ? guard.violations : [],
      });
    }

    // The NEW turn must be cited: a new attestation AND at least one new chip.
    // In deterministic mode it must ALSO be provably air-gapped from live AI.
    // Fail closed if PDF indexing never finished: a cited answer that happens
    // to pass anyway doesn't prove the prerequisite this wait enforces, and a
    // false green here would mask the exact silent-uncited-fallback failure
    // mode waitForPdfIndexing exists to catch.
    const citedOk = out.settled && out.newCitedAttestation && out.newCitationChips >= 1;
    out.ok = citedOk && out.pdfIndex.ok && (!deterministic || (out.egress && out.egress.ok));
  } catch (e) {
    out.err = String(e.message || e);
  }

  return out;
}
