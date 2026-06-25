// Clear the persisted active matter so Ask retrieves across ALL clients (global),
// then reopen the Northcrest workspace. Email scope then filters allMatters -> mail.
import { getPage } from '../robot/connection.mjs';
const page = await getPage();

const before = await page.evaluate(() => {
  const raw = localStorage.getItem('keepance:matters');
  let m; try { m = JSON.parse(raw); } catch { m = null; }
  const cur = m?.state?.activeMatterId ?? m?.activeMatterId ?? null;
  if (m && m.state) m.state.activeMatterId = null; else if (m) m.activeMatterId = null;
  if (m) localStorage.setItem('keepance:matters', JSON.stringify(m));
  return cur;
});
console.log('activeMatterId was:', before, '-> set null');

await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(4000);

// reopen Northcrest from picker
async function rowCount() { return page.$$eval('[data-testid="recent-workspace-row"]', (e) => e.length).catch(() => 0); }
const onSel = await page.$('[data-testid="workspace-selector-dialog"]');
if (onSel) {
  for (let i = 0; i < 4 && (await rowCount()) === 0; i++) { await page.click('[data-testid="recent-workspaces-toggle"]').catch(() => {}); await page.waitForTimeout(800); }
  for (const r of await page.$$('[data-testid="recent-workspace-row"]')) {
    const t = await r.innerText().catch(() => ''); if (/Northcrest/.test(t)) { await r.click(); break; }
  }
  await page.waitForTimeout(5000);
}
for (let i = 0; i < 4; i++) { const tour = await page.$('[data-testid="feature-tour-center"]'); if (tour) { await page.click('[data-testid="feature-tour-skip"]').catch(() => page.keyboard.press('Escape')); await page.waitForTimeout(500); } else break; }
await page.waitForSelector('[data-testid="spine-nav-matters"]', { timeout: 30000 }).catch(() => {});
const after = await page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem('keepance:matters') || '{}');
  return { activeMatterId: m?.state?.activeMatterId ?? null, workspaceOpen: !!document.querySelector('[data-testid="spine-nav-matters"]') };
});
console.log('AFTER:', JSON.stringify(after));
process.exit(0);
