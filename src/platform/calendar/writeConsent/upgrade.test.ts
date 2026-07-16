import { describe, expect, it } from 'vitest';
import { assertCalendarWriteAllowed, requestCalendarWriteConsent } from './upgrade';
import type {
  CalendarConsentAttempt,
  CalendarConsentPort,
  CalendarGrant,
  StagedGrantRef,
} from './types';

const STAGED = 'staged-1' as StagedGrantRef;

const readGrant: CalendarGrant = {
  provider: 'outlook',
  capability: 'read',
  grantedScopes: ['Calendars.Read'],
  grantVersion: 3,
};

/**
 * A recording fake of the native seam. Deliberately not a mock library: the
 * assertions below are about what the contract did to a real grant, not about
 * call bookkeeping.
 */
function fakePort(attempt: CalendarConsentAttempt | (() => Promise<never>)) {
  const calls: string[] = [];
  const port: CalendarConsentPort = {
    requestWriteConsent: async (_provider, requestedScopes) => {
      calls.push(`request:${requestedScopes.join(' ')}`);
      if (typeof attempt === 'function') return attempt();
      return attempt;
    },
    commitStagedGrant: (ref) => {
      calls.push(`commit:${ref}`);
      return Promise.resolve();
    },
    discardStagedGrant: (ref) => {
      calls.push(`discard:${ref}`);
      return Promise.resolve();
    },
  };
  return { port, calls };
}

const grantedWrite: CalendarConsentAttempt = {
  outcome: 'granted',
  grantedScopes: ['Calendars.ReadWrite', 'offline_access'],
  stagedRef: STAGED,
};

describe('requestCalendarWriteConsent — the happy upgrade', () => {
  it('upgrades to write and bumps the grant version when the provider verified write scope', async () => {
    const { port } = fakePort(grantedWrite);
    const { grant, receipt } = await requestCalendarWriteConsent({
      provider: 'outlook',
      currentGrant: readGrant,
      port,
    });

    expect(receipt.outcome).toBe('upgraded');
    expect(grant?.capability).toBe('write');
    expect(grant?.grantVersion).toBe(4);
  });

  it('commits the staged grant only after write scope is verified', async () => {
    const { port, calls } = fakePort(grantedWrite);
    await requestCalendarWriteConsent({ provider: 'outlook', currentGrant: readGrant, port });

    expect(calls).toContain(`commit:${STAGED}`);
    expect(calls.indexOf('request:offline_access openid User.Read Calendars.ReadWrite')).toBe(0);
  });
});

describe('requestCalendarWriteConsent — a denied or partial upgrade keeps the old read grant', () => {
  it('preserves the working read grant when the person declines at the provider', async () => {
    const { port } = fakePort({ outcome: 'denied' });
    const { grant, receipt } = await requestCalendarWriteConsent({
      provider: 'outlook',
      currentGrant: readGrant,
      port,
    });

    expect(receipt.outcome).toBe('denied');
    expect(grant).toEqual(readGrant);
  });

  it('refuses write and discards the grant when the provider returned read-only scope', async () => {
    // The person unchecked the write permission but still completed sign-in.
    const { port, calls } = fakePort({
      outcome: 'granted',
      grantedScopes: ['Calendars.Read'],
      stagedRef: STAGED,
    });
    const { grant, receipt } = await requestCalendarWriteConsent({
      provider: 'outlook',
      currentGrant: readGrant,
      port,
    });

    expect(receipt.outcome).toBe('insufficient_scope');
    expect(grant).toEqual(readGrant);
    expect(calls).toContain(`discard:${STAGED}`);
    expect(calls).not.toContain(`commit:${STAGED}`);
  });

  it('preserves the read grant and reports a fixed code when the attempt fails', async () => {
    const { port } = fakePort({ outcome: 'failed', reason: 'network_unavailable' });
    const { grant, receipt } = await requestCalendarWriteConsent({
      provider: 'outlook',
      currentGrant: readGrant,
      port,
    });

    expect(receipt.outcome).toBe('failed');
    expect(receipt.reason).toBe('network_unavailable');
    expect(grant).toEqual(readGrant);
  });

  it('never claims write when the port throws while committing', async () => {
    // The riskiest window: scope verified, but the store write blew up. The
    // grant must not be reported as write when it may not have landed.
    const { port } = fakePort(grantedWrite);
    port.commitStagedGrant = () => {
      throw new Error('keychain locked: token=ya29.SECRET');
    };
    const { grant, receipt } = await requestCalendarWriteConsent({
      provider: 'outlook',
      currentGrant: readGrant,
      port,
    });

    expect(receipt.outcome).toBe('failed');
    expect(receipt.reason).toBe('internal');
    expect(grant).toEqual(readGrant);
  });

  it('preserves the read grant and leaks nothing when the port throws outright', async () => {
    const { port } = fakePort(() => {
      throw new Error(
        'consent failed at https://login.microsoftonline.com/authorize?client_id=abc&state=xyz',
      );
    });
    const { grant, receipt } = await requestCalendarWriteConsent({
      provider: 'outlook',
      currentGrant: readGrant,
      port,
    });

    expect(receipt.outcome).toBe('failed');
    expect(receipt.reason).toBe('internal');
    expect(grant).toEqual(readGrant);
    expect(JSON.stringify(receipt)).not.toMatch(/login\.microsoftonline|client_id|state=/);
  });
});

