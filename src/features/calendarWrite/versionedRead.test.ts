import { describe, expect, it } from 'vitest';
import { classifyWriteEligibility, isWriteEligible } from './versionedRead';

const versioned = {
  provider: 'outlook',
  providerEventId: 'evt-123',
  providerCalendarId: 'cal-home',
  providerVersion: 'W/"etag-1"',
  ownership: 'organizer-self',
  canWrite: true,
  seriesKind: 'single',
  originalTimezone: 'America/New_York',
  location: 'Room 4',
  readGrantVersion: 2,
};

describe('classifyWriteEligibility', () => {
  it('accepts a fully-versioned row as writeable', () => {
    const result = classifyWriteEligibility(versioned);
    expect(result.kind).toBe('writeable');
    if (result.kind === 'writeable') {
      expect(result.projection.providerEventId).toBe('evt-123');
      expect(result.projection.location).toBe('Room 4');
    }
    expect(isWriteEligible(versioned)).toBe(true);
  });

  it('accepts a null location', () => {
    const result = classifyWriteEligibility({ ...versioned, location: null });
    expect(result.kind).toBe('writeable');
  });

  it('treats a legacy row lacking version facts as view-only', () => {
    // A pre-Part-B row: has read fields but no provider version/id/grant facts.
    const legacy = {
      provider: 'outlook',
      title: 'Old event',
      startUtc: '2026-01-01T10:00:00Z',
    };
    const result = classifyWriteEligibility(legacy);
    expect(result).toEqual({ kind: 'view-only', reason: 'legacy-unversioned' });
    expect(isWriteEligible(legacy)).toBe(false);
  });

  it('treats a malformed/partial projection as view-only', () => {
    expect(classifyWriteEligibility({ ...versioned, providerVersion: '' })).toEqual({
      kind: 'view-only',
      reason: 'malformed-projection',
    });
    expect(classifyWriteEligibility({ ...versioned, canWrite: 'yes' })).toEqual({
      kind: 'view-only',
      reason: 'malformed-projection',
    });
    expect(classifyWriteEligibility({ ...versioned, ownership: 'boss' })).toEqual({
      kind: 'view-only',
      reason: 'malformed-projection',
    });
    expect(classifyWriteEligibility({ ...versioned, seriesKind: 'weekly' })).toEqual({
      kind: 'view-only',
      reason: 'malformed-projection',
    });
    expect(classifyWriteEligibility({ ...versioned, readGrantVersion: -1 })).toEqual({
      kind: 'view-only',
      reason: 'malformed-projection',
    });
    expect(classifyWriteEligibility({ ...versioned, readGrantVersion: 1.5 })).toEqual({
      kind: 'view-only',
      reason: 'malformed-projection',
    });
    expect(classifyWriteEligibility({ ...versioned, location: 42 })).toEqual({
      kind: 'view-only',
      reason: 'malformed-projection',
    });
  });

  it('treats ICS and unknown providers as view-only (never write-eligible)', () => {
    expect(classifyWriteEligibility({ ...versioned, provider: 'ics' })).toEqual({
      kind: 'view-only',
      reason: 'unsupported-provider',
    });
    expect(classifyWriteEligibility({ ...versioned, provider: 'yahoo' })).toEqual({
      kind: 'view-only',
      reason: 'unsupported-provider',
    });
  });

  it('treats a non-object as view-only without throwing', () => {
    expect(classifyWriteEligibility(null).kind).toBe('view-only');
    expect(classifyWriteEligibility(undefined).kind).toBe('view-only');
    expect(classifyWriteEligibility('nope').kind).toBe('view-only');
    expect(classifyWriteEligibility(7).kind).toBe('view-only');
  });
});
