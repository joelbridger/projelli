import { getPage } from '../robot/connection.mjs';
const page = await getPage();

// 1) Is Tauri invoke reachable from page context?
const tauri = await page.evaluate(() => {
  const w = window;
  return {
    hasGlobalTauri: !!w.__TAURI__,
    invokePath: w.__TAURI__ ? (w.__TAURI__.core ? 'core.invoke' : (w.__TAURI__.invoke ? 'invoke' : 'unknown')) : null,
    keys: w.__TAURI__ ? Object.keys(w.__TAURI__) : [],
  };
});
console.log('TAURI:', JSON.stringify(tauri));

// 2) look for any sync testid / button across the email + connections UI
await page.evaluate(() => window.dispatchEvent(new CustomEvent('keepance:open-account', { detail: { tab: 'connections' } })));
await page.waitForTimeout(1500);
const ui = await page.evaluate(() => {
  const ids = [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid'));
  const syncish = ids.filter((x) => /sync|import|refresh/i.test(x));
  const buttons = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter((t) => t && t.length < 30);
  return { syncTestids: syncish, buttons: [...new Set(buttons)].slice(0, 25) };
});
console.log('UI:', JSON.stringify(ui, null, 2));
process.exit(0);
