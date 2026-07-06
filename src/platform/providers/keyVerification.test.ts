/**
 * Fix 1 (dress-rehearsal finding #1): getKeyCheckStatus is the single read
 * path ApiKeyManager uses to restore a provider's last-known Check result on
 * dialog open, instead of resetting to "unverified" every mount.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  markKeyVerified,
  markKeyInvalid,
  clearKeyStatus,
  getKeyCheckStatus,
} from './keyVerification';

describe('getKeyCheckStatus', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is "unknown" with no checkedAt for a provider that was never checked', () => {
    expect(getKeyCheckStatus('anthropic')).toEqual({ status: 'unknown', checkedAt: null });
  });

  it('is "verified" with a checkedAt timestamp after markKeyVerified', () => {
    markKeyVerified('anthropic');
    const result = getKeyCheckStatus('anthropic');
    expect(result.status).toBe('verified');
    expect(result.checkedAt).not.toBeNull();
  });

  it('is "invalid" with a checkedAt timestamp after markKeyInvalid', () => {
    markKeyInvalid('openai');
    const result = getKeyCheckStatus('openai');
    expect(result.status).toBe('invalid');
    expect(result.checkedAt).not.toBeNull();
  });

  it('a later markKeyInvalid overrides a prior markKeyVerified for the same provider', () => {
    markKeyVerified('google');
    markKeyInvalid('google');
    expect(getKeyCheckStatus('google').status).toBe('invalid');
  });

  it('returns to "unknown" after clearKeyStatus', () => {
    markKeyVerified('anthropic');
    clearKeyStatus('anthropic');
    expect(getKeyCheckStatus('anthropic')).toEqual({ status: 'unknown', checkedAt: null });
  });
});
