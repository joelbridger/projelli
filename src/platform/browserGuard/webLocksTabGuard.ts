// src/platform/browserGuard/webLocksTabGuard.ts
//
// TWO SUBSTRATES (see tabLockGuard.ts's createTabGuard() for selection): this
// is the PREFERRED single-writer substrate, built on the browser's native Web
// Locks API (navigator.locks). tabWriteGuard.ts's heartbeat + compare-and-set
// protocol is kept as the fallback for the rare browser without
// navigator.locks (feature-detected at guard-construction time).
//
// Why this is better than the heartbeat protocol: the browser itself
// arbitrates exclusive ownership of a named lock across every same-origin
// tab/worker. That eliminates, structurally rather than by careful patching,
// every race class the heartbeat substrate needed seven codex-review rounds
// to close:
//   - no polling interval, so no window between "the record went stale" and
//     "another tab notices" — the browser calls our callback the instant a
//     lock is granted;
//   - no compare-and-set-over-localStorage, so no two-tabs-write-at-once
//     race and no need for a re-read-after-write confirmation step;
//   - no staleAfterMs guess — a crashed/closed/navigated-away tab's document
//     is destroyed, and the browser releases its lock as a direct
//     consequence, with no timeout to tune or wait out;
//   - a browsing-context frozen in the back/forward cache (bfcache) keeps
//     holding its lock for as long as the browser keeps that document alive
//     (frozen, not destroyed) — which is the CORRECT behavior (that tab
//     hasn't actually gone away), not a bug to patch around with pagehide/
//     pageshow re-checks the way the heartbeat substrate needs.
//
// The one capability this substrate gives up: FORCED preemption. The
// heartbeat guard's requestTakeover() can unilaterally overwrite the lock
// record regardless of what the current owner does. The Web Locks API has no
// "steal" primitive (by design — that's what makes the browser's exclusivity
// guarantee trustworthy) so a tab can only become owner when the browser
// actually grants it the lock, which only happens once the current holder's
// lock callback returns (see yieldIfOwner below) or its document is
// destroyed. Takeover is therefore COOPERATIVE-ONLY under this substrate:
// requestTakeover() (below) is a no-op, since this guard is already queued
// for the lock from the moment start() ran; useTabWriteGuard.ts's existing
// flush-and-ack handshake (flushHandoff.ts) is what actually nudges the
// current owner to flush and then call ITS OWN guard's yieldIfOwner() to let
// the waiting tab through. In the pathological case of a current owner that
// is alive, running, but never responds to that request (a bug, not a
// realistic browser state), takeover has no bound and simply keeps waiting —
// a deliberate, documented trade of forced-preemption for eliminating an
// entire class of real races. See useTabWriteGuard.ts's module doc for how
// the two sides of the handshake are wired.
//
// A second, subtler trade-off: the requeueDelayAfterYieldMs heuristic (see
// its field doc). A tab that just voluntarily yielded the lock does NOT
// immediately re-enter the queue — it waits a few seconds first. Without
// this, the new owner's OWN required reload (forced rehydrate — see
// useTabWriteGuard.ts) creates a brief real gap (the reloading document is
// destroyed, releasing the lock, before its replacement resubmits a
// request) that the just-demoted tab, still alive and racing to requeue,
// could win — silently handing the lock back to the wrong tab. This is a
// fixed delay, not a proof; it is comfortably longer than a typical page
// reload but not a hard guarantee under extreme load. Two other hazards
// this module closes with certainty rather than heuristics: React 18
// StrictMode's dev-only mount→cleanup→remount double-invoke (see
// `generation` and hasProbedOnce's field docs) and the lone-tab false-
// positive reload loop (see attemptAcquire()'s doc on the `ifAvailable`
// probe).

import type { TabGuardStatus } from './tabWriteGuard';
import { randomId } from './randomId';

export interface LockRequestOptions {
  signal?: AbortSignal;
  /** Never queues: the browser grants immediately if free (callback receives
   *  a real lock), or invokes the callback immediately with `null` if
   *  already held elsewhere. Used exactly once per guard — see the
   *  "uncontended-first-acquisition" doc on attemptAcquire below. */
  ifAvailable?: boolean;
}

export type LockGrantedCallback = (lock: unknown) => unknown;

