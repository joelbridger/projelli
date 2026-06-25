import { getPage } from '../robot/connection.mjs';
const page = await getPage();
const SHOT = '/tmp/claude-1000/-home-jameson/dadc9abc-0cc3-4e6a-9a49-136a3006e1b0/scratchpad';

async function clickTestid(id) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el) { el.click(); return true; }
    return false;
  }, id);
}

// 1) Go to Search/Ask
console.log('nav search:', await clickTestid('spine-nav-search'));
await page.waitForTimeout(1500);

// 2) Inspect Ask UI testids + scope chips
const ui = await page.evaluate(() => {
  const ids = [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid'));
  return {
    askIds: ids.filter((x) => /ask|scope|compos|search|citation/i.test(x)),
    hasEmailScope: ids.includes('scope-option-email'),
  };
});
console.log('ASK UI:', JSON.stringify(ui, null, 2));
await page.screenshot({ path: `${SHOT}/ask-1.png` });
process.exit(0);
