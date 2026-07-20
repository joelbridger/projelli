// DOCXIO-SINK-FOLLOWON — the two holes R-49 HANDED OFF rather than folded in.
//
// `src/platform/utils/docx-io.ts` is the fourth markdown→HTML renderer. R-14
// routed its link rule through the shared `safeUrlAttribute`, which closed the
// scheme hole — and, exactly as in `MarkdownPreview.tsx`, introduced a SECOND
// escape of an already-escaped `&`. R-49 proved that executably on this branch
// and handed it off; this file is where it is closed.
//
// WHY THE `&` BUG IS A SECURITY DEFECT AND NOT A COSMETIC ONE (consultant
// ruling, restated so the next reader does not have to be told): the
// correctness of a security control IS a security property. A sanitizer that
// silently breaks every link with a query string is a sanitizer someone turns
// off, and a disabled control is a live hole reached by disuse — which no
// security test catches.
//
// WHAT "RESOLVES" MEANS HERE. `markdownToHtml`'s output is not shown to a
// browser. It is re-parsed by `docx-io`'s own `htmlToDocxChildren`
// (`DOMParser`, `text/html`) and the `href` read back with `getAttribute` is
// handed to `ExternalHyperlink({ link })` — i.e. it becomes the click target
// stored in the `.docx`. `pptx-io.ts` re-parses the same markup the same way.
// So the assertions below read the href back through that same parse, and the
// end-to-end case goes all the way into the packed `.docx` relationship part.
// Asserting on the raw markup string alone would prove the wrong thing: one
// level of `&amp;` is CORRECT in markup and only the parse tells you whether
// there are two.

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';

import { markdownToHtml, markdownToDocxBytes } from '@/platform/utils/docx-io';
import { BLOCKED_URL } from '@/platform/render/htmlSanitize';

/**
 * Render markdown and read the hrefs back the way `docx-io` itself does —
 * `DOMParser`, `text/html`, `getAttribute('href')`. This is the value that
 * reaches `ExternalHyperlink({ link })`, so it is the value that matters.
 */
function resolvedHrefs(markdown: string): string[] {
  const html = markdownToHtml(markdown);
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    'text/html'
  );
  return Array.from(doc.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
}

/** The anchor element itself, for attribute- and child-level assertions. */
function firstAnchor(markdown: string): HTMLAnchorElement | null {
  const html = markdownToHtml(markdown);
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    'text/html'
  );
  return doc.querySelector('a');
}

// ---------------------------------------------------------------------------
// DEFECT 1 — the `&` double-escape corruption (R-49 defect 1c)
// ---------------------------------------------------------------------------

