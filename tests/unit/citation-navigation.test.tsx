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
    expect(open).toHaveBeenCalledWith('notes/pricing.md', 3);
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
    // Multiple source buttons inside the expanded accordion, plus the
    // inline citation buttons above. Use getAllByTestId and assert
    // length >= 2 to stay resilient to the accordion rendering pattern.
    expect(
      screen.getAllByTestId('chat-citation-pricing.md-3').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('clicking a source row in the accordion opens the file', () => {
    const open = vi.fn();
    render(
      <AIChatViewer
        chatData={buildChatWithCitations()}
        onOpenFileAtPath={open}
      />,
    );
    fireEvent.click(screen.getByTestId('chat-sources-toggle'));
    // Find the accordion-level button (the last chat-citation-*-3
    // element in the DOM is the accordion row, since inline citations
    // come first in document order).
    const all = screen.getAllByTestId('chat-citation-pricing.md-3');
    const accordionRow = all[all.length - 1]!;
    fireEvent.click(accordionRow);
    expect(open).toHaveBeenCalledWith('notes/pricing.md', 3);
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
