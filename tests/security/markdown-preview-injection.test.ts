// Security regression: HTML injection through the document markdown preview.
//
// THE DEFECT (runtime-proven by the injection-chain lane, c34): the hand-rolled
// markdown renderer in src/features/documents/editor/MarkdownPreview.tsx inserted
// link/image URLs (and image alt text) into href="…"/src="…"/alt="…" WITHOUT
// escaping the attribute-terminating double quote and WITHOUT validating the URL
// scheme. A `.md`/`.txt` file opened in preview could therefore break out of the
// attribute and inject live event-handler attributes (onerror, onanimationstart,
// onmouseover) or a `javascript:` URL — attacker JS executing in the app under a
// CSP that permits 'unsafe-inline'.
//
// This suite feeds a battery of injection payloads through the REAL
// renderMarkdownToHtml and asserts the produced DOM is inert BY CONSTRUCTION.
//
// The detector + payload battery below are written to be RENDER-AGNOSTIC so the
// app-wide DOM-sink sweep can reuse them against other renderers: findInjections
// / runsCanary inspect produced HTML (they don't know or care it came from
// markdown), and INJECTION_PAYLOADS exposes the raw attack strings. This file
// only wires them to the markdown-preview renderer — extending to other sinks is
// out of scope here, but the machinery is not hard-wired to markdown.
//
// A PERMANENT NEGATIVE CONTROL (final describe block) runs the identical detector
// against a deliberately-vulnerable render and REQUIRES it to catch the injection
// — so a green "inert" result can never be vacuous.

import { describe, it, expect } from 'vitest';
import { renderMarkdownToHtml } from '../../src/features/documents/editor/MarkdownPreview';

// ===========================================================================
// REUSABLE DOM-INERTNESS DETECTOR (render-agnostic — operates on produced HTML)
// ===========================================================================

/**
 * Return a list of live-injection sinks found in `html`. Empty ⇒ inert.
 * Reusable across any renderer that produces an HTML string.
 */
export function findInjections(html: string): string[] {
  const container = document.createElement('div');
  container.innerHTML = html;
  const problems: string[] = [];

  // 1. No <script> elements.
  const scripts = container.querySelectorAll('script');
  if (scripts.length > 0) problems.push(`<script> element present (${scripts.length})`);

  const all = Array.from(container.querySelectorAll('*'));

  // 2. No on* event-handler attribute anywhere.
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) {
        problems.push(`event-handler attribute ${attr.name} on <${el.tagName.toLowerCase()}>`);
      }
    }
  }

  // 3. No dangerous URL scheme in any href/src/xlink:href. Normalize the way a
  //    browser does before scheme parsing (strip control chars + spaces,
  //    lower-case) so `java\tscript:` and ` javascript:` are caught.
  for (const el of all) {
    for (const name of ['href', 'src', 'xlink:href']) {
      const raw = el.getAttribute(name);
      if (raw == null || raw === '') continue; // empty attribute = inert no-op
      // eslint-disable-next-line no-control-regex -- intentionally matches control chars a browser ignores during scheme parsing (anti-obfuscation), mirroring the renderer
      const norm = raw.replace(/[\u0000-\u0020\u007F-\u009F]+/g, '').toLowerCase();
      // ALLOW-LIST check (mirrors the renderer): any scheme NOT positively
      // permitted is a problem. This catches block-list escapees too — blob:,
      // filesystem:, and any novel scheme — not just javascript:/vbscript:.
      const scheme = /^([a-z][a-z0-9+.-]*):/.exec(norm)?.[1];
      if (scheme === undefined) continue; // relative / anchor URL — allowed
      const allowed =
        ['http', 'https', 'mailto', 'tel'].includes(scheme) ||
        /^data:image\/(png|jpe?g|gif|webp|avif|bmp);/.test(norm);
      if (!allowed) {
        problems.push(`non-allowlisted URL scheme in ${name}="${raw}"`);
      }
    }
  }

  return problems;
}

/**
 * Mount `html`, then fire every event an injected handler might listen for on
 * every element, and report whether an attacker canary executed. Belt-and-
 * suspenders on top of findInjections' structural check.
 */
