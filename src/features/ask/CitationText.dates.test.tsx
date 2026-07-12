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
  it('takes a rag_retrieve-shaped mail, CRM, and file response through citations, save/reload, and honest rendering', () => {
    // This is the complete renderer half of the desktop path. These are the
    // exact camelCase fields returned by Rust's `rag_retrieve`, not a separate
    // citation-only test shape.
    const retrieved: RagHit[] = [
      {
        id: 'mail-date', sourceId: 'mail:message-42', path: 'mail:message-42', sourceType: 'mail',
        chunkText: 'The client confirmed the review date.', score: 0.98, paragraphIndex: 0, matterId: 'jordan',
        sourceDate: { value: '2026-07-10T14:30:00.000Z', kind: 'received', confidence: 'source' },
        datedFact: { key: 'mail-message:<message-42>:received-date', value: '2026-07-10T14:30:00Z' },
      },
      {
        id: 'crm-date', sourceId: 'crm:note:42', path: 'crm:note:42', sourceType: 'crm',
        chunkText: 'CRM note says the account review is complete.', score: 0.97, paragraphIndex: 0, matterId: 'jordan',
        sourceDate: { value: '2026-07-11T14:30:00.000Z', kind: 'updated', confidence: 'source' },
        datedFact: { key: 'crm-record:note:42:updated-date', value: '2026-07-11T14:30:00Z' },
      },
      {
        id: 'file-date', sourceId: '/clients/jordan/notes.docx', path: '/clients/jordan/notes.docx', sourceType: 'docx',
        chunkText: 'Local notes for the review.', score: 0.96, paragraphIndex: 0, matterId: 'jordan',
        sourceDate: { value: '2026-07-12T14:30:00.000Z', kind: 'document-modified', confidence: 'derived' },
      },
      {
        id: 'malformed-mail-date', sourceId: 'mail:legacy', path: 'mail:legacy', sourceType: 'mail',
        chunkText: 'An old imported email with an unreadable date.', score: 0.95, paragraphIndex: 0, matterId: 'jordan',
        sourceDate: { value: null, rawValue: 'last Tuesday', kind: 'received', confidence: 'source' },
      },
    ];
    const bound = bindAnswerBlocks(
      '[[BLOCK:FILES]]\nThe mail, CRM note, local file, and legacy mail were retrieved. [mail:message-42 paragraph 0] [crm:note:42 paragraph 0] [notes.docx paragraph 0] [mail:legacy paragraph 0]',
      retrieved,
      'jordan',
    );
    const restored = reconstructTurns(JSON.parse(JSON.stringify([
      { role: 'user', content: 'What changed?', timestamp: '2026-07-12T12:00:00.000Z' },
      {
        role: 'assistant', content: bound.answer, timestamp: '2026-07-12T12:00:01.000Z',
        askCitations: bound.citations, askSources: bound.sources,
        askBlocks: bound.blocks.map((block) => ({ kind: block.kind, text: block.text })),
      },
    ])) as ChatMessage[])[0];

    render(<CitationText text={restored?.answer ?? ''} citations={restored?.citations ?? []} selected={null} onSelect={() => undefined} />);
    // The malformed date is retained in saved evidence but never turned into a
    // made-up timeline date; the three valid source dates remain after reload.
    expect(screen.getAllByTestId(/answer-citation-date-chip-/)).toHaveLength(3);
    expect(screen.getByTestId('answer-citation-date-chip-3')).toHaveTextContent('Local file metadata · Jul 12, 2026');
    expect(screen.getByTestId('answer-date-timeline')).not.toHaveTextContent('last Tuesday');
  });

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