/** The subset of the real navigator.locks LockManager shape this guard
 *  needs — narrow enough to be trivially fakeable in tests (see
 *  webLocksTabGuard.test.ts's FakeLockManager) while a real LockManager
 *  instance satisfies it as-is. */
export interface LockManagerLike {
  request(name: string, callback: LockGrantedCallback): Promise<unknown>;
  request(name: string, options: LockRequestOptions, callback: LockGrantedCallback): Promise<unknown>;
}

export interface WebLocksTabGuardOptions {
  locks?: LockManagerLike;
  tabId?: string;
  /** See the field doc on the private field of the same name: how long a
   *  tab that just voluntarily yielded waits before re-entering the queue.
   *  Defaults to 3000ms; tests override it to 0 for determinism. */
  requeueDelayAfterYieldMs?: number;
}

// Deliberately NOT `err instanceof Error`: jsdom's DOMException (used by the
// fake LockManager in tests) does not extend Error, even though real
// browsers' DOMException does. Matching on `.name` (the one thing every
// AbortError-shaped value — real or faked — actually has) works in both.
function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

export class WebLocksTabGuard {
  private readonly key: string;
  private readonly locks: LockManagerLike;
  private readonly _tabId: string;
  private _status: TabGuardStatus = 'blocked';
  private listeners = new Set<(status: TabGuardStatus) => void>();
  private abortController: AbortController | null = null;
  private releaseHeldLock: (() => void) | null = null;
  /** True until start() runs, and again once stop() has been called for
   *  good — distinguishes a real shutdown (don't requeue) from a voluntary
   *  yield (requeue so a later reclaim needs no external action). */
  private stopped = true;
  /** Consumed by the very first attemptAcquire() call this guard instance
   *  EVER makes — never reset, including across a stop()/start() cycle (see
   *  attemptAcquire()'s doc for why re-probing on every restart would be
   *  actively harmful, not just redundant). */
  private hasProbedOnce = false;
  /** Sticky: once true, stays true for this guard instance's entire
   *  lifetime. Sets true the moment we have SOLID evidence a real other tab
   *  was ever involved — either the one-shot probe found the lock genuinely
   *  held by someone else, or this tab itself voluntarily yielded the lock
   *  to an incoming takeover request (which only a different real tab could
   *  have sent). Read directly by shouldRehydrateOnThisAcquisition() below —
   *  once true, every later acquisition (including any auto-reclaim after
   *  yielding) correctly reports reload-worthy, since by definition another
   *  tab was genuinely the owner at some point before it. */
  private contentionEverConfirmed = false;
  /** How long a tab that just voluntarily yielded (see yieldIfOwner) waits
   *  before re-entering the queue for a future auto-reclaim. This is a
   *  deliberate, documented heuristic, not a hard guarantee — see
   *  attemptAcquire()'s "finally" doc for the exact race it exists to avoid:
   *  the new owner's reload (reloadAsFreshOwner in useTabWriteGuard.ts)
   *  necessarily destroys its document to release THIS tab's just-yielded
   *  lock and re-acquire it fresh; without a delay, this tab's immediate
   *  requeue can win that gap and steal the lock back before the new
   *  owner's reloaded page manages to resubmit its own request. */
  private readonly requeueDelayAfterYieldMs: number;
  /** Bumped by every start()/stop() call. An in-flight attemptAcquire()'s
   *  callback and `finally` both check this against the value captured at
   *  their own call time, so an attempt superseded by a LATER start()/stop()
   *  cycle recognizes itself as stale and declines to touch guard state —
   *  see attemptAcquire()'s doc for why this is needed even for the
   *  ifAvailable probe path, which has no AbortController to cancel it. */
  private generation = 0;

  constructor(key: string, options: WebLocksTabGuardOptions = {}) {
    this.key = key;
    this.locks = options.locks ?? (navigator.locks as unknown as LockManagerLike);
    this._tabId = options.tabId ?? randomId('tab');
    this.requeueDelayAfterYieldMs = options.requeueDelayAfterYieldMs ?? 3000;
  }

  get tabId(): string {
    return this._tabId;
  }

  get status(): TabGuardStatus {
    return this._status;
  }

