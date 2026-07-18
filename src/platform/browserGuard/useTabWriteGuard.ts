// src/platform/browserGuard/useTabWriteGuard.ts
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { SK_TAB_LOCK } from '@/config/identity';
import { useEditorStore } from '@/platform/state/editorStore';
import { createTabGuard, type TabLockGuard, type TabGuardStatus } from './tabLockGuard';
import { requestFlushAck, wireFlushResponder, type FlushAckChannel } from './flushHandoff';

// One guard per browser tab (module-scoped singleton, not per-component) —
// the lock protocol only makes sense as a single instance contending for one
// lock key on behalf of this tab, no matter how many components call the
// hook. createTabGuard() picks the substrate (Web Locks or the heartbeat
// fallback) — see tabLockGuard.ts.
let sharedGuard: TabLockGuard | null = null;

/** ONE-SHOT handoff for the reload a blocked→owner transition triggers on
 *  itself (see reloadAsFreshOwner below) — NOT a general "stable tab id",
 *  on purpose. Only meaningful for the heartbeat substrate (tabWriteGuard.ts)
 *  — the Web Locks substrate (webLocksTabGuard.ts) has no notion of "tab
 *  identity" for lock ownership at all (a reload just releases and the fresh
 *  document re-queues; the browser doesn't care whose document it is), so it
 *  accepts a `tabId` option for interface parity but doesn't rely on it for
 *  correctness. This handoff still runs unconditionally for both substrates
 *  since it's harmless either way, and keeps this code substrate-agnostic.
 *
 *  A naive "persist the tabId in sessionStorage for the tab's whole
 *  lifetime" is unsafe FOR THE HEARTBEAT SUBSTRATE: browsers COPY
 *  sessionStorage when a tab is duplicated (right-click "Duplicate Tab", or
 *  any opener-based new tab), so a long-lived persisted id would be silently
 *  shared by both copies — `TabWriteGuard` would treat
 *  `record.tabId === this._tabId` as "this is still my own lock" in BOTH
 *  tabs, and the single-writer guarantee this whole module exists for would
 *  be defeated by the single most common way users make a second tab
 *  (codex-review P1, round 3).
 *
 *  Instead, every ordinary page load gets a fresh random tabId (via
 *  `TabWriteGuard`'s own default) — genuinely unique per real tab, so a
 *  duplicated tab immediately diverges. The ONE exception: right before a
 *  blocked→owner reload, the current tabId is written here, then READ AND
 *  IMMEDIATELY DELETED on the very next load. Once consumed it can never be
 *  read again — not by a later reload of this same tab, and not by any tab
 *  duplicated after this point — so the only way it could ever end up in
 *  two places is a browser "duplicate tab" landing inside the
 *  sub-millisecond window between the reload() call and this key's
 *  synchronous consumption on the next load, which isn't a real user action
 *  a duplicate-tab click can hit. */
const TAB_TAKEOVER_HANDOFF_KEY = 'lantern:tab-takeover-handoff';

function consumeTakeoverHandoffTabId(): string | undefined {
  const handoff = window.sessionStorage.getItem(TAB_TAKEOVER_HANDOFF_KEY);
  if (handoff === null) return undefined;
  window.sessionStorage.removeItem(TAB_TAKEOVER_HANDOFF_KEY);
  return handoff;
}

/** Constructing the guard also primes it with a checkNow() call. Under the
 *  heartbeat substrate this is a synchronous re-evaluation, so the very
 *  first render already reports the right status — otherwise a lone tab
 *  would flash the "blocked" gate for one frame until the mount effect below
 *  got a chance to run start(). Under the Web Locks substrate checkNow() is
 *  a no-op (see webLocksTabGuard.ts) — that substrate's own start() is
 *  always asynchronous by nature of the Web Locks API, so a lone tab
 *  reports 'blocked' for one microtask regardless; this call is harmless
 *  there, just not load-bearing. Either way it's idempotent and safe to call
 *  from render (via getSnapshot) under React 18 Strict Mode's double-invoke.
 *  Only ever reached from an `enabled` branch, so desktop and test mode
 *  never touch localStorage (or navigator.locks) at all. */
function getSharedGuard(): TabLockGuard {
  if (!sharedGuard) {
    const handoffTabId = consumeTakeoverHandoffTabId();
    sharedGuard = createTabGuard(SK_TAB_LOCK, handoffTabId ? { tabId: handoffTabId } : {});
    sharedGuard.checkNow();
  }
  return sharedGuard;
}

