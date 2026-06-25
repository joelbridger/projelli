// Reopen the Northcrest workspace from the picker (no reset/reseed).
import { getPage } from '../robot/connection.mjs';
const page = await getPage();

async function rowCount() {
  return page.$$eval('[data-testid="recent-workspace-row"]', (e) => e.length).catch(() => 0);
}
const onSelector = await page.$('[data-testid="workspace-selector-dialog"]');
console.log('on picker:', !!onSelector);
if (onSelector) {
  for (let i = 0; i < 4 && (await rowCount()) === 0; i++) {
    await page.click('[data-testid="recent-workspaces-toggle"]').catch(() => {});
    await page.waitForTimeout(800);
  }
  const rows = await page.$$('[data-testid="recent-workspace-row"]');
  let clicked = false;
  for (const r of rows) {
    const t = await r.innerText().catch(() => '');
    if (/Northcrest/.test(t)) { await r.click(); clicked = true; break; }
  }
  console.log('clicked Northcrest row:', clicked);
  await page.waitForTimeout(5000);
}
// dismiss tour if any
for (let i = 0; i < 4; i++) {
  const tour = await page.$('[data-testid="feature-tour-center"]');
  if (tour) { await page.click('[data-testid="feature-tour-skip"]').catch(() => page.keyboard.press('Escape')); await page.waitForTimeout(500); } else break;
}
await page.waitForSelector('[data-testid="spine-nav-matters"]', { timeout: 30000 }).catch(() => {});
const v = await page.evaluate(() => {
  const tids = new Set([...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')));
  const m = JSON.parse(localStorage.getItem('keepance:matters') || '{}');
  return { workspaceOpen: tids.has('spine-nav-matters'), matters: ((m.state ? m.state.matters : m.matters) || []).length, hasNorthcrest: document.body.innerText.includes('Northcrest') };
});
console.log('VERIFY:', JSON.stringify(v));
process.exit(0);
