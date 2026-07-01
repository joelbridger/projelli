/**
 * A1 (isolation) — durable "facts" memory must never cross the client/matter
 * boundary. A fact learned inside Client A must NOT be injected into a prompt
 * while Client B is active. Pins both the pure selector and the singleton
 * ingress (`snapshotFactsForInjection`) the chat send path actually calls.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  selectFactsForInjection,
  createFactsService,
  type Fact,
  type FactsStorage,
} from '@/platform/rag/FactsService';
import {
  setFactsServiceForTests,
  resetFactsReaders,
  snapshotFactsForInjection,
} from '@/platform/rag/factsSingleton';

function fact(id: string, text: string, matterId?: string): Fact {
  return {
    id,
    text,
    created: '2026-06-30T12:00:00.000Z',
    approved_by: 'user',
    ...(matterId ? { matterId } : {}),
  };
}

const GLOBAL_FACT = fact('g1', 'The user is a financial advisor at Northcrest.');
const CLIENT_A_FACT = fact('a1', "Client A's SSN ends 4471 and his trust holds $18.75M.", 'client-a');
const CLIENT_B_FACT = fact('b1', "Client B is doing a Roth conversion this year.", 'client-b');

describe('selectFactsForInjection (A1 isolation)', () => {
  const all = [GLOBAL_FACT, CLIENT_A_FACT, CLIENT_B_FACT];

  it('injects ONLY the active client\'s facts when client-scoped — Client B never sees Client A', () => {
    const forB = selectFactsForInjection(all, { matterId: 'client-b' });
    expect(forB).toEqual([CLIENT_B_FACT]);
    // The hard guarantee: Client A's fact is absent while Client B is active.
    expect(forB).not.toContainEqual(CLIENT_A_FACT);
    // And a global/legacy fact is NOT injected in a client scope (fail-safe:
    // we can't prove which client it came from).
    expect(forB).not.toContainEqual(GLOBAL_FACT);
  });

  it('injects ONLY global facts in an all-matters / no-client turn', () => {
    const forAll = selectFactsForInjection(all, { matterId: null });
    expect(forAll).toEqual([GLOBAL_FACT]);
    expect(forAll).not.toContainEqual(CLIENT_A_FACT);
    expect(forAll).not.toContainEqual(CLIENT_B_FACT);
  });

  it('treats legacy unscoped facts as global (never injected in a client scope)', () => {
    const legacyOnly = [GLOBAL_FACT];
    expect(selectFactsForInjection(legacyOnly, { matterId: 'client-a' })).toEqual([]);
    expect(selectFactsForInjection(legacyOnly, { matterId: null })).toEqual([GLOBAL_FACT]);
  });

  it('an unscoped/global fact is NEVER injected while working in a specific (different) client (review P1)', () => {
    // The fail-closed guarantee: even if a global/unscoped fact exists (e.g. a
    // legacy one), a client-scoped turn must not receive it. New ambiguous
    // facts are dropped at save (never stored global) — see deriveFactScope +
    // the AIChatViewer extraction drop — but the injection filter is the
    // second line of defence.
    const facts = [GLOBAL_FACT, CLIENT_A_FACT];
    expect(selectFactsForInjection(facts, { matterId: 'client-b' })).toEqual([]);
    expect(selectFactsForInjection(facts, { matterId: 'client-a' })).toEqual([CLIENT_A_FACT]);
  });
});

describe('snapshotFactsForInjection (A1 — the chat send ingress)', () => {
  // In-memory facts service seeded with one global + one per-client fact.
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    const storage: FactsStorage = {
      read: async (p) => store[p] ?? '',
      write: async (p, c) => { store[p] = c; },
      exists: async (p) => p in store,
      remove: async (p) => { delete store[p]; },
    };
    const svc = createFactsService({ storage });
    setFactsServiceForTests(svc);
    return (async () => {
      await svc.addFact({ text: GLOBAL_FACT.text, approved_by: 'user' });
      await svc.addFact({ text: CLIENT_A_FACT.text, approved_by: 'user', matterId: 'client-a' });
      await svc.addFact({ text: CLIENT_B_FACT.text, approved_by: 'user', matterId: 'client-b' });
    })();
  });

  afterEach(() => {
    setFactsServiceForTests(null);
    resetFactsReaders();
  });

  it("a Client-B prompt does NOT include Client-A's fact", async () => {
    const facts = await snapshotFactsForInjection({ matterId: 'client-b' });
    const texts = facts.map((f) => f.text);
    expect(texts).toContain(CLIENT_B_FACT.text);
    expect(texts).not.toContain(CLIENT_A_FACT.text);
    expect(texts).not.toContain(GLOBAL_FACT.text);
  });

  it('a Client-A prompt includes only Client-A facts', async () => {
    const facts = await snapshotFactsForInjection({ matterId: 'client-a' });
    expect(facts.map((f) => f.text)).toEqual([CLIENT_A_FACT.text]);
  });

  it('defaults to GLOBAL-only when no scope is passed (safe default)', async () => {
    const facts = await snapshotFactsForInjection();
    expect(facts.map((f) => f.text)).toEqual([GLOBAL_FACT.text]);
  });

  it('round-trips matterId through save/load so scope survives persistence', async () => {
    // Re-create a service over the SAME backing store (simulates reload).
    const storage: FactsStorage = {
      read: async (p) => store[p] ?? '',
      write: async (p, c) => { store[p] = c; },
      exists: async (p) => p in store,
      remove: async (p) => { delete store[p]; },
    };
    const reloaded = createFactsService({ storage });
    const loaded = await reloaded.listFacts();
    const a = loaded.find((f) => f.text === CLIENT_A_FACT.text);
    expect(a?.matterId).toBe('client-a');
  });
});
