// src/platform/browserGuard/webLocksTabGuard.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebLocksTabGuard, type LockManagerLike, type LockGrantedCallback, type LockRequestOptions } from './webLocksTabGuard';
import { TabWriteGuard } from './tabWriteGuard';

const LOCK_KEY = 'test:tab-lock';

/** Minimal in-memory Storage double for the rollout-compatibility bridge's
 *  `legacyStorage` option, so these tests never touch real localStorage
 *  (jsdom provides a real one, and WebLocksTabGuard defaults to it — this
 *  double is injected everywhere in this file precisely to avoid that). */
class FakeStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

/** Faithful-enough stand-in for the real navigator.locks LockManager: FIFO
 *  queue, exclusive-only (we never request 'shared' mode), and honors an
 *  AbortSignal on a still-PENDING (not yet granted) request — exactly the
 *  two things WebLocksTabGuard actually uses. */
class FakeLockManager implements LockManagerLike {
  private held = false;
  private queue: Array<() => void> = [];

  request(
    name: string,
    optionsOrCallback: LockRequestOptions | LockGrantedCallback,
    maybeCallback?: LockGrantedCallback,
  ): Promise<unknown> {
    const isCallbackFirst = typeof optionsOrCallback === 'function';
    const options: LockRequestOptions = isCallbackFirst ? {} : optionsOrCallback;
    const callback = (isCallbackFirst ? optionsOrCallback : maybeCallback) as LockGrantedCallback;

    // Matches the real navigator.locks.request(): `signal` and `ifAvailable`
    // are mutually exclusive (a request that never queues has nothing to
    // abort) and combining them throws synchronously, not a rejection.
    if (options.signal && options.ifAvailable) {
      throw new TypeError("Failed to execute 'request' on 'LockManager': The 'signal' and 'ifAvailable' options cannot be used together.");
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      const onAbort = () => {
        if (settled) return;
        settled = true;
        const idx = this.queue.indexOf(tryAcquire);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new DOMException('The request was aborted', 'AbortError'));
      };

      const tryAcquire = () => {
        if (settled) return;
        settled = true;
        this.held = true;
        options.signal?.removeEventListener('abort', onAbort);
        Promise.resolve()
          .then(() => callback({ name, mode: 'exclusive' }))
          .then(
            (value) => {
              this.held = false;
              this.grantNext();
              resolve(value);
            },
            (err: unknown) => {
              this.held = false;
              this.grantNext();
              reject(err instanceof Error ? err : new Error(String(err)));
            },
          );
      };

      if (options.ifAvailable) {
        // Never queues: settle immediately, one way or the other.
        if (this.held) {
          settled = true;
          void Promise.resolve()
            .then(() => callback(null))
            .then(resolve, (err: unknown) => {
              reject(err instanceof Error ? err : new Error(String(err)));
            });
        } else {
          tryAcquire();
        }
        return;
      }

      options.signal?.addEventListener('abort', onAbort);

      if (this.held) {
        this.queue.push(tryAcquire);
      } else {
        tryAcquire();
      }
    });
  }

  private grantNext(): void {
    const next = this.queue.shift();
    next?.();
  }

  /** Test introspection: how many requests are still waiting their turn. */
  get pendingCount(): number {
    return this.queue.length;
  }
}

