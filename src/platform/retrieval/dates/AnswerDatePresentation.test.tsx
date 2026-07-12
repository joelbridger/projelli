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
    render(<AnswerDatePresentation citations={[citation({ label: 'Undated plan.pdf' })]} />);

    expect(screen.queryByTestId('answer-date-timeline')).toBeNull();
  });

  it('shows dated source chips as a record timeline', () => {
    render(
      <AnswerDatePresentation
        citations={[
          citation({
            label: 'Plan summary.docx',
            sourceDate: { value: '2026-01-08T00:00:00.000Z', kind: 'effective', confidence: 'source' },
          }),
          citation({
            label: 'Account statement.pdf',
            sourceDate: { value: '2026-06-12T00:00:00.000Z', kind: 'document-modified', confidence: 'derived' },
          }),
        ]}
      />
    );

    expect(screen.getByTestId('answer-date-timeline').textContent).toContain('Dates in the cited records');
    expect(screen.getByTestId('answer-citation-date-chip-1').textContent).toContain('Jan 8, 2026');
    expect(screen.getByTestId('answer-citation-date-chip-2').textContent).toContain('Jun 12, 2026');
  });

  it('flags a disagreement while keeping both the newest and authoritative dates visible', () => {
    render(
      <AnswerDatePresentation
        citations={[
          citation({
            label: 'Signed instruction.pdf',
            sourceDate: { value: '2026-02-01T00:00:00.000Z', kind: 'effective', confidence: 'source' },
            datedFact: { key: 'umbrella-limit', value: '$3 million', authorityReason: 'signed policy declaration' },
          }),
          citation({
            label: 'Newer note.docx',
            sourceDate: { value: '2026-06-20T00:00:00.000Z', kind: 'received', confidence: 'source' },
            dateConflict: {
              kind: 'conflicting-dated-evidence',
              factKey: 'umbrella-limit',
              relation: 'newer-conflicts-with-older',
              evidence: [
                {
                  sourceId: 'signed-policy',
                  path: 'Signed instruction.pdf',
                  value: '$3 million',
                  sourceDate: { value: '2026-02-01T00:00:00.000Z', kind: 'effective', confidence: 'source' },
                  authorityReason: 'signed policy declaration',
                },
                {
                  sourceId: 'newer-note',
                  path: 'Newer note.docx',
                  value: '$5 million',
                  sourceDate: { value: '2026-06-20T00:00:00.000Z', kind: 'received', confidence: 'source' },
                },
              ],
            },
          }),
        ]}
      />
    );

    expect(screen.getByTestId('answer-date-conflict').textContent).toContain(
      'Newest record: Jun 20, 2026 — $5 million. Authoritative record: Feb 1, 2026 — $3 million (signed policy declaration).'
    );
    expect(screen.getByTestId('answer-date-timeline').textContent).toContain('Authoritative');
  });
});
