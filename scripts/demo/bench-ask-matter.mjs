// Verify: open a client (matter) then ask a GENERIC email question -> finds THAT
// client's email (matter-scoped retrieval). Proves the open-client-then-ask flow.
import { getPage } from '../robot/connection.mjs';
const page = await getPage();
const SHOT = '/tmp/claude-1000/-home-jameson/dadc9abc-0cc3-4e6a-9a49-136a3006e1b0/scratchpad';
const MATTER = process.env.MATTER || 'matter_nc_brennan_thomas_karen';
const Q = process.env.ASK_Q || 'What did this client email me about their retirement accounts?';
const click = (id) => page.evaluate((id) => { const e = document.querySelector(`[data-testid="${id}"]`); if (e) { e.click(); return true; } return false; }, id);

await page.keyboard.press('Escape');
// open the client into the Search surface
await page.evaluate((m) => window.dispatchEvent(new CustomEvent('keepance:matter-launch', { detail: { matterId: m, surface: 'search' } })), MATTER);
await page.waitForTimeout(2500);
const active = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem('keepance:matters') || '{}'); return m?.state?.activeMatterId; });
console.log('active matter:', active);
// new search (clear), email scope
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'New search'); if (b) b.click(); });
await page.waitForTimeout(500);
await click('scope-toggle'); await page.waitForTimeout(400);
await click('scope-option-email'); await page.waitForTimeout(400);
await page.fill('[data-testid="ask-composer-input"]', Q).catch(async () => { await page.type('[data-testid="ask-composer-input"]', Q); });
await page.keyboard.press('Enter');
console.log('asked (matter-scoped):', Q);

let res = null;
for (let i = 0; i < 45; i++) {
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => ({
    cited: document.querySelectorAll('[data-testid="ask-cited-attestation"]').length,
    uncited: document.querySelectorAll('[data-testid="ask-uncited-warning"]').length,
    chips: document.querySelectorAll('[data-testid^="ask-citation-chip"]').length,
    busy: /Searching…|Answering…/.test(document.body.innerText),
  }));
  if (!st.busy && (st.cited || st.uncited || st.chips)) { res = st; break; }
}
console.log('RESULT:', JSON.stringify(res));
const ans = await page.evaluate((q) => { const t = (document.querySelector('main') || document.body).innerText; const i = t.lastIndexOf(q.slice(0, 20)); return t.slice(i, i + 600); }, Q);
console.log('--- ANSWER ---\n' + ans);
await page.screenshot({ path: `${SHOT}/ask-matter-scoped.png` });
process.exit(0);
