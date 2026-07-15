import { describe, it, expect } from 'vitest';
import { needsReview } from './insights/review/meetingReviewArtifactStore';
import type { MeetingSummary } from './ClientMeetingsTab';
import type { NoticeState } from './noticeLedger';

const NOW = Date.parse('2026-07-04T12:00:00.000Z');

function meeting(overrides: Partial<MeetingSummary> = {}): MeetingSummary {
  return {
    dir: '/ws/Clients/Acme/Meetings/m1',
    folderName: 'm1',
    meta: {
      matterId: 'm',
      startedAt: '2026-07-04T11:00:00.000Z', // 1h old, not day-old
      consent: { mode: 'two-party', confirmedBy: 'advisor', confirmedAt: '2026-07-04T11:00:00.000Z' },
      reviewedAt: '2026-07-04T11:30:00.000Z', // reviewed so no unreviewed-note noise
    },
    hasNotes: true,
    hasAudio: true,
    hasTranscript: true,
    ...overrides,
  };
}

describe('needsReview — recording notice', () => {
  it('adds no notice item when the notice was verified', () => {
    const items = needsReview(meeting(), [], NOW, { state: { status: 'verified', atMs: 1000, snippet: 's', confidence: 0.8 }, policy: 'standard' });
    expect(items.some((i) => i.kind === 'notice-unverified' || i.kind === 'notice-quarantined')).toBe(false);
  });

  it('adds no notice item when the check has not run yet (unchecked)', () => {
    const items = needsReview(meeting(), [], NOW, { state: { status: 'unchecked' }, policy: 'standard' });
    expect(items.some((i) => i.kind === 'notice-unverified' || i.kind === 'notice-quarantined')).toBe(false);
  });

  it('Standard: flags an unverified notice as notice-unverified', () => {
    const items = needsReview(meeting(), [], NOW, { state: { status: 'unverified', at: 't' }, policy: 'standard' });
    expect(items.map((i) => i.kind)).toContain('notice-unverified');
    expect(items.map((i) => i.kind)).not.toContain('notice-quarantined');
  });

  it('Strict: quarantines an unverified notice', () => {
    const items = needsReview(meeting(), [], NOW, { state: { status: 'unverified', at: 't' }, policy: 'strict' });
    expect(items.map((i) => i.kind)).toContain('notice-quarantined');
    expect(items.map((i) => i.kind)).not.toContain('notice-unverified');
  });

  it('resolved notice clears the flag under both policies', () => {
    const resolved: NoticeState = { status: 'resolved', resolution: 'disclosed-in-advance', at: 't' };
    for (const policy of ['standard', 'strict'] as const) {
      const items = needsReview(meeting(), [], NOW, { state: resolved, policy });
      expect(items.some((i) => i.kind === 'notice-unverified' || i.kind === 'notice-quarantined')).toBe(false);
    }
  });

  it('is backward-compatible when no notice argument is passed', () => {
    // Existing callers pass only (meeting, crmQueue) — must not throw or add a notice item.
    const items = needsReview(meeting(), []);
    expect(items.some((i) => i.kind === 'notice-unverified' || i.kind === 'notice-quarantined')).toBe(false);
  });
});
