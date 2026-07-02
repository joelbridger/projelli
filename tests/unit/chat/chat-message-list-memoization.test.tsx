/**
 * Perf (P1.2) — ChatMessageList + MessageBubble memoization.
 *
 * Before this change, AIChatViewer passed the full `messages` array straight
 * into every MessageBubble as a prop. Any array reference change (even one
 * unrelated to a given bubble) broke memoization for ALL bubbles at once,
 * and the message list itself lived inline in AIChatViewer, so a composer
 * keystroke (which only changes `inputValue`) re-rendered the whole history.
 *
 * This test drives ChatMessageList directly (no need to stand up the full
 * AIChatViewer + provider plumbing) and proves: re-rendering the parent with
 * referentially-STABLE props is a no-op for the memoized list/bubbles, while
 * an actual `messages` change still re-renders exactly what changed.
 */
import { describe, it, expect, vi } from 'vitest';
import { useRef, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { EntityLabel } from '@/platform/hooks/useEntityLabel';
import type { ChatMessage } from '@/platform/types/ai';

const renderSpy = vi.fn();

vi.mock('@/features/ask/chat/MessageBubble', () => ({
  MessageBubble: (props: { msg: ChatMessage; idx: number }) => {
    renderSpy(props.idx);
    return <div data-testid={`bubble-${props.idx}`}>{props.msg.content}</div>;
  },
}));

import { ChatMessageList } from '@/features/ask/chat/ChatMessageList';

const entityLabel = {} as EntityLabel;
const t = ((key: string) => key) as unknown as (key: string) => string;
const noop = () => {};

const EMPTY_PROPOSED_FACTS: never[] = [];

function makeMessages(): ChatMessage[] {
  return [
    { role: 'user', content: 'hi', timestamp: '2026-07-01T00:00:00.000Z' },
    { role: 'assistant', content: 'hello', timestamp: '2026-07-01T00:00:01.000Z' },
  ];
}

/** Mirrors how AIChatViewer hosts ChatMessageList: a composer input lives
 * alongside it, and typing in the composer re-renders the HOST, not
 * ChatMessageList's props. */
function Harness({ messages }: { messages: ChatMessage[] }) {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef(null);
  return (
    <div>
      <input
        data-testid="composer-input"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
      />
      <ChatMessageList
        messages={messages}
        isLoading={false}
        t={t as never}
        entityLabel={entityLabel}
        handleCitationClick={noop}
        handleMissingSource={noop}
        handleExpandSegment={noop}
        onRetryLastError={noop}
        onStop={noop}
        proposedFacts={EMPTY_PROPOSED_FACTS}
        onAcceptProposedFact={noop}
        onRejectProposedFact={noop}
        messagesEndRef={messagesEndRef}
      />
    </div>
  );
}

describe('ChatMessageList / MessageBubble memoization (Perf P1.2)', () => {
  it('does not re-render bubbles when the host re-renders with the same messages reference', () => {
    const messages = makeMessages();
    const { rerender } = render(<Harness messages={messages} />);
    expect(renderSpy).toHaveBeenCalledTimes(2); // one per message, initial mount

    renderSpy.mockClear();
    // Simulate composer typing: the host re-renders, but `messages` itself
    // (and every other ChatMessageList prop) is referentially unchanged.
    fireEvent.change(screen.getByTestId('composer-input'), { target: { value: 'a' } });
    fireEvent.change(screen.getByTestId('composer-input'), { target: { value: 'ab' } });
    fireEvent.change(screen.getByTestId('composer-input'), { target: { value: 'abc' } });

    expect(renderSpy).not.toHaveBeenCalled();

    // A genuine messages change still re-renders (correctness, not just speed).
    renderSpy.mockClear();
    const updated = [...messages, { role: 'assistant' as const, content: 'more', timestamp: '2026-07-01T00:00:02.000Z' }];
    rerender(<Harness messages={updated} />);
    expect(renderSpy).toHaveBeenCalledTimes(3);
  });
});