/** BroadcastChannel used for the takeover flush-and-ack handshake (round 5
 *  P1 below). Same module-singleton pattern as the guard itself. Some very
 *  old browsers lack BroadcastChannel; requestTakeover degrades to
 *  proceeding immediately (no ack to wait for) rather than failing. */
let sharedFlushChannel: FlushAckChannel | null | undefined;

function getSharedFlushChannel(): FlushAckChannel | null {
  if (sharedFlushChannel === undefined) {
    sharedFlushChannel = typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel('lantern:tab-write-guard-flush')
      : null;
  }
  return sharedFlushChannel;
}

/** requestTakeover()/an automatic reclaim triggers window.location.reload(),
 *  which fires a non-persisted `pagehide` on THIS tab before the reload
 *  lands. Without this flag, that pagehide's normal "release the lock on
 *  real close" handling would immediately clearIfMine() the lock this tab
 *  just claimed — opening a gap for another tab's heartbeat to reclaim it
 *  before the reloaded page gets a chance to run its own checkNow(), so the
 *  reloaded tab would come back seeing its own takeover as a foreign lock
 *  and gate itself again. Set right before the reload; a fresh reload never
 *  needs it reset (the module reloads too), but __resetTabWriteGuardForTests
 *  clears it for test isolation within one file. */
let takingOver = false;

/** Test seam: reset the shared instance (each real tab only ever gets one —
 *  this only matters for test isolation across renderHook calls in one file).
 *  Releases the current guard's lock first, since in a real tab this only
 *  ever happens because the tab is gone. */
export function __resetTabWriteGuardForTests(): void {
  sharedGuard?.stop();
  sharedGuard = null;
  takingOver = false;
  sharedFlushChannel = undefined;
}

/** Test seam: simulate spawning an INDEPENDENT tab's guard within the same
 *  test file (a fresh module realm, as a real second browser tab would have)
 *  WITHOUT releasing the current guard's lock — unlike
 *  __resetTabWriteGuardForTests, the "current" tab is modeled as still alive
 *  (e.g. testing that a duplicated tab doesn't silently co-own the lock). */
export function __forkTabWriteGuardForTests(): void {
  sharedGuard = null;
  takingOver = false;
}

export interface TabWriteGuardState {
  status: TabGuardStatus;
  requestTakeover: () => void;
}

function noopUnsubscribe(): void {
  // enabled=false: nothing to unsubscribe from.
}

/** Prepare the handoff (stable id + pagehide suppression) and reload. Used
 *  for EVERY blocked→owner transition, not just an explicit takeover click —
 *  see the mount effect's `subscribe` listener below for why the automatic
 *  reclaim path (the old owner closed/went stale, nobody clicked anything)
 *  needs this exact same treatment (codex-review P1, round 5). */
function reloadAsFreshOwner(guard: TabLockGuard): void {
  takingOver = true;
  window.sessionStorage.setItem(TAB_TAKEOVER_HANDOFF_KEY, guard.tabId);
  window.location.reload();
}

/** Whether a `pagehide` with `event.persisted` (a bfcache freeze, not a real
 *  close) should release the lock — extracted as a pure function so this
 *  decision is unit-testable without driving a real WebLocksTabGuard.
 *
 *  False for the heartbeat substrate: it deliberately never releases on
 *  freeze (requestTakeover() can force a takeover regardless of the current
 *  holder's liveness — see releaseOnFreeze()'s doc).
 *
 *  For the Web Locks substrate (releaseOnFreeze() === true), releasing
 *  keeps "Take over" working against a frozen-but-CLEAN tab — without it,
 *  a frozen tab's fully-suspended JS could never respond to a takeover
 *  request (codex-review, round 1 P2). But pagehide handlers cannot
 *  reliably await async work — the browser can freeze/destroy this page
 *  right after the handler returns, regardless of a pending promise (see
 *  useFlushOnExit's own doc for the same constraint). So if this tab has
 *  unsaved (dirty) editor content, this returns false too: another tab
 *  acquiring the real Web Lock right now could read or write before this
 *  tab's best-effort pagehide flush (useFlushOnExit, BUG-046) has actually
 *  landed on disk — a real data-loss window (codex-review finding). While
 *  dirty, the lock stays held exactly like the heartbeat substrate always
 *  holds it; the browser's own auto-release-on-destroy (a true close or
 *  bfcache eviction, not a mere freeze) resolves it safely instead, with no
 *  window where a stale in-flight write can land after a fresher one. */