describe('docx-io — DEFECT 1: the pipeline escape must not be applied twice', () => {
  // FLIP: remove `decodePipelineEscape` from the href capture in renderInline.
  it('DEFECT-1 an ordinary link keeps its query string: ?a=1&b=2 resolves to ?a=1&b=2', () => {
    expect(resolvedHrefs('see [the page](https://example.com/s?a=1&b=2) now')).toEqual([
      'https://example.com/s?a=1&b=2',
    ]);
  });

  it('DEFECT-1 several ampersands in one URL all survive', () => {
    expect(resolvedHrefs('[x](https://example.com/s?a=1&b=2&c=3&d=4)')).toEqual([
      'https://example.com/s?a=1&b=2&c=3&d=4',
    ]);
  });

  // The decode must be the exact inverse of the pipeline escape, applied in
  // REVERSE order. The author wrote the six literal characters `&`,`l`,`t`,`;`
  // — that is, the TEXT "&lt;", not a `<`. The pipeline escape turns the `&`
  // into `&amp;`, so the capture reads `&amp;lt;`. A reverse-order decode
  // yields back `&lt;` (right). A forward-order decode would yield `<` (wrong)
  // — it would silently rewrite the author's URL into a different one.
  // FLIP: reorder decodePipelineEscape's replaces to &amp; first.
  it('DEFECT-1 the decode is a TRUE INVERSE: a literal &lt; in the URL round-trips as &lt;, not <', () => {
    expect(resolvedHrefs('[x](https://example.com/s?q=&lt;tag)')).toEqual([
      'https://example.com/s?q=&lt;tag',
    ]);
  });

  it('DEFECT-1 a bare < or > written in a URL survives as itself', () => {
    expect(resolvedHrefs('[x](https://example.com/s?q=a<b>c)')).toEqual([
      'https://example.com/s?q=a<b>c',
    ]);
  });

  // The END-TO-END case: all the way into the packed .docx. The hyperlink
  // target lives in word/_rels/document.xml.rels, not in document.xml, so this
  // reads the relationship part the Word client actually follows.
  it('DEFECT-1 END-TO-END: the packed .docx hyperlink target is the URL the author wrote', async () => {
    const bytes = await markdownToDocxBytes(
      '[the page](https://example.com/s?a=1&b=2)',
      'link.docx'
    );
    const zip = await JSZip.loadAsync(bytes);
    const relsFile = zip.file('word/_rels/document.xml.rels');
    expect(relsFile).not.toBeNull();
    const rels = await relsFile!.async('string');
    // POSITIVE CONTROL. Match ONLY relationships whose Type is `hyperlink`, and
    // require exactly one. Without this the assertion below could go green over
    // a document that contains no hyperlink at all — an absence reported as a
    // pass. The other seven relationships in this part are styles.xml,
    // numbering.xml and friends.
    const hyperlinkTargets = Array.from(
      rels.matchAll(/<Relationship\b[^>]*\bType="[^"]*\/hyperlink"[^>]*\bTarget="([^"]*)"/g)
    ).map((m) => m[1]!);
    expect(hyperlinkTargets).toHaveLength(1);

    // The .rels part is XML, so a real `&` in the URL is stored as `&amp;`.
    // Decode ONE level — that is the XML encoding, not the bug — and the result
    // must be the author's URL. A second level of escaping leaves `&amp;`
    // behind here, and that is exactly what Word would open.
    const decoded = hyperlinkTargets[0]!
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    expect(decoded).toBe('https://example.com/s?a=1&b=2');
  });
});

// ---------------------------------------------------------------------------
// DEFECT 2 — the scheme allowlist
// ---------------------------------------------------------------------------

describe('docx-io — DEFECT 2: the scheme allowlist', () => {
  // FLIP: drop safeUrlAttribute from renderInline's link rule and go back to
  // the pre-R-14 `href.replace(/"/g, '&quot;')`.
  it.each([
    'javascript:alert(1',
    'JaVaScRiPt:alert(1',
    '  javascript:alert(1',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox',
    'file:///etc/passwd',
    'jAvAsCrIpT:void 0',
  ])('DEFECT-2 blocks the scheme %j', (url) => {
    expect(resolvedHrefs(`[x](${url})`)).toEqual([BLOCKED_URL]);
  });

  it.each([
    'https://example.com/ok',
    'http://example.com/ok',
    'mailto:a@example.com',
    'tel:+15551234567',
    '#anchor',
    '/relative/path',
    './sibling',
    '../parent',
  ])('DEFECT-2 still ALLOWS the ordinary URL %j (positive control)', (url) => {
    expect(resolvedHrefs(`[x](${url})`)).toEqual([url]);
  });
});

// ---------------------------------------------------------------------------
// THE PROPERTY THAT MAKES DECODING SAFE — it cannot widen the allowlist
// ---------------------------------------------------------------------------

describe('docx-io — the decode CANNOT WIDEN the allowlist', () => {
  // The only characters `decodePipelineEscape` can reintroduce are `&`, `<`
  // and `>`. None of them appears in ANY allowed prefix (`https?:` `mailto:`
  // `tel:` `#` `/` `./` `../`), so no input can cross BLOCKED → ALLOWED by
  // being decoded; it can only alter the TAIL of an already-allowed URL, and
  // that tail is re-escaped in full. These cases pin that bound: every one is
  // a blocked payload dressed in the entity spellings the decode undoes.
  const blockedBase = [
    'javascript:alert(1',
    'vbscript:msgbox',
    'data:text/html,x',
    'file:///etc/passwd',
    'about:config',
    'chrome://settings',
    'blob:https://example.com/x',
    'ws://example.com',
  ];

  // Entity dressings the decode WILL undo, and some it will not — both must
  // stay blocked.
  const dressings: ReadonlyArray<(u: string) => string> = [
    (u) => u,
    (u) => `&lt;${u}`,
    (u) => `&gt;${u}`,
    (u) => `&amp;${u}`,
    (u) => `&amp;lt;${u}`,
    (u) => `&amp;amp;${u}`,
    (u) => u.replace(':', '&amp;#58;'),
    (u) => u.replace(':', '&#58;'),
    (u) => `&lt;a href=&quot;${u}`,
  ];

  const cases: string[] = [];
  for (const base of blockedBase) {
    for (const dress of dressings) cases.push(dress(base));
  }

  it.each(cases)('WIDENING: %j stays BLOCKED after decoding', (url) => {
    expect(resolvedHrefs(`[x](${url})`)).toEqual([BLOCKED_URL]);
  });

  it('WIDENING: the whole corpus is blocked, and the corpus is non-empty (positive control)', () => {
    expect(cases.length).toBe(blockedBase.length * dressings.length);
    expect(cases.length).toBeGreaterThan(50);
    const allowed = cases.filter((u) => resolvedHrefs(`[x](${u})`)[0] !== BLOCKED_URL);
    expect(allowed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// THE LINK TEXT IS DELIBERATELY NOT DECODED
// ---------------------------------------------------------------------------

describe('docx-io — the link TEXT stays in element position', () => {
  // FLIP: apply decodePipelineEscape to the `text` capture as well. That would
  // turn escaped source into live markup, which is the opposite of the fix.
  it('TEXT: markup written in the link text stays INERT text, never a child element', () => {
    const a = firstAnchor('[<b>bold</b>](https://example.com/ok)');
    expect(a).not.toBeNull();
    expect(a!.querySelector('b')).toBeNull();
    expect(a!.textContent).toBe('<b>bold</b>');
  });

  it('TEXT: an ampersand in the link text still reads as one ampersand', () => {
    const a = firstAnchor('[Jones & Co](https://example.com/ok)');
    expect(a!.textContent).toBe('Jones & Co');
  });

  it('TEXT: an event-handler payload in the link text creates NO attribute', () => {
    const a = firstAnchor('[<img src=x onerror="alert(1)">](https://example.com/ok)');
    expect(a!.querySelector('img')).toBeNull();
    const html = markdownToHtml('[<img src=x onerror="alert(1)">](https://example.com/ok)');
    const doc = new DOMParser().parseFromString(
      `<!doctype html><html><body>${html}</body></html>`,
      'text/html'
    );
    const handlers: string[] = [];
    for (const el of Array.from(doc.querySelectorAll('*'))) {
      for (const { name } of Array.from(el.attributes)) {
        if (/^on/i.test(name)) handlers.push(`${el.tagName.toLowerCase()}.${name}`);
      }
    }
    expect(handlers).toEqual([]);
  });

  it('TEXT: the attribute-breakout payload produces no handler and a blocked href', () => {
    const md = '[x](" onmouseover="alert(1))';
    expect(resolvedHrefs(md)).toEqual([BLOCKED_URL]);
    const a = firstAnchor(md);
    expect(a!.getAttribute('onmouseover')).toBeNull();
  });
});
