import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DateableCitation } from './contracts';
import { AnswerDatePresentation } from './AnswerDatePresentation';

function citation(overrides: Partial<DateableCitation> = {}): DateableCitation {
  return {
    label: 'Source',
    ...overrides,
  };
}

describe('AnswerDatePresentation', () => {
  it('stays out of the way when older citations have no date fields', () => {
    render(
      <AnswerDatePresentation
        citations={[citation({ label: 'Undated plan.pdf' })]}
      />
    );

    expect(screen.queryByTestId('answer-date-timeline')).toBeNull();
  });

  it('shows dated source chips as a record timeline', () => {
    render(
      <AnswerDatePresentation
        citations={[
          citation({
            label: 'Plan summary.docx',
            sourceDate: {
              value: '2026-01-08T00:00:00.000Z',
              kind: 'effective',
              confidence: 'source',
            },
          }),
          citation({
            label: 'Account statement.pdf',
            sourceDate: {
              value: '2026-06-12T00:00:00.000Z',
              kind: 'document-modified',
              confidence: 'derived',
            },
          }),
        ]}
      />
    );

    expect(screen.getByTestId('answer-date-timeline').textContent).toContain(
      'Dates in the cited records'
    );
    expect(
      screen.getByTestId('answer-citation-date-chip-1').textContent
    ).toContain('Jan 8, 2026');
    expect(
      screen.getByTestId('answer-citation-date-chip-2').textContent
    ).toContain('Local file metadata · Jun 12, 2026');
  });

  it('warns only about timestamps from matching copies of the same record', () => {
    render(
      <AnswerDatePresentation
        citations={[
          citation({
            label: 'Inbox copy',
            sourceDate: {
              value: '2026-02-01T00:00:00.000Z',
              kind: 'received',
              confidence: 'source',
            },
            datedFact: {
              key: 'mail-message:<jordan-review@example.test>:received-date',
              value: '2026-02-01T00:00:00Z',
            },
          }),
          citation({
            label: 'Archive copy',
            sourceDate: {
              value: '2026-06-20T00:00:00.000Z',
              kind: 'received',
              confidence: 'source',
            },
            dateConflict: {
              kind: 'conflicting-dated-evidence',
              factKey:
                'mail-message:<jordan-review@example.test>:received-date',
              relation: 'newer-conflicts-with-older',
              evidence: [
                {
                  sourceId: 'mail:inbox-copy',
                  path: 'Inbox copy',
                  value: '2026-02-01T00:00:00Z',
                  sourceDate: {
                    value: '2026-02-01T00:00:00.000Z',
                    kind: 'received',
                    confidence: 'source',
                  },
                },
                {
                  sourceId: 'mail:archive-copy',
                  path: 'Archive copy',
                  value: '2026-06-20T00:00:00Z',
                  sourceDate: {
                    value: '2026-06-20T00:00:00.000Z',
                    kind: 'received',
                    confidence: 'source',
                  },
                },
              ],
            },
          }),
        ]}
      />
    );

    expect(screen.getByTestId('answer-date-conflict').textContent).toContain(
      'Matching record copies have different timestamps. Newest copy: Jun 20, 2026. Earlier copy: Feb 1, 2026.'
    );
  });
});
