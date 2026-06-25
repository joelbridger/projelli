import { getPage } from '../robot/connection.mjs';
const page = await getPage();
const SHOT = '/tmp/claude-1000/-home-jameson/dadc9abc-0cc3-4e6a-9a49-136a3006e1b0/scratchpad';
const Q = process.env.ASK_Q || 'What did Thomas Brennan email me about his retirement accounts?';
const click = (id) => page.evaluate((id) => { const e = document.querySelector(`[data-testid="${id}"]`); if (e) { e.click(); return true; } return false; }, id);
const clickText = (txt) => page.evaluate((txt) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === txt); if (b) { b.click(); return true; } return false; }, txt);

await page.keyboard.press('Escape');
await click('spine-nav-search');
await page.waitForTimeout(1200);
// clear old chat
await clickText('New search');
await page.waitForTimeout(600);
// email scope
await click('scope-toggle');
await page.waitForTimeout(400);
await click('scope-option-email');
await page.waitForTimeout(400);
// type + submit
await page.fill('[data-testid="ask-composer-input"]', Q).catch(async () => { await page.type('[data-testid="ask-composer-input"]', Q); });
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
console.log('submitted:', Q);

let result = null;
for (let i = 0; i < 45; i++) {
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => {
    const cited = document.querySelectorAll('[data-testid="ask-cited-attestation"]').length;
    const uncited = document.querySelectorAll('[data-testid="ask-uncited-warning"]').length;
    const chips = [...document.querySelectorAll('[data-testid^="ask-citation-chip"]')].map((c) => (c.textContent || '').trim());
    const busy = /Searching…|Answering…/.test(document.body.innerText);
    // last turn answer text
    const blocks = [...document.querySelectorAll('[data-testid="ask-turn"], [class*="turn" i]')];
    return { cited, uncited, chips, busy };
  });
  if (!st.busy && (st.cited > 0 || st.uncited > 0 || st.chips.length > 0)) { result = st; break; }
  if (i % 4 === 0) console.log(`  ...t=${i * 2}s busy=${st.busy} cited=${st.cited} uncited=${st.uncited} chips=${st.chips.length}`);
}
console.log('RESULT:', JSON.stringify(result));
// capture the answer text of the last turn
const ans = await page.evaluate(() => {
  const main = document.querySelector('main') || document.body;
  const txt = main.innerText;
  const idx = txt.lastIndexOf('What did Thomas Brennan');
  return txt.slice(idx, idx + 700);
});
console.log('--- LAST TURN TEXT ---\n' + ans);
await page.screenshot({ path: `${SHOT}/ask-clean.png` });
process.exit(0);
