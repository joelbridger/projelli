import { describe, expect, it } from 'vitest';
import { createCalendarWriteOrchestrator, type BusyInterval, type CalendarWriteDeps } from '../orchestrator';
import { newIdempotencyKey } from '../idempotency';
import type { CalendarGrant } from '@/platform/calendar/writeConsent';
import type {
  CalendarCreateIntent,
  CalendarUpdateIntent,
  CalendarWriteIntent,
  CalendarWriteProviderId,
} from '../types';
import { SyntheticProvider, SECRET_MARKERS } from './syntheticProvider';
import { SerializingProposalStore } from './serializingStore';

const HOME = 'cal-home';

const writeGrant: CalendarGrant = {
  provider: 'outlook',
  capability: 'write',
  grantedScopes: ['offline_access', 'openid', 'User.Read', 'Calendars.ReadWrite'],
  grantVersion: 2,
};

function baseEvent(overrides: Partial<CalendarCreateIntent['event']> = {}): CalendarCreateIntent['event'] {
  return {
    title: 'Client review',
    startUtc: '2026-02-01T15:00:00Z',
    endUtc: '2026-02-01T15:30:00Z',
    displayTimezone: 'America/New_York',
    allDay: false,
    location: null,
    notes: null,
    ...overrides,
  };
}

function createIntent(provider: CalendarWriteProviderId = 'outlook'): CalendarCreateIntent {
  return { kind: 'create', provider, targetCalendarId: HOME, event: baseEvent() };
}

interface Harness {
  deps: CalendarWriteDeps;
  provider: SyntheticProvider;
  store: SerializingProposalStore;
  orch: ReturnType<typeof createCalendarWriteOrchestrator>;
  state: { flag: boolean; grant: CalendarGrant | null; busy: BusyInterval[] };
}

function harness(init: Partial<Harness['state']> = {}, store = new SerializingProposalStore()): Harness {
  const provider = new SyntheticProvider();
  const state = { flag: true, grant: writeGrant, busy: [] as BusyInterval[], ...init };
  let clock = 0;
  let ids = 0;
  const deps: CalendarWriteDeps = {
    isWriteEnabled: () => state.flag,
    loadGrant: () => Promise.resolve(state.grant),
    getHomeCalendarId: () => Promise.resolve(HOME),
    refreshBusy: () => Promise.resolve(state.busy),
    provider,
    store,
    now: () => `2026-02-01T00:00:0${String(clock++)}Z`,
    newProposalId: () => `prop-${String(ids++)}`,
    newIdempotencyKey,
  };
  return { deps, provider, store, orch: createCalendarWriteOrchestrator(deps), state };
}

async function prepareAndApprove(h: Harness, intent: CalendarWriteIntent = createIntent()) {
  const prepared = await h.orch.prepare(intent);
  expect(prepared.kind).toBe('prepared');
  if (prepared.kind !== 'prepared') throw new Error('not prepared');
  return h.orch.approve(prepared.proposal.id);
}

describe('B2 — explicit-consent, final-approval, versioned, idempotent, verified writes', () => {
  it('creates exactly one event on a clean create (verified receipt)', async () => {
    const h = harness();
    const out = await prepareAndApprove(h);
    expect(out.kind).toBe('confirmed');
    if (out.kind === 'confirmed') {
      expect(out.proposal.status).toBe('verified');
      expect(out.proposal.confirmed?.providerEventId).toBeTruthy();
    }
    expect(h.provider.createdCount).toBe(1);
  });

  it('a retried write does NOT duplicate (idempotency across an ambiguous timeout)', async () => {
    const h = harness();
    // The write lands server-side but the reply is lost -> ambiguous.
    h.provider.submitBehaviour({ kind: 'silent-success' });
    const out = await prepareAndApprove(h);
    expect(out.kind).toBe('verify_pending');
    expect(h.provider.createdCount).toBe(1);

    // Resolve: verify finds the event and confirms; it does NOT re-create.
    const outcomes = await h.orch.resolvePending();
    expect(outcomes[0]?.kind).toBe('confirmed');
    expect(h.provider.createdCount).toBe(1);
  });

  it('a stale-version reschedule is BLOCKED, never overwrites', async () => {
    const h = harness({ grant: { ...writeGrant, provider: 'google' } });
    h.provider.seedEvent({ id: 'evt-target', etag: 'v-current', calendarId: HOME, key: '' });
    const update: CalendarUpdateIntent = {
      kind: 'update',
      provider: 'google',
      targetCalendarId: HOME,
      event: baseEvent({ startUtc: '2026-02-01T16:00:00Z', endUtc: '2026-02-01T16:30:00Z' }),
      target: {
        providerEventId: 'evt-target',
        providerCalendarId: HOME,
        expectedVersion: 'v-STALE',
        seriesKind: 'single',
        ownership: 'organizer-self',
        canWrite: true,
      },
    };
    const out = await prepareAndApprove(h, update);
    expect(out).toMatchObject({ kind: 'refused', reason: 'stale_version' });
    expect(h.provider.currentEtag('evt-target')).toBe('v-current'); // untouched
  });

  it('a newly-busy slot is BLOCKED at the pre-approval refresh — with ZERO egress', async () => {
    const h = harness({ busy: [{ startUtc: '2026-02-01T15:15:00Z', endUtc: '2026-02-01T15:45:00Z' }] });
    const out = await prepareAndApprove(h);
    expect(out).toMatchObject({ kind: 'refused', reason: 'slot_unavailable' });
    expect(h.provider.submitCalls).toBe(0);
  });
});