describe('requestCalendarWriteConsent — paths that must never touch the network', () => {
  it('refuses an ICS write grant without making any consent request', async () => {
    const { port, calls } = fakePort(grantedWrite);
    const { receipt } = await requestCalendarWriteConsent({
      provider: 'ics',
      currentGrant: null,
      port,
    });

    expect(receipt.outcome).toBe('unsupported_provider');
    expect(receipt.capabilityAfter).toBe('read');
    expect(calls).toEqual([]);
  });

  it('refuses to make a first connect a write connect', async () => {
    // Write consent is an upgrade from a working read grant, never the door in.
    const { port, calls } = fakePort(grantedWrite);
    const { grant, receipt } = await requestCalendarWriteConsent({
      provider: 'google',
      currentGrant: null,
      port,
    });

    expect(receipt.outcome).toBe('no_existing_read_grant');
    expect(grant).toBeNull();
    expect(calls).toEqual([]);
  });

  it('does not re-prompt a grant that is already write-capable', async () => {
    const writeGrant: CalendarGrant = { ...readGrant, capability: 'write', grantVersion: 9 };
    const { port, calls } = fakePort(grantedWrite);
    const { grant, receipt } = await requestCalendarWriteConsent({
      provider: 'outlook',
      currentGrant: writeGrant,
      port,
    });

    expect(receipt.outcome).toBe('already_write');
    expect(grant).toEqual(writeGrant);
    expect(calls).toEqual([]);
  });

  it('rejects a grant belonging to a different provider rather than upgrading it', async () => {
    const { port } = fakePort(grantedWrite);
    await expect(
      requestCalendarWriteConsent({ provider: 'google', currentGrant: readGrant, port }),
    ).rejects.toThrow();
  });
});

describe('the receipt is safe to persist', () => {
  it('carries only recognized scope tokens, dropping anything else the provider sent', async () => {
    const { port } = fakePort({
      outcome: 'granted',
      grantedScopes: [
        'Calendars.ReadWrite',
        'https://login.microsoftonline.com/consent?client_id=abc123&code_challenge=zzz',
        'refresh_token=0.AaBbCc-REAL-LOOKING-SECRET-VALUE',
      ],
      stagedRef: STAGED,
    });
    const { receipt } = await requestCalendarWriteConsent({
      provider: 'outlook',
      currentGrant: readGrant,
      port,
    });

    expect(receipt.recognizedScopes).toEqual(['Calendars.ReadWrite']);
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toMatch(/refresh_token|code_challenge|client_id|AaBbCc/);
  });

  it('records the capability and version actually in force after the attempt', async () => {
    const { port } = fakePort({ outcome: 'denied' });
    const { receipt } = await requestCalendarWriteConsent({
      provider: 'outlook',
      currentGrant: readGrant,
      port,
    });

    expect(receipt.capabilityAfter).toBe('read');
    expect(receipt.grantVersionAfter).toBe(3);
  });
});

describe('assertCalendarWriteAllowed', () => {
  it('lets a verified write grant through', () => {
    expect(() => {
      assertCalendarWriteAllowed({ ...readGrant, capability: 'write' });
    }).not.toThrow();
  });

  it('blocks a read grant', () => {
    expect(() => {
      assertCalendarWriteAllowed(readGrant);
    }).toThrow();
  });

  it('blocks a missing grant', () => {
    expect(() => {
      assertCalendarWriteAllowed(null);
    }).toThrow();
  });
});
