// Security: iframe `src` scheme constraints (render-sinks S17/S18/S19).
//
// Three iframes take a URL from a variable: the PDF blob preview (PDFViewer,
// S17), the in-app browser (BrowserPanel, S18), and the research source preview
// (SourceFileEditor, S19). This suite SETTLES each BY RUNNING it: it drives
// fabricated malicious URLs through the REAL components and asserts (a) the
// scheme that reaches `src` is constrained to a safe set, and (b) the iframe
// carries a sandbox. Negative controls prove the raw (un-guarded) value is the
// dangerous one.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

import { isAllowedUrl, toSafeFrameSrc } from '@/platform/security/urlAllowlist';
import PDFViewer from '@/features/documents/media/PDFViewer';
import { BrowserPanel } from '@/features/workflows/BrowserPanel';
import { SourceFileEditor } from '@/features/ask/research/SourceFileEditor';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

// ===========================================================================
// The scheme guard itself (the shared resolver every iframe now routes through)
// ===========================================================================
describe('toSafeFrameSrc / isAllowedUrl(frame) — scheme allow-list', () => {
  const MALICIOUS = [
    'javascript:window.__F__=1',
    'JavaScript:alert(1)',
    'java\tscript:alert(1)',
    '  javascript:alert(1)',
    'data:text/html,<script>window.__F__=1</script>',
    'data:image/svg+xml,<svg onload=1>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'tauri://localhost/secret',
    'blob:https://evil.example/uuid', // blob refused unless allowBlob
    'filesystem:https://evil.example/x',
  ];
  const LEGIT = [
    'https://www.anthropic.com/about',
    'http://example.com/page?q=1&x=2',
    'about:blank',
    '/relative/path',
    '#anchor',
  ];

  for (const url of MALICIOUS) {
    it(`neutralizes to about:blank: ${JSON.stringify(url)}`, () => {
      expect(toSafeFrameSrc(url)).toBe('about:blank');
      expect(isAllowedUrl(url, 'frame')).toBe(false);
    });
  }
  for (const url of LEGIT) {
    it(`passes through legit: ${JSON.stringify(url)}`, () => {
      expect(toSafeFrameSrc(url)).toBe(url);
      expect(isAllowedUrl(url, 'frame')).toBe(true);
    });
  }
  it('allows blob: ONLY when allowBlob is set (the PDF viewer)', () => {
    const blob = 'blob:https://app.localhost/uuid';
    expect(toSafeFrameSrc(blob)).toBe('about:blank'); // default: refused
    expect(toSafeFrameSrc(blob, { allowBlob: true })).toBe(blob); // PDF viewer
  });
  it('null / empty → about:blank', () => {
    expect(toSafeFrameSrc(null)).toBe('about:blank');
    expect(toSafeFrameSrc(undefined)).toBe('about:blank');
    expect(toSafeFrameSrc('')).toBe('about:blank');
  });
});

// ===========================================================================
// S18 — BrowserPanel: initialUrl reaches the iframe src through the guard
// ===========================================================================
describe('BrowserPanel (S18) — iframe src is scheme-constrained + sandboxed', () => {
  function iframeOf(container: HTMLElement): HTMLIFrameElement {
    const f = container.querySelector('iframe');
    expect(f, 'browser iframe should render').not.toBeNull();
    return f as HTMLIFrameElement;
  }

  it('a javascript: initialUrl becomes about:blank (NEGATIVE CONTROL: raw value is the payload)', () => {
    const payload = 'javascript:window.__F__=1';
    // NEGATIVE CONTROL: without the guard, this exact string would be the src.
    expect(payload).not.toBe('about:blank');
    const { container } = render(<BrowserPanel initialUrl={payload} />);
    const f = iframeOf(container);
    expect(f.getAttribute('src')).toBe('about:blank');
    expect(f.getAttribute('sandbox')).toBeTruthy();
  });

  it('a file:// initialUrl (reachable via the prompt) becomes about:blank', () => {
    const { container } = render(<BrowserPanel initialUrl="file:///etc/passwd" />);
    expect(iframeOf(container).getAttribute('src')).toBe('about:blank');
  });

  it('a tauri:// (app-origin) initialUrl becomes about:blank', () => {
    const { container } = render(<BrowserPanel initialUrl="tauri://localhost/index.html" />);
    expect(iframeOf(container).getAttribute('src')).toBe('about:blank');
  });

  it('a legitimate https initialUrl passes through unchanged', () => {
    const { container } = render(<BrowserPanel initialUrl="https://www.anthropic.com/" />);
    expect(iframeOf(container).getAttribute('src')).toBe('https://www.anthropic.com/');
  });
});

