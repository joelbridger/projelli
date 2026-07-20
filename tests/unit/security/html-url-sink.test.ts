// R-14 — the four markdown/HTML sanitizers, unified.
//
// The finding as filed said pdf-export.ts was a THIRD sanitizer outside the
// tracked unification. Settling it before grading showed that path was the
// STRONGEST of the four; the live hole was in path #1, the one the unification
// already tracked. These tests pin both halves of that conclusion so a future
// reader does not have to take it on trust.

import { describe, it, expect } from 'vitest';

import {
  BLOCKED_URL,
  escapeHtmlText,
  isSafeUrl,
  safeUrlAttribute,
  sanitizeHtmlString,
} from '@/platform/render/htmlSanitize';
import { renderMarkdownToHtml } from '@/features/documents/editor/MarkdownPreview';

describe('htmlSanitize — the chokepoint', () => {
  // FLIP: delete the `.replace(/"/g, '&quot;')` from escapeHtmlText.
  it('escapes the quote, which is the whole bug', () => {
    expect(escapeHtmlText('a"b')).toBe('a&quot;b');
    expect(escapeHtmlText("a'b")).toBe('a&#39;b');
    expect(escapeHtmlText('<b>&')).toBe('&lt;b&gt;&amp;');
  });

  // FLIP: make SAFE_URL_PATTERN match everything.
  it.each([
    'javascript:alert`1`',
    'JaVaScRiPt:alert`1`',
    '  javascript:alert`1`',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox',
    'file:///etc/passwd',
  ])('blocks %j', (url) => {
    expect(safeUrlAttribute(url)).toBe(BLOCKED_URL);
    expect(isSafeUrl(url)).toBe(false);
  });

  it.each(['https://example.com', 'http://example.com', 'mailto:a@b.c', 'tel:+1', '#anchor', './rel'])(
    'allows %j',
    (url) => {
      expect(safeUrlAttribute(url)).not.toBe(BLOCKED_URL);
    },
  );

  it('escapes even an ALLOWED url so it cannot leave its attribute', () => {
    expect(safeUrlAttribute('https://e.com/?a="b" onx="y')).not.toContain('"');
  });

  it('permits data: only for images, and only image media types', () => {
    expect(isSafeUrl('data:image/png;base64,AAAA', 'image')).toBe(true);
    expect(isSafeUrl('data:image/png;base64,AAAA', 'link')).toBe(false);
    expect(isSafeUrl('data:text/html;base64,AAAA', 'image')).toBe(false);
  });

  // The DOM pass, lifted from pdf-export.ts. FLIP: delete the `on*` loop in
  // sanitizeInertDocument.
  it('strips scripts, handlers and unsafe urls from a document', () => {
    const dirty =
      '<p onclick="alert(1)">x</p><script>alert(2)</script>' +
      '<a href="javascript:alert`3`">y</a><iframe src="https://evil"></iframe>';
    const clean = sanitizeHtmlString(dirty);
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('<iframe');
  });
});

/**
 * Assert on the PARSED DOM, not on the string. Text-matching `/onerror=/`
 * would red on the harmless case where the payload survives correctly ESCAPED
 * inside an attribute VALUE — a test that cannot tell "an event handler ran"
 * from "the characters o-n-e-r-r-o-r appear" is measuring the wrong thing.
 */
function attackSurfaceOf(html: string): { handlers: string[]; urls: string[] } {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const handlers: string[] = [];
  const urls: string[] = [];
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) handlers.push(`${el.tagName}.${attr.name}`);
      if (/^(?:href|src|data|action)$/i.test(attr.name)) urls.push(attr.value);
    }
  }
  return { handlers, urls };
}

describe('R-14 — the live hole was in the TRACKED path, not the third one', () => {
  // THE BUG. `markdownToHtml` escaped `& < >` but not `"`, then interpolated
  // the raw link capture into an attribute. This output goes to
  // dangerouslySetInnerHTML and the app's CSP allows 'unsafe-inline'.
  //
  // FLIP: restore the string-replacement form
  //   html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" …>$1</a>')
  it('an attribute breakout in a markdown link no longer escapes the href', () => {
    const { html } = renderMarkdownToHtml('[click](" onmouseover="alert(1))');
    expect(attackSurfaceOf(html).handlers).toEqual([]);
  });

  it('a javascript: markdown link is neutralised', () => {
    const { html } = renderMarkdownToHtml('[click](javascript:alert`1`)');
    const { urls } = attackSurfaceOf(html);
    expect(urls).toEqual([BLOCKED_URL]);
  });

  it('an image src gets the same treatment', () => {
    const { html } = renderMarkdownToHtml('![alt](" onerror="alert(1))');
    expect(attackSurfaceOf(html).handlers).toEqual([]);
  });

  it('an alt text cannot break out either', () => {
    const { html } = renderMarkdownToHtml('![" onerror="alert(1)](https://e.com/a.png)');
    const surface = attackSurfaceOf(html);
    expect(surface.handlers).toEqual([]);
    // The payload survives as inert TEXT inside the alt value — which is the
    // correct outcome, and the reason this assertion looks at the DOM.
    expect(surface.urls).toEqual(['https://e.com/a.png']);
  });

  // The guard-of-guards for this file: the assertion helper must itself go RED
  // on the pre-fix output, or it is proving nothing.
  it('attackSurfaceOf DETECTS the pre-fix output (control)', () => {
    const preFix = '<a href="" onmouseover="alert(1" class="x">click</a>';
    expect(attackSurfaceOf(preFix).handlers).toEqual(['A.onmouseover']);
  });

  it('ordinary links and images still work', () => {
    const { html } = renderMarkdownToHtml('[x](https://example.com) ![y](https://e.com/a.png)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('src="https://e.com/a.png"');
  });
});
