/**
 * 2026-07-04 UX review B5: meeting folders are machine-named
 * (`<date>-<matter-slug>`) and must never render as titles — the human
 * title derives from what we know about the meeting.
 */
import { describe, it, expect } from 'vitest';
import i18n from '@/i18n';
import {
  meetingDisplayTitle,
  formatMeetingDuration,
} from '@/features/meetings/meetingDisplay';
import type { MeetingMeta } from '@/features/meetings/meetingStore';

const t = i18n.t.bind(i18n);

const base: MeetingMeta = {
  matterId: 'm-1',
  startedAt: '2026-06-30T15:00:00Z',
  consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-06-30T15:00:00Z' },
};

describe('meetingDisplayTitle', () => {
  it('uses the built-in type label when a type is set', () => {
    expect(meetingDisplayTitle({ ...base, typeId: 'annual-review' }, t)).toBe('Annual review');
  });

  it('uses a custom type id verbatim', () => {
    expect(meetingDisplayTitle({ ...base, typeId: 'Estate planning' }, t)).toBe('Estate planning');
  });

  it('falls back to the calendar title, then dictated, then a plain "Meeting"', () => {
    expect(meetingDisplayTitle({ ...base, calendarTitle: 'Quarterly review — Brennans' }, t)).toBe(
      'Quarterly review — Brennans',
    );
    expect(meetingDisplayTitle({ ...base, dictation: true }, t)).toBe('Dictated note');
    expect(meetingDisplayTitle(base, t)).toBe('Meeting');
    expect(meetingDisplayTitle(null, t)).toBe('Meeting');
  });

  it('never returns a machine folder name shape', () => {
    // No meta at all (pre-contract folder): still a human word, not the slug.
    expect(meetingDisplayTitle(null, t)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe('formatMeetingDuration', () => {
  it('rounds to minutes with a 1-minute floor', () => {
    expect(formatMeetingDuration(2_460_000, t)).toBe('41 min');
    expect(formatMeetingDuration(20_000, t)).toBe('1 min');
  });

  it('returns null when unknown', () => {
    expect(formatMeetingDuration(undefined, t)).toBeNull();
    expect(formatMeetingDuration(0, t)).toBeNull();
  });
});