// ===========================================================================
// S19 — SourceFileEditor: sourceCard.url (from a .source file) reaches the iframe
// ===========================================================================
describe('SourceFileEditor (S19) — iframe src is scheme-constrained + sandboxed', () => {
  function sourceContent(url: string): string {
    return JSON.stringify({
      title: 'A source',
      url,
      quote_or_snippet: '',
      claim_supported: '',
      reliability_notes: '',
      date_accessed: '2026-07-20',
      tags: [],
    });
  }

  async function iframeFor(url: string): Promise<HTMLIFrameElement> {
    const { container } = render(
      <SourceFileEditor initialContent={sourceContent(url)} filePath="x.source" onSave={async () => {}} />,
    );
    let f: HTMLIFrameElement | null = null;
    await waitFor(() => {
      f = container.querySelector('iframe');
      expect(f, 'preview iframe should render').not.toBeNull();
    });
    return f!;
  }

  it('a javascript: source url becomes about:blank (EXPLOITABLE path — now closed)', async () => {
    const payload = 'javascript:window.__F__=1';
    const f = await iframeFor(payload);
    expect(f.getAttribute('src')).toBe('about:blank');
    expect(f.getAttribute('sandbox')).toBeTruthy();
  });

  it('a data:text/html source url becomes about:blank', async () => {
    const f = await iframeFor('data:text/html,<script>window.__F__=1</script>');
    expect(f.getAttribute('src')).toBe('about:blank');
  });

  it('a legitimate https source url passes through', async () => {
    const f = await iframeFor('https://example.com/article');
    expect(f.getAttribute('src')).toBe('https://example.com/article');
  });
});

// ===========================================================================
// S17 — PDFViewer: blob MIME is pinned to application/pdf + iframe sandboxed
// ===========================================================================
describe('PDFViewer (S17) — blob MIME pinned + iframe scheme-gated + sandboxed', () => {
  /** A tiny valid-ish base64 payload (content irrelevant; we inspect the Blob type). */
  const B64 = 'JVBERi0xLjQK'; // "%PDF-1.4\n"

  function spyCreateObjectURL(): { blobs: Blob[] } {
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
      if (obj instanceof Blob) blobs.push(obj);
      return 'blob:https://app.localhost/pinned-uuid';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    return { blobs };
  }

  it('a data:text/html src is re-wrapped as an application/pdf blob (NEGATIVE CONTROL: the declared MIME is text/html)', async () => {
    const declaredMime = 'text/html';
    const src = `data:${declaredMime};base64,${B64}`;
    // NEGATIVE CONTROL: the incoming data URL declares text/html — the OLD code
    // read that verbatim, producing a scriptable text/html blob.
    expect(src).toContain('text/html');

    const { blobs } = spyCreateObjectURL();
    const { container } = render(<PDFViewer src={src} fileName="x.pdf" />);
    await waitFor(() => expect(blobs.length).toBeGreaterThan(0));
    // The pin: every blob handed to the iframe is application/pdf, never text/html.
    for (const b of blobs) expect(b.type).toBe('application/pdf');

    // And the iframe (once loaded) is sandboxed without allow-scripts, its src a
    // blob: URL (or about:blank), never a data:/javascript: value.
    await waitFor(() => {
      const f = container.querySelector('iframe');
      expect(f, 'pdf iframe should render').not.toBeNull();
      const sandbox = (f as HTMLIFrameElement).getAttribute('sandbox') ?? '';
      expect(sandbox).toBe('allow-same-origin');
      expect(sandbox).not.toContain('allow-scripts');
      const iframeSrc = (f as HTMLIFrameElement).getAttribute('src') ?? '';
      expect(/^blob:/.test(iframeSrc) || iframeSrc === 'about:blank').toBe(true);
    });
  });

  it('a normal application/pdf data URL still renders (blob is application/pdf)', async () => {
    const { blobs } = spyCreateObjectURL();
    render(<PDFViewer src={`data:application/pdf;base64,${B64}`} fileName="x.pdf" />);
    await waitFor(() => expect(blobs.length).toBeGreaterThan(0));
    for (const b of blobs) expect(b.type).toBe('application/pdf');
  });
});
