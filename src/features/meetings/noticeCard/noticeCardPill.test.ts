import { describe, it, expect } from 'vitest';
import { noticeCardPillView } from './noticeCardPill';

describe('noticeCardPillView', () => {
  it('shows a present (ok) message once in the meeting', () => {
    const v = noticeCardPillView({ phase: 'present', platform: 'teams' });
    expect(v).toEqual({ kind: 'present', tone: 'ok' });
  });
  it('shows a warn message with the fallback when the card failed', () => {
    const v = noticeCardPillView({ phase: 'failed', reason: 'denied' });
    expect(v?.tone).toBe('warn');
    expect(v?.kind).toBe('failed');
  });
  it('shows a pending message while joining or in the lobby', () => {
    expect(noticeCardPillView({ phase: 'joining', platform: 'zoom' })?.tone).toBe('pending');
    expect(noticeCardPillView({ phase: 'lobby', platform: 'zoom' })?.tone).toBe('pending');
  });
  it('shows nothing when idle, left, or null', () => {
    expect(noticeCardPillView(null)).toBeNull();
    expect(noticeCardPillView({ phase: 'idle' })).toBeNull();
    expect(noticeCardPillView({ phase: 'left' })).toBeNull();
  });
});
