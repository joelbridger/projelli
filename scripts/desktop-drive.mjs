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
// Env: DESKTOP_CDP_PORT (default 9223 on the bench; set 9444 only when using a local tunnel).
//      DESKTOP_CDP_HOSTS comma-list is optional; defaults to 127.0.0.1,localhost,[::1].
import { chromium } from 'playwright';

const PORT = process.env.DESKTOP_CDP_PORT || '9223';
const CDP_HOSTS = (process.env.DESKTOP_CDP_HOSTS || process.env.DESKTOP_CDP_HOST || '127.0.0.1,localhost,[::1]')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);
const APP_URL_RE = /(?:localhost|127\.0\.0\.1|\[::1\]):5173/;

function httpBase(host) {
  return `http://${host}:${PORT}`;
}

async function getBrowser() {
  // /json/version returns a ws URL pointing at the bench's own :9223; rewrite
  // its host:port to our tunnel port so the connection goes through the tunnel.
  const errors = [];
  for (const host of CDP_HOSTS) {
    try {
      const info = await (await fetch(`${httpBase(host)}/json/version`)).json();
      const ws = info.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//, `ws://${host}:${PORT}/`);
      return chromium.connectOverCDP(ws);
    } catch (err) {
      errors.push(`${host}:${PORT} ${err.message || err}`);
    }
  }
  throw new Error(`Could not reach WebView2 CDP on any configured host: ${errors.join('; ')}`);
}

function pickPage(browser) {
  // The Keepance main window loads from the Vite dev server (localhost:5173).
  // Prefer that; fall back to the first non-devtools page.
  const pages = browser.contexts().flatMap((c) => c.pages());
  return (
    pages.find((p) => APP_URL_RE.test(p.url()) && !/connector|account-window/i.test(p.url())) ||
    pages.find((p) => APP_URL_RE.test(p.url()) || /index\.html|tauri/i.test(p.url())) ||
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
// Linux Tauri uses the debug-only local bridge rather than Chromium CDP.  Keep
// the same small CLI so desktop checks do not silently fall back to a browser
// mock just because the host is not Windows.
async function bridgeRequest(path, params = {}) {
  const url = new URL(`http://127.0.0.1:${PORT}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error || `Desktop bridge ${path} failed`);
  return body.result;
}

async function runBridge() {
  switch (cmd) {
    case 'pages':
      console.log(JSON.stringify([{ url: await bridgeRequest('/url'), title: 'Tauri desktop app' }], null, 2));
      break;
    case 'url':
      console.log(await bridgeRequest('/url'));
      break;
    case 'snapshot': {
      const data = await bridgeRequest('/eval', { js: `Array.from(document.querySelectorAll('[data-testid], button, a, [role="button"], input, textarea')).map((e) => ({ testid: e.getAttribute('data-testid') || undefined, tag: e.tagName.toLowerCase(), text: (e.textContent || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').trim().slice(0, 60) || undefined })).filter((x) => x.testid || x.text).slice(0, 250)` });
      console.log(JSON.stringify(data, null, 2));
      break;
    }
    case 'click':
      await bridgeRequest('/click', { testid: args[0] });
      console.log('clicked [data-testid="' + args[0] + '"]');
      break;
    case 'type':
    case 'type-stdin': {
      const value = cmd === 'type-stdin' ? await readStdinText() : (args[1] ?? '');
      await bridgeRequest('/fill', { testid: args[0], text: value });
      if (args.includes('--submit')) {
        await bridgeRequest('/eval', { js: `document.querySelector('[data-testid="${args[0]}"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))` });
      }
      console.log('typed into [data-testid="' + args[0] + '"]');
      break;
    }
    case 'eval':
      console.log(JSON.stringify(await bridgeRequest('/eval', { js: args[0] }), null, 2));
      break;
    case 'waitfor': {
      const deadline = Date.now() + (Number(args[1]) || 15) * 1000;
      while (Date.now() < deadline) {
        const text = await bridgeRequest('/eval', { js: 'document.body.innerText' });
        if (String(text).includes(args[0])) { console.log('found: ' + args[0]); return; }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Timed out waiting for text: ${args[0]}`);
    }
    case 'screenshot':
      throw new Error('The Linux desktop bridge cannot capture pixels itself. Use the X display screenshot helper for this debug run.');
    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}

if (PORT === '9250') {
  await runBridge();
} else {
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
}
