/**
 * Citation navigation — clicking a `[filename paragraph N]` chip in an
 * assistant response fires `onOpenFileAtPath` with the resolved
 * workspace path + paragraph index. The Sources accordion rows behave
 * the same way.
 *
 * We don't need the full send pipeline here — we render a pre-populated
 * chat with a response that already carries sources, then interact with
 * the rendered chips.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Stub the providers so the import graph doesn't pull in network clients.
// Also stub ChatCostChip — it uses Radix Tooltip which needs a provider
// at the root we're not bothering to wire in these tests.
vi.mock('@/components/ai/ChatCostChip', () => ({
  ChatCostChip: () => null,
}));

vi.mock('@/modules/models/ClaudeProvider', () => ({
  ClaudeProvider: class {
    setTools() {}
    sendMessage = vi.fn();
    getMetadata() { return { model: 'stub' }; }
  },
}));
vi.mock('@/modules/models/OpenAIProvider', () => ({
  OpenAIProvider: class {
    setTools() {}
    sendMessage = vi.fn();
    getMetadata() { return { model: 'stub' }; }
  },
}));
vi.mock('@/modules/models/GeminiProvider', () => ({
  GeminiProvider: class {
    setTools() {}
    sendMessage = vi.fn();
    getMetadata() { return { model: 'stub' }; }
  },
}));

import { AIChatViewer } from '@/components/ai/AIChatViewer';
import type { AIChatFile } from '@/types/ai';
import { useAIChatStore } from '@/stores/aiChatStore';
import {
  SCROLL_TO_PARAGRAPH_EVENT,
  approximateChunkOffset,
  consumePendingScroll,
  requestScrollToParagraph,
  resolveScrollPosition,
  type ScrollToParagraphDetail,
} from '@/utils/scrollToParagraph';

function buildChatWithCitations(): AIChatFile {
  return {
    id: 'm2-citation-test',
    title: 'Citation Nav Test',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    provider: 'anthropic',
    model: 'stub',
    messages: [
      {
        role: 'user',
        content: 'How did we price premium?',
        timestamp: new Date().toISOString(),
        sources: [
          {
            path: 'notes/pricing.md',
            chunkText: 'Premium tier priced at $49.',
            score: 0.9,
            paragraphIndex: 3,
          },
          {
            path: 'notes/research.md',
            chunkText: 'Competitor analysis',
            score: 0.8,
            paragraphIndex: 1,
          },
        ],
      },
      {
        role: 'assistant',
        content:
          'We priced at $49 [pricing.md paragraph 3] based on [research.md paragraph 1].',
        timestamp: new Date().toISOString(),
        sources: [
          {
            path: 'notes/pricing.md',
            chunkText: 'Premium tier priced at $49.',
            score: 0.9,
            paragraphIndex: 3,
          },
          {
            path: 'notes/research.md',
            chunkText: 'Competitor analysis',
            score: 0.8,
            paragraphIndex: 1,
          },
        ],
      },
    ],
  };
}

describe('Citation navigation (M2)', () => {
  beforeEach(() => {
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
  });

  afterEach(() => {
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
  });

  it('renders inline citation chips for every [filename paragraph N]', () => {
    render(
      <AIChatViewer
        chatData={buildChatWithCitations()}
        onOpenFileAtPath={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId('chat-citation-pricing.md-3'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('chat-citation-research.md-1'),
    ).toBeInTheDocument();
  });

  it('clicking an inline citation calls onOpenFileAtPath with the resolved path', () => {
    const open = vi.fn();
    render(
      <AIChatViewer
        chatData={buildChatWithCitations()}
        onOpenFileAtPath={open}
      />,
    );
    fireEvent.click(screen.getByTestId('chat-citation-pricing.md-3'));
    expect(open).toHaveBeenCalledTimes(1);
    // F-504 — the cited chunk's text rides along as the third arg so the
    // editor can locate the passage by exact search.
    expect(open).toHaveBeenCalledWith(
      'notes/pricing.md',
      3,
      'Premium tier priced at $49.',
    );
  });

  it('renders the sources accordion on messages that have retrieval', () => {
    render(
      <AIChatViewer
        chatData={buildChatWithCitations()}
        onOpenFileAtPath={vi.fn()}
      />,
    );
    // The accordion header shows "2 sources".
    const accordion = screen.getByTestId('chat-sources-accordion');
    expect(accordion).toBeInTheDocument();
    expect(accordion.textContent).toContain('2 sources');
  });

  it('expanding the accordion reveals individual source rows', () => {
    render(
      <AIChatViewer
        chatData={buildChatWithCitations()}
        onOpenFileAtPath={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('chat-sources-toggle'));
    // F-505 — accordion rows carry their OWN testid (chat-source-*), so
    // the inline chip's chat-citation-* id stays unique even with the
    // accordion open.
    expect(
      screen.getByTestId('chat-source-pricing.md-3'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('chat-source-research.md-1'),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId('chat-citation-pricing.md-3')).toHaveLength(1);
  });

  it('clicking a source row in the accordion opens the file with its snippet', () => {
    const open = vi.fn();
    render(
      <AIChatViewer
        chatData={buildChatWithCitations()}
        onOpenFileAtPath={open}
      />,
    );
    fireEvent.click(screen.getByTestId('chat-sources-toggle'));
    fireEvent.click(screen.getByTestId('chat-source-pricing.md-3'));
    expect(open).toHaveBeenCalledWith(
      'notes/pricing.md',
      3,
      'Premium tier priced at $49.',
    );
  });

  it('labels transcript citations "Tr. page:line" on the chip and accordion row (VG-3c)', () => {
    const chat = buildChatWithCitations();
    chat.messages[1] = {
      ...chat.messages[1]!,
      content: 'The hold went out on September 12 [weston.txt paragraph 2].',
      sources: [
        {
          path: 'matter/weston.txt',
          chunkText: 'A. The litigation hold notice went out to the team.',
          score: 0.9,
          paragraphIndex: 2,
          sourceType: 'transcript',
          locator: '2:14-2:16',
        },
      ],
    };
    render(<AIChatViewer chatData={chat} onOpenFileAtPath={vi.fn()} />);
    // Chip: the label is the lawyer's cite ("Tr. 2:14-2:16"); the resolution
    // key + testid grammar (basename + paragraphIndex) are unchanged.
    const chip = screen.getByTestId('chat-citation-weston.txt-2');
    expect(chip.textContent).toContain('Tr. 2:14-2:16');
    expect(chip.textContent).not.toContain('§');
    // Accordion row: same label, basename stays in the title attr.
    fireEvent.click(screen.getByTestId('chat-sources-toggle'));
    const row = screen.getByTestId('chat-source-weston.txt-2');
    expect(row.textContent).toContain('Tr. 2:14-2:16');
    expect(row).toHaveAttribute('title', 'matter/weston.txt');
  });

  it('shows a toast warning when the citation has no matching source', () => {
    const chat = buildChatWithCitations();
    // Replace the assistant message with a citation whose basename
    // does not appear in the sources list.
    chat.messages[1] = {
      ...chat.messages[1]!,
      content: 'See [nowhere.md paragraph 0] for the answer.',
      sources: [
        {
          path: 'notes/pricing.md',
          chunkText: 'Pricing',
          score: 0.9,
          paragraphIndex: 3,
        },
      ],
    };
    render(<AIChatViewer chatData={chat} onOpenFileAtPath={vi.fn()} />);
    fireEvent.click(screen.getByTestId('chat-citation-nowhere.md-0'));
    expect(
      screen.getByTestId('chat-missing-source-warning'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('chat-missing-source-warning').textContent,
    ).toMatch(/nowhere\.md/);
  });
});

/**
 * F-504 — the scroll plumbing itself. `requestScrollToParagraph` must both
 * dispatch the live event (already-mounted editors) and stash a pending
 * slot (the editor for a freshly-opened tab mounts AFTER the dispatch);
 * `resolveScrollPosition` is the pure snippet → document-position logic
 * the editor listener runs.
 */
