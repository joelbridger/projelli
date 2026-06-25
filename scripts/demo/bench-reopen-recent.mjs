// Reopen the (single) most-recent workspace — it holds the index + mail.
import { getPage } from '../robot/connection.mjs';
const page = await getPage();
async function rowCount() { return page.$$eval('[data-testid="recent-workspace-row"]', (e) => e.length).catch(() => 0); }
const onSel = await page.$('[data-testid="workspace-selector-dialog"]');
console.log('on picker:', !!onSel);
for (let i = 0; i < 4 && (await rowCount()) === 0; i++) { await page.click('[data-testid="recent-workspaces-toggle"]').catch(() => {}); await page.waitForTimeout(800); }
const rows = await page.$$('[data-testid="recent-workspace-row"]');
console.log('recent rows:', rows.length);
if (rows.length) { await rows[0].click(); }
await page.waitForTimeout(6000);
for (let i = 0; i < 4; i++) { const tour = await page.$('[data-testid="feature-tour-center"]'); if (tour) { await page.click('[data-testid="feature-tour-skip"]').catch(() => page.keyboard.press('Escape')); await page.waitForTimeout(500); } else break; }
await page.waitForSelector('[data-testid="spine-nav-matters"]', { timeout: 30000 }).catch(() => {});
const v = await page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem('keepance:matters') || '{}');
  return {
    workspaceOpen: !!document.querySelector('[data-testid="spine-nav-matters"]'),
    activeMatterId: m?.state?.activeMatterId ?? null,
    matters: ((m.state ? m.state.matters : m.matters) || []).length,
    clientsShown: document.body.innerText.includes('Brennan') || document.body.innerText.includes('Caldwell'),
  };
});
console.log('VERIFY:', JSON.stringify(v));
process.exit(0);
