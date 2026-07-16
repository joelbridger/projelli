/**
 * Public import-compile + consumer gate for the calendar write-consent
 * contract.
 *
 * Everything here imports from `@/platform/calendar/writeConsent` only — no
 * deep import, no test-only export. If a future consumer (the consent/reconnect
 * UI, the Outlook or Google writer, the write review step, or booking
 * confirmation) needs something this file cannot reach, the public index is
 * missing it and must be extended deliberately.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  assertCalendarWriteAllowed,
  evaluateGrantedCapability,
  requestCalendarWriteConsent,
  writeConsentScopeRequest,
  type CalendarConsentPort,
  type CalendarGrant,
  type CalendarWriteConsentReceipt,
  type StagedGrantRef,
} from '@/platform/calendar/writeConsent';

const readGrant: CalendarGrant = {
  provider: 'google',
  capability: 'read',
  grantedScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  grantVersion: 1,
};

describe('a consent UI consumer can drive an upgrade through the public index', () => {
  it('turns a read grant into a write grant when Google verifies event write', async () => {
    const port: CalendarConsentPort = {
      requestWriteConsent: async () => ({
        outcome: 'granted',
        grantedScopes: [
          'openid',
          'email',
          'https://www.googleapis.com/auth/calendar.readonly',
          'https://www.googleapis.com/auth/calendar.events',
        ],
        stagedRef: 'ref' as StagedGrantRef,
      }),
      commitStagedGrant: vi.fn(async () => {}),
      discardStagedGrant: vi.fn(async () => {}),
    };

    const { grant, receipt } = await requestCalendarWriteConsent({
      provider: 'google',
      currentGrant: readGrant,
      port,
    });

    expect(receipt.outcome).toBe('upgraded');
    expect(grant?.capability).toBe('write');
    // The upgrade kept the read scope it already had.
    expect(grant?.grantedScopes).toContain('https://www.googleapis.com/auth/calendar.readonly');
  });

  it('keeps the calendar connected when the person approves read but not write', async () => {
    const discardStagedGrant = vi.fn(async () => {});
    const port: CalendarConsentPort = {
      requestWriteConsent: async () => ({
        outcome: 'granted',
        grantedScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
        stagedRef: 'ref' as StagedGrantRef,
      }),
      commitStagedGrant: vi.fn(async () => {}),
      discardStagedGrant,
    };

    const { grant, receipt } = await requestCalendarWriteConsent({
      provider: 'google',
      currentGrant: readGrant,
      port,
    });

    expect(receipt.outcome).toBe('insufficient_scope');
    expect(grant).toEqual(readGrant);
    expect(discardStagedGrant).toHaveBeenCalled();
  });
});

describe('a provider writer consumer cannot write through an unverified grant', () => {
  it('blocks a write attempt on a read grant', () => {
    expect(() => assertCalendarWriteAllowed(readGrant)).toThrow(/read-only/);
  });

  it('allows a write attempt on a verified write grant', () => {
    const writeGrant: CalendarGrant = {
      ...readGrant,
      capability: 'write',
      grantedScopes: ['https://www.googleapis.com/auth/calendar.events'],
    };
    expect(() => assertCalendarWriteAllowed(writeGrant)).not.toThrow();
  });
});

describe('the scope rules are public so the native port cannot drift from them', () => {
  it('exposes the exact scopes an upgrade must request', () => {
    expect(writeConsentScopeRequest('outlook')).toContain('Calendars.ReadWrite');
  });

  it('exposes the granted-scope verification the port must agree with', () => {
    expect(evaluateGrantedCapability('outlook', ['Calendars.Read'])).toBe('read');
  });
});

describe('a receipt consumer sees only safe, fixed values', () => {
  it('produces a receipt that carries no provider error text', async () => {
    const port: CalendarConsentPort = {
      requestWriteConsent: async () => ({ outcome: 'failed', reason: 'timeout' }),
      commitStagedGrant: vi.fn(async () => {}),
      discardStagedGrant: vi.fn(async () => {}),
    };

    const { receipt }: { receipt: CalendarWriteConsentReceipt } =
      await requestCalendarWriteConsent({ provider: 'google', currentGrant: readGrant, port });

    expect(receipt.reason).toBe('timeout');
    expect(receipt.capabilityAfter).toBe('read');
  });
});
