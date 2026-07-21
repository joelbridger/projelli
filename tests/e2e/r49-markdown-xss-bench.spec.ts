/**
 * R-49 BENCH — the payload driven through the REAL app, not a test harness.
 *
 * R-49 was graded a pre-deploy blocker on the CHAIN: renderer XSS +
 * `'unsafe-inline'` + `withGlobalTauri: true`. It was proven in a unit test and
 * never in a running application, which is why the row stayed open.
 *
 * This spec drives the app's real built bundle: it opens a real markdown file
 * on the real editor surface, toggles the real preview, and then interrogates
 * the REAL DOM the browser actually built — not a string this test rendered.
 *
 * WHAT IT DOES NOT CLAIM: this runs in the Playwright browser, NOT inside the
 * Tauri WebView, and `window.__TAURI__` is not present here. The renderer
 * behaviour under test (does the parser create an event-handler attribute; does
 * a `javascript:` URL survive into an href) is HTML-parsing behaviour, and the
 * production CSP is applied verbatim below — but a packaged-app drive is a
 * strictly stronger artifact and this is not one.
 *
 * The production CSP is copied from `src-tauri/tauri.conf.json` and injected on
 * the document response. Note it carries `'unsafe-inline'`, so it is NOT what
 * stops the payload — it is here for fidelity, and its presence is asserted so
 * the run cannot silently drift into a no-CSP page.
 *
 * NEGATIVE CONTROL: every "nothing happened" assertion is worthless unless the
 * same detector fires on the pre-fix markup. The control test below injects the
 * exact HTML the un-fixed `markdownToHtml` produced and REQUIRES the sentinel to
 * trip. If the control ever goes green-by-silence, this whole file is void.
 */

import { test, expect, type Page } from '@playwright/test';
import { waitForTestModeLoad, openStandaloneFile } from './helpers/test-utils';

const PRODUCTION_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; " +
  "connect-src 'self' ipc: http://ipc.localhost https://api.anthropic.com https://api.openai.com " +
  'https://generativelanguage.googleapis.com https://forms.lanternplatform.app ' +
  'https://licenses.lanternplatform.app https://api.lanternplatform.app ' +
  'wss://api.lanternplatform.app http://127.0.0.1:11434 http://127.0.0.1:18089';

/**
 * The corpus. Every one of these was a live or plausible breakout shape.
 *
 * The sentinel is `window.XSSFIRED`, deliberately spelled with NO underscores
 * and no asterisks. The first version of this spec used `window.__XSS__`, and
 * the flip run showed why that was wrong: `markdownToHtml`'s BOLD rule rewrote
 * `__XSS__` into `<strong>XSS</strong>` INSIDE the injected handler, so even
 * the vulnerable build produced a handler whose code could never run. The
 * attribute assertion still red correctly, but the sentinel would have been
 * green-by-accident on a genuinely exploitable build — a detector defeated by
 * the very pipeline it is pointed at.
 */
const PAYLOAD_MARKDOWN = [
  '# R-49 bench',
  '',
  'A [click](" onmouseover="window.XSSFIRED=1) double-quote attribute breakout.',
  '',
  "A [click](' onmouseover='window.XSSFIRED=1) single-quote attribute breakout.",
  '',
  'An [click](x onmouseover=window.XSSFIRED=1) unquoted attribute breakout.',
  '',
  'A [click](javascript:window.XSSFIRED=1) scheme payload.',
  '',
  'A [click](JaVaScRiPt:window.XSSFIRED=1) mixed-case scheme payload.',
  '',
  'A [click](#" onmouseover="window.XSSFIRED=1) breakout behind an ALLOWED prefix.',
  '',
  'An ![alt](" onerror="window.XSSFIRED=1) image src breakout.',
  '',
  'An ![" onerror="window.XSSFIRED=1](https://example.com/a.png) image alt breakout.',
  '',
  'A [click](data:text/html;base64,PHNjcmlwdD53aW5kb3cuX19YU1NfXz0xPC9zY3JpcHQ+) data URL.',
  '',
  'An ordinary [link](https://example.com/s?a=1&b=2) that must still work.',
].join('\n');

/** Arm the sentinels BEFORE any app code runs. */
async function armSentinels(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.XSSFIRED = 0;
    w.__ALERTS__ = 0;
    const realAlert = window.alert;
    window.alert = function (...args: unknown[]) {
      (window as unknown as Record<string, number>).__ALERTS__++;
      return (realAlert as unknown as (...a: unknown[]) => void).apply(window, args);
    } as typeof window.alert;
  });
  await page.route('**/*', async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    if ((headers['content-type'] ?? '').includes('text/html')) {
      headers['content-security-policy'] = PRODUCTION_CSP;
    }
    await route.fulfill({ response, headers });
  });
}

