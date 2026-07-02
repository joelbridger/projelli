/**
 * keyVerification — the persistent "this key passed a live check" markers that
 * let a new chat prefer a verified provider over a merely-present one.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  markKeyVerified,
  markKeyInvalid,
  clearKeyStatus,
  isKeyVerified,
  isKeyInvalid,
  getVerifiedProviders,
  getInvalidProviders,
} from '@/platform/providers/keyVerification';

beforeEach(() => {
  localStorage.clear();
});

describe('keyVerification', () => {
  it('starts with nothing verified or invalid', () => {
    expect(isKeyVerified('openai')).toBe(false);
    expect(isKeyInvalid('openai')).toBe(false);
    expect(getVerifiedProviders().size).toBe(0);
    expect(getInvalidProviders().size).toBe(0);
  });

  it('marks and reads a verified provider', () => {
    markKeyVerified('openai');
    expect(isKeyVerified('openai')).toBe(true);
    expect(getVerifiedProviders()).toEqual(new Set(['openai']));
  });

  it('marks and reads an invalid provider', () => {
    markKeyInvalid('anthropic');
    expect(isKeyInvalid('anthropic')).toBe(true);
    expect(getInvalidProviders()).toEqual(new Set(['anthropic']));
  });

  it('verified and invalid are mutually exclusive per provider', () => {
    markKeyVerified('openai');
    markKeyInvalid('openai'); // flips it
    expect(isKeyVerified('openai')).toBe(false);
    expect(isKeyInvalid('openai')).toBe(true);
    markKeyVerified('openai'); // flips back
    expect(isKeyVerified('openai')).toBe(true);
    expect(isKeyInvalid('openai')).toBe(false);
  });

  it('clearKeyStatus forgets both markers', () => {
    markKeyInvalid('anthropic');
    clearKeyStatus('anthropic');
    expect(isKeyInvalid('anthropic')).toBe(false);
    expect(isKeyVerified('anthropic')).toBe(false);
    expect(getInvalidProviders().has('anthropic')).toBe(false);
  });

  it('tracks multiple providers independently', () => {
    markKeyVerified('openai');
    markKeyInvalid('google');
    expect(getVerifiedProviders()).toEqual(new Set(['openai']));
    expect(getInvalidProviders()).toEqual(new Set(['google']));
    clearKeyStatus('openai');
    expect(getVerifiedProviders().size).toBe(0);
    expect(getInvalidProviders()).toEqual(new Set(['google']));
  });

  it('persists an ISO timestamp under the namespaced key', () => {
    markKeyVerified('openai');
    const raw = localStorage.getItem('lantern_key_verified_openai');
    expect(raw).toBeTruthy();
    expect(() => new Date(raw as string).toISOString()).not.toThrow();
  });
});
