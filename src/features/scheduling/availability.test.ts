import { describe, expect, it } from 'vitest';
import {
  computeOpenSlots,
  formatSlotInTimeZone,
  type AvailabilitySearchInput,
} from './availability';
import type { AvailabilityRule, Weekday } from './types';

const CLOSED_WEEK: AvailabilityRule['workingHours'] = {
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
};

function ruleFor(
  weekday: Weekday,
  hours: Array<{ startLocal: string; endLocal: string }>,
  overrides: Partial<AvailabilityRule> = {},
): AvailabilityRule {
  return {
    workingHours: {
      ...CLOSED_WEEK,
      [weekday]: hours,
    },
    meetingTypes: [
      {
        id: 'intro',
        name: 'Intro call',
        durationMin: 30,
        bufferBeforeMin: 0,
        bufferAfterMin: 0,
      },
    ],
    minNoticeHours: 0,
    maxHorizonDays: 30,
    ...overrides,
  };
}

function starts(input: AvailabilitySearchInput): string[] {
  return computeOpenSlots(input).map((slot) => slot.startUtc);
}

describe('computeOpenSlots', () => {
  it('keeps slots inside advisor working hours', () => {
    const rule = ruleFor('monday', [{ startLocal: '09:00', endLocal: '10:00' }]);

    expect(
      starts({
        rule,
        busyFreeSnapshot: { busy: [] },
        rangeStartUtc: '2026-07-06T00:00:00Z',
        rangeEndUtc: '2026-07-07T00:00:00Z',
        advisorTimezone: 'UTC',
        nowUtc: '2026-07-01T00:00:00Z',
      }),
    ).toEqual([
      '2026-07-06T09:00:00Z',
      '2026-07-06T09:15:00Z',
      '2026-07-06T09:30:00Z',
    ]);
  });

  it('subtracts busy blocks with meeting buffers', () => {
    const rule = ruleFor(
      'monday',
      [{ startLocal: '09:00', endLocal: '12:00' }],
      {
        meetingTypes: [
          {
            id: 'intro',
            name: 'Intro call',
            durationMin: 30,
            bufferBeforeMin: 15,
            bufferAfterMin: 15,
          },
        ],
      },
    );

    const slotStarts = starts({
      rule,
      busyFreeSnapshot: {
        busy: [{ startUtc: '2026-07-06T10:00:00Z', endUtc: '2026-07-06T10:30:00Z' }],
      },
      rangeStartUtc: '2026-07-06T00:00:00Z',
      rangeEndUtc: '2026-07-07T00:00:00Z',
      advisorTimezone: 'UTC',
      nowUtc: '2026-07-01T00:00:00Z',
    });

    expect(slotStarts).toContain('2026-07-06T09:15:00Z');
    expect(slotStarts).not.toContain('2026-07-06T09:30:00Z');
    expect(slotStarts).not.toContain('2026-07-06T10:30:00Z');
    expect(slotStarts).toContain('2026-07-06T10:45:00Z');
  });

  it('honors minimum notice and maximum booking horizon', () => {
    const rule = ruleFor(
      'thursday',
      [{ startLocal: '09:00', endLocal: '12:00' }],
      { minNoticeHours: 2, maxHorizonDays: 1 },
    );

    const slotStarts = starts({
      rule,
      busyFreeSnapshot: { busy: [] },
      rangeStartUtc: '2026-07-09T00:00:00Z',
      rangeEndUtc: '2026-07-11T00:00:00Z',
      advisorTimezone: 'UTC',
      nowUtc: '2026-07-09T08:00:00Z',
    });

    expect(slotStarts[0]).toBe('2026-07-09T10:00:00Z');
    expect(slotStarts).not.toContain('2026-07-09T09:45:00Z');
    expect(slotStarts.some((start) => start.startsWith('2026-07-10'))).toBe(false);
  });

  it('computes advisor hours in the advisor timezone and formats for the viewer timezone', () => {
    const rule = ruleFor('monday', [{ startLocal: '09:00', endLocal: '10:00' }]);

    const [slot] = computeOpenSlots({
      rule,
      busyFreeSnapshot: { busy: [] },
      rangeStartUtc: '2026-01-05T08:00:00Z',
      rangeEndUtc: '2026-01-06T08:00:00Z',
      advisorTimezone: 'America/New_York',
      nowUtc: '2026-01-01T00:00:00Z',
      meetingTypeId: 'intro',
    });

    expect(slot).toBeDefined();
    if (!slot) throw new Error('Expected a New York booking slot.');

    expect(slot.startUtc).toBe('2026-01-05T14:00:00Z');
    expect(formatSlotInTimeZone(slot, 'America/New_York')).toMatchObject({
      date: '2026-01-05',
      time: '09:00',
      weekday: 'monday',
    });
    expect(formatSlotInTimeZone(slot, 'America/Los_Angeles')).toMatchObject({
      date: '2026-01-05',
      time: '06:00',
      weekday: 'monday',
    });
  });

  it('keeps the same local advisor hour across daylight saving time changes', () => {
    const rule: AvailabilityRule = {
      ...ruleFor('monday', [{ startLocal: '09:00', endLocal: '09:30' }]),
      workingHours: {
        ...CLOSED_WEEK,
        friday: [{ startLocal: '09:00', endLocal: '09:30' }],
        monday: [{ startLocal: '09:00', endLocal: '09:30' }],
      },
    };

    const slotStarts = starts({
      rule,
      busyFreeSnapshot: { busy: [] },
      rangeStartUtc: '2026-03-06T00:00:00Z',
      rangeEndUtc: '2026-03-10T00:00:00Z',
      advisorTimezone: 'America/New_York',
      nowUtc: '2026-03-01T00:00:00Z',
    });

    expect(slotStarts).toContain('2026-03-06T14:00:00Z');
    expect(slotStarts).toContain('2026-03-09T13:00:00Z');
  });

  it('supports meeting-type-specific durations', () => {
    const rule = ruleFor(
      'monday',
      [{ startLocal: '09:00', endLocal: '10:00' }],
      {
        meetingTypes: [
          {
            id: 'quick',
            name: 'Quick call',
            durationMin: 15,
            bufferBeforeMin: 0,
            bufferAfterMin: 0,
          },
          {
            id: 'long',
            name: 'Planning session',
            durationMin: 60,
            bufferBeforeMin: 0,
            bufferAfterMin: 0,
          },
        ],
      },
    );

    expect(
      starts({
        rule,
        busyFreeSnapshot: { busy: [] },
        rangeStartUtc: '2026-07-06T00:00:00Z',
        rangeEndUtc: '2026-07-07T00:00:00Z',
        advisorTimezone: 'UTC',
        nowUtc: '2026-07-01T00:00:00Z',
        meetingTypeId: 'long',
      }),
    ).toEqual(['2026-07-06T09:00:00Z']);
  });
});