/** Read the attack surface out of the LIVE DOM inside the preview. */
async function liveAttackSurface(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="markdown-preview"]');
    if (!root) return null;
    const handlers: string[] = [];
    const urls: string[] = [];
    for (const el of Array.from(root.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        if (/^on/i.test(attr.name)) handlers.push(`${el.tagName.toLowerCase()}.${attr.name}`);
        if (/^(?:href|src|data|action|srcdoc|formaction)$/i.test(attr.name)) {
          urls.push(attr.value);
        }
      }
    }
    return { handlers, urls, html: root.innerHTML };
  });
}

/** Try hard to TRIGGER anything that did survive. Absence of a handler
 *  attribute is one claim; nothing firing when provoked is a stronger one. */
async function provoke(page: Page) {
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="markdown-preview"]');
    if (!root) return;
    for (const el of Array.from(root.querySelectorAll('*'))) {
      for (const type of ['mouseover', 'mouseenter', 'click', 'error', 'load', 'focus']) {
        el.dispatchEvent(new Event(type, { bubbles: true }));
      }
    }
  });
  await page.waitForTimeout(300);
}

async function sentinels(page: Page) {
  return page.evaluate(() => ({
    xss: (window as unknown as Record<string, number>).XSSFIRED,
    alerts: (window as unknown as Record<string, number>).__ALERTS__,
  }));
}

test.describe('R-49 — markdown preview injection, driven in the real app', () => {
  test('NEGATIVE CONTROL: the detector and sentinel fire on the PRE-FIX markup', async ({
    page,
  }) => {
    await armSentinels(page);
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // The literal markup the un-fixed markdownToHtml produced for
    // `[click](" onmouseover="…)`, inserted the same way the app inserts it.
    const control = await page.evaluate(() => {
      const host = document.createElement('div');
      host.setAttribute('data-testid', 'markdown-preview');
      host.innerHTML =
        '<a href="" onmouseover="window.XSSFIRED=1" class="text-primary">click</a>' +
        '<img src="" onerror="window.XSSFIRED=1" alt="x" />';
      document.body.appendChild(host);
      const handlers: string[] = [];
      for (const el of Array.from(host.querySelectorAll('*'))) {
        for (const attr of Array.from(el.attributes)) {
          if (/^on/i.test(attr.name)) handlers.push(`${el.tagName.toLowerCase()}.${attr.name}`);
        }
      }
      return handlers;
    });

    // The detector must SEE the pre-fix handlers.
    expect(control).toEqual(['a.onmouseover', 'img.onerror']);

    // And provoking them must actually RUN them — proving the sentinel works.
    await provoke(page);
    const fired = await sentinels(page);
    expect(fired.xss).toBe(1);
  });

  test('the payload corpus produces NO handler, NO executable URL, and fires nothing', async ({
    page,
  }, testInfo) => {
    await armSentinels(page);
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // The CSP must actually be on the document, or this run is not faithful.
    const csp = await page.evaluate(() =>
      document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'),
    );
    const cspHeader = await page.evaluate(async () => {
      const r = await fetch(window.location.href, { method: 'GET' });
      return r.headers.get('content-security-policy');
    });
    expect(csp ?? cspHeader ?? '').toContain("'unsafe-inline'");

    await openStandaloneFile(page, '/test-workspace/r49.md', 'r49.md', PAYLOAD_MARKDOWN);

    // Toggle the real preview (Alt+Z is the app's own shortcut).
    await page.keyboard.press('Alt+z');
    await expect(page.getByTestId('markdown-preview')).toBeVisible({ timeout: 15_000 });

    const surface = await liveAttackSurface(page);
    expect(surface).not.toBeNull();

    await testInfo.attach('rendered-preview.html', {
      body: surface!.html,
      contentType: 'text/html',
    });
    await page.screenshot({ path: testInfo.outputPath('r49-preview.png'), fullPage: true });

    // 1. The parser built no event-handler attribute anywhere in the preview.
    expect(surface!.handlers).toEqual([]);

    // 2. No URL that a browser would execute survived.
    const executable = surface!.urls.filter((u) =>
      /^(?:javascript|data:text\/html|vbscript)/i.test(u.replace(/[ \t\n\r]/g, '')),
    );
    expect(executable).toEqual([]);

    // 3. The ordinary link still resolves to the URL the author wrote —
    //    the regression this lane found would show up here as `&amp;`.
    expect(surface!.urls).toContain('https://example.com/s?a=1&b=2');

    // 4. Nothing fired, even when every element is provoked.
    await provoke(page);
    const fired = await sentinels(page);
    expect(fired.xss).toBe(0);
    expect(fired.alerts).toBe(0);
  });
});
