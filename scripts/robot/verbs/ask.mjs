import { installAIReplay } from '../fixtures/aiReplay.mjs';

const STATUS_SELECTOR = '[data-testid="ask-uncited-warning"],[data-testid="ask-cited-attestation"]';
const CITATION_CHIP_SELECTOR = '[data-testid^="ask-citation-chip-"]';

/**
 * Ask one grounded question and wait for the newest answer to settle.
 *
 * @param {import('playwright').Page} page
 * @param {{ question: string, deterministic?: boolean, replay?: string }} args
 * @returns {Promise<{ ok: boolean, settled: boolean, citationChips: number, attestations: number, uncitedWarnings: number, lastAnswer: string | null, err?: string }>}
 */
export async function askQuestion(page, args = {}) {
  const question = args.question || 'What is the total portfolio value for this household?';
  const deterministic = args.deterministic ?? false;
  const replay = args.replay ?? 'ask-portfolio';

  const out = {
    ok: false,
    settled: false,
    citationChips: 0,
    attestations: 0,
    uncitedWarnings: 0,
    lastAnswer: null,
  };

  try {
    if (deterministic) {
      await installAIReplay(page, replay);
    }

    // Self-navigate to a client's Ask if no ask input is on the current screen.
    // (Each client row exposes matter-launch-ask-<matterId>.)
    const matterId = args.matterId || 'matter_nc_hollings_family';
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

    const before = await page.$$eval(STATUS_SELECTOR, (els) => els.length).catch(() => 0);

    // Prefer the composer; fall back to hub input.
    let sel = '[data-testid="ask-composer-input"]';
    if (!(await page.$(sel))) sel = '[data-testid="hub-ask-input"]';

    await page.fill(sel, question);
    await page.press(sel, 'Enter').catch(async () => {
      await page.click('[data-testid="hub-ask-submit"]').catch(() => {});
    });

    // Wait until a new turn settles: attestation/warning total grows and no "Answering".
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(1000);
      const cur = await page.$$eval(STATUS_SELECTOR, (els) => els.length).catch(() => 0);
      const answering = await page
        .evaluate(() => /Answering…|Answering\.\.\./.test(document.body.innerText))
        .catch(() => false);
      if (cur > before && !answering) {
        out.settled = true;
        break;
      }
    }

    out.attestations = await page
      .$$eval('[data-testid="ask-cited-attestation"]', (e) => e.length)
      .catch(() => 0);
    out.uncitedWarnings = await page
      .$$eval('[data-testid="ask-uncited-warning"]', (e) => e.length)
      .catch(() => 0);
    out.citationChips = await page.$$eval(CITATION_CHIP_SELECTOR, (e) => e.length).catch(() => 0);

    // Last turn answer text: grab the same parent block used by legion-askcheck.mjs.
    out.lastAnswer = await page
      .evaluate(() => {
        const warns = [
          ...document.querySelectorAll(
            '[data-testid="ask-uncited-warning"],[data-testid="ask-cited-attestation"]',
          ),
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

    out.ok = out.settled && out.attestations > out.uncitedWarnings;
  } catch (e) {
    out.err = String(e.message || e);
  }

  return out;
}