describe('scroll-to-paragraph plumbing (F-504)', () => {
  it('requestScrollToParagraph dispatches the event AND stashes a one-shot pending slot', () => {
    const seen: ScrollToParagraphDetail[] = [];
    const handler = (e: Event) =>
      seen.push((e as CustomEvent<ScrollToParagraphDetail>).detail);
    window.addEventListener(SCROLL_TO_PARAGRAPH_EVENT, handler);
    try {
      requestScrollToParagraph({
        path: '/ws/a.md',
        paragraphIndex: 4,
        snippet: 'cited chunk text',
      });
    } finally {
      window.removeEventListener(SCROLL_TO_PARAGRAPH_EVENT, handler);
    }
    expect(seen).toEqual([
      { path: '/ws/a.md', paragraphIndex: 4, snippet: 'cited chunk text' },
    ]);
    // Pending slot: keyed by path, consumable exactly once.
    expect(consumePendingScroll('/ws/other.md')).toBeNull();
    expect(consumePendingScroll('/ws/a.md')).toEqual({
      path: '/ws/a.md',
      paragraphIndex: 4,
      snippet: 'cited chunk text',
    });
    expect(consumePendingScroll('/ws/a.md')).toBeNull();
  });

  it('keeps only the LATEST pending request', () => {
    requestScrollToParagraph({ path: '/ws/a.md', paragraphIndex: 1 });
    requestScrollToParagraph({ path: '/ws/b.md', paragraphIndex: 2 });
    expect(consumePendingScroll('/ws/a.md')).toBeNull();
    expect(consumePendingScroll('/ws/b.md')).toEqual({
      path: '/ws/b.md',
      paragraphIndex: 2,
    });
  });

  describe('resolveScrollPosition (snippet → document position)', () => {
    const doc = [
      '# Deposition notes',
      '',
      'Alpha paragraph with plenty of text in it.',
      '',
      'A. He said I had until October 17, 2025 to submit my written response.',
      '',
      'Tail block of the document.',
    ].join('\n');

    it('finds the cited chunk by exact search on its first searchable line', () => {
      const snippet =
        'He said I had until October 17, 2025 to submit my written response.';
      expect(resolveScrollPosition(doc, { paragraphIndex: 12, snippet })).toBe(
        doc.indexOf('He said I had until October 17'),
      );
    });

    it('skips short leading lines (< 8 chars after trim) in the snippet', () => {
      const snippet =
        'A.\n   \nHe said I had until October 17, 2025 to submit my written response.';
      expect(resolveScrollPosition(doc, { paragraphIndex: 0, snippet })).toBe(
        doc.indexOf('He said I had until October 17'),
      );
    });

    it('falls back to the approximate chunk offset when the snippet is absent or unfindable', () => {
      expect(resolveScrollPosition(doc, { paragraphIndex: 0 })).toBe(0);
      expect(
        resolveScrollPosition(doc, {
          paragraphIndex: 0,
          snippet: 'text that exists nowhere in this document',
        }),
      ).toBe(0);
    });

    it('clamps the resolved position into the document', () => {
      const pos = resolveScrollPosition('short doc', { paragraphIndex: 99 });
      expect(pos).toBeGreaterThanOrEqual(0);
      expect(pos).toBeLessThanOrEqual('short doc'.length);
    });
  });

  describe('approximateChunkOffset (chunker byte-budget mirror)', () => {
    it('chunk 0 starts at offset 0', () => {
      expect(approximateChunkOffset('anything at all', 0)).toBe(0);
    });

    it('walks double-newline blocks and lands later chunks deeper in the doc, block-aligned', () => {
      // 8 blocks of 600 bytes ≈ 4,800 bytes ≈ 3 chunks of 1,536.
      const block = 'x'.repeat(600);
      const doc = Array.from({ length: 8 }, () => block).join('\n\n');
      const c1 = approximateChunkOffset(doc, 1);
      const c2 = approximateChunkOffset(doc, 2);
      expect(c1).toBeGreaterThan(0);
      expect(c2).toBeGreaterThan(c1);
      expect(c2).toBeLessThanOrEqual(doc.length);
      // Offsets land at a block start, never mid-block.
      expect(doc.slice(0, c1).endsWith('\n\n')).toBe(true);
      expect(doc.slice(0, c2).endsWith('\n\n')).toBe(true);
    });

    it('clamps past-the-end chunk indexes to the document length', () => {
      expect(approximateChunkOffset('tiny', 50)).toBe(4);
    });
  });
});
