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
import {
  installLocalOnlyEgressTripwire,
  localOnlyEgressVerdict,
} from './robot/fixtures/egressGuard.mjs';

// The Tauri debug bridge port. Overridable (matching the app's
// LANTERN_DEV_BRIDGE_PORT) so several app instances can be driven side by side.
const BRIDGE_PORT = process.env.LANTERN_DEV_BRIDGE_PORT || '9250';
// Keep the command-line driver and the Rust bridge on the same configurable
// deadline.  A test can still pass a more specific `timeout_ms` to one bridge
// request, but normal driving should never silently fall back to an old,
// hard-coded five-second limit.
const BRIDGE_TIMEOUT_MS = process.env.LANTERN_DEV_BRIDGE_TIMEOUT_MS || '20000';
// In Linux bridge mode callers set LANTERN_DEV_BRIDGE_PORT for BOTH the app
// and this driver.  Keep DESKTOP_CDP_PORT as an explicit override for the
// Windows CDP path, but never silently dial its old 9223 default after a
// caller has selected a bridge port.
const PORT = process.env.DESKTOP_CDP_PORT || BRIDGE_PORT;
const CDP_HOSTS = (process.env.DESKTOP_CDP_HOSTS || process.env.DESKTOP_CDP_HOST || '127.0.0.1,localhost,[::1]')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);
const APP_URL_RE = /(?:localhost|127\.0\.0\.1|\[::1\]):5173/;

function byTestId(testId) {
  return `[data-testid="${String(testId).replace(/"/g, '\\"')}"]`;
}

async function clickByTestIdIfPresent(page, testId, { timeout = 3000 } = {}) {
  const locator = page.locator(byTestId(testId)).first();
  if ((await locator.count().catch(() => 0)) === 0) return false;
  await locator.click({ timeout });
  return true;
}

async function ensureLocalOnlyMode(page) {
  await page.locator(byTestId('settings-gear')).click({ timeout: 8000 });
  await page.locator(byTestId('settings-category-ai')).click({ timeout: 8000 });
  await page.locator(byTestId('confidentiality-mode-local-only')).click({ timeout: 8000 });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="confidentiality-mode-settings"]')
        ?.getAttribute('data-active-mode') === 'local-only',
    null,
    { timeout: 8000 },
  );
  return page.locator(byTestId('egress-indicator-label')).first().textContent({ timeout: 3000 }).catch(() => '');
}

async function revertToCloudMode(page) {
  await page.locator(byTestId('settings-gear')).click({ timeout: 8000 }).catch(() => {});
  await page.locator(byTestId('settings-category-ai')).click({ timeout: 8000 }).catch(() => {});
  await page.locator(byTestId('confidentiality-mode-direct')).click({ timeout: 8000 }).catch(() => {});
}

async function runLocalOnlyEgressWalk(page) {
  const localLabel = await ensureLocalOnlyMode(page);
  const guard = await installLocalOnlyEgressTripwire(page);
  const walked = [];

  if (await clickByTestIdIfPresent(page, 'spine-nav-search')) {
    walked.push('Ask');
    await page
      .waitForSelector(
        `${byTestId('ask-composer-input')},${byTestId('hub-ask-input')},${byTestId('egress-indicator-composer')}`,
        { timeout: 8000 },
      )
      .catch(() => {});
    await clickByTestIdIfPresent(page, 'scope-toggle', { timeout: 2000 }).catch(() => false);
  }

  if (await clickByTestIdIfPresent(page, 'spine-nav-workflows')) {
    walked.push('Workflows');
    await page.waitForTimeout(500);
  }

  if (await clickByTestIdIfPresent(page, 'spine-nav-matters')) {
    walked.push('Clients');
    await page.waitForTimeout(500);
  }

  const verdict = localOnlyEgressVerdict({ violations: guard.violations });
  await revertToCloudMode(page);

  return {
    ok: verdict.ok,
    localLabel: String(localLabel || '').trim(),
    walked,
    violations: verdict.violations,
    violationCount: verdict.violationCount,
  };
}

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
  if (path === '/eval' && !url.searchParams.has('timeout_ms')) {
    url.searchParams.set('timeout_ms', BRIDGE_TIMEOUT_MS);
  }
  // A Vite hot reload or a real desktop relaunch can land between the bridge
  // accepting a request and the WebView becoming ready to evaluate it. Retry
  // only that short, known transient instead of misreporting a healthy screen
  // as unwired. All ordinary selector/action failures still surface directly.
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url);
      const body = await response.json();
      if (response.ok && body.ok) return body.result;
      const error = new Error(body.error || `Desktop bridge ${path} failed`);
      if (!String(error.message).includes('eval code@')) throw error;
      lastError = error;
    } catch (error) {
      if (!(error instanceof Error) || (!error.message.includes('eval code@') && !error.message.includes('fetch failed'))) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError ?? new Error(`Desktop bridge ${path} failed`);
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

if (PORT === BRIDGE_PORT || process.env.LANTERN_DEV_BRIDGE_PORT) {
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
      case 'setfiles': {
        // args[0] = '|'-separated absolute paths to set on the first visible
        // input[type=file] on the page (test-driving helper; bypasses the
        // native OS file picker so a headless bench can drive uploads).
        const paths = args[0].split('|').filter(Boolean);
        const input = page.locator('input[type="file"]').first();
        await input.setInputFiles(paths, { timeout: 8000 });
        console.log('set files: ' + paths.join(', '));
        break;
      }
      case 'consolewatch': {
        // args[0] = seconds to listen. Prints every browser console message
        // seen during the window (diagnostic helper; does not click anything).
        const seconds = Number(args[0]) || 20;
        const lines = [];
        const onMsg = (msg) => lines.push(`[${msg.type()}] ${msg.text()}`);
        page.on('console', onMsg);
        await page.waitForTimeout(seconds * 1000);
        page.off('console', onMsg);
        console.log(JSON.stringify(lines, null, 2));
        break;
      }
      case 'local-only-egress-walk': {
        const result = await runLocalOnlyEgressWalk(page);
        console.log(JSON.stringify(result, null, 2));
        break;
      }
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