  /** Begin contending for the lock. Safe to call once; idempotent. Unlike
   *  the heartbeat substrate, this can never resolve synchronously — the Web
   *  Locks API always defers the grant callback at least one microtask, even
   *  when the lock is immediately free, so a lone tab briefly reports
   *  'blocked' before flipping to 'owner'. That gap is on the order of a
   *  single microtask (not the heartbeat substrate's polling interval) and
   *  is not user-perceptible. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.generation += 1;
    this.attemptAcquire(this.generation);
  }

  /** Requests the lock, probing with `ifAvailable` on the very first-ever
   *  attempt only.
   *
   *  Why the probe: this guard's status genuinely starts 'blocked' (the
   *  class field default) and only becomes 'owner' once the browser grants
   *  it — which, per the Web Locks API, is NEVER synchronous, even for an
   *  uncontended lock. useTabWriteGuard.ts's mount effect reads `.status`
   *  synchronously right after calling start(), so for a LONE tab with
   *  nobody else ever holding the lock, it would always observe a
   *  'blocked' → 'owner' transition a moment later — indistinguishable, by
   *  the bare status sequence alone, from a genuine "recovered the lock
   *  from a real other tab" transition, which is exactly the signal that
   *  effect uses to force a rehydrating reload (stale-store protection).
   *  Without the probe, EVERY page load — including the single-tab common
   *  case — would trigger that reload, and the reloaded page would hit the
   *  exact same async-grant timing and reload again: an infinite loop.
   *
   *  `ifAvailable` resolves this: it never queues, so its callback tells us,
   *  within one microtask, whether another tab held the lock AT THAT
   *  INSTANT. If someone did (lock === null), that's solid proof of a real
   *  other tab — contentionEverConfirmed is set true (permanently; see its
   *  field doc) and this call holds nothing, falling through to the normal
   *  queueing path via the `finally` requeue below. If nobody did, nothing
   *  is recorded either way — this one acquisition (and any later one, for
   *  as long as contentionEverConfirmed stays false) is genuinely
   *  uncontended, and shouldRehydrateOnThisAcquisition() (below) reports
   *  false for it. Only the very first attempt this guard EVER makes probes
   *  — every later acquisition (the contended-fallback above, or any
   *  auto-reclaim after yielding) uses the normal queueing request, and its
   *  reload-worthiness is decided purely by whether contentionEverConfirmed
   *  has been set by then.
   *
   *  `generation` guards against a subtler hazard specific to the probe:
   *  React 18 StrictMode (dev only) mounts an effect, cleans it up, then
   *  mounts it again — calling stop() then start() on this SAME guard
   *  singleton in quick succession. The probe has no AbortController (see
   *  below), so a probe from the FIRST mount can still be in flight (and
   *  still eventually grantable) when the SECOND mount's start() begins a
   *  fresh attempt. Without this check, that orphaned first attempt could
   *  fire its callback later and mutate state (or hold a lock) on behalf of
   *  a generation that's no longer current. Every start()/stop() call bumps
   *  `generation`; an attempt compares the value it captured at call time
   *  against the CURRENT value and declines entirely if they've diverged.
   *  hasProbedOnce is deliberately NOT reset by that same stop()/start()
   *  cycle (see its own field doc) — re-probing on the second mount would
   *  race the orphaned first probe for the FakeLockManager/browser's
   *  internal "is it held" bookkeeping and could observe its OWN still-
   *  settling first attempt as if it were a foreign holder. */
  private attemptAcquire(generation: number): void {
    const useProbe = !this.hasProbedOnce;
    this.hasProbedOnce = true;
    // `ifAvailable` and `signal` are mutually exclusive per the Web Locks
    // spec (a request that never queues has nothing to abort), so the probe
    // attempt gets no AbortController — it settles within a microtask
    // regardless, and a stale/stopped probe is caught by the generation
    // check above instead.
    let options: LockRequestOptions;
    if (useProbe) {
      this.abortController = null;
      options = { ifAvailable: true };
    } else {
      const controller = new AbortController();
      this.abortController = controller;
      options = { signal: controller.signal };
    }

    void this.locks
      .request(this.key, options, (lock) => {
        if (useProbe && lock === null) {
          // Solid evidence of a real other tab — true regardless of whether
          // THIS particular attempt is stale (see the generation check
          // below); a stale attempt's discovery is still a true fact.
          this.contentionEverConfirmed = true;
        }
        if (generation !== this.generation) {
          // Superseded by a later start()/stop() cycle — decline outright;
          // release right back if granted, and leave abortController/
          // status/releaseHeldLock alone, since the current generation's
          // own attempt owns them.
          return Promise.resolve();
        }
        this.abortController = null;
        if (useProbe && lock === null) {
          // Probed and found another tab already holding it. Hold nothing;
          // `finally` below requeues via the normal (non-probing) path,
          // whose eventual grant is a genuine contention recovery.
          return undefined;
        }
        this.setStatus('owner');
        return new Promise<void>((resolve) => {
          this.releaseHeldLock = resolve;
        });
      })
      .catch((err: unknown) => {
        if (!isAbortError(err)) throw err;
      })
      .finally(() => {
        if (generation !== this.generation) return;
        this.abortController = null;
        this.releaseHeldLock = null;
        const wasOwner = this._status === 'owner';
        if (wasOwner) {
          this.setStatus('blocked');
        }
        if (this.stopped) return;
        // Re-queue unless this is a real shutdown — this is what lets a
        // demoted tab silently reclaim the lock later with no user action,
        // mirroring the heartbeat substrate's continuous polling. A tab
        // that WAS just the owner (a cooperative yield, per yieldIfOwner)
        // waits requeueDelayAfterYieldMs first — see that field's doc for
        // the exact race this avoids with the new owner's reload. A tab
        // that never became owner in the first place (the contended-probe
        // fallback, or an aborted/declined attempt) isn't racing anyone's
        // reload, so it requeues immediately.
        if (wasOwner) {
          setTimeout(() => {
            if (!this.stopped) this.attemptAcquire(this.generation);
          }, this.requeueDelayAfterYieldMs);
        } else {
          this.attemptAcquire(this.generation);
        }
      });
  }