export function runsCanary(html: string): boolean {
  const w = window as unknown as { __MD_XSS__?: number };
  w.__MD_XSS__ = 0;
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    const events = ['error', 'load', 'animationstart', 'mouseover', 'click', 'mouseenter'];
    for (const el of Array.from(container.querySelectorAll('*'))) {
      for (const type of events) {
        try {
          el.dispatchEvent(new Event(type, { bubbles: true }));
        } catch {
          /* jsdom may not construct every event type; ignore */
        }
      }
    }
    return (w.__MD_XSS__ ?? 0) > 0;
  } finally {
    container.remove();
    w.__MD_XSS__ = 0;
  }
}

/** One assertion used everywhere: produced HTML must be inert. */
export function expectHtmlInert(html: string, context = ''): void {
  const problems = findInjections(html);
  expect(problems, `${context}\nrendered HTML:\n${html}\ninjection sinks:\n${problems.join('\n')}`).toEqual([]);
  expect(runsCanary(html), `${context} — canary executed; rendered HTML:\n${html}`).toBe(false);
}

// ===========================================================================
// REUSABLE PAYLOAD BATTERY. `md` is markdown here; the raw attack substrings
// (javascript: URLs, quote-breakout + on* handlers) are what a non-markdown
// sink test would splice into its own input. `)` truncates a markdown URL
// match, so canaries use paren-free assignments.
// ===========================================================================
const CANARY = 'window.__MD_XSS__=1';
export const INJECTION_PAYLOADS: Array<{ name: string; md: string }> = [
  { name: 'attribute breakout via link URL → onmouseover', md: `[click me](http://example.com" onmouseover="${CANARY})` },
  { name: 'proven: <img onerror> via empty-alt image', md: `![](x" onerror="${CANARY})` },
  { name: 'proven: style-driven onanimationstart via link URL', md: `[x](http://a" style="animation-name:spin;animation-duration:1s" onanimationstart="${CANARY})` },
  { name: 'javascript: URL in link', md: `[click](javascript:${CANARY})` },
  { name: 'JAVASCRIPT: URL (uppercase scheme)', md: `[click](JAVASCRIPT:${CANARY})` },
  { name: 'javascript: URL with tab-split scheme', md: `[click](java\tscript:${CANARY})` },
  { name: 'javascript: URL in image src (empty alt)', md: `![](javascript:${CANARY})` },
  { name: 'vbscript: URL in link', md: `[click](vbscript:${CANARY})` },
  // Allow-list (not block-list) proof: schemes a denylist would forget.
  { name: 'blob: URL in link (novel scheme must be refused)', md: `[x](blob:https://evil.example/uuid)` },
  { name: 'filesystem: URL in link', md: `[x](filesystem:https://evil.example/temporary/x)` },
  { name: 'file: URL in link', md: `[x](file:///etc/passwd)` },
  { name: 'unknown scheme URL in link', md: `[x](weirdscheme:whatever)` },
  { name: 'data:text/html URL in link', md: `[x](data:text/html,injected)` },
  { name: 'data:image/svg+xml URL in image (svg can script)', md: `![](data:image/svg+xml,injected)` },
  { name: 'attribute breakout via image alt text', md: `![" onerror="${CANARY}](http://example.com/a.png)` },
  { name: 'raw <script> in body', md: `hello\n\n<script>${CANARY}</script>\n\nworld` },
  { name: 'raw <img onerror> HTML in body', md: `<img src=x onerror="${CANARY}">` },
  { name: 'single-quote attribute breakout attempt', md: `[x](http://a' onmouseover='${CANARY})` },
];

// ===========================================================================
// THE REAL RENDERER MUST BE INERT
// ===========================================================================
describe('MarkdownPreview — injection is inert by construction', () => {
  for (const { name, md } of INJECTION_PAYLOADS) {
    it(`neutralizes: ${name}`, () => {
      expectHtmlInert(renderMarkdownToHtml(md).html, name);
    });
  }

  it('every payload combined in one document is still inert', () => {
    const combined = INJECTION_PAYLOADS.map((p) => p.md).join('\n\n');
    expectHtmlInert(renderMarkdownToHtml(combined).html, 'combined document');
  });
});

