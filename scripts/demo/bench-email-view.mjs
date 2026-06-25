import { getPage } from '../robot/connection.mjs';
const page = await getPage();
const SHOT = '/tmp/claude-1000/-home-jameson/dadc9abc-0cc3-4e6a-9a49-136a3006e1b0/scratchpad';
const click = (id) => page.evaluate((id) => { const e = document.querySelector(`[data-testid="${id}"]`); if (e) { e.click(); return true; } return false; }, id);

await page.keyboard.press('Escape');
console.log('nav email:', await click('spine-nav-email'));
await page.waitForTimeout(4000);
const info = await page.evaluate(() => {
  const t = document.body.innerText;
  const names = ['Thomas Brennan','Priya Patel','Eleanor Voss','Carol Greer','Gary York','Susan Nakamura'];
  return {
    present: names.filter((n) => t.includes(n)),
    countRows: document.querySelectorAll('[data-testid^="mail-"],[data-testid^="email-row"],[role="listitem"]').length,
    snippet: t.split('\n').filter((l)=>l.trim()).slice(0, 20),
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: `${SHOT}/email-view.png` });
process.exit(0);
