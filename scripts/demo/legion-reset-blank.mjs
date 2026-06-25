#!/usr/bin/env node
// legion-reset-blank.mjs — TRUE FIRST-RUN ("blank") state for the build-it-live demo.
// Clears ALL localStorage and writes NO seed, so the app boots into the first-run
// onboarding wizard with zero clients and zero recent workspaces (App.tsx shows the
// FirstRunWizard when onboarding is incomplete AND recentWorkspaces is empty).
// The OS-keychain AI key is left intact, so "ask" works immediately after a live
// import without typing an API key on stage. Pair with legion-demo-blank.sh, which
// also force-restarts the app. Mirrors legion-reset.mjs but seeds nothing.
import { chromium } from 'playwright';
const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const BASE = `http://localhost:${PORT}`;
async function getBrowser() {
  const i = await (await fetch(`${BASE}/json/version`)).json();
  const ws = i.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//, `ws://localhost:${PORT}/`);
  return chromium.connectOverCDP(ws);
}
function pickPage(b) {
  const p = b.contexts().flatMap((c) => c.pages());
  return p.find((x) => /localhost:5173/.test(x.url()) && !/connector|account-window/i.test(x.url())) || p.find((x) => /localhost:5173/.test(x.url())) || p[0] || null;
}
const browser = await getBrowser();
const page = pickPage(browser);
if (!page) { console.error('no page'); process.exit(2); }
const out = await page.evaluate(() => {
  const beforeKeys = localStorage.length;
  localStorage.clear();
  return { beforeKeys, afterKeys: localStorage.length };
});
console.log(JSON.stringify(out, null, 2));
await browser.close().catch(() => {});
