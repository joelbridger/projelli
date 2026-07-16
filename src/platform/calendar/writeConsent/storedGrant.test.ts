import { describe, expect, it } from 'vitest';
import { verifyStoredGrant } from './storedGrant';
import { capabilityOfRecognizedScopes } from './scopeEvaluation';

const OUTLOOK_WRITE = ['offline_access', 'openid', 'User.Read', 'Calendars.ReadWrite'];
const OUTLOOK_READ = ['offline_access', 'openid', 'User.Read', 'Calendars.Read'];
const GOOGLE_WRITE = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];
const GOOGLE_READ = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.readonly',
];

describe('verifyStoredGrant', () => {
  it('trusts a well-formed write grant whose scopes justify write', () => {
    const grant = verifyStoredGrant({
      provider: 'outlook',
      capability: 'write',
      grantedScopes: OUTLOOK_WRITE,
      grantVersion: 3,
    });
    expect(grant).toEqual({
      provider: 'outlook',
      capability: 'write',
      grantedScopes: OUTLOOK_WRITE,
      grantVersion: 3,
    });
  });

  it('trusts a well-formed read grant', () => {
    const grant = verifyStoredGrant({
      provider: 'google',
      capability: 'read',
      grantedScopes: GOOGLE_READ,
      grantVersion: 1,
    });
    expect(grant?.capability).toBe('read');
    expect(grant?.grantedScopes).toEqual(
      capabilityOfRecognizedScopes('google', GOOGLE_READ) === 'read'
        ? GOOGLE_READ
        : GOOGLE_READ,
    );
  });

  it('DEMOTES a stored write claim whose scopes are only read (F1/F2 tamper)', () => {
    const grant = verifyStoredGrant({
      provider: 'outlook',
      capability: 'write', // flipped claim
      grantedScopes: OUTLOOK_READ, // but scopes are read-only
      grantVersion: 5,
    });
    expect(grant).not.toBeNull();
    expect(grant?.capability).toBe('read');
  });

  it('does NOT auto-promote a stored read claim even when scopes include write', () => {
    // Disagreement in either direction demotes to read: write is only ever
    // minted by a fresh verified consent, never by loading.
    const grant = verifyStoredGrant({
      provider: 'google',
      capability: 'read',
      grantedScopes: GOOGLE_WRITE,
      grantVersion: 2,
    });
    expect(grant?.capability).toBe('read');
  });

  it('re-derives capability, dropping unrecognized scope tokens', () => {
    const grant = verifyStoredGrant({
      provider: 'outlook',
      capability: 'write',
      grantedScopes: [...OUTLOOK_WRITE, 'Mail.ReadWrite', 'Directory.AccessAsUser.All'],
      grantVersion: 0,
    });
    // Unrecognized scopes are dropped; recognized write scope remains -> write.
    expect(grant?.capability).toBe('write');
    expect(grant?.grantedScopes).toEqual(OUTLOOK_WRITE);
  });

  it('reads Graph-prefixed and mixed-case Outlook scopes', () => {
    const grant = verifyStoredGrant({
      provider: 'outlook',
      capability: 'write',
      grantedScopes: 'offline_access openid User.Read https://graph.microsoft.com/Calendars.ReadWrite',
      grantVersion: 4,
    });
    expect(grant?.capability).toBe('write');
  });

  it('does NOT read the google substring trap as write', () => {
    const grant = verifyStoredGrant({
      provider: 'google',
      capability: 'write',
      grantedScopes: [
        'openid',
        'email',
        'https://www.googleapis.com/auth/calendar.events.readonly',
      ],
      grantVersion: 1,
    });
    expect(grant?.capability).toBe('read');
  });

  it('rejects a grant for a non-write-capable or unknown provider (ICS can never hold a grant)', () => {
    expect(verifyStoredGrant({ provider: 'ics', capability: 'write', grantedScopes: [], grantVersion: 1 })).toBeNull();
    expect(verifyStoredGrant({ provider: 'nope', capability: 'read', grantedScopes: [], grantVersion: 1 })).toBeNull();
    expect(verifyStoredGrant({ provider: undefined, grantVersion: 1 })).toBeNull();
  });

  it('rejects an unusable version (fail closed rather than invent one)', () => {
    expect(verifyStoredGrant({ provider: 'outlook', capability: 'read', grantedScopes: OUTLOOK_READ, grantVersion: -1 })).toBeNull();
    expect(verifyStoredGrant({ provider: 'outlook', capability: 'read', grantedScopes: OUTLOOK_READ, grantVersion: 1.5 })).toBeNull();
    expect(verifyStoredGrant({ provider: 'outlook', capability: 'read', grantedScopes: OUTLOOK_READ, grantVersion: 'x' })).toBeNull();
    expect(verifyStoredGrant({ provider: 'outlook', capability: 'read', grantedScopes: OUTLOOK_READ, grantVersion: NaN })).toBeNull();
  });

  it('rejects a non-object and coerces junk scopes to read', () => {
    expect(verifyStoredGrant(null)).toBeNull();
    expect(verifyStoredGrant('a string')).toBeNull();
    expect(verifyStoredGrant(42)).toBeNull();
    const grant = verifyStoredGrant({
      provider: 'google',
      capability: 'write',
      grantedScopes: { not: 'an array' },
      grantVersion: 0,
    });
    expect(grant?.capability).toBe('read');
    expect(grant?.grantedScopes).toEqual([]);
  });

  it('treats an invalid capability claim as a disagreement (read)', () => {
    const grant = verifyStoredGrant({
      provider: 'outlook',
      capability: 'admin', // not a valid capability
      grantedScopes: OUTLOOK_WRITE,
      grantVersion: 1,
    });
    expect(grant?.capability).toBe('read');
  });
});
