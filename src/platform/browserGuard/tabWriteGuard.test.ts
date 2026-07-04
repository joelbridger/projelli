// src/platform/browserGuard/tabWriteGuard.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TabWriteGuard } from './tabWriteGuard';

const LOCK_KEY = 'test:tab-lock';

describe('TabWriteGuard', () => {
  let guards: TabWriteGuard[] = [];

  beforeEach(() => {
    localStorage.clear();
    guards = [];
  });

  afterEach(() => {
    guards.forEach((g) => {
      g.stop();
    });
  });

  function makeGuard(tabId: string): TabWriteGuard {
    const guard = new TabWriteGuard(LOCK_KEY, { tabId });
    guards.push(guard);
    return guard;
  }

  it('claims ownership immediately when no other tab holds the lock', () => {
    const a = makeGuard('A');
    a.start();
    expect(a.status).toBe('owner');
  });

  it('blocks a second tab while the first tab freshly holds the lock', () => {
    const a = makeGuard('A');
    const b = makeGuard('B');
    a.start();
    b.start();
    expect(a.status).toBe('owner');
    expect(b.status).toBe('blocked');
  });

  it('lets the blocked tab take over the instant the owner releases (tab closed)', () => {
    const a = makeGuard('A');
    const b = makeGuard('B');
    a.start();
    b.start();
    expect(b.status).toBe('blocked');

    a.stop(); // simulates the owner tab closing (pagehide -> release)
    b.checkNow(); // simulates the blocked tab's `storage` event handler firing

    expect(b.status).toBe('owner');
  });

  it('lets a blocked tab force a takeover, bumping the current owner to blocked', () => {
    const a = makeGuard('A');
    const b = makeGuard('B');
    a.start();
    b.start();
    expect(a.status).toBe('owner');
    expect(b.status).toBe('blocked');

    b.requestTakeover();
    expect(b.status).toBe('owner');

    // The old owner only learns about this on its own next check (heartbeat
    // tick or a `storage` event) — simulate that here.
    a.checkNow();
    expect(a.status).toBe('blocked');
  });

  it('reclaims an abandoned lock once it goes stale, even without an explicit release', () => {
    let clock = 0;
    const a = new TabWriteGuard(LOCK_KEY, { tabId: 'A', now: () => clock, staleAfterMs: 5000, heartbeatIntervalMs: 1500 });
    const b = new TabWriteGuard(LOCK_KEY, { tabId: 'B', now: () => clock, staleAfterMs: 5000, heartbeatIntervalMs: 1500 });
    guards.push(a, b);

    a.start();
    b.start();
    expect(b.status).toBe('blocked');

    // Tab A crashes/hangs — its timer stops firing, but it never released
    // (no pagehide fired). Advance the clock past staleAfterMs.
    clock += 6000;
    b.checkNow();

    expect(b.status).toBe('owner');
  });

  it('notifies subscribers when status changes', () => {
    const a = makeGuard('A');
    const b = makeGuard('B');
    a.start();
    b.start();

    const seen: string[] = [];
    const unsubscribe = b.subscribe((status) => seen.push(status));

    a.stop();
    b.checkNow();

    expect(seen).toEqual(['owner']);
    unsubscribe();
  });

  it('QA-15: makes the two-tab silent-clobber repro impossible — a blocked tab never applies a write', () => {
    // Mirrors the evidence.md repro shape: two independent "matter store"
    // stand-ins sharing one persisted array, gated by guard.status the same
    // way the real App shell only mounts (and only lets store actions run)
    // for the current owner.
    const sharedMatters: string[] = [];
    const a = makeGuard('A');
    const b = makeGuard('B');
    a.start();
    b.start();
    expect(a.status).toBe('owner');
    expect(b.status).toBe('blocked');

    function createMatter(guard: TabWriteGuard, name: string): void {
      if (guard.status !== 'owner') return; // the gate: blocked tabs never write
      sharedMatters.push(name);
    }

    createMatter(b, 'Created in Tab B'); // tab B is blocked — must be a no-op
    createMatter(a, 'Created in Tab A');

    expect(sharedMatters).toEqual(['Created in Tab A']);
  });

  it('regression (codex-review P2, round 4): does not report ownership if another tab wins the race right after this tab writes', () => {
    // Two tabs can both observe a free/stale lock before either writes (e.g.
    // starting at nearly the same instant). Simulate tab B's write landing in
    // the split second between tab A's write() and tab A's own read-back, by
    // hooking a fake Storage's setItem to inject B's write immediately after
    // A's first write to this key.
    const store = new Map<string, string>();
    let injectRaceOnNextWrite = true;
    const racyStorage: Storage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => {
        store.set(key, value);
        if (injectRaceOnNextWrite && key === LOCK_KEY) {
          injectRaceOnNextWrite = false;
          store.set(key, JSON.stringify({ tabId: 'B', heartbeatAt: Date.now() }));
        }
      },
      removeItem: (key) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: () => null,
      length: 0,
    };

    const a = new TabWriteGuard(LOCK_KEY, { tabId: 'A', storage: racyStorage });
    guards.push(a);

    a.checkNow();

    // A's write was immediately clobbered by B's — A must NOT believe it owns
    // the lock, or both tabs would render as writers simultaneously.
    expect(a.status).toBe('blocked');
    const stored = JSON.parse(store.get(LOCK_KEY) as string) as { tabId: string };
    expect(stored.tabId).toBe('B');
  });
});
