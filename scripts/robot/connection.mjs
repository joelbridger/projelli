// scripts/robot/connection.mjs
import { chromium } from 'playwright';

const DEFAULT_PORT = process.env.DESKTOP_CDP_PORT || '9444';

export function pickPage(pages) {
  return (
    pages.find((p) => /localhost:5173/.test(p.url) && !/connector|account-window/i.test(p.url)) ||
    pages.find((p) => /localhost:5173|index\.html|tauri/i.test(p.url)) ||
    pages.find((p) => !/devtools/i.test(p.url)) ||
    pages[0] ||
    null
  );
}

let _browser = null;
let _page = null;

async function connect(port) {
  // Use 127.0.0.1, NOT localhost: Node's fetch resolves localhost to ::1 (IPv6)
  // first, but the SSH tunnel (ssh -L) binds 127.0.0.1 (IPv4). localhost => fetch failed.
  const base = `http://127.0.0.1:${port}`;
  const info = await (await fetch(`${base}/json/version`)).json();
  const ws = info.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//, `ws://127.0.0.1:${port}/`);
  const browser = await chromium.connectOverCDP(ws);
  const pages = browser.contexts().flatMap((c) => c.pages());
  const picked = pickPage(pages.map((p) => ({ url: p.url(), _p: p })));
  const page = picked ? picked._p : null;
  if (!page) { await browser.close().catch(() => {}); throw new Error('No Keepance webview page found'); }
  return { browser, page };
}

export async function getPage(opts = {}) {
  const port = opts.port || DEFAULT_PORT;
  if (_page && !_page.isClosed()) return _page;
  ({ browser: _browser, page: _page } = await connect(port));
  return _page;
}

export async function reconnect(opts = {}) {
  await disconnect();
  return getPage(opts);
}

export async function disconnect() {
  if (_browser) { await _browser.close().catch(() => {}); } // close() only DETACHES over CDP
  _browser = null; _page = null;
}
