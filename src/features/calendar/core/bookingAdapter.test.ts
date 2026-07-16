import { describe, expect, it } from 'vitest';
import { toBookingPageAvailabilityConsumer } from './bookingAdapter';

describe('booking availability presentation adapter', () => {
  it('returns loading, unavailable, and display-ready states only', () => {
    expect(toBookingPageAvailabilityConsumer({ state: 'loading' }).getPresentation()).toEqual({ state: 'loading' });
    expect(toBookingPageAvailabilityConsumer({ state: 'unavailable', message: 'No openings' }).getPresentation()).toEqual({
      state: 'unavailable', message: 'No openings',
    });
    const result = toBookingPageAvailabilityConsumer({
      state: 'available',
      advisorTimezone: 'America/New_York',
      slots: [{
        id: 'intro@2026-08-03T14:00:00Z', meetingTypeId: 'intro', startUtc: '2026-08-03T14:00:00Z',
        endUtc: '2026-08-03T14:30:00Z', advisorTimezone: 'America/New_York',
      }],
    }).getPresentation();
    expect(result).toMatchObject({ state: 'available', dates: [{ id: '2026-08-03' }] });
    expect(JSON.stringify(result)).not.toMatch(/title|notes|guest|join|provider|save|hold|confirm/i);
  });
});
