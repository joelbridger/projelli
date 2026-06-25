// QA the BLANK build-up: from the blank picker, open C:\keepance-demo-blank,
// confirm the Brennan client folder + files appear and indexing runs.
import { getPage } from '../robot/connection.mjs';
const page = await getPage();

// seed the blank workspace into recent + mark onboarding done (skip any wizard gate for QA)
await page.evaluate(() => {
  localStorage.setItem('keepance_recent_workspaces', JSON.stringify([{ path: 'C:/keepance-demo-blank', name: 'keepance-demo-blank', lastOpened: '2026-06-25T17:30:00.000Z' }]));
  localStorage.setItem('keepance_onboarding_complete', 'true');
});
await page.evaluate(() => location.reload());
await page.waitForTimeout(5000);

async function rowCount() { return page.$$eval('[data-testid="recent-workspace-row"]', (e) => e.length).catch(() => 0); }
if (await page.$('[data-testid="workspace-selector-dialog"]')) {
  for (let i = 0; i < 5 && (await rowCount()) === 0; i++) { await page.click('[data-testid="recent-workspaces-toggle"]').catch(() => {}); await page.waitForTimeout(700); }
  const rows = await page.$$('[data-testid="recent-workspace-row"]');
  if (rows.length) await rows[0].click();
  await page.waitForTimeout(7000);
}
for (let i = 0; i < 4; i++) { const t = await page.$('[data-testid="feature-tour-center"]'); if (t) { await page.click('[data-testid="feature-tour-skip"]').catch(() => page.keyboard.press('Escape')); await page.waitForTimeout(500); } else break; }
await page.waitForTimeout(1500);

const v = await page.evaluate(() => {
  const txt = document.body.innerText;
  return {
    workspaceOpen: !!document.querySelector('[data-testid="spine-nav-documents"]') || !!document.querySelector('[data-testid="spine-nav-matters"]'),
    showsBrennan: txt.includes('Brennan'),
    showsFiles: ['Account Summary', 'Intake Notes', 'Advisor Recommendations', 'Estate'].filter((f) => txt.includes(f)),
    indexing: /Indexing/i.test(txt),
    head: txt.split('\n').filter((l) => l.trim()).slice(0, 12),
  };
});
await page.screenshot({ path: 'C:/Users/james/qa-blank-open.png' });
console.log(JSON.stringify(v, null, 2));
process.exit(0);
