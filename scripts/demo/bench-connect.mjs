// Open Account -> Connections on the bench app, report state across all webview pages.
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9444';
const base = `http://127.0.0.1:${PORT}`;
const info = await (await fetch(`${base}/json/version`)).json();
const ws = info.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//, `ws://127.0.0.1:${PORT}/`);
const browser = await chromium.connectOverCDP(ws);
const pages = browser.contexts().flatMap((c) => c.pages());

// main app page
const main = pages.find((p) => /localhost:5173/.test(p.url()) && !/account|connector/i.test(p.url())) || pages[0];
console.log('MAIN URL:', main.url());
await main.evaluate(() => window.dispatchEvent(new CustomEvent('keepance:open-account', { detail: { tab: 'connections' } })));
await main.waitForTimeout(2500);

// re-enumerate (account window may have opened as a new page)
const pages2 = browser.contexts().flatMap((c) => c.pages());
for (const p of pages2) {
  let info2;
  try {
    info2 = await p.evaluate(() => {
      const t = document.body ? document.body.innerText : '';
      const has = (s) => t.includes(s);
      const testids = [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')).filter((x) => /mail|email|connect|sync|account/i.test(x));
      return {
        url: location.href,
        microsoft365: has('Microsoft 365'),
        connectBtn: has('Connect Microsoft 365'),
        connected: has('Connected') || has('Disconnect') || has('Sync now') || has('Last synced'),
        snippet: t.split('\n').filter((l) => /microsoft|mail|email|connect|sync|import/i.test(l)).slice(0, 8),
        testids,
      };
    });
  } catch (e) { info2 = { url: p.url(), err: String(e) }; }
  if (info2.microsoft365 || info2.connectBtn || (info2.testids && info2.testids.length)) {
    console.log('--- CONNECTIONS PAGE ---');
    console.log(JSON.stringify(info2, null, 2));
  }
}
await browser.close().catch(() => {});
process.exit(0);
