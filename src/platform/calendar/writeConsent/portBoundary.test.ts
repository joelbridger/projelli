/**
 * The port boundary is the only thing standing between an untrusted native
 * response and a receipt the contract calls safe to persist and show. These test
 * it directly, because the native lane will call these exports itself.
 */
import { describe, expect, it } from 'vitest';
import { coerceFailureReason, verifyConsentAttempt } from './portBoundary';
import type { StagedGrantRef } from './types';

const STAGED = 'staged-1' as StagedGrantRef;

describe('coerceFailureReason', () => {
  it('passes through each code the contract defined', () => {
    for (const reason of [
      'network_unavailable',
      'provider_rejected',
      'timeout',
      'cancelled',
      'internal',
    ] as const) {
      expect(coerceFailureReason(reason)).toBe(reason);
    }
  });

  it('replaces provider error text with a fixed code', () => {
    expect(
      coerceFailureReason('AADSTS65004: user declined at https://login.microsoftonline.com/x'),
    ).toBe('internal');
  });

  it('replaces a value that is not even a string', () => {
    for (const junk of [undefined, null, 42, {}, ['timeout']]) {
      expect(coerceFailureReason(junk)).toBe('internal');
    }
  });
});

describe('verifyConsentAttempt — a granted response', () => {
  it('reports write only when the recognized scopes carry the write scope', () => {
    const verified = verifyConsentAttempt('outlook', {
      outcome: 'granted',
      grantedScopes: ['Calendars.ReadWrite', 'offline_access'],
      stagedRef: STAGED,
    });

    expect(verified.outcome).toBe('granted');
    if (verified.outcome !== 'granted') return;
    expect(verified.capability).toBe('write');
    expect(verified.recognizedScopes).toContain('Calendars.ReadWrite');
  });

  it('accepts the space-delimited string providers actually return', () => {
    const verified = verifyConsentAttempt('outlook', {
      outcome: 'granted',
      grantedScopes: 'offline_access Calendars.ReadWrite',
      stagedRef: STAGED,
    });

    expect(verified.outcome === 'granted' && verified.capability).toBe('write');
  });

  it('never reports a capability the scopes it carries do not justify', () => {
    // The binding the whole contract rests on: these two values come from one
    // read of one field, so they cannot disagree.
    const verified = verifyConsentAttempt('outlook', {
      outcome: 'granted',
      grantedScopes: ['Calendars.Read'],
      stagedRef: STAGED,
    });

    expect(verified.outcome).toBe('granted');
    if (verified.outcome !== 'granted') return;
    expect(verified.capability).toBe('read');
    expect(verified.recognizedScopes).not.toContain('Calendars.ReadWrite');
  });

  it('drops scope entries that are not strings instead of throwing', () => {
    const verified = verifyConsentAttempt('outlook', {
      outcome: 'granted',
      grantedScopes: [{ toString: () => 'Calendars.ReadWrite' }, null, 7, 'Calendars.Read'],
      stagedRef: STAGED,
    });

    expect(verified.outcome).toBe('granted');
    if (verified.outcome !== 'granted') return;
    // The object stringifies to the write scope. It is not a string, so it never
    // gets the chance.
    expect(verified.capability).toBe('read');
    expect(verified.recognizedScopes).toEqual(['Calendars.Read']);
  });

  it('fails closed when granted scopes are missing or unusable', () => {
    for (const grantedScopes of [undefined, null, 42, { 0: 'Calendars.ReadWrite' }]) {
      const verified = verifyConsentAttempt('outlook', {
        outcome: 'granted',
        grantedScopes,
        stagedRef: STAGED,
      });
      expect(verified.outcome === 'granted' && verified.capability).toBe('read');
    }
  });

  it('rejects a grant with no usable staged handle', () => {
    // Nothing to commit and nothing to discard, so there is nothing to verify.
    for (const stagedRef of [undefined, null, '', 42]) {
      const verified = verifyConsentAttempt('outlook', {
        outcome: 'granted',
        grantedScopes: ['Calendars.ReadWrite'],
        stagedRef,
      });
      expect(verified).toEqual({ outcome: 'failed', reason: 'internal' });
    }
  });
});

describe('verifyConsentAttempt — everything else', () => {
  it('keeps a denial a denial', () => {
    expect(verifyConsentAttempt('google', { outcome: 'denied' })).toEqual({ outcome: 'denied' });
  });

  it('coerces a failure reason rather than forwarding it', () => {
    expect(
      verifyConsentAttempt('google', {
        outcome: 'failed',
        reason: 'https://accounts.google.com/o/oauth2/auth?client_id=abc&code_challenge=zzz',
      }),
    ).toEqual({ outcome: 'failed', reason: 'internal' });
  });

  it('fails closed on an outcome the contract never defined', () => {
    for (const response of [
      { outcome: 'partially_granted', grantedScopes: ['Calendars.ReadWrite'], stagedRef: STAGED },
      { outcome: undefined },
      {},
      null,
      undefined,
      'granted',
    ]) {
      expect(verifyConsentAttempt('outlook', response)).toEqual({
        outcome: 'failed',
        reason: 'internal',
      });
    }
  });
});
