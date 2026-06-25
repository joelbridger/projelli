import { getPage } from '../robot/connection.mjs';
const page = await getPage();

// Attach a progress listener that accumulates into window for later read.
await page.evaluate(() => {
  window.__mailProg = [];
  if (window.__TAURI__?.event?.listen) {
    window.__TAURI__.event.listen('mail-sync-progress', (e) => { window.__mailProg.push(e.payload); });
  }
});

console.log('Invoking mail_sync_all (m365)...');
const res = await page.evaluate(async () => {
  try {
    const out = await window.__TAURI__.core.invoke('mail_sync_all', { matterMap: [], onlyProvider: 'm365' });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, err: String(e) };
  }
});
console.log('SYNC RESULT:', JSON.stringify(res).slice(0, 800));

await page.waitForTimeout(4000);
const prog = await page.evaluate(() => (window.__mailProg || []).slice(-6));
console.log('PROGRESS TAIL:', JSON.stringify(prog).slice(0, 800));
process.exit(0);
