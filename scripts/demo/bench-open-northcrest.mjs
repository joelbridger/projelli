// Restore the correct demo workspace (Northcrest Wealth Partners) in the recent list,
// clear active matter, reload to picker, open it. Then verify mail is retrievable.
import { getPage, reconnect } from '../robot/connection.mjs';
import { readFileSync } from 'fs';

const seed = JSON.parse(readFileSync(new URL('./seed-loaded.json', import.meta.url)));
const recent = seed.recentWorkspaces; // [{path, name, lastOpened}]
let page = await getPage();

await page.evaluate((recent) => {
  localStorage.setItem('keepance_recent_workspaces', JSON.stringify(recent));
  const m = JSON.parse(localStorage.getItem('keepance:matters') || '{}');
  if (m.state) m.state.activeMatterId = null; else m.activeMatterId = null;
  localStorage.setItem('keepance:matters', JSON.stringify(m));
}, recent);
console.log('set recent ->', recent[0].path);

await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(4000);
// reconnect in case the reload detached
try { page = await reconnect(); } catch { page = await getPage(); }

async function rowCount() { return page.$$eval('[data-testid="recent-workspace-row"]', (e) => e.length).catch(() => 0); }
if (await page.$('[data-testid="workspace-selector-dialog"]')) {
  for (let i = 0; i < 5 && (await rowCount()) === 0; i++) { await page.click('[data-testid="recent-workspaces-toggle"]').catch(() => {}); await page.waitForTimeout(800); }
  for (const r of await page.$$('[data-testid="recent-workspace-row"]')) {
    const t = await r.innerText().catch(() => ''); if (/Northcrest/.test(t)) { await r.click(); break; }
  }
  await page.waitForTimeout(6000);
}
for (let i = 0; i < 4; i++) { const tour = await page.$('[data-testid="feature-tour-center"]'); if (tour) { await page.click('[data-testid="feature-tour-skip"]').catch(() => page.keyboard.press('Escape')); await page.waitForTimeout(500); } else break; }
await page.waitForSelector('[data-testid="spine-nav-matters"]', { timeout: 30000 }).catch(() => {});
const v = await page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem('keepance:matters') || '{}');
  const rw = JSON.parse(localStorage.getItem('keepance_recent_workspaces') || '[]');
  return { workspaceOpen: !!document.querySelector('[data-testid="spine-nav-matters"]'), activeMatterId: m?.state?.activeMatterId ?? null, openPath: rw[0]?.path };
});
console.log('VERIFY:', JSON.stringify(v));
process.exit(0);
