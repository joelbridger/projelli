import { describe, it, expect } from 'vitest';
import { needsReview } from '@/features/meetings/meetingStore';
import type { MeetingSummary } from '@/features/meetings/ClientMeetingsTab';

const baseMeeting: MeetingSummary = {
  dir: 'Clients/Hendersons/Meetings/2026-06-30-annual-review',
  folderName: '2026-06-30-annual-review',
  hasNotes: true,
  hasAudio: true,
  hasTranscript: true,
  meta: {
    matterId: 'm-1',
    startedAt: '2026-06-30T15:00:00Z',
    consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-06-30T15:00:00Z' },
  },
};

describe('needsReview', () => {
  it('flags unreviewed notes and undrafted follow-ups', () => {
    const items = needsReview(baseMeeting, []);
    expect(items.map((i) => i.kind)).toEqual(['unreviewed-note', 'no-followup']);
  });

  it('flags waiting CRM updates for this meeting only', () => {
    const q = [
      { matterId: 'm-1', sourceRef: `meeting:${baseMeeting.dir}#0`, status: 'proposed' as const },
    ];
    expect(needsReview(baseMeeting, q).some((i) => i.kind === 'crm-waiting')).toBe(true);
  });

  it('ignores CRM queue items for a different meeting', () => {
    const q = [
      { matterId: 'm-1', sourceRef: 'meeting:Clients/Hendersons/Meetings/other#0', status: 'proposed' as const },
    ];
    expect(needsReview(baseMeeting, q).some((i) => i.kind === 'crm-waiting')).toBe(false);
  });

  // 2026-07-04 UX review S3: "no follow-up" must not nag minutes after the
  // meeting — it only counts once the meeting is a day old.
  it('does not flag "no follow-up" on a meeting under a day old', () => {
    const now = Date.parse('2026-06-30T18:00:00Z'); // 3h after startedAt
    expect(needsReview(baseMeeting, [], now).map((i) => i.kind)).toEqual(['unreviewed-note']);
  });

  it('flags "no follow-up" once the meeting is a day old', () => {
    const now = Date.parse('2026-07-02T15:00:00Z');
    expect(needsReview(baseMeeting, [], now).map((i) => i.kind)).toEqual(['unreviewed-note', 'no-followup']);
  });

  it('clear when reviewed, drafted, and queue empty', () => {
    const done: MeetingSummary = {
      ...baseMeeting,
      meta: { ...baseMeeting.meta!, reviewedAt: '2026-07-01T00:00:00Z', followupDraftedAt: '2026-07-01T00:00:00Z' },
    };
    expect(needsReview(done, [])).toEqual([]);
  });

  // P1 fix (2026-07): an orphaned/incomplete meeting folder (missing or
  // corrupt meeting.json) must be surfaced honestly in the needs-review
  // queue, never silently hidden or treated as a normal, fully-formed entry.
  it('flags a meeting with unreadable/missing meeting.json for review', () => {
    const orphaned: MeetingSummary = { ...baseMeeting, meta: null };
    expect(needsReview(orphaned, []).map((i) => i.kind)).toContain('unreadable-meta');
  });
});
