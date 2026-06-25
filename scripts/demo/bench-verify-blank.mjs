// Verify the BLANK build-up: open C:\keepance-demo-blank, confirm the Brennan client
// folder + files appear and an index runs. Run bench-local (DESKTOP_CDP_PORT=9223).
import { getPage } from '../robot/connection.mjs';
const page = await getPage();

await page.evaluate(() => {
  localStorage.setItem('keepance_recent_workspaces', JSON.stringify([{ path: 'C:/keepance-demo-blank', name: 'keepance-demo-blank', lastOpened: '2026-06-25T17:00:00.000Z' }]));
});
await page.evaluate(() => location.reload());
await page.waitForTimeout(5000);

async function rowCount() { return page.$$eval('[data-testid="recent-workspace-row"]', (e) => e.length).catch(() => 0); }
if (await page.$('[data-testid="workspace-selector-dialog"]')) {
  for (let i = 0; i < 5 && (await rowCount()) === 0; i++) { await page.click('[data-testid="recent-workspaces-toggle"]').catch(() => {}); await page.waitForTimeout(800); }
  const rows = await page.$$('[data-testid="recent-workspace-row"]');
  if (rows.length) await rows[0].click();
  await page.waitForTimeout(6000);
}
// dismiss any first-run/tour
for (let i = 0; i < 4; i++) { const t = await page.$('[data-testid="feature-tour-center"]'); if (t) { await page.click('[data-testid="feature-tour-skip"]').catch(() => page.keyboard.press('Escape')); await page.waitForTimeout(500); } else break; }
await page.waitForTimeout(2000);

const v = await page.evaluate(() => {
  const txt = document.body.innerText;
  return {
    workspaceOpen: !!document.querySelector('[data-testid="spine-nav-matters"]') || !!document.querySelector('[data-testid="spine-nav-documents"]'),
    showsBrennanFolder: txt.includes('Brennan'),
    showsFiles: ['Account Summary', 'Intake Notes', 'Advisor Recommendations'].filter((f) => txt.includes(f)),
    indexing: /Indexing|index/i.test(txt),
  };
});
console.log('BLANK VERIFY:', JSON.stringify(v, null, 2));
process.exit(0);
