import { describe, it, expect } from 'vitest';
import { consentModeFor, TWO_PARTY_STATES } from '@/features/meetings/recordingConsentLaw';

describe('recording consent law table', () => {
  it('classifies known states', () => {
    expect(consentModeFor('UT')).toBe('one-party');
    expect(consentModeFor('CA')).toBe('two-party');
    expect(TWO_PARTY_STATES.has('FL')).toBe(true);
  });
  it('defaults to two-party when state unknown', () => {
    expect(consentModeFor(null)).toBe('two-party');
    expect(consentModeFor('ZZ')).toBe('two-party');
  });
});
