import { describe, it, expect } from 'vitest';
import type { NoticeEntry, NoticeState } from '../noticeLedger';
import {
  deriveNoticeCardEvidence,
  noticeEvidenceSatisfied,
  type NoticeEvidenceRule,
} from './noticeCardEvidence';

const DIR = 'Meetings/2026-07-04-henderson';

const joined = (): NoticeEntry => ({
  kind: 'notice-card-joined',
  meetingDir: DIR,
  at: '2026-07-04T16:00:00Z',
  platform: 'teams',
  meetingTitle: 'Henderson quarterly review',
});
const left = (): NoticeEntry => ({ kind: 'notice-card-left', meetingDir: DIR, at: '2026-07-04T16:45:00Z' });
const present = (): NoticeEntry => ({
  kind: 'notice-card-present-for-entire-recording',
  meetingDir: DIR,
  at: '2026-07-04T16:45:00Z',
  platform: 'teams',
});
const failed = (): NoticeEntry => ({
  kind: 'notice-card-failed',
  meetingDir: DIR,
  at: '2026-07-04T16:00:05Z',
  reason: 'denied',
});

describe('deriveNoticeCardEvidence', () => {
  it('reports full-duration presence when the derived event is filed', () => {
    const ev = deriveNoticeCardEvidence([joined(), present()]);
    expect(ev.presentForEntireRecording).toBe(true);
    expect(ev.platform).toBe('teams');
  });

  it('does NOT claim full-duration presence from a bare join (join without the derived fact)', () => {
    // A join that never produced a present-for-entire-recording fact (e.g. the
    // card dropped mid-meeting) must not count as full-duration evidence.
    const ev = deriveNoticeCardEvidence([joined(), left()]);
    expect(ev.presentForEntireRecording).toBe(false);
  });

  it('surfaces the failure reason when the card failed to join', () => {
    const ev = deriveNoticeCardEvidence([failed()]);
    expect(ev.presentForEntireRecording).toBe(false);
    expect(ev.failedReason).toBe('denied');
  });

  it('is empty for a meeting with no card events at all', () => {
    const ev = deriveNoticeCardEvidence([{ kind: 'verbal-notice-not-detected', meetingDir: DIR, at: 'x' }]);
    expect(ev.presentForEntireRecording).toBe(false);
    expect(ev.platform).toBeUndefined();
    expect(ev.failedReason).toBeUndefined();
  });
});

describe('noticeEvidenceSatisfied', () => {
  const verified: NoticeState = { status: 'verified', atMs: 14000, snippet: 'recording this', confidence: 0.9 };
  const unverified: NoticeState = { status: 'unverified', at: 'x' };
  const resolved: NoticeState = { status: 'resolved', resolution: 'disclosed-in-advance', at: 'x' };
  const unchecked: NoticeState = { status: 'unchecked' };
  const cardYes = { presentForEntireRecording: true, platform: 'teams' as const };
  const cardNo = { presentForEntireRecording: false };

  const check = (state: NoticeState, card: typeof cardYes | typeof cardNo, rule: NoticeEvidenceRule) =>
    noticeEvidenceSatisfied(state, card, rule);

  it('either rule: verbal alone satisfies', () => {
    expect(check(verified, cardNo, 'either')).toBe(true);
  });

  it('either rule: full-duration card alone satisfies (the whole point of the feature)', () => {
    expect(check(unverified, cardYes, 'either')).toBe(true);
  });

  it('either rule: neither verbal nor card => not satisfied', () => {
    expect(check(unverified, cardNo, 'either')).toBe(false);
  });

  it('both rule: verbal without card is NOT satisfied', () => {
    expect(check(verified, cardNo, 'both')).toBe(false);
  });

  it('both rule: card without verbal is NOT satisfied', () => {
    expect(check(unverified, cardYes, 'both')).toBe(false);
  });

  it('both rule: verbal AND card satisfies', () => {
    expect(check(verified, cardYes, 'both')).toBe(true);
  });

  it('a human resolution counts as verbal evidence under both rules', () => {
    expect(check(resolved, cardNo, 'either')).toBe(true);
    expect(check(resolved, cardYes, 'both')).toBe(true);
  });

  it('unchecked (no transcript yet) is treated as not-yet-evidenced, never falsely satisfied', () => {
    expect(check(unchecked, cardNo, 'either')).toBe(false);
  });
});
