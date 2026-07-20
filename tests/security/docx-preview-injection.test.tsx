// Security regression: HTML/URL injection through the .docx preview (render-sink
// S7). docx-preview copies a Word document's external hyperlink target verbatim
// onto `<a href>` with NO scheme filter, and 0.3.7 defaults `renderAltChunks` to
// TRUE (embedded-HTML → <iframe srcdoc>). A `.docx` opened in the app (meeting
// notes, imports, peer sync) could therefore run attacker JS in the app origin.
//
// This suite drives FABRICATED malicious `.docx` fixtures through the REAL render
// path (renderDocxPreview, and the full DocxViewer component incl. its Shadow
// DOM) and asserts the produced DOM is inert. The detector + payload battery are
// the render-agnostic ones replicated from the markdown (S2) lane.
//
// NEGATIVE CONTROLS (must-fail proofs): the same fixtures rendered through RAW
// docx-preview (guard neutered) MUST trip the detector — a green "inert" result
// can never be vacuous.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { renderAsync } from 'docx-preview';

import { renderDocxPreview, docxBytesToDataUrl } from '@/platform/utils/docx-io';
import { sanitizeRenderedDocxDom } from '@/platform/utils/docx-sanitize';
import DocxViewer from '@/features/documents/media/DocxViewer';
import { findInjections, expectDomInert } from './renderSinkInjection';
import {
  buildDocxWithHyperlinks,
  buildDocxWithImageAndHttpsLink,
  buildDocxWithAltChunk,
  MALICIOUS_DOCX_TARGETS,
  DOCX_CANARY_KEY,
} from './fixtures/maliciousDocx';

const CANARY_KEYS = [DOCX_CANARY_KEY, '__X__'];

function freshContainer(): HTMLDivElement {
  const c = document.createElement('div');
  document.body.appendChild(c);
  return c;
}

/** Render docx bytes through the RAW library (no app sanitizer) — the neutered
 *  guard, used only by the negative controls. */
async function rawRender(bytes: ArrayBuffer, opts: Record<string, unknown> = {}): Promise<HTMLElement> {
  const container = freshContainer();
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  await renderAsync(blob, container, undefined, {
    inWrapper: true,
    experimental: true,
    breakPages: true,
    useBase64URL: true,
    ...opts,
  });
  return container;
}