describe('SC-013 / SC-014 — ownership, same-calendar, writeable (enforced before egress)', () => {
  const gGrant: CalendarGrant = { ...writeGrant, provider: 'google' };
  function update(target: Partial<CalendarUpdateIntent['target']>): CalendarUpdateIntent {
    return {
      kind: 'update',
      provider: 'google',
      targetCalendarId: HOME,
      event: baseEvent(),
      target: {
        providerEventId: 'evt-x',
        providerCalendarId: HOME,
        expectedVersion: 'v1',
        seriesKind: 'single',
        ownership: 'organizer-self',
        canWrite: true,
        ...target,
      },
    };
  }

  it('refuses an unowned target (SC-014) with no egress', async () => {
    const h = harness({ grant: gGrant });
    const out = await h.orch.prepare(update({ ownership: 'attendee' }));
    expect(out).toMatchObject({ kind: 'refused', reason: 'not_owned' });
    expect(h.provider.submitCalls).toBe(0);
  });

  it('refuses a provider-non-writeable target (SC-014, shared reach)', async () => {
    const h = harness({ grant: gGrant });
    const out = await h.orch.prepare(update({ canWrite: false }));
    expect(out).toMatchObject({ kind: 'refused', reason: 'not_writeable' });
  });

  it('refuses a cross-calendar move (SC-013 / B4)', async () => {
    const h = harness({ grant: gGrant });
    const out = await h.orch.prepare(update({ providerCalendarId: 'cal-other' }));
    expect(out).toMatchObject({ kind: 'refused', reason: 'wrong_calendar' });
  });

  it('refuses a create onto a non-home calendar (SC-013)', async () => {
    const h = harness();
    const out = await h.orch.prepare({ ...createIntent(), targetCalendarId: 'cal-other' });
    expect(out).toMatchObject({ kind: 'refused', reason: 'wrong_calendar' });
  });

  it('refuses a recurring target (series_unsupported)', async () => {
    const h = harness({ grant: gGrant });
    const out = await h.orch.prepare(update({ seriesKind: 'recurring-instance' }));
    expect(out).toMatchObject({ kind: 'refused', reason: 'series_unsupported' });
  });
});

describe('SC-022 — ICS and unknown providers can never write', () => {
  it('refuses an ICS write with zero port/egress calls', async () => {
    const h = harness();
    // ICS is not a write provider; force the cast a hostile caller might attempt.
    const ics = { ...createIntent(), provider: 'ics' as unknown as CalendarWriteProviderId };
    const out = await h.orch.prepare(ics);
    expect(out).toMatchObject({ kind: 'refused', reason: 'provider_unsupported' });
    expect(h.provider.submitCalls).toBe(0);
  });
});

describe('Fail-closed — flag and consent', () => {
  it('flag off: prepare refuses, no egress, no proposal persisted', async () => {
    const h = harness({ flag: false });
    const out = await h.orch.prepare(createIntent());
    expect(out).toMatchObject({ kind: 'refused', reason: 'flag_disabled' });
    expect(h.provider.submitCalls).toBe(0);
    expect((await h.store.load()).length).toBe(0);
  });

  it('flag off at approve time also refuses (re-checked at the write)', async () => {
    const h = harness();
    const prepared = await h.orch.prepare(createIntent());
    if (prepared.kind !== 'prepared') throw new Error('setup');
    h.state.flag = false;
    const out = await h.orch.approve(prepared.proposal.id);
    expect(out).toMatchObject({ kind: 'refused', reason: 'flag_disabled' });
    expect(h.provider.submitCalls).toBe(0);
  });

  it('no write grant: refuses with no egress, and the read grant is untouched', async () => {
    const readGrant: CalendarGrant = { ...writeGrant, capability: 'read' };
    const snapshot = JSON.stringify(readGrant);
    const h = harness({ grant: readGrant });
    const out = await h.orch.prepare(createIntent());
    expect(out).toMatchObject({ kind: 'refused', reason: 'consent_missing' });
    expect(h.provider.submitCalls).toBe(0);
    // byte-identical read grant after a non-upgraded ending
    expect(JSON.stringify(h.state.grant)).toBe(snapshot);
  });

  it('consent revoked between prepare and approve: the write is stopped', async () => {
    const h = harness();
    const prepared = await h.orch.prepare(createIntent());
    if (prepared.kind !== 'prepared') throw new Error('setup');
    h.state.grant = { ...writeGrant, capability: 'read' };
    const out = await h.orch.approve(prepared.proposal.id);
    expect(out).toMatchObject({ kind: 'refused', reason: 'consent_missing' });
    expect(h.provider.submitCalls).toBe(0);
  });
});

