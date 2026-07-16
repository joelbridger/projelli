import { describe, expect, it } from 'vitest';
import { CalendarFoundationError } from './errors';
import { parseUtc } from './time';

describe('UTC timestamp validation', () => {
  it.each([
    '2026-02-30T14:00:00Z',
    '2026-04-31T14:00:00Z',
    '2026-01-01T24:00:00Z',
  ])('rejects a shape-matching timestamp whose calendar date does not exist: %s', (value) => {
    expect(() => parseUtc(value)).toThrow(CalendarFoundationError);
    try {
      parseUtc(value);
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_utc_timestamp' });
    }
  });

  it('accepts a real leap-day timestamp without changing it', () => {
    expect(parseUtc('2028-02-29T14:00:00.123Z')).toBe(Date.parse('2028-02-29T14:00:00.123Z'));
  });
});
