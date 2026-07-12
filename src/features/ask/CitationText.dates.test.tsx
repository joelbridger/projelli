import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/platform/types/ai';
import { CitationText } from './CitationText';
import { reconstructTurns } from './askHelpers';
import { bindAnswerBlocks } from './answerBlockHelpers';
import { REAL_RAG_RETRIEVE_DATE_HITS } from '../../../tests/fixtures/rag-dated-retrieval';

describe('CitationText dated Ask evidence', () => {
  it('takes real rag_retrieve mail and CRM fields through citations, save/reload, and honest rendering', () => {
    const bound = bindAnswerBlocks(
      '[[BLOCK:FILES]]\nThe matching mail copies and CRM note were retrieved. [mail:mail-copy-older paragraph 0] [mail:mail-copy-newer paragraph 0] [crm:note:42 paragraph 0]',
      REAL_RAG_RETRIEVE_DATE_HITS,
      'jordan'
    );
    const restored = reconstructTurns(
      JSON.parse(
        JSON.stringify([
          {
            role: 'user',
            content: 'What changed?',
            timestamp: '2026-07-12T12:00:00.000Z',
          },
          {
            role: 'assistant',
            content: bound.answer,
            timestamp: '2026-07-12T12:00:01.000Z',
            askCitations: bound.citations,
            askSources: bound.sources,
            askBlocks: bound.blocks.map((block) => ({
              kind: block.kind,
              text: block.text,
            })),
          },
        ])
      ) as ChatMessage[]
    )[0];

    render(
      <CitationText
        text={restored?.answer ?? ''}
        citations={restored?.citations ?? []}
        selected={null}
        onSelect={() => undefined}
      />
    );
    // The real command's source timestamps and record-copy warning remain after
    // reload. The renderer does not claim the mail and CRM documents disagree
    // about a business fact.
    expect(screen.getAllByTestId(/answer-citation-date-chip-/)).toHaveLength(3);
    expect(screen.getByTestId('answer-date-conflict')).toHaveTextContent(
      'Matching record copies have different timestamps. Newest copy: Jul 11, 2026. Earlier copy: Jul 10, 2026.'
    );
  });
});
