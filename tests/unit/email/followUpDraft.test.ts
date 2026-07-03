import { describe, it, expect } from 'vitest';
import {
  applyDraftResponse,
  splitBodyWithCitations,
  verifyDraftCitations,
} from '@/features/email/followUpDraft';

describe('verifyDraftCitations — drops anything not verifiably grounded', () => {
  const noteContent = [
    'Retirement timing',
    'David is now targeting retirement at 64 rather than 66, two years earlier than his previous plan.',
    'Education planning',
    'We discussed the five-year gift-tax election and agreed to revisit it at the next meeting.',
  ].join('\n');
  const body =
    'I will rerun your projection using a retirement age of 64 and send the five-year gift-tax election details.';

  it('keeps a citation whose quote is a real substring of the note and whose matchText is in the body', () => {
    const verified = verifyDraftCitations(
      [{ matchText: 'retirement age of 64', quote: 'David is now targeting retirement at 64 rather than 66, two years earlier than his previous plan.', label: 'Retirement timing' }],
      body,
      noteContent,
    );
    expect(verified).toHaveLength(1);
    expect(verified[0]).toMatchObject({ matchText: 'retirement age of 64', label: 'Retirement timing' });
  });

  it('drops a citation whose quote does not appear verbatim in the note (hallucination guard)', () => {
    const verified = verifyDraftCitations(
      [{ matchText: 'retirement age of 64', quote: 'David wants to retire at 60, much earlier than planned.' }],
      body,
      noteContent,
    );
    expect(verified).toHaveLength(0);
  });

  it('drops a citation whose matchText is not actually present in the drafted body', () => {
    const verified = verifyDraftCitations(
      [{ matchText: 'a phrase never written', quote: 'David is now targeting retirement at 64 rather than 66, two years earlier than his previous plan.' }],
      body,
      noteContent,
    );
    expect(verified).toHaveLength(0);
  });

  it('tolerates whitespace/line-wrap differences when matching the quote against the note', () => {
    const wrapped = 'David is now targeting\nretirement at 64   rather than 66, two years earlier than his previous plan.';
    const verified = verifyDraftCitations(
      [{ matchText: 'retirement age of 64', quote: wrapped }],
      body,
      noteContent,
    );
    expect(verified).toHaveLength(1);
  });

  it('ignores malformed entries instead of throwing', () => {
    expect(verifyDraftCitations(null, body, noteContent)).toEqual([]);
    expect(verifyDraftCitations([null, 'not an object', {}], body, noteContent)).toEqual([]);
  });
});

describe('splitBodyWithCitations — builds an ordered text/citation run', () => {
  it('wraps each matched phrase and leaves surrounding text untouched', () => {
    const body = 'Please confirm the beneficiary designations on the rollover IRA soon.';
    const citations = verifyDraftCitations(
      [{ matchText: 'beneficiary designations on the rollover IRA', quote: 'Confirm the beneficiary designations on the rollover IRA.' }],
      body,
      'Action items\nConfirm the beneficiary designations on the rollover IRA.',
    );
    const segments = splitBodyWithCitations(body, citations);
    expect(segments[0]).toEqual({ type: 'text', value: 'Please confirm the ' });
    expect(segments[1]).toMatchObject({ type: 'citation' });
    expect(segments[2]).toEqual({ type: 'text', value: ' soon.' });
  });

  it('drops a citation whose matchText cannot be found from the current cursor onward', () => {
    const body = 'One citation phrase appears once.';
    const citations = [
      { id: 'a', matchText: 'citation phrase', quote: 'q1', label: undefined },
      { id: 'b', matchText: 'citation phrase', quote: 'q2', label: undefined },
    ];
    const segments = splitBodyWithCitations(body, citations);
    const citationSegments = segments.filter((s) => s.type === 'citation');
    expect(citationSegments).toHaveLength(1);
  });

  it('keeps an earlier-in-body citation even when the model lists it AFTER a later one (codex-review round 3 P3)', () => {
    const body = 'First the retirement age of 64, later the gift tax election.';
    // Listed out of body order: "gift tax election" appears second in the
    // body but is listed FIRST in the citations array.
    const citations = [
      { id: 'later', matchText: 'gift tax election', quote: 'q1', label: undefined },
      { id: 'earlier', matchText: 'retirement age of 64', quote: 'q2', label: undefined },
    ];
    const segments = splitBodyWithCitations(body, citations);
    const citationIds = segments
      .filter((s): s is Extract<typeof segments[number], { type: 'citation' }> => s.type === 'citation')
      .map((s) => s.citation.id);
    expect(citationIds).toEqual(['earlier', 'later']);
  });

  it('returns a single text segment when there are no citations', () => {
    expect(splitBodyWithCitations('Plain body.', [])).toEqual([{ type: 'text', value: 'Plain body.' }]);
  });
});

describe('applyDraftResponse — shape tolerance and subject derivation', () => {
  it('derives the subject from the note name and verifies citations against the note', () => {
    const result = applyDraftResponse(
      'Annual review notes.docx',
      {
        body: 'I will confirm the beneficiary designations on the rollover IRA.',
        citations: [
          { matchText: 'beneficiary designations on the rollover IRA', quote: 'Confirm the beneficiary designations on the rollover IRA.' },
        ],
      },
      'Action items\nConfirm the beneficiary designations on the rollover IRA.',
    );
    expect(result.subject).toBe('Follow-up: Annual review notes');
    expect(result.body).toBe('I will confirm the beneficiary designations on the rollover IRA.');
    expect(result.citations).toHaveLength(1);
  });

  it('degrades to an empty body (never throws) when the response shape is unexpected', () => {
    const result = applyDraftResponse('Notes.docx', { body: 42, citations: 'not an array' }, 'note');
    expect(result.body).toBe('');
    expect(result.citations).toEqual([]);
  });
});
