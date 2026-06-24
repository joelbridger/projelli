#!/usr/bin/env node
// legion-seed.mjs — seed the running Keepance desktop app (over CDP on the Legion)
// with: advisor profession, PDF+OCR+memory settings on, the 26 Northcrest clients,
// and the Northcrest workspace in the recent list. Read-only DUMP if argv has --dump.
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
const DUMP = process.argv.includes('--dump');
const mattersPath = process.argv.find((a) => a.endsWith('.json')) || 'C:/northcrest_matters.json';
const WS_PATH = 'C:/keepance-demo-northcrest/Northcrest Wealth Partners';
const WS_NAME = 'Northcrest Wealth Partners';

async function getBrowser() {
  const info = await (await fetch(`${BASE}/json/version`)).json();
  const ws = info.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//, `ws://localhost:${PORT}/`);
  return chromium.connectOverCDP(ws);
}
function pickPage(browser) {
  const pages = browser.contexts().flatMap((c) => c.pages());
  return (
    pages.find((p) => /localhost:5173/.test(p.url()) && !/connector|account-window/i.test(p.url())) ||
    pages.find((p) => /localhost:5173|index\.html|tauri/i.test(p.url())) ||
    pages.find((p) => !/devtools/i.test(p.url())) ||
    pages[0] || null
  );
}

const matters = DUMP ? [] : JSON.parse(readFileSync(mattersPath, 'utf8'));
const browser = await getBrowser();
const page = pickPage(browser);
if (!page) { console.error('No webview page'); process.exit(2); }

const result = await page.evaluate(({ matters, wsPath, wsName, dump }) => {
  const dumpShapes = () => ({
    profession: localStorage.getItem('keepance_profession'),
    onboarding: localStorage.getItem('keepance_onboarding_complete'),
    settings: localStorage.getItem('keepance:settings'),
    matters: localStorage.getItem('keepance:matters'),
    recent: localStorage.getItem('keepance_recent_workspaces'),
  });
  if (dump) return { mode: 'dump', shapes: dumpShapes() };

  const out = { mode: 'seed', before: {}, after: {} };
  out.before = dumpShapes();

  // profession + onboarding
  localStorage.setItem('keepance_profession', 'advisor');
  localStorage.setItem('keepance_onboarding_complete', 'true');

  // settings: preserve persist wrapper, merge the three values on
  let s = null; try { s = JSON.parse(localStorage.getItem('keepance:settings') || 'null'); } catch (e) {}
  if (!s || typeof s !== 'object') s = { state: { values: {} }, version: 0 };
  const sState = s.state || (s.state = {});
  sState.values = Object.assign({}, sState.values || {}, {
    memoryEnabled: true,
    includePdfsInWorkspaceIndex: true,
    ocrScannedPdfs: true,
  });
  localStorage.setItem('keepance:settings', JSON.stringify(s));

  // matters: exact shape {state:{matters,activeMatterId}, version:5}
  localStorage.setItem('keepance:matters', JSON.stringify({
    state: { matters: matters, activeMatterId: null },
    version: 5,
  }));

  // recent workspaces: prepend Northcrest
  let r = []; try { r = JSON.parse(localStorage.getItem('keepance_recent_workspaces') || '[]'); } catch (e) {}
  if (!Array.isArray(r)) r = [];
  r = r.filter((w) => w && w.path !== wsPath);
  r.unshift({ path: wsPath, name: wsName, lastOpened: new Date().toISOString() });
  localStorage.setItem('keepance_recent_workspaces', JSON.stringify(r.slice(0, 10)));

  // after summary
  const mm = JSON.parse(localStorage.getItem('keepance:matters'));
  const ss = JSON.parse(localStorage.getItem('keepance:settings'));
  out.after = {
    profession: localStorage.getItem('keepance_profession'),
    mattersCount: (mm.state || mm).matters.length,
    firstMatter: (mm.state || mm).matters[0],
    settingsValues: (ss.state || ss).values,
    recentCount: JSON.parse(localStorage.getItem('keepance_recent_workspaces')).length,
  };
  return out;
}, { matters, wsPath: WS_PATH, wsName: WS_NAME, dump: DUMP });

console.log(JSON.stringify(result, null, 2));
await browser.close().catch(() => {});