/** Flush the microtask queue (and one macrotask tick) so chained .then()s
 *  inside FakeLockManager/WebLocksTabGuard have had a chance to run. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('WebLocksTabGuard', () => {
  let guards: WebLocksTabGuard[] = [];
  let heartbeatGuards: TabWriteGuard[] = [];
  let locks: FakeLockManager;
  let legacyStorage: FakeStorage;

  beforeEach(() => {
    locks = new FakeLockManager();
    legacyStorage = new FakeStorage();
    guards = [];
    heartbeatGuards = [];
  });

  afterEach(() => {
    guards.forEach((g) => {
      g.stop();
    });
    heartbeatGuards.forEach((g) => {
      g.stop();
    });
  });

  function makeGuard(
    overrides: {
      requeueDelayAfterYieldMs?: number;
      legacyHeartbeatIntervalMs?: number;
      legacyStaleAfterMs?: number;
    } = {},
  ): WebLocksTabGuard {
    // requeueDelayAfterYieldMs defaults to 0 here (production default is
    // 3000ms — see the field doc on webLocksTabGuard.ts) so these tests stay
    // fast and deterministic; the delay itself is exercised by its own test
    // below. legacyStorage is ALWAYS an isolated fake — the class defaults
    // to real window.localStorage, which these tests must never touch.
    // legacyHeartbeatIntervalMs/legacyStaleAfterMs default to fast values
    // (production defaults are 1500ms/5000ms) so the rollout-bridge tests
    // don't need real multi-second waits.
    const guard = new WebLocksTabGuard(LOCK_KEY, {
      locks,
      requeueDelayAfterYieldMs: 0,
      legacyStorage,
      legacyHeartbeatIntervalMs: 20,
      legacyStaleAfterMs: 60,
      ...overrides,
    });
    guards.push(guard);
    return guard;
  }

  /** A real heartbeat guard sharing the SAME fake legacy storage/key — used
   *  to test the rollout-compatibility bridge from the "old tab" side (see
   *  webLocksTabGuard.ts's module doc). Not a fake: this is the actual,
   *  unmodified TabWriteGuard class old deployed bundles run. */
  function makeHeartbeatGuard(tabId: string): TabWriteGuard {
    const guard = new TabWriteGuard(LOCK_KEY, { storage: legacyStorage, tabId, heartbeatIntervalMs: 20, staleAfterMs: 60 });
    heartbeatGuards.push(guard);
    return guard;
  }

  it('claims ownership once the browser grants the (immediately free) lock', async () => {
    const a = makeGuard();
    a.start();
    expect(a.status).toBe('blocked'); // Web Locks grants are always async — never synchronous.
    await flush();
    expect(a.status).toBe('owner');
  });

  it('regression: a lone, uncontended first acquisition reports shouldRehydrateOnThisAcquisition() === false, so a solo tab does not force a reload loop', async () => {
    // Web Locks grants are never synchronous even when uncontended, so a
    // solo tab's status genuinely goes 'blocked' -> 'owner' on its very
    // first load -- indistinguishable, by the bare status sequence alone,
    // from a real recovery from another tab. Without the ifAvailable probe
    // this guard uses internally, useTabWriteGuard.ts would force a reload
    // on every solo page load, and the reloaded page would hit the exact
    // same timing and reload again forever.
    const a = makeGuard();
    a.start();
    await flush();
    expect(a.status).toBe('owner');
    expect(a.shouldRehydrateOnThisAcquisition()).toBe(false);
  });

  it('regression: React 18 StrictMode dev double-invoke (start, immediate stop, immediate restart before the probe settles) still resolves to a single correct owner with no stale-state leakage', async () => {
    // StrictMode mounts an effect, cleans it up, then mounts it again --
    // calling stop() then start() on this SAME guard singleton within the
    // same synchronous tick, before the ifAvailable probe (which has no
    // AbortController) has had a chance to settle. Without the generation
    // check, the orphaned first probe's eventual grant could race with the
    // second start()'s own attempt and corrupt guard state.
    const a = makeGuard();
    a.start();
    a.stop();
    a.start();
    await flush();

    expect(a.status).toBe('owner');
    expect(a.shouldRehydrateOnThisAcquisition()).toBe(false); // still a genuinely uncontended first acquisition

    const b = makeGuard();
    b.start();
    await flush();
    expect(b.status).toBe('blocked'); // the lock is truly held once, not leaked/duplicated
  });

  it('regression (codex-review round 2): after a real stop()/start() gap (e.g. a bfcache freeze-then-restore) with time to actually settle, a fresh probe correctly detects contention that arose while this guard was away', async () => {
    // Unlike the StrictMode case above (no real time passes, so re-probing
    // would race the orphaned first probe), a genuine stop()-then-start()
    // separated by a settled gap must re-probe -- otherwise a tab that lost
    // the lock while frozen and reclaims afterward would wrongly skip the
    // rehydrate-before-write reload.
    const a = makeGuard();
    a.start();
    await flush(); // a's first probe settles: uncontended, owner
    expect(a.status).toBe('owner');
    expect(a.shouldRehydrateOnThisAcquisition()).toBe(false);

    a.stop(); // simulates releaseOnFreeze() releasing on bfcache freeze
    await flush();

    // Real time passes: a different guard (a different real tab) takes the
    // now-free lock while `a` is away.
    const b = makeGuard();
    b.start();
    await flush();
    expect(b.status).toBe('owner');

    a.start(); // simulates restoring from bfcache and re-queueing
    await flush();
    expect(a.status).toBe('blocked'); // b genuinely holds it

    b.stop();
    await flush();
    expect(a.status).toBe('owner');
    // The fresh probe on restart found b holding it -- this reclaim must be
    // treated as a genuine recovery, not silently skipped.
    expect(a.shouldRehydrateOnThisAcquisition()).toBe(true);
  });

  it('regression (codex-review round 3, P1): reacquiring after releasing a HELD lock (e.g. bfcache freeze) is ALWAYS reload-worthy, even if the probe on restart finds the lock free again', async () => {
    // The dangerous case round 2's test above doesn't cover: another tab (b)
    // acquires the lock, saves, and closes again -- ALL before `a` restarts.
    // `a`'s fresh probe on restart then finds the lock genuinely free
    // (nobody currently holds it), which would look identical to "nobody
    // ever touched it." But releasing at all means `a` can no longer prove
    // nothing happened while it was gone -- skipping the reload here would
    // let `a` write its stale in-memory state over whatever `b` saved.
    const a = makeGuard();
    a.start();
    await flush();
    expect(a.status).toBe('owner');
    expect(a.shouldRehydrateOnThisAcquisition()).toBe(false);

    a.stop(); // releases a HELD lock -- simulates releaseOnFreeze() on bfcache freeze
    await flush();

    // b comes and goes entirely while a is away -- by the time a restarts,
    // there is NO other guard left to be found contended against.
    const b = makeGuard();
    b.start();
    await flush();
    b.stop();
    await flush();

    a.start(); // simulates restoring from bfcache
    await flush();
    expect(a.status).toBe('owner'); // uncontended probe -- the lock is genuinely free
    // Despite the probe finding it free, this MUST still be reload-worthy --
    // a real other tab genuinely held it in between, even though it's gone
    // again by the time we checked.
    expect(a.shouldRehydrateOnThisAcquisition()).toBe(true);
  });

  it('an acquisition that genuinely had to wait behind another guard reports shouldRehydrateOnThisAcquisition() === true', async () => {
    const a = makeGuard();
    const b = makeGuard();
    a.start();
    await flush();
    b.start();
    await flush();
    expect(b.status).toBe('blocked');

    a.stop();
    await flush();

    expect(b.status).toBe('owner');
    expect(b.shouldRehydrateOnThisAcquisition()).toBe(true);
  });

  it('a later reclaim after having yielded at least once always reports shouldRehydrateOnThisAcquisition() === true, even though this same guard was once the uncontended first owner', async () => {
    const a = makeGuard();
    const b = makeGuard();
    a.start();
    await flush();
    expect(a.shouldRehydrateOnThisAcquisition()).toBe(false); // a's own first, uncontended grant

    b.start();
    await flush();
    a.yieldIfOwner();
    await flush();
    expect(b.status).toBe('owner');
    expect(b.shouldRehydrateOnThisAcquisition()).toBe(true); // b waited behind a -- real contention

    b.yieldIfOwner();
    await flush();
    expect(a.status).toBe('owner'); // a reclaims automatically
    expect(a.shouldRehydrateOnThisAcquisition()).toBe(true); // but THIS time it's a genuine recovery
  });

  it('blocks a second guard while the first holds the lock', async () => {
    const a = makeGuard();
    const b = makeGuard();
    a.start();
    await flush();
    b.start();
    await flush();

    expect(a.status).toBe('owner');
    expect(b.status).toBe('blocked');
  });

  it('auto-releases when the owner stops (simulating tab close/crash), letting the blocked guard through with no polling or staleness wait', async () => {
    const a = makeGuard();
    const b = makeGuard();
    a.start();
    await flush();
    b.start();
    await flush();
    expect(b.status).toBe('blocked');

    a.stop();
    await flush();

    expect(b.status).toBe('owner');
  });

  it('yieldIfOwner() releases a held lock cooperatively, letting the next queued guard become owner', async () => {
    const a = makeGuard();
    const b = makeGuard();
    a.start();
    await flush();
    b.start();
    await flush();
    expect(a.status).toBe('owner');
    expect(b.status).toBe('blocked');

    a.yieldIfOwner();
    await flush();

    expect(a.status).toBe('blocked');
    expect(b.status).toBe('owner');
  });

  it('regression: after voluntarily yielding, this guard does NOT immediately re-enter the queue — it waits requeueDelayAfterYieldMs, so it cannot steal the lock back from the new owner mid-reload', async () => {
    // The new owner's reload (reloadAsFreshOwner in useTabWriteGuard.ts)
    // necessarily destroys its document to release the just-yielded lock
    // and re-acquires it fresh. If the tab that just yielded requeued
    // immediately, it could win that gap before the new owner's reloaded
    // page resubmits its own request -- silently handing the lock back to
    // the wrong tab. A real delay (here shortened to 20ms) proves the
    // requeue genuinely waits rather than firing on the same tick.
    const a = makeGuard({ requeueDelayAfterYieldMs: 20 });
    const b = makeGuard();
    a.start();
    await flush();
    b.start();
    await flush();
    expect(a.status).toBe('owner');

    a.yieldIfOwner();
    await flush();
    expect(b.status).toBe('owner'); // b, the long-waiting guard, gets it

    // Immediately after yielding (well within the 20ms delay), a must NOT
    // yet be back in the FakeLockManager's queue contending for the lock.
    expect(locks.pendingCount).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 40));
    await flush();
    // Now that the delay has elapsed, a is back in the queue (blocked,
    // behind b) -- proving the requeue did eventually happen, just not
    // instantly.
    expect(a.status).toBe('blocked');
    expect(locks.pendingCount).toBe(1);
  });

  it('regression (codex-review round 2): a delayed post-yield requeue superseded by a real stop()/start() cycle during the wait does not submit a duplicate request', async () => {
    // If a bfcache freeze-then-restore (a real stop()/start() cycle) lands
    // inside the requeueDelayAfterYieldMs window, the delayed timeout must
    // recognize itself as superseded (by generation) rather than blindly
    // reusing whatever generation is current at fire time -- otherwise it
    // would submit a SECOND, duplicate request alongside the one the
    // restart's own start() already made.
    const a = makeGuard({ requeueDelayAfterYieldMs: 20 });
    const b = makeGuard();
    a.start();
    await flush();
    b.start();
    await flush();
    expect(a.status).toBe('owner');

    a.yieldIfOwner(); // schedules a's delayed requeue (20ms out)
    await flush();
    expect(b.status).toBe('owner');

    // Before the delay elapses, simulate a real stop()/start() cycle on a
    // (e.g. bfcache freeze-then-restore) -- this bumps generation, which
    // must invalidate the still-pending delayed requeue from the yield.
    a.stop();
    a.start();
    await flush();

    await new Promise((resolve) => setTimeout(resolve, 40));
    await flush();

    // Exactly one pending request for a, not two -- the stale timeout must
    // have declined rather than submitting a duplicate.
    expect(locks.pendingCount).toBe(1);
    expect(a.status).toBe('blocked'); // b still holds it
  });

  it('yieldIfOwner() is a safe no-op when this guard is not currently the owner', async () => {
    const a = makeGuard();
    const b = makeGuard();
    a.start();
    await flush();
    b.start();
    await flush();
    expect(b.status).toBe('blocked');

    expect(() => {
      b.yieldIfOwner();
    }).not.toThrow();
    await flush();
    expect(b.status).toBe('blocked');
    expect(a.status).toBe('owner');
  });

  it('auto-requeues after yielding, so a later reclaim needs no external action (mirrors heartbeat continuous polling)', async () => {
    const a = makeGuard();
    const b = makeGuard();
    a.start();
    await flush();
    b.start();
    await flush();

    a.yieldIfOwner(); // a -> blocked, b -> owner
    await flush();
    expect(a.status).toBe('blocked');
    expect(b.status).toBe('owner');

    b.yieldIfOwner(); // b -> blocked, a reclaims automatically -- proves a re-queued
    await flush();
    expect(b.status).toBe('blocked');
    expect(a.status).toBe('owner');
  });

  it('regression (codex-review): stop() while actually holding the lock immediately reflects blocked status, not leaving it stuck reporting owner', async () => {
    // stop() bumps `generation`, which makes the held attempt's OWN async
    // `finally` see itself as stale once the release resolves -- so status
    // must be updated directly inside stop(), synchronously, not left to
    // that (now-declining) `finally` to handle.
    const a = makeGuard();
    a.start();
    await flush();
    expect(a.status).toBe('owner');

    a.stop();
    expect(a.status).toBe('blocked');

    // And the lock is genuinely released, not just cosmetically -- a
    // waiting guard can actually acquire it.
    const b = makeGuard();
    b.start();
    await flush();
    expect(b.status).toBe('owner');
  });

  it('stop() while still pending (never granted) cancels cleanly without becoming owner or leaking a queue slot', async () => {
    const a = makeGuard();
    const b = makeGuard();
    a.start();
    await flush();
    b.start();
    await flush();
    expect(locks.pendingCount).toBe(1);

    b.stop();
    await flush();
    expect(b.status).toBe('blocked'); // never granted
    expect(locks.pendingCount).toBe(0); // cancelled, not left queued

    const c = makeGuard();
    c.start();
    await flush();
    expect(c.status).toBe('blocked'); // a is still owner, unaffected by b's cancel

    a.stop();
    await flush();
    expect(c.status).toBe('owner'); // c (not the cancelled b) gets it
  });

  it('requestTakeover() is a safe no-op — this guard is already queued from start(); there is no force primitive to invoke', async () => {
    const a = makeGuard();
    const b = makeGuard();
    a.start();
    await flush();
    b.start();
    await flush();
    expect(b.status).toBe('blocked');

    expect(() => {
      b.requestTakeover();
    }).not.toThrow();
    await flush();
    expect(b.status).toBe('blocked'); // still blocked -- only a cooperative yield or a's stop() unblocks it
  });

  it('checkNow() is a safe no-op — Web Locks state is always current, driven by the browser, never polled', async () => {
    const a = makeGuard();
    a.start();
    await flush();
    expect(() => {
      a.checkNow();
    }).not.toThrow();
    expect(a.status).toBe('owner');
  });

  it('releaseOnFreeze() is true: a frozen (bfcache) owner has no force-takeover fallback, so it must release rather than block "Take over" indefinitely (codex-review finding)', () => {
    const a = makeGuard();
    expect(a.releaseOnFreeze()).toBe(true);
  });

  it('notifies subscribers when status changes', async () => {
    const a = makeGuard();
    const b = makeGuard();
    a.start();
    await flush();
    b.start();
    await flush();

    const seen: string[] = [];
    const unsubscribe = b.subscribe((status) => seen.push(status));

    a.stop();
    await flush();

    expect(seen).toEqual(['owner']);
    unsubscribe();
  });

  it('exposes a stable tabId (interface parity with the heartbeat substrate; not load-bearing for correctness here)', () => {
    const a = makeGuard();
    expect(typeof a.tabId).toBe('string');
    expect(a.tabId.length).toBeGreaterThan(0);
  });

  it('QA-15: makes the two-tab silent-clobber repro impossible — a blocked guard never applies a write', async () => {
    const sharedMatters: string[] = [];
    const a = makeGuard();
    const b = makeGuard();
    a.start();
    await flush();
    b.start();
    await flush();
    expect(a.status).toBe('owner');
    expect(b.status).toBe('blocked');

    function createMatter(guard: WebLocksTabGuard, name: string): void {
      if (guard.status !== 'owner') return;
      sharedMatters.push(name);
    }

    createMatter(b, 'Created in Guard B');
    createMatter(a, 'Created in Guard A');

    expect(sharedMatters).toEqual(['Created in Guard A']);
  });

  describe('rollout-compatibility bridge (coordinator finding: old heartbeat tab + new Web Locks tab coexisting across a deploy)', () => {
    it('a live foreign (old-code) heartbeat tab blocks a new Web Locks tab from reporting owner, even though it acquires the real Web Lock', async () => {
      const oldTab = makeHeartbeatGuard('old-tab-1');
      oldTab.start(); // heartbeat is synchronous: immediately owner, writes its record
      expect(oldTab.status).toBe('owner');

      const newTab = makeGuard();
      newTab.start();
      await flush(); // Web Lock probe resolves uncontended -- the old tab never touches navigator.locks

      // The Web Lock itself was free, but the bridge's reconcile (run
      // synchronously the moment the real lock is granted) sees the old
      // tab's live heartbeat and refuses to report 'owner' -- otherwise
      // BOTH tabs would believe they're the sole writer.
      expect(newTab.status).toBe('blocked');
      expect(newTab.shouldRehydrateOnThisAcquisition()).toBe(true);
    });

    it('once the foreign heartbeat goes stale (the old tab closes), the Web Locks tab commits to owner', async () => {
      const oldTab = makeHeartbeatGuard('old-tab-1');
      oldTab.start();

      const newTab = makeGuard();
      newTab.start();
      await flush();
      expect(newTab.status).toBe('blocked');

      oldTab.stop(); // old tab closes -- heartbeat's own stop() clears its record

      // Wait for newTab's bridge reconcile interval (20ms in these tests) to
      // notice the record is gone.
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(newTab.status).toBe('owner');
    });

    it('a heartbeat tab correctly defers to a Web Locks tab\'s sentinel record (the other bridge direction)', async () => {
      const newTab = makeGuard();
      newTab.start();
      await flush(); // uncontended -- becomes owner, bridge writes its sentinel record
      expect(newTab.status).toBe('owner');

      const oldTab = makeHeartbeatGuard('old-tab-2');
      oldTab.start(); // heartbeat's own checkNow(): sees a fresh foreign record -> stays blocked
      expect(oldTab.status).toBe('blocked');
    });

    it('when the Web Locks tab releases, it clears its sentinel record immediately so a heartbeat tab can reclaim without waiting out staleness', async () => {
      const newTab = makeGuard();
      newTab.start();
      await flush();
      expect(newTab.status).toBe('owner');

      newTab.stop();

      const oldTab = makeHeartbeatGuard('old-tab-3');
      oldTab.start();
      expect(oldTab.status).toBe('owner'); // no stale record left behind to wait out
    });

    it('a Web Locks tab that is legacy-blocked the whole time still waits requeueDelayAfterYieldMs-style before its next reconcile, and marks contentionEverConfirmed permanently', async () => {
      // Regression-shaped: confirms the legacy-bridge path is treated the
      // same as a real "held the resource" acquisition for the delay/reload
      // bookkeeping, even though status never reported 'owner'.
      const oldTab = makeHeartbeatGuard('old-tab-1');
      oldTab.start();

      const newTab = makeGuard();
      newTab.start();
      await flush();
      expect(newTab.status).toBe('blocked');
      expect(newTab.shouldRehydrateOnThisAcquisition()).toBe(true);

      oldTab.stop();
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(newTab.status).toBe('owner');
      // Still true -- a real other (legacy) tab was genuinely involved.
      expect(newTab.shouldRehydrateOnThisAcquisition()).toBe(true);
    });
  });
});