beforeEach(() => {
  for (const k of CANARY_KEYS) (window as unknown as Record<string, unknown>)[k] = 0;
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

// ===========================================================================
// THE REAL RENDER PATH MUST BE INERT — hyperlink battery
// ===========================================================================
describe('DocxViewer render — javascript:/data:/etc. hyperlinks are inert by construction', () => {
  for (const { name, target } of MALICIOUS_DOCX_TARGETS) {
    it(`neutralizes: ${name}`, async () => {
      const bytes = await buildDocxWithHyperlinks([{ id: 'rIdH1', target, text: 'click me' }]);
      const container = freshContainer();
      await renderDocxPreview(bytes, container);
      expectDomInert(container, CANARY_KEYS, name);
      // The anchor still exists as inert text (href removed), not a live link.
      const anchors = Array.from(container.querySelectorAll('a'));
      for (const a of anchors) {
        const href = a.getAttribute('href');
        expect(href === null || href === '' || /^(https?:|mailto:|tel:|#|\/)/i.test(href)).toBe(true);
      }
    });
  }

  it('every malicious hyperlink combined in one document is still inert', async () => {
    const bytes = await buildDocxWithHyperlinks(
      MALICIOUS_DOCX_TARGETS.map((t, i) => ({ id: `rIdH${i}`, target: t.target, text: `link ${i}` })),
    );
    const container = freshContainer();
    await renderDocxPreview(bytes, container);
    expectDomInert(container, CANARY_KEYS, 'combined malicious document');
  });
});

// ===========================================================================
// NEGATIVE CONTROL — raw docx-preview (guard neutered) MUST trip the detector
// ===========================================================================
describe('NEGATIVE CONTROL — the sink is genuinely dangerous without the guard', () => {
  it('raw docx-preview renders the javascript: hyperlink → detector catches it', async () => {
    const bytes = await buildDocxWithHyperlinks([
      { id: 'rIdH1', target: `javascript:window.${DOCX_CANARY_KEY}=1`, text: 'click me' },
    ]);
    const container = await rawRender(bytes);
    const problems = findInjections(container);
    expect(problems.length, `raw render must expose the javascript: href; got ${JSON.stringify(problems)}`).toBeGreaterThan(0);
    expect(problems.some((p) => /javascript:/i.test(p))).toBe(true);
  });

  it('the SAME bytes through renderDocxPreview (guard restored) are inert', async () => {
    const bytes = await buildDocxWithHyperlinks([
      { id: 'rIdH1', target: `javascript:window.${DOCX_CANARY_KEY}=1`, text: 'click me' },
    ]);
    const container = freshContainer();
    await renderDocxPreview(bytes, container);
    expect(findInjections(container)).toEqual([]);
  });

  it('sanitizeRenderedDocxDom reports the neutralization it performed (guard does work)', async () => {
    const bytes = await buildDocxWithHyperlinks([
      { id: 'rIdH1', target: 'javascript:alert(1)', text: 'x' },
    ]);
    // Render raw, THEN sanitize, and inspect the report.
    const container = await rawRender(bytes);
    const report = sanitizeRenderedDocxDom(container);
    expect(report.neutralizedUrls.some((u) => /javascript:/i.test(u.value))).toBe(true);
  });
});

// ===========================================================================
// altChunk — the worse (no-click) embedded-HTML vector. docx-preview 0.3.7
// defaults renderAltChunks:TRUE, so this proves BOTH that the app pins it off
// AND that the sanitizer strips the frame even if it were on.
// ===========================================================================
describe('DocxViewer render — embedded altChunk HTML never executes', () => {
  const EMBEDDED = `<html><body><img src=x onerror="window.${DOCX_CANARY_KEY}=1"><script>window.${DOCX_CANARY_KEY}=1</script></body></html>`;

  it('NEGATIVE CONTROL: raw docx-preview with renderAltChunks:true renders an <iframe srcdoc> (vector is live at the library default)', async () => {
    const bytes = await buildDocxWithAltChunk(EMBEDDED);
    const container = await rawRender(bytes, { renderAltChunks: true });
    // docx-preview creates an <iframe> and sets its srcdoc to the embedded HTML.
    const problems = findInjections(container);
    expect(
      problems.length,
      `expected the altChunk iframe/srcdoc to be exposed; got ${JSON.stringify(problems)}`,
    ).toBeGreaterThan(0);
    expect(container.querySelector('iframe')).not.toBeNull();
  });

  it('renderDocxPreview (renderAltChunks pinned off + iframe stripped) is inert', async () => {
    const bytes = await buildDocxWithAltChunk(EMBEDDED);
    const container = freshContainer();
    await renderDocxPreview(bytes, container);
    expect(container.querySelector('iframe')).toBeNull();
    expectDomInert(container, CANARY_KEYS, 'altChunk embedded HTML');
  });
});

// ===========================================================================
// FULL COMPONENT (Shadow DOM) — drive the REAL <DocxViewer>, end to end
// ===========================================================================
describe('DocxViewer component — inert through the real Shadow-DOM render', () => {
  async function renderViewer(bytes: ArrayBuffer): Promise<ShadowRoot> {
    const dataUrl = docxBytesToDataUrl(new Uint8Array(bytes));
    const { container } = render(<DocxViewer src={dataUrl} fileName="notes.docx" />);
    let shadow: ShadowRoot | null = null;
    await waitFor(
      () => {
        const host = container.querySelector('[data-testid="docx-viewer"] div[class*="overflow-auto"]') as HTMLElement | null;
        shadow = host?.shadowRoot ?? null;
        expect(shadow, 'shadow root should exist').not.toBeNull();
        expect(shadow!.querySelector('.docx-wrapper, .docx, a, p'), 'docx content should be rendered').not.toBeNull();
      },
      { timeout: 5000 },
    );
    return shadow!;
  }

  it('a javascript: hyperlink is inert inside the shadow root', async () => {
    const bytes = await buildDocxWithHyperlinks([
      { id: 'rIdH1', target: `javascript:window.${DOCX_CANARY_KEY}=1`, text: 'click me' },
    ]);
    const shadow = await renderViewer(bytes);
    expect(findInjections(shadow)).toEqual([]);
    const anchor = shadow.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute('href')).toBeNull(); // neutralized
    expect(anchor!.textContent).toContain('click me'); // text preserved
  });
});

// ===========================================================================
// LEGITIMATE CONTENT MUST STILL RENDER
// ===========================================================================
describe('DocxViewer render — legitimate content survives sanitization', () => {
  it('keeps an https hyperlink and an embedded raster image', async () => {
    const bytes = await buildDocxWithImageAndHttpsLink();
    const container = freshContainer();
    await renderDocxPreview(bytes, container);

    // https link preserved.
    const anchors = Array.from(container.querySelectorAll('a'));
    const httpsLink = anchors.find((a) => a.getAttribute('href') === 'https://www.anthropic.com/about');
    expect(httpsLink, 'the https link must survive').toBeDefined();
    expect(httpsLink!.textContent).toContain('Anthropic');

    // Embedded image preserved as an inline data: URI (docx-preview emits
    // application/octet-stream) or a blob: URL — the guard must NOT strip it.
    const imgs = Array.from(container.querySelectorAll('img'));
    expect(imgs.length, 'the embedded image should render').toBeGreaterThan(0);
    const src = imgs[0]!.getAttribute('src') ?? '';
    expect(
      /^data:(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/octet-stream);/i.test(src) ||
        /^blob:/i.test(src),
      `embedded image src must survive; got: ${src.slice(0, 48)}`,
    ).toBe(true);

    // And the whole thing is still inert.
    expect(findInjections(container)).toEqual([]);
  });
});
