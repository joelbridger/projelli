import { getPage } from '../robot/connection.mjs';
const page = await getPage();
const ls = await page.evaluate(() => localStorage.getItem('keepance_recent_workspaces'));
console.log('localStorage recent:', ls);
const onSel = await page.$('[data-testid="workspace-selector-dialog"]');
console.log('onSelector:', !!onSel);
let rows = await page.$$('[data-testid="recent-workspace-row"]');
if (rows.length === 0) {
  for (let i = 0; i < 5; i++) { await page.click('[data-testid="recent-workspaces-toggle"]').catch(() => {}); await page.waitForTimeout(700); rows = await page.$$('[data-testid="recent-workspace-row"]'); if (rows.length) break; }
}
const txts = [];
for (const r of rows) txts.push((await r.innerText().catch(() => '')).replace(/\n/g, ' ').slice(0, 60));
console.log('rows:', JSON.stringify(txts));
process.exit(0);
