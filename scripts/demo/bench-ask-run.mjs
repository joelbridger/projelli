import { getPage } from '../robot/connection.mjs';
const page = await getPage();
const SHOT = '/tmp/claude-1000/-home-jameson/dadc9abc-0cc3-4e6a-9a49-136a3006e1b0/scratchpad';
const Q = process.env.ASK_Q || 'What did Thomas Brennan email me about his retirement accounts?';

const click = (id) => page.evaluate((id) => { const e = document.querySelector(`[data-testid="${id}"]`); if (e) { e.click(); return true; } return false; }, id);

// close any modal (account window)
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
await page.evaluate(() => { const x = document.querySelector('[data-testid="account-window"] [aria-label*="Close"], [data-testid="account-window"] button'); });
await click('spine-nav-search');
await page.waitForTimeout(1200);

// set email scope
await click('scope-toggle');
await page.waitForTimeout(500);
const scoped = await click('scope-option-email');
console.log('email scope set:', scoped);
await page.waitForTimeout(500);

// type question
await page.evaluate((q) => {
  const inp = document.querySelector('[data-testid="ask-composer-input"]');
  if (inp) { inp.focus(); }
}, Q);
await page.click('[data-testid="ask-composer-input"]').catch(() => {});
await page.fill('[data-testid="ask-composer-input"]', Q).catch(async () => {
  await page.type('[data-testid="ask-composer-input"]', Q);
});
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
console.log('submitted:', JSON.stringify(Q));

// poll for an answer with citations OR a terminal "couldn't find" message
let final = null;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => {
    const t = document.body.innerText;
    const chips = [...document.querySelectorAll('[data-testid^="ask-citation-chip"]')].map((c) => (c.textContent || '').trim());
    const main = document.querySelector('main') || document.body;
    const mt = main.innerText;
    return {
      chips,
      couldntFind: /couldn'?t find|no results|nothing/i.test(mt),
      cited: /cited (over|from)|answered over your own|Sources?:/i.test(mt),
      answerRegion: mt.split('\n').filter((l) => l.trim()).slice(-25),
    };
  });
  const terminal = (st.chips && st.chips.length) || st.couldntFind || st.cited;
  if (terminal) { final = st; break; }
  if (i % 3 === 0) console.log(`  ...waiting (${i * 2}s) chips=${st.chips?.length || 0}`);
}
console.log('FINAL:', JSON.stringify(final, null, 2)?.slice(0, 2500));
await page.screenshot({ path: `${SHOT}/ask-email-answer.png` });
process.exit(0);