export function shouldReleaseOnPersistedFreeze(guard: TabLockGuard): boolean {
  if (!guard.releaseOnFreeze()) return false;
  return !useEditorStore.getState().openTabs.some((tab) => tab.isDirty);
}

export interface UseTabWriteGuardOptions {
  /** Called (while this tab is the owner) when another tab asks it to flush
   *  before taking over — see the flush-and-ack handshake below. Passed in
   *  rather than imported directly: this is `platform` layer, and the real
   *  flush lives in `app/fileOps` (`app` sits ABOVE `platform` in the 5-layer
   *  DAG — see ARCHITECTURE.md — so `platform` importing from `app` would be
   *  an upward/backward dependency, machine-enforced against by
   *  tests/unit/architecture-boundaries.test.ts). The caller (App.tsx) wires
   *  in `flushAllDirtyTabs`. */
  onFlushRequested?: () => Promise<void>;
}

/**
 * Wires TabWriteGuard into React via useSyncExternalStore (the store lives
 * outside React — localStorage plus a heartbeat timer — so this avoids the
 * "setState synchronously in an effect" cascading-render anti-pattern that a
 * plain useState+useEffect sync would hit).
 *
 * When `enabled` is false (desktop/Tauri, which already has an OS-level
 * single-instance guard, or test mode, whose harness never simulates two
 * same-origin tabs — see src/app/lifecycle/useTestModeWorkspace.ts), this is
 * a permanent no-op that reports 'owner' and never touches localStorage.
 */
