/**
 * Q12 (Wave 1.4) — smart paste URL handler.
 *
 * Tests the pure helpers + the CodeMirror extension's paste path without
 * a real browser. We construct an `EditorView` against a DOM node
 * (jsdom), dispatch a synthetic `ClipboardEvent`, and assert on the
 * resulting document content.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  createSmartPasteExtension,
  findUrlPlaceholder,
  isInsideCodeBlock,
  isSingleUrl,
  resolveUrlPasteReplacement,
} from '@/features/documents/editor-core/smartPaste';

// ---------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------

describe('isSingleUrl', () => {
  it('matches http and https URLs', () => {
    expect(isSingleUrl('https://example.com')).toBe(true);
    expect(isSingleUrl('http://example.com')).toBe(true);
    expect(isSingleUrl('https://example.com/path?query=1#frag')).toBe(true);
  });
  it('trims whitespace before testing', () => {
    expect(isSingleUrl('  https://example.com\n')).toBe(true);
    expect(isSingleUrl('\thttps://example.com\t')).toBe(true);
  });
  it('rejects non-URL text', () => {
    expect(isSingleUrl('hello')).toBe(false);
    expect(isSingleUrl('')).toBe(false);
    expect(isSingleUrl('   ')).toBe(false);
    expect(isSingleUrl('example.com')).toBe(false);
  });
  it('rejects multi-token pastes even if one token is a URL', () => {
    expect(isSingleUrl('hello https://example.com')).toBe(false);
    expect(isSingleUrl('https://example.com and stuff')).toBe(false);
    expect(isSingleUrl('https://example.com\nhttps://other.com')).toBe(false);
  });
  it('rejects non-http schemes', () => {
    expect(isSingleUrl('ftp://example.com')).toBe(false);
    expect(isSingleUrl('mailto:foo@example.com')).toBe(false);
    expect(isSingleUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('isInsideCodeBlock', () => {
  it('detects cursor inside a fenced block', () => {
    const doc = '# Title\n\n```\nsome code\n```';
    // Inside the code
    const inside = doc.indexOf('some');
    expect(isInsideCodeBlock(doc, inside)).toBe(true);
  });
  it('returns false when outside any fence', () => {
    const doc = '# Title\n\n```\nsome code\n```\n\nafter';
    const after = doc.indexOf('after');
    expect(isInsideCodeBlock(doc, after)).toBe(false);
  });
  it('detects cursor inside inline backticks on the same line', () => {
    const doc = 'type `code-here| in backticks';
    const cursor = doc.indexOf('|');
    expect(isInsideCodeBlock(doc, cursor)).toBe(true);
  });
  it('returns false after closing inline backticks', () => {
    const doc = 'type `code` then paste |';
    const cursor = doc.indexOf('|');
    expect(isInsideCodeBlock(doc, cursor)).toBe(false);
  });
  it('handles out-of-range cursor without throwing', () => {
    expect(isInsideCodeBlock('abc', -5)).toBe(false);
    expect(isInsideCodeBlock('abc', 999)).toBe(false);
  });
});

describe('findUrlPlaceholder', () => {
  it('finds placeholder at the exact expected position', () => {
    const doc = 'prefix [Fetching title...](https://x.com) suffix';
    const from = doc.indexOf('[');
    expect(findUrlPlaceholder(doc, from, 'https://x.com')).toEqual({
      from,
      to: from + '[Fetching title...](https://x.com)'.length,
    });
  });
  it('falls back to a document scan when the position drifted', () => {
    const doc = 'xxx [Fetching title...](https://x.com) yyy';
    const expected = doc.indexOf('[');
    expect(findUrlPlaceholder(doc, 0, 'https://x.com')).toEqual({
      from: expected,
      to: expected + '[Fetching title...](https://x.com)'.length,
    });
  });
  it('returns null when the placeholder was removed', () => {
    expect(findUrlPlaceholder('nothing here', 0, 'https://x.com')).toBeNull();
  });
});

describe('resolveUrlPasteReplacement', () => {
  it('returns [title](url) when title is non-empty', () => {
    expect(resolveUrlPasteReplacement('https://x.com', 'Hello World')).toBe(
      '[Hello World](https://x.com)',
    );
  });
  it('falls back to the raw URL when title is empty or whitespace', () => {
    expect(resolveUrlPasteReplacement('https://x.com', '')).toBe('https://x.com');
    expect(resolveUrlPasteReplacement('https://x.com', '   ')).toBe('https://x.com');
  });
});

// ---------------------------------------------------------------------
// Extension integration
// ---------------------------------------------------------------------

function createEditorWith(opts: {
  doc?: string;
  fetchUrlTitle?: (url: string) => Promise<string>;
  selection?: { anchor: number; head?: number };
  onUrlPasteResolved?: (r: { url: string; title: string }) => void;
}) {
  const {
    doc = '',
    fetchUrlTitle = async () => '',
    selection,
    onUrlPasteResolved,
  } = opts;

  const parent = document.createElement('div');
  document.body.appendChild(parent);

  const state = EditorState.create({
    doc,
    selection: selection ?? { anchor: doc.length },
    extensions: [
      createSmartPasteExtension({
        fetchUrlTitle,
        ...(onUrlPasteResolved ? { onUrlPasteResolved } : {}),
      }),
    ],
  });
  const view = new EditorView({ state, parent });
  return { view, parent };
}

function pasteText(view: EditorView, text: string): ClipboardEvent {
  // jsdom doesn't fully implement ClipboardEvent + DataTransfer for
  // this path. Construct a plain Event + attach the surface we need.
  const event = new Event('paste', { bubbles: true, cancelable: true });
  const items: DataTransferItem[] = [];
  const dataTransfer = {
    getData: (type: string) => (type === 'text/plain' ? text : ''),
    items,
    files: [] as unknown as FileList,
    types: ['text/plain'],
  } as unknown as DataTransfer;
  Object.defineProperty(event, 'clipboardData', { value: dataTransfer });
  view.contentDOM.dispatchEvent(event);
  return event as ClipboardEvent;
}

describe('smart URL paste — extension integration', () => {
  let originalConsoleWarn: typeof console.warn;
  beforeEach(() => {
    originalConsoleWarn = console.warn;
    console.warn = vi.fn();
  });
  afterEach(() => {
    console.warn = originalConsoleWarn;
  });

  it('inserts a placeholder then swaps in the title', async () => {
    const resolved = vi.fn();
    const { view } = createEditorWith({
      fetchUrlTitle: async () => 'Example Domain',
      onUrlPasteResolved: resolved,
    });
    const event = pasteText(view, 'https://example.com');

    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe(
      '[Fetching title...](https://example.com)',
    );

    // Flush the microtask queue so the async resolution runs.
    await vi.waitFor(() => {
      expect(resolved).toHaveBeenCalled();
    });
    expect(view.state.doc.toString()).toBe(
      '[Example Domain](https://example.com)',
    );
  });

  it('falls back to the raw URL on empty title', async () => {
    const resolved = vi.fn();
    const { view } = createEditorWith({
      fetchUrlTitle: async () => '',
      onUrlPasteResolved: resolved,
    });
    pasteText(view, 'https://example.com');
    await vi.waitFor(() => expect(resolved).toHaveBeenCalled());
    expect(view.state.doc.toString()).toBe('https://example.com');
  });

  it('falls back to the raw URL when the fetcher throws', async () => {
    const resolved = vi.fn();
    const { view } = createEditorWith({
      fetchUrlTitle: async () => {
        throw new Error('network');
      },
      onUrlPasteResolved: resolved,
    });
    pasteText(view, 'https://example.com');
    await vi.waitFor(() => expect(resolved).toHaveBeenCalled());
    expect(view.state.doc.toString()).toBe('https://example.com');
  });

  it('linkifies a selection instead of inserting a placeholder', () => {
    const resolved = vi.fn();
    const { view } = createEditorWith({
      doc: 'See the docs here.',
      selection: { anchor: 4, head: 12 }, // "the docs"
      onUrlPasteResolved: resolved,
    });
    pasteText(view, 'https://example.com');

    expect(view.state.doc.toString()).toBe(
      'See [the docs](https://example.com) here.',
    );
    expect(resolved).toHaveBeenCalledWith({
      url: 'https://example.com',
      title: 'the docs',
    });
  });

  it('does NOT trigger smart paste for non-URL text', () => {
    const resolved = vi.fn();
    const fetchUrlTitle = vi.fn(async () => 'X');
    const { view } = createEditorWith({
      fetchUrlTitle,
      onUrlPasteResolved: resolved,
    });
    pasteText(view, 'just some text');
    expect(fetchUrlTitle).not.toHaveBeenCalled();
    expect(resolved).not.toHaveBeenCalled();
    // The doc must NOT contain our placeholder.
    expect(view.state.doc.toString()).not.toContain('[Fetching title...]');
  });

  it('does NOT trigger smart paste inside a fenced code block', () => {
    const doc = '```\n\n```';
    const inside = doc.indexOf('\n') + 1; // right after the opening fence
    const resolved = vi.fn();
    const fetchUrlTitle = vi.fn(async () => 'X');
    const { view } = createEditorWith({
      doc,
      selection: { anchor: inside },
      fetchUrlTitle,
      onUrlPasteResolved: resolved,
    });
    pasteText(view, 'https://example.com');
    expect(fetchUrlTitle).not.toHaveBeenCalled();
    expect(resolved).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).not.toContain('[Fetching title...]');
  });

  it('does NOT trigger smart paste inside inline backticks', () => {
    const doc = 'type `here`';
    const inside = doc.indexOf('here');
    const resolved = vi.fn();
    const fetchUrlTitle = vi.fn(async () => 'X');
    const { view } = createEditorWith({
      doc,
      selection: { anchor: inside },
      fetchUrlTitle,
      onUrlPasteResolved: resolved,
    });
    pasteText(view, 'https://example.com');
    expect(fetchUrlTitle).not.toHaveBeenCalled();
    expect(resolved).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).not.toContain('[Fetching title...]');
  });

  it('survives the placeholder position drifting (user kept typing)', async () => {
    const resolved = vi.fn();
    let resolveFetch: (s: string) => void = () => {};
    const { view } = createEditorWith({
      fetchUrlTitle: () =>
        new Promise<string>((res) => {
          resolveFetch = res;
        }),
      onUrlPasteResolved: resolved,
    });
    pasteText(view, 'https://example.com');
    expect(view.state.doc.toString()).toBe(
      '[Fetching title...](https://example.com)',
    );

    // Simulate the user typing "prefix " at the start of the document.
    view.dispatch({ changes: { from: 0, insert: 'prefix ' } });
    expect(view.state.doc.toString()).toBe(
      'prefix [Fetching title...](https://example.com)',
    );

    resolveFetch('Example Domain');
    await vi.waitFor(() => expect(resolved).toHaveBeenCalled());
    expect(view.state.doc.toString()).toBe(
      'prefix [Example Domain](https://example.com)',
    );
  });
});
