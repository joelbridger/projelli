import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/platform/types/ai';
import type { RagHit } from '@/platform/utils/tauri-commands';
import { CitationText } from './CitationText';
import { reconstructTurns } from './askHelpers';
import { bindAnswerBlocks } from './answerBlockHelpers';

function datedHits(): RagHit[] {
  return [
    {
      id: 'signed-policy',
      sourceId: '/clients/jordan/signed-policy.pdf',
      path: '/clients/jordan/Signed policy.pdf',
      chunkText: 'The signed policy sets the umbrella limit at $3 million.',
      score: 0.97,
      paragraphIndex: 0,
      matterId: 'jordan',
      sourceType: 'pdf',
      sourceDate: {
        value: '2026-02-01T00:00:00Z',
        kind: 'effective',
        confidence: 'source',
      },
      datedFact: {
        key: 'umbrella-limit',
        value: '$3 million',
        authorityReason: 'signed policy declaration',
      },
    },
    {
      id: 'carrier-email',
      sourceId: 'mail:carrier',
      path: '/clients/jordan/Carrier email.eml',
      chunkText: 'The carrier says the umbrella limit is now $5 million.',
      score: 0.95,
      paragraphIndex: 0,
      matterId: 'jordan',
      sourceType: 'mail',
      sourceDate: {
        value: '2026-06-20T00:00:00Z',
        kind: 'received',
        confidence: 'source',
      },
      datedFact: { key: 'umbrella-limit', value: '$5 million' },
    },
  ];
}

describe('CitationText dated Ask evidence', () => {
  it('shows dated conflict evidence from a real Ask binding and after reload', () => {
    const bound = bindAnswerBlocks(
      '[[BLOCK:FILES]]\nWhat is Jordan’s umbrella limit? [Signed policy.pdf paragraph 0] The carrier later says $5 million. [Carrier email.eml paragraph 0]',
      datedHits(),
      'jordan',
    );

    expect(bound.citations).toHaveLength(2);
    expect(bound.citations.every((citation) => citation.sourceDate?.value)).toBe(true);
    expect(bound.citations.every((citation) => citation.dateConflict)).toBe(true);

    const live = render(
      <CitationText
        text={bound.answer}
        citations={bound.citations}
        selected={null}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getAllByTestId(/answer-citation-date-chip-/)).toHaveLength(2);
    expect(screen.getByTestId('answer-date-conflict')).toHaveTextContent(
      'Newest record: Jun 20, 2026 — $5 million. Authoritative record: Feb 1, 2026 — $3 million (signed policy declaration).',
    );
    live.unmount();

    // Ask persists citations and sources in its conversation file. A JSON round
    // trip is the same shape it reads after an app restart.
    const restoredMessages = JSON.parse(JSON.stringify([
      { role: 'user', content: 'What is Jordan’s umbrella limit?', timestamp: '2026-07-12T12:00:00.000Z' },
      {
        role: 'assistant',
        content: bound.answer,
        timestamp: '2026-07-12T12:00:01.000Z',
        askCitations: bound.citations,
        askSources: bound.sources,
        askBlocks: bound.blocks.map((block) => ({ kind: block.kind, text: block.text })),
      },
    ])) as ChatMessage[];
    const restored = reconstructTurns(restoredMessages)[0];
    expect(restored).toBeDefined();

    render(
      <CitationText
        text={restored?.answer ?? ''}
        citations={restored?.citations ?? []}
        selected={null}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getAllByTestId(/answer-citation-date-chip-/)).toHaveLength(2);
    expect(screen.getByTestId('answer-date-conflict')).toBeVisible();
  });
});
