import { describe, it, expect, vi } from 'vitest';
import { makeConsentLedger } from '@/features/meetings/consentLedger';

describe('consent ledger', () => {
  it('records and finds standing consent', async () => {
    const files = new Map<string, string>();
    const ws = {
      readFile: vi.fn(async (p: string) => files.get(p) ?? null),
      writeFile: vi.fn(async (p: string, c: string) => { files.set(p, c); }),
    };
    const ledger = makeConsentLedger(ws as never, () => 'Clients/Hendersons');
    expect(await ledger.standingConsent('m-1')).toBeNull();
    await ledger.recordConsent('m-1', { mode: 'one-party', scope: 'standing', confirmedAt: 't1', note: 'email 6/12' });
    const sc = await ledger.standingConsent('m-1');
    expect(sc?.scope).toBe('standing');
  });

  it('per-meeting consent does not count as standing', async () => {
    const files = new Map<string, string>();
    const ws = {
      readFile: vi.fn(async (p: string) => files.get(p) ?? null),
      writeFile: vi.fn(async (p: string, c: string) => { files.set(p, c); }),
    };
    const ledger = makeConsentLedger(ws as never, () => 'Clients/Hendersons');
    await ledger.recordConsent('m-1', { mode: 'two-party', scope: 'per-meeting', confirmedAt: 't1', meetingDir: 'Clients/Hendersons/Meetings/x' });
    expect(await ledger.standingConsent('m-1')).toBeNull();
  });

  it('writes to the per-matter path under Meetings/', async () => {
    const written: Record<string, string> = {};
    const ws = {
      readFile: vi.fn(async () => null),
      writeFile: vi.fn(async (p: string, c: string) => { written[p] = c; }),
    };
    const ledger = makeConsentLedger(ws as never, () => 'Clients/Hendersons');
    await ledger.recordConsent('m-1', { mode: 'one-party', scope: 'standing', confirmedAt: 't1' });
    expect(Object.keys(written)).toEqual(['Clients/Hendersons/Meetings/.consent-ledger.json']);
  });
});
