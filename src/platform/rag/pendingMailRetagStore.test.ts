/**
 * QA-44 (R7-6) — the persisted mail-retag store must VALIDATE its hydrated shape.
 * A corrupt/partial `localStorage` blob keeps its well-formed records (still held),
 * drops malformed ones rather than trusting a garbage hold, and marks the store
 * SUSPECT so the restore surfaces a visible banner — fail closed, not silent open.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  __resetPendingMailRetagHydrationSuspect,
  pendingMailRetagHydrationSuspect,
  sanitizePersistedMailRetag,
} from './pendingMailRetagStore';

const goodIntent = {
  workspaceRoot: '/wsA',
  provider: 'm365',
  account: 'acct',
  folderId: 'Inbox',
  targetMatter: 'B',
  staleMatters: ['A'],
};

afterEach(() => {
  __resetPendingMailRetagHydrationSuspect();
});

describe('sanitizePersistedMailRetag (R7-6 shape validation)', () => {
  it('keeps a well-formed intent and does NOT flag suspicion', () => {
    const out = sanitizePersistedMailRetag({ intents: { k: goodIntent } });
    expect(out.intents['k']).toEqual(goodIntent);
    expect(pendingMailRetagHydrationSuspect()).toBe(false);
  });

  it('drops a malformed record, keeps the good ones, and flags suspicion', () => {
    const out = sanitizePersistedMailRetag({
      intents: {
        good: goodIntent,
        badStale: { ...goodIntent, staleMatters: 'not-an-array' },
        missingField: { workspaceRoot: '/wsA', provider: 'm365' },
        notObject: 42,
      },
    });
    expect(out.intents['good']).toEqual(goodIntent);
    expect(out.intents['badStale']).toBeUndefined();
    expect(out.intents['missingField']).toBeUndefined();
    expect(out.intents['notObject']).toBeUndefined();
    // A dropped record means the restored hold set may be incomplete → suspect.
    expect(pendingMailRetagHydrationSuspect()).toBe(true);
  });

  it('flags a wholly wrong-shaped blob and yields no intents', () => {
    const out = sanitizePersistedMailRetag({ intents: 'garbage' });
    expect(out.intents).toEqual({});
    expect(pendingMailRetagHydrationSuspect()).toBe(true);
  });

  it('rejects a stale-matters array containing a non-string', () => {
    const out = sanitizePersistedMailRetag({
      intents: { k: { ...goodIntent, staleMatters: ['A', 7] } },
    });
    expect(out.intents['k']).toBeUndefined();
    expect(pendingMailRetagHydrationSuspect()).toBe(true);
  });

  it('treats a legitimately empty / absent store as NOT suspect', () => {
    expect(sanitizePersistedMailRetag(undefined).intents).toEqual({});
    expect(sanitizePersistedMailRetag(null).intents).toEqual({});
    expect(sanitizePersistedMailRetag({ intents: {} }).intents).toEqual({});
    expect(pendingMailRetagHydrationSuspect()).toBe(false);
  });
});
