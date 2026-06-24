import { installAIReplay } from '../fixtures/aiReplay.mjs';

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
 * @param {import('playwright').Page} page
 * @param {{ question?: string, deterministic?: boolean, replay?: string, matterId?: string }} args
 */
export async function askQuestion(page, args = {}) {
  const question = args.question || 'What is the total portfolio value for this household?';
  const deterministic = args.deterministic ?? false;
  const replay = args.replay ?? 'ask-portfolio';
  const matterId = args.matterId || 'matter_nc_hollings_family';

  const out = {
    ok: false,
    settled: false,
    newCitedAttestation: false,
    newCitationChips: 0,
    attestationsBefore: 0, attestationsAfter: 0,
    uncitedBefore: 0, uncitedAfter: 0,
    chipsBefore: 0, chipsAfter: 0,
    lastAnswer: null,
  };

  const count = (sel) => page.$$eval(sel, (els) => els.length).catch(() => 0);

  try {
    if (deterministic) await installAIReplay(page, replay);

    // Self-navigate to a client's Ask if no ask input is on the current screen.
    if (!(await page.$('[data-testid="ask-composer-input"]')) && !(await page.$('[data-testid="hub-ask-input"]'))) {
      await page.click('[data-testid="spine-nav-matters"]', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(800);
      const launch = page.locator(`[data-testid="matter-launch-ask-${matterId}"]`).first();
      if (await launch.count()) await launch.click({ timeout: 8000 }).catch(() => {});
      else await page.locator('[data-testid^="matter-launch-ask-"]').first().click({ timeout: 8000 }).catch(() => {});
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

    // The NEW turn must be cited: a new attestation AND at least one new chip.
    out.ok = out.settled && out.newCitedAttestation && out.newCitationChips >= 1;
  } catch (e) {
    out.err = String(e.message || e);
  }

  return out;
}