describe('SC-012 / B3 — a confirmation only ever comes from a verified provider receipt', () => {
  it('a prepared proposal is not a confirmation', async () => {
    const h = harness();
    const out = await h.orch.prepare(createIntent());
    expect(out.kind).toBe('prepared');
    expect(out.kind).not.toBe('confirmed');
  });

  it('an ambiguous submit yields verify_pending, never a confirmation', async () => {
    const h = harness();
    h.provider.submitBehaviour({ kind: 'timeout' });
    const out = await prepareAndApprove(h);
    expect(out.kind).toBe('verify_pending');
    expect(out.kind).not.toBe('confirmed');
  });

  it('a provider rejection yields failed, never a confirmation', async () => {
    const h = harness();
    h.provider.submitBehaviour({ kind: 'reject', reason: 'provider_rejected' });
    const out = await prepareAndApprove(h);
    expect(out).toMatchObject({ kind: 'failed', reason: 'provider_rejected' });
  });
});

describe('No-secret — a hostile provider body never reaches a receipt or the store', () => {
  it('strips secrets from a laced OK body; store + outcome carry none', async () => {
    const h = harness();
    h.provider.submitBehaviour({ kind: 'hostile-ok' });
    const out = await prepareAndApprove(h);
    expect(out.kind).toBe('confirmed');

    const serialised = JSON.stringify(h.store.snapshot());
    const outText = JSON.stringify(out);
    for (const marker of SECRET_MARKERS) {
      expect(serialised).not.toContain(marker);
      expect(outText).not.toContain(marker);
    }
  });

  it('drops provider error text on rejection (only a coerced code survives)', async () => {
    const h = harness();
    h.provider.submitBehaviour({
      kind: 'reject',
      reason: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=SECRET',
    });
    const out = await prepareAndApprove(h);
    expect(out).toMatchObject({ kind: 'failed', reason: 'internal' });
    expect(JSON.stringify(out)).not.toContain('client_id');
  });
});

describe('Restart durability — an approved-but-unverified proposal survives a real reload', () => {
  it('resolves via verification after a serialize round-trip, without re-firing', async () => {
    const store = new SerializingProposalStore();
    const h1 = harness({}, store);
    h1.provider.submitBehaviour({ kind: 'silent-success' }); // lands, reply lost
    const out = await prepareAndApprove(h1);
    expect(out.kind).toBe('verify_pending');
    expect(h1.provider.createdCount).toBe(1);

    // "Restart": only the serialised bytes survive. Build a fresh store + fresh
    // orchestrator, but hand it the SAME provider so verify can find the event.
    const bytes = store.snapshot();
    const rehydrated = new SerializingProposalStore(bytes);
    const h2 = harness({}, rehydrated);
    // A fresh orchestrator over the rehydrated store, but the SAME provider so
    // verify can find the event the first attempt actually created.
    const orch2 = createCalendarWriteOrchestrator({ ...h2.deps, provider: h1.provider });

    const outcomes = await orch2.resolvePending();
    expect(outcomes[0]?.kind).toBe('confirmed');
    expect(h1.provider.createdCount).toBe(1); // never re-fired
  });

  it('the absent-then-resubmit path is fully gated: a slot that went busy blocks the re-submit', async () => {
    const store = new SerializingProposalStore();
    const h = harness({}, store);
    // First attempt times out with the event NOT actually created (plain timeout).
    h.provider.submitBehaviour({ kind: 'timeout' });
    const out = await prepareAndApprove(h);
    expect(out.kind).toBe('verify_pending');
    expect(h.provider.createdCount).toBe(0);

    // Now the slot has become busy. On resolve, verify says absent, and the
    // guarded re-submit must be BLOCKED by the fresh busy check — no new event.
    h.state.busy = [{ startUtc: '2026-02-01T15:15:00Z', endUtc: '2026-02-01T15:45:00Z' }];
    const outcomes = await h.orch.resolvePending();
    expect(outcomes[0]?.kind).toBe('refused');
    expect(h.provider.createdCount).toBe(0);
    expect(h.provider.submitCalls).toBe(1); // the re-submit never reached egress
  });

  it('a tampered stored "verified" row without a confirmation is demoted, never a false booking', async () => {
    const store = new SerializingProposalStore();
    // A row that claims verified but carries no `confirmed` block.
    store.injectRaw(
      'tampered',
      JSON.stringify({
        id: 'tampered',
        kind: 'create',
        provider: 'outlook',
        targetCalendarId: HOME,
        status: 'verified',
        idempotencyKey: newIdempotencyKey(),
        event: baseEvent(),
        grantVersion: 2,
        createdAtUtc: '2026-02-01T00:00:00Z',
        updatedAtUtc: '2026-02-01T00:00:00Z',
      }),
    );
    const loaded = await store.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.status).toBe('verify_pending'); // demoted, not believed
    expect(loaded[0]?.confirmed).toBeUndefined();
  });
});