export function useTabWriteGuard(enabled: boolean, options: UseTabWriteGuardOptions = {}): TabWriteGuardState {
  const { onFlushRequested } = options;
  // Options may change as the parent renders. The lock lifecycle is about
  // enabled/disabled ownership, not callback identity: restarting it while
  // holding a real Web Lock looks like contention and can trigger a reload.
  // Keep the responder current without making it a lifecycle dependency.
  const onFlushRequestedRef = useRef(onFlushRequested);
  useEffect(() => {
    onFlushRequestedRef.current = onFlushRequested;
  }, [onFlushRequested]);
  const subscribe = useCallback(
    (onStoreChange: () => void) => (enabled ? getSharedGuard().subscribe(onStoreChange) : noopUnsubscribe),
    [enabled],
  );
  const getSnapshot = useCallback((): TabGuardStatus => (enabled ? getSharedGuard().status : 'owner'), [enabled]);
  const status = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    if (!enabled) return;
    const guard = getSharedGuard();
    guard.start();

    // Every blocked→owner transition — whether an explicit requestTakeover()
    // click OR the OLD owner simply closing/going stale (automatic reclaim)
    // — must go through the SAME reload-before-write path. This tab's
    // zustand/persist stores hydrated from localStorage back when it was
    // still blocked, possibly stale relative to whatever the real owner
    // saved since; mounting AppShell straight onto that stale snapshot would
    // let the very next write persist it, erasing the other tab's real
    // changes. Only the very first ownership determination (this tab was
    // 'owner' from its own initial load, never blocked) is exempt — its
    // hydration and its ownership were established at the same moment, so
    // there's nothing stale to rehydrate. The extra
    // shouldRehydrateOnThisAcquisition() guard exists for the Web Locks
    // substrate specifically: its grant callback is never synchronous, even
    // when uncontended, so a lone tab's very first acquisition ALSO looks
    // like a blocked→owner transition by the time this effect's synchronous
    // `guard.status` read happens — without that extra check, a solo tab
    // would reload every time it loads, forever (see webLocksTabGuard.ts's
    // attemptAcquire() doc). The heartbeat substrate's version of this
    // method always returns true, so this is a no-op there.
    let previousStatus = guard.status;
    const unsubscribeAutoReload = guard.subscribe((next) => {
      if (next === 'owner' && previousStatus === 'blocked' && guard.shouldRehydrateOnThisAcquisition()) {
        reloadAsFreshOwner(guard);
      }
      previousStatus = next;
    });

    // Takeover flush-and-ack (round 5 P1): whenever THIS tab currently owns
    // the lock, respond to another tab's "I'm about to take over" request by
    // flushing dirty edits and acking — so the new owner's reload (gated on
    // requestFlushAck below) is far less likely to land before this tab's
    // in-flight edit is saved. The trailing yieldIfOwner() is a no-op for the
    // heartbeat substrate (whose requestTakeover() forces the takeover
    // unilaterally, with or without this tab's cooperation) but is exactly
    // what lets the Web Locks substrate's waiting requester actually get
    // granted — that substrate has no "force" primitive, so without this
    // call a takeover would just wait forever for this tab to let go on its
    // own (see webLocksTabGuard.ts's module doc). This is why the responder
    // is wired whenever there's a channel at all, NOT only when
    // onFlushRequested is also supplied (codex-review, round 3 P2 finding):
    // onFlushRequested is optional in this hook's contract, and skipping the
    // whole responder without it would silently strand a Web Locks-enabled
    // caller — "Take over" would hang until the owner tab closes for real,
    // whereas the heartbeat substrate degrades gracefully (its forced
    // takeover never depended on this responder in the first place). Flush
    // is best-effort when provided; yielding is not optional.
    const flushChannel = getSharedFlushChannel();
    const unsubscribeFlushResponder = flushChannel
      ? wireFlushResponder(flushChannel, () => guard.status === 'owner', async () => {
          if (onFlushRequestedRef.current) await onFlushRequestedRef.current();
          guard.yieldIfOwner();
        })
      : undefined;

    // `storage` fires in OTHER same-origin tabs (never the one that wrote),
    // so this is how a blocked tab notices the owner released or another tab
    // forced a takeover, without waiting out the heartbeat poll interval.
    const handleStorageEvent = (event: StorageEvent) => {
      if (event.key === null || event.key === SK_TAB_LOCK) guard.checkNow();
    };
    window.addEventListener('storage', handleStorageEvent);

    // Release the lock the instant this tab actually closes/navigates away,
    // so a blocked tab can take over immediately instead of waiting for the
    // lock to go stale. `pagehide` ALSO fires when the browser freezes this
    // page into the back/forward cache (bfcache) rather than destroying it —
    // `event.persisted` distinguishes the two. Whether a frozen tab should
    // release is substrate-dependent (see releaseOnFreeze()'s doc): the
    // heartbeat substrate deliberately doesn't (requestTakeover() can force
    // a takeover regardless), but the Web Locks substrate must (codex-review
    // finding) — its frozen JS can never respond to a takeover request, so
    // without this, "Take over" would hang against any tab that merely
    // navigated away, not just a truly dead one.
    const handlePageHide = (event: PageTransitionEvent) => {
      if (takingOver) return;
      if (!event.persisted) {
        guard.stop();
        return;
      }
      if (shouldReleaseOnPersistedFreeze(guard)) guard.stop();
    };
    window.addEventListener('pagehide', handlePageHide);

    // On restore from bfcache, this component remounts nothing (React never
    // saw the unmount) and the heartbeat timer was frozen the whole time —
    // re-evaluate immediately so a restored tab can't keep showing itself as
    // 'owner' on a lock it stopped maintaining, and picks up a takeover that
    // happened while it was frozen. A substrate that released on freeze
    // (releaseOnFreeze() === true) also needs start() to re-queue —
    // checkNow() alone has nothing to re-evaluate once the lock has
    // actually been let go.
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      guard.checkNow();
      if (guard.releaseOnFreeze()) guard.start();
    };
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      unsubscribeAutoReload();
      unsubscribeFlushResponder?.();
      window.removeEventListener('storage', handleStorageEvent);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      if (!takingOver) guard.stop();
    };
  }, [enabled]);

  return {
    status,
    requestTakeover: () => {
      if (!enabled) return;
      const guard = getSharedGuard();
      const flushChannel = getSharedFlushChannel();
      void (async () => {
        if (flushChannel) {
          // Ask the current owner to flush and wait briefly for its ack
          // before actually claiming the lock, so its in-flight edit is far
          // more likely to be saved before this tab's reload reads the file
          // (round 5 P1). A dead/unresponsive owner can't wedge this
          // forever — proceed anyway once the timeout elapses. Under the
          // Web Locks substrate, the current owner's response to this same
          // request is also what actually releases the lock (see the
          // wireFlushResponder wiring above) — this await mostly just gives
          // it a head start; the guard's own subscribe listener reacts
          // whenever the browser grants the lock, whether that happens
          // before or after this promise settles.
          await requestFlushAck({ channel: flushChannel });
        }
        // Claiming the lock flips status to 'owner', which the mount
        // effect's subscribe listener above turns into a reload —
        // requestTakeover() doesn't need to reload itself. For the Web
        // Locks substrate this is a no-op (this tab has been queued for the
        // lock since start(); there is no force primitive to invoke — see
        // webLocksTabGuard.ts's module doc).
        guard.requestTakeover();
      })();
    },
  };
}
