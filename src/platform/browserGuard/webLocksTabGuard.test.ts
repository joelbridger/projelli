// src/platform/browserGuard/webLocksTabGuard.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebLocksTabGuard, type LockManagerLike, type LockGrantedCallback, type LockRequestOptions } from './webLocksTabGuard';

const LOCK_KEY = 'test:tab-lock';

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
  let locks: FakeLockManager;

  beforeEach(() => {
    locks = new FakeLockManager();
    guards = [];
  });

  afterEach(() => {
    guards.forEach((g) => {
      g.stop();
    });
  });

  function makeGuard(overrides: { requeueDelayAfterYieldMs?: number } = {}): WebLocksTabGuard {
    // requeueDelayAfterYieldMs defaults to 0 here (production default is
    // 3000ms — see the field doc on webLocksTabGuard.ts) so these tests stay
    // fast and deterministic; the delay itself is exercised by its own test
    // below.
    const guard = new WebLocksTabGuard(LOCK_KEY, { locks, requeueDelayAfterYieldMs: 0, ...overrides });
    guards.push(guard);
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
});