// ===========================================================================
// LEGITIMATE CONTENT MUST STILL RENDER (hardening must not break real markdown)
// ===========================================================================
describe('MarkdownPreview — legitimate content still renders', () => {
  function render(md: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = renderMarkdownToHtml(md).html;
    return el;
  }

  it('keeps an https link with its href, text, and target', () => {
    const a = render('[Anthropic](https://www.anthropic.com/about)').querySelector('a');
    expect(a).not.toBeNull();
    expect(a!.getAttribute('href')).toBe('https://www.anthropic.com/about');
    expect(a!.textContent).toBe('Anthropic');
    expect(a!.getAttribute('target')).toBe('_blank');
    expect(a!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('preserves a legitimate query string with ampersands (no double-escaping)', () => {
    const a = render('[search](https://example.com/s?q=a&page=2&sort=asc)').querySelector('a');
    expect(a).not.toBeNull();
    expect(a!.getAttribute('href')).toBe('https://example.com/s?q=a&page=2&sort=asc');
  });

  it('renders an https image with its src', () => {
    const img = render('![](https://example.com/logo.png)').querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('https://example.com/logo.png');
  });

  it('allows a relative image path', () => {
    const img = render('![](./assets/diagram.png)').querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('./assets/diagram.png');
  });

  it('allows a non-scriptable raster data: image URI', () => {
    const dataUri =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const img = render(`![](${dataUri})`).querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe(dataUri);
  });

  it('allows a mailto: link', () => {
    const a = render('[email us](mailto:hello@example.com)').querySelector('a');
    expect(a).not.toBeNull();
    expect(a!.getAttribute('href')).toBe('mailto:hello@example.com');
  });

  it('keeps a quote inside legitimate link text as inert text', () => {
    const a = render('[the "best" tool](https://example.com)').querySelector('a');
    expect(a).not.toBeNull();
    expect(a!.getAttribute('href')).toBe('https://example.com');
    expect(a!.textContent).toBe('the "best" tool');
  });

  it('still renders headings, bold, italics, code, and lists', () => {
    const el = render(['# Title', '', 'Some **bold** and *italic* and `code`.', '', '- one', '- two'].join('\n'));
    expect(el.querySelector('h1')?.textContent).toBe('Title');
    expect(el.querySelector('strong')?.textContent).toBe('bold');
    expect(el.querySelector('em')?.textContent).toBe('italic');
    expect(el.querySelector('code')?.textContent).toBe('code');
    expect(el.querySelectorAll('li').length).toBe(2);
  });
});

// ===========================================================================
// PERMANENT NEGATIVE CONTROL
// Prove the detector is NOT vacuous: the OLD vulnerable substitution (URLs and
// alt text spliced into attributes with no scheme check and no quote-escaping)
// MUST be caught by findInjections. If someone guts the detector, this fails.
// This is the in-repo standing equivalent of the manual neuter-the-escaping
// demonstration recorded in the lane report.
// ===========================================================================
describe('NEGATIVE CONTROL — detector catches the pre-fix vulnerable render', () => {
  // Reproduces the exact unsafe rendering that shipped before the fix: the
  // document-wide <>& escape, then link/image URLs and alt text dropped RAW into
  // href/src/alt attributes. (Standalone; does not import the fixed renderer.)
  function vulnerableRender(markdown: string): string {
    let html = markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
    return html;
  }

  it('the vulnerable render trips the detector on the proven payloads', () => {
    // The three runtime-proven sinks + a javascript: URL must ALL be detected.
    const mustCatch = [
      `![](x" onerror="${CANARY})`,
      `[x](http://a" style="animation-name:x" onanimationstart="${CANARY})`,
      `[click me](http://example.com" onmouseover="${CANARY})`,
      `[click](javascript:alert1)`,
    ];
    for (const md of mustCatch) {
      const problems = findInjections(vulnerableRender(md));
      expect(problems.length, `detector must flag vulnerable render of: ${md}\ngot: ${JSON.stringify(problems)}`).toBeGreaterThan(0);
    }
  });

  it('the fixed renderer is inert on those same payloads (side-by-side)', () => {
    const payloads = [
      `![](x" onerror="${CANARY})`,
      `[x](http://a" style="animation-name:x" onanimationstart="${CANARY})`,
      `[click me](http://example.com" onmouseover="${CANARY})`,
      `[click](javascript:alert1)`,
    ];
    for (const md of payloads) {
      expect(findInjections(renderMarkdownToHtml(md).html)).toEqual([]);
    }
  });
});
