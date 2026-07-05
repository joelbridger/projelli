import { describe, it, expect } from 'vitest';
import {
  buildCitationFootnotes,
  appendCitationFootnotes,
  type DraftCitation,
} from '@/features/email/followUpDraft';

const CITES: DraftCitation[] = [
  { id: 'cite-0', matchText: 'beneficiary designations', quote: 'Confirm the beneficiary designations on the rollover IRA.', label: 'Action items' },
  { id: 'cite-1', matchText: '$1.8M target', quote: 'Retirement target is $1.8M.', label: undefined },
];

describe('R4b — citation footnotes travel with a saved/sent draft', () => {
  it('lists source NAMES and quotes, never internal citation ids', () => {
    const fn = buildCitationFootnotes(CITES, 'Annual review notes.docx');
    expect(fn).toContain('Action items');
    expect(fn).toContain('Confirm the beneficiary designations on the rollover IRA.');
    expect(fn).toContain('Retirement target is $1.8M.');
    // The heading label is the source name; a citation with no heading falls
    // back to the note name — never a bare internal id.
    expect(fn).toContain('Annual review notes.docx');
    expect(fn).not.toContain('cite-0');
    expect(fn).not.toContain('cite-1');
  });

  it('appends the footnotes below the body, separated', () => {
    const out = appendCitationFootnotes('Hi Tom, see below.', CITES, 'Notes.docx');
    expect(out.startsWith('Hi Tom, see below.')).toBe(true);
    expect(out).toContain('Confirm the beneficiary designations on the rollover IRA.');
    // What the advisor saw (the body) is preserved verbatim at the top.
    expect(out.indexOf('Hi Tom, see below.')).toBe(0);
  });

  it('returns the body unchanged when there is nothing cited', () => {
    expect(appendCitationFootnotes('Just a note.', [], 'Notes.docx')).toBe('Just a note.');
    expect(buildCitationFootnotes([], 'Notes.docx')).toBe('');
  });
});
