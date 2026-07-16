import { describe, expect, it } from 'vitest';
import {
  verifyStoredProposal,
  createLiveRecordProposalStore,
  PROPOSAL_RECORD_KIND,
  type LiveRecordLike,
} from './proposalStore';
import { newIdempotencyKey } from './idempotency';
import type { CalendarWriteProposal } from './types';

const key = newIdempotencyKey();

function goodCreate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p1',
    kind: 'create',
    provider: 'outlook',
    targetCalendarId: 'cal-home',
    status: 'prepared',
    idempotencyKey: key,
    event: {
      title: 'Review',
      startUtc: '2026-02-01T15:00:00Z',
      endUtc: '2026-02-01T15:30:00Z',
      displayTimezone: 'America/New_York',
      allDay: false,
      location: null,
      notes: null,
    },
    grantVersion: 2,
    createdAtUtc: '2026-02-01T00:00:00Z',
    updatedAtUtc: '2026-02-01T00:00:00Z',
    ...overrides,
  };
}

const goodTarget = {
  providerEventId: 'evt-1',
  providerCalendarId: 'cal-home',
  expectedVersion: 'W/"1"',
  seriesKind: 'single',
  ownership: 'organizer-self',
  canWrite: true,
};

describe('verifyStoredProposal', () => {
  it('accepts a well-formed create proposal', () => {
    expect(verifyStoredProposal(goodCreate())?.id).toBe('p1');
  });

  it('accepts a well-formed update proposal with a target', () => {
    const p = verifyStoredProposal(goodCreate({ kind: 'update', target: goodTarget }));
    expect(p?.kind).toBe('update');
    expect(p?.target?.expectedVersion).toBe('W/"1"');
  });

  it('REJECTS an update proposal with no target (would PATCH with no If-Match)', () => {
    expect(verifyStoredProposal(goodCreate({ kind: 'update' }))).toBeNull();
  });

  it('REJECTS an update proposal with a malformed target', () => {
    expect(
      verifyStoredProposal(goodCreate({ kind: 'update', target: { ...goodTarget, expectedVersion: '' } })),
    ).toBeNull();
  });

  it('rejects an unknown provider, bad version, or tampered idempotency key', () => {
    expect(verifyStoredProposal(goodCreate({ provider: 'ics' }))).toBeNull();
    expect(verifyStoredProposal(goodCreate({ provider: 'yahoo' }))).toBeNull();
    expect(verifyStoredProposal(goodCreate({ grantVersion: -1 }))).toBeNull();
    expect(verifyStoredProposal(goodCreate({ grantVersion: 1.5 }))).toBeNull();
    expect(verifyStoredProposal(goodCreate({ idempotencyKey: 'not-a-key' }))).toBeNull();
    expect(verifyStoredProposal(goodCreate({ status: 'bogus' }))).toBeNull();
  });

  it('DEMOTES a "verified" row that has no confirmation block (never a false booking)', () => {
    const p = verifyStoredProposal(goodCreate({ status: 'verified' }));
    expect(p?.status).toBe('verify_pending');
    expect(p?.confirmed).toBeUndefined();
  });

  it('keeps a "verified" row that carries a well-formed confirmation', () => {
    const p = verifyStoredProposal(
      goodCreate({
        status: 'verified',
        confirmed: { providerEventId: 'evt-9', providerVersion: 'W/"5"', verifiedAtUtc: '2026-02-01T01:00:00Z' },
      }),
    );
    expect(p?.status).toBe('verified');
    expect(p?.confirmed?.providerEventId).toBe('evt-9');
  });

  it('rejects a non-object', () => {
    expect(verifyStoredProposal(null)).toBeNull();
    expect(verifyStoredProposal('x')).toBeNull();
  });
});

describe('createLiveRecordProposalStore', () => {
  it('persists under the proposal kind and validates every row on load', async () => {
    const rows: LiveRecordLike[] = [];
    const store = createLiveRecordProposalStore({
      save: (r) => {
        rows.push(r);
        return Promise.resolve();
      },
      load: () => Promise.resolve(rows),
    });
    const proposal = verifyStoredProposal(goodCreate()) as CalendarWriteProposal;
    await store.put(proposal);
    expect(rows[0]?.kind).toBe(PROPOSAL_RECORD_KIND);
    // The record's own kind is the CRM category; the proposal's intent kind is
    // preserved in the nested payload, not clobbered.
    expect(rows[0]?.['payload']).toMatchObject({ kind: 'create', id: 'p1' });

    // A foreign-kind row, a payload-less row, and a corrupt payload are all
    // ignored on load.
    rows.push({ id: 'other', kind: 'calendar_event', title: 'x' });
    rows.push({ id: 'empty', kind: PROPOSAL_RECORD_KIND });
    rows.push({ id: 'corrupt', kind: PROPOSAL_RECORD_KIND, payload: { ...goodCreate(), provider: 'ics' } });
    const loaded = await store.load();
    expect(loaded.map((p) => p.id)).toEqual(['p1']);
  });
});
