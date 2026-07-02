import { describe, it, expect } from 'vitest';
import {
  sourceChipLabel,
  isImportedMeetingNoteSource,
  hasImportedMeetingNoteSource,
} from '@/platform/clientMap/meetingNoteSources';
import type { SourceRef, ClientMapItem } from '@/platform/clientMap/types';

const src = (kind: SourceRef['kind'], ref: string, locator?: string): SourceRef => ({
  kind,
  ref,
  snippet: 'q',
  ...(locator != null ? { locator } : {}),
});

describe('sourceChipLabel', () => {
  it('labels a Jump-export document by tool (filename recognition)', () => {
    expect(sourceChipLabel(src('document', 'Clients/Brennan/Jump Meeting Recap 2026-06-24.txt'))).toBe(
      'Jump meeting note',
    );
  });
  it('labels Zocks and meeting kinds explicitly', () => {
    expect(sourceChipLabel(src('zocks', 'zocks:abc'))).toBe('Zocks meeting note');
    expect(sourceChipLabel(src('meeting', 'meeting:xyz'))).toBe('meeting');
  });
  it('keeps the existing generic labels and locator suffix for everything else', () => {
    expect(sourceChipLabel(src('email', 'mail:1'))).toBe('email');
    expect(sourceChipLabel(src('document', 'Clients/Brennan/Statement Q4.pdf', 'p. 2'))).toBe(
      'source p. 2',
    );
  });
  it('does NOT tag an ordinary document that merely contains the word jump', () => {
    expect(sourceChipLabel(src('document', 'Clients/B/long-jump-training-results.pdf'))).toBe('source');
  });
});

describe('imported-meeting-note detection', () => {
  it('treats zocks, meeting, and Jump-recognized documents as imported meeting notes', () => {
    expect(isImportedMeetingNoteSource(src('zocks', 'zocks:1'))).toBe(true);
    expect(isImportedMeetingNoteSource(src('meeting', 'meeting:1'))).toBe(true);
    expect(
      isImportedMeetingNoteSource(src('document', 'Clients/B/Jump-Note-2026-06-01.pdf')),
    ).toBe(true);
    expect(isImportedMeetingNoteSource(src('email', 'mail:1'))).toBe(false);
    expect(isImportedMeetingNoteSource(src('document', 'Clients/B/Statement.pdf'))).toBe(false);
  });
  it('flags an item when any of its sources is an imported meeting note', () => {
    const item: ClientMapItem = {
      id: 'i1',
      text: 'Discussed 529 contributions',
      origin: 'ai',
      isAssumption: false,
      sources: [src('document', 'Clients/B/Statement.pdf'), src('zocks', 'zocks:1')],
      updatedAt: '2026-06-24T00:00:00Z',
    };
    expect(hasImportedMeetingNoteSource(item)).toBe(true);
  });
});
