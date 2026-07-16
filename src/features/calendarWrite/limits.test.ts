import { describe, expect, it } from 'vitest';
import { enforceWriteLimits, type WriteLimitContext } from './limits';
import type { CalendarCreateIntent, CalendarUpdateIntent } from './types';

const ctx: WriteLimitContext = { homeCalendarId: 'cal-home' };

const event = {
  title: 'Review',
  startUtc: '2026-02-01T15:00:00Z',
  endUtc: '2026-02-01T15:30:00Z',
  displayTimezone: 'America/New_York',
  allDay: false,
  location: null,
  notes: null,
};

const createIntent: CalendarCreateIntent = {
  kind: 'create',
  provider: 'outlook',
  targetCalendarId: 'cal-home',
  event,
};

const updateTarget: CalendarUpdateIntent['target'] = {
  providerEventId: 'evt-1',
  providerCalendarId: 'cal-home',
  expectedVersion: 'W/"1"',
  seriesKind: 'single',
  ownership: 'organizer-self',
  canWrite: true,
};

const updateIntent: CalendarUpdateIntent = {
  kind: 'update',
  provider: 'google',
  targetCalendarId: 'cal-home',
  event,
  target: updateTarget,
};

describe('enforceWriteLimits', () => {
  it('allows an advisor-owned one-time create on the home calendar', () => {
    expect(enforceWriteLimits(createIntent, ctx)).toEqual({ ok: true });
  });

  it('allows an advisor-owned one-time reschedule that stays on the home calendar', () => {
    expect(enforceWriteLimits(updateIntent, ctx)).toEqual({ ok: true });
  });

  it('refuses a create targeting any calendar other than home (SC-013)', () => {
    expect(enforceWriteLimits({ ...createIntent, targetCalendarId: 'cal-other' }, ctx)).toEqual({
      ok: false,
      reason: 'wrong_calendar',
    });
  });

  it('refuses a reschedule that would move out of the home calendar (SC-013/B4)', () => {
    const moved: CalendarUpdateIntent = {
      ...updateIntent,
      target: { ...updateTarget, providerCalendarId: 'cal-other' },
    };
    expect(enforceWriteLimits(moved, ctx)).toEqual({ ok: false, reason: 'wrong_calendar' });
  });

  it('refuses a recurring target (series_unsupported)', () => {
    for (const seriesKind of ['recurring-master', 'recurring-instance', 'recurring-exception'] as const) {
      const recurring: CalendarUpdateIntent = {
        ...updateIntent,
        target: { ...updateTarget, seriesKind },
      };
      expect(enforceWriteLimits(recurring, ctx)).toEqual({ ok: false, reason: 'series_unsupported' });
    }
  });

  it('refuses an unowned target (SC-014, not_owned)', () => {
    const unowned: CalendarUpdateIntent = {
      ...updateIntent,
      target: { ...updateTarget, ownership: 'attendee' },
    };
    expect(enforceWriteLimits(unowned, ctx)).toEqual({ ok: false, reason: 'not_owned' });
  });

  it('refuses a target the provider says is not writeable (SC-014, shared reach)', () => {
    const shared: CalendarUpdateIntent = {
      ...updateIntent,
      target: { ...updateTarget, canWrite: false },
    };
    expect(enforceWriteLimits(shared, ctx)).toEqual({ ok: false, reason: 'not_writeable' });
  });

  it('refuses when there is no configured home calendar', () => {
    expect(enforceWriteLimits(createIntent, { homeCalendarId: '' })).toEqual({
      ok: false,
      reason: 'wrong_calendar',
    });
  });
});
