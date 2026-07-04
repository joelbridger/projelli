#!/usr/bin/env node
// scripts/desktop-drive.mjs — drive the Keepance DESKTOP app (Tauri/WebView2) over CDP.
//
// THE BRIDGE: the desktop app's UI is a WebView2 (Chromium). Launched with
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223
// on a bench, it exposes the Chrome DevTools Protocol. With an SSH tunnel from
// this server to the bench:
//   ssh -N -L 9444:localhost:9223 james@100.127.67.22
// this script connects Playwright to it and drives the REAL desktop app by the
// app's own data-testid attributes — exactly like driving the browser.
//
// Usage:
//   node scripts/desktop-drive.mjs pages                      # list webview pages
//   node scripts/desktop-drive.mjs url                        # current page URL
//   node scripts/desktop-drive.mjs snapshot                   # interactive testids + text
//   node scripts/desktop-drive.mjs click <testid>
//   node scripts/desktop-drive.mjs type <testid> "<text>" [--submit]
//   node scripts/desktop-drive.mjs type-stdin <testid> [--submit]
//   node scripts/desktop-drive.mjs eval "<js expression>"     # runs in the app, prints result
//   node scripts/desktop-drive.mjs screenshot <path.jpeg>     # via CDP (works even if window hidden)
//   node scripts/desktop-drive.mjs waitfor "<text>" [seconds]
//
// Env: DESKTOP_CDP_PORT (default 9444, the tunnel port on this server).
import { chromium } from 'playwright';

const PORT = process.env.DESKTOP_CDP_PORT || '9444';
const BASE = `http://localhost:${PORT}`;

async function getBrowser() {
  // /json/version returns a ws URL pointing at the bench's own :9223; rewrite
  // its host:port to our tunnel port so the connection goes through the tunnel.
  const info = await (await fetch(`${BASE}/json/version`)).json();
  const ws = info.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//, `ws://localhost:${PORT}/`);
  return chromium.connectOverCDP(ws);
}

function pickPage(browser) {
  // The Keepance main window loads from the Vite dev server (localhost:5173).
  // Prefer that; fall back to the first non-devtools page.
  const pages = browser.contexts().flatMap((c) => c.pages());
  return (
    pages.find((p) => /localhost:5173/.test(p.url()) && !/connector|account-window/i.test(p.url())) ||
    pages.find((p) => /localhost:5173|index\.html|tauri/i.test(p.url())) ||
    pages.find((p) => !/devtools/i.test(p.url())) ||
    pages[0] ||
    null
  );
}

async function readStdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

const [cmd, ...args] = process.argv.slice(2);
const browser = await getBrowser();
try {
  if (cmd === 'pages') {
    const out = [];
    for (const c of browser.contexts()) for (const p of c.pages()) out.push({ url: p.url(), title: await p.title().catch(() => '') });
    console.log(JSON.stringify(out, null, 2));
  } else {
    const page = pickPage(browser);
    if (!page) throw new Error('No Keepance webview page found');
    switch (cmd) {
      case 'url':
        console.log(page.url());
        break;
      case 'snapshot': {
        const data = await page.evaluate(() => {
          const els = [...document.querySelectorAll('[data-testid], button, a, [role="button"], input, textarea')];
          return els
            .map((e) => ({
              testid: e.getAttribute('data-testid') || undefined,
              tag: e.tagName.toLowerCase(),
              text: (e.textContent || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').trim().slice(0, 60) || undefined,
            }))
            .filter((x) => x.testid || x.text)
            .slice(0, 250);
        });
        console.log(JSON.stringify(data, null, 2));
        break;
      }
      case 'click':
        await page.click(`[data-testid="${args[0]}"]`, { timeout: 8000 });
        console.log('clicked [data-testid="' + args[0] + '"]');
        break;
      case 'type': {
        const sel = `[data-testid="${args[0]}"]`;
        await page.fill(sel, args[1] ?? '');
        if (args.includes('--submit')) await page.press(sel, 'Enter');
        console.log('typed into ' + sel + (args.includes('--submit') ? ' + Enter' : ''));
        break;
      }
      case 'type-stdin': {
        const sel = `[data-testid="${args[0]}"]`;
        const text = await readStdinText();
        await page.fill(sel, text);
        const actual = await page.locator(sel).inputValue();
        if (actual !== text) {
          throw new Error(`type-stdin mismatch for ${sel}: expected ${text.length} chars, got ${actual.length} chars`);
        }
        if (args.includes('--submit')) await page.press(sel, 'Enter');
        console.log('typed ' + actual.length + ' chars into ' + sel + (args.includes('--submit') ? ' + Enter' : ''));
        break;
      }
      case 'eval': {
        const r = await page.evaluate(args[0]);
        console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2));
        break;
      }
      case 'screenshot':
        await page.screenshot({ path: args[0], type: 'jpeg', quality: 80 });
        console.log('screenshot -> ' + args[0]);
        break;
      case 'waitfor':
        await page.getByText(args[0]).first().waitFor({ timeout: (Number(args[1]) || 15) * 1000 });
        console.log('found: ' + args[0]);
        break;
      default:
        console.error('unknown command: ' + cmd);
        process.exitCode = 2;
    }
  }
} finally {
  // Disconnect CDP WITHOUT closing the app (connectOverCDP.close() only detaches).
  await browser.close().catch(() => {});
}
