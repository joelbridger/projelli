/**
 * Merged suites (add/add resolution at the connector-parity merge):
 * - getKeyCheckStatus (dress-rehearsal fix 1): the single read path
 *   ApiKeyManager uses to restore a provider's last-known Check result on
 *   dialog open, instead of resetting to "unverified" every mount.
 * - isVerifiableProvider + the shared "mark key invalid on auth rejection"
 *   contract (connect-flow demo hardening, fix 3) used by both send paths.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearKeyStatus,
  getKeyCheckStatus,
  isKeyInvalid,
  isKeyVerified,
  isVerifiableProvider,
  markKeyInvalid,
  markKeyVerified,
} from './keyVerification';

beforeEach(() => {
  localStorage.clear();
});

describe('getKeyCheckStatus', () => {
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

describe('isVerifiableProvider', () => {
  it('accepts only the three cloud providers with a verifiable key', () => {
    expect(isVerifiableProvider('anthropic')).toBe(true);
    expect(isVerifiableProvider('openai')).toBe(true);
    expect(isVerifiableProvider('google')).toBe(true);
  });

  it('rejects local engines, which have no key to verify', () => {
    expect(isVerifiableProvider('keepance-local')).toBe(false);
    expect(isVerifiableProvider('ollama')).toBe(false);
    expect(isVerifiableProvider('none')).toBe(false);
  });
});

describe('markKeyInvalid / markKeyVerified', () => {
  it('marking invalid clears a prior verified marker, and vice versa', () => {
    markKeyVerified('anthropic');
    expect(isKeyVerified('anthropic')).toBe(true);

    markKeyInvalid('anthropic');
    expect(isKeyInvalid('anthropic')).toBe(true);
    expect(isKeyVerified('anthropic')).toBe(false);

    markKeyVerified('anthropic');
    expect(isKeyVerified('anthropic')).toBe(true);
    expect(isKeyInvalid('anthropic')).toBe(false);
  });

  it('clearKeyStatus forgets both markers', () => {
    markKeyInvalid('openai');
    clearKeyStatus('openai');
    expect(isKeyInvalid('openai')).toBe(false);
    expect(isKeyVerified('openai')).toBe(false);
  });
});