  /** Stop contending and, if this tab currently holds the lock, release it
   *  immediately (equivalent to the tab closing). Does NOT re-queue.
   *
   *  Bumps `generation` (invalidating any in-flight attemptAcquire() call —
   *  see its doc), but deliberately does NOT reset hasProbedOnce: a
   *  subsequent start() should NOT re-probe, even though this looks like a
   *  fresh start()-to-stop() lifetime. See hasProbedOnce's field doc and
   *  attemptAcquire()'s doc for why re-probing on a React 18 StrictMode
   *  remount would race the still-settling orphaned first probe. */
  stop(): void {
    this.stopped = true;
    this.generation += 1;
    if (this.releaseHeldLock) {
      this.releaseHeldLock();
    } else {
      this.abortController?.abort();
    }
  }

  /** No-op under this substrate — see the module doc's "one capability this
   *  substrate gives up" section. This guard has been queued for the lock
   *  since start() ran; there is nothing left to do here. The actual nudge
   *  (asking the current owner to flush and yield) happens in
   *  useTabWriteGuard.ts via the flush-and-ack handshake. */
  requestTakeover(): void {
    // Intentionally empty.
  }

  /** Voluntarily release the lock if this guard currently holds it, so a
   *  waiting tab can be granted it next. Called by useTabWriteGuard.ts after
   *  this tab (as the current owner) finishes flushing in response to
   *  another tab's takeover request. Actually releasing here is solid proof
   *  a real other tab exists (only a genuine incoming BroadcastChannel
   *  request drives this) — see contentionEverConfirmed's field doc for why
   *  that's recorded permanently, covering this tab's own later reclaim. */
  yieldIfOwner(): void {
    if (this._status === 'owner' && this.releaseHeldLock) {
      this.contentionEverConfirmed = true;
      this.releaseHeldLock();
    }
  }

  /** Re-subscribe to status changes. Returns an unsubscribe function. */
  subscribe(listener: (status: TabGuardStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** No-op under this substrate: Web Locks state is always current, driven
   *  directly by the browser's own grant/release callbacks — there is no
   *  polling drift to correct, unlike the heartbeat substrate's checkNow(). */
  checkNow(): void {
    // Intentionally empty.
  }

  /** See contentionEverConfirmed's field doc: reads that sticky flag
   *  directly. False for as long as no real other tab has ever been
   *  confirmed to exist (the common, single-tab case); true from the moment
   *  one is. useTabWriteGuard.ts calls this at the exact moment it observes
   *  a blocked→owner transition, to decide whether to force the
   *  rehydrate-before-write reload. */
  shouldRehydrateOnThisAcquisition(): boolean {
    return this.contentionEverConfirmed;
  }

  private setStatus(next: TabGuardStatus): void {
    if (this._status === next) return;
    this._status = next;
    this.listeners.forEach((listener) => {
      listener(next);
    });
  }
}
