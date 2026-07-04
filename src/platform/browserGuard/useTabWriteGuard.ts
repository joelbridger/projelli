// src/platform/browserGuard/useTabWriteGuard.ts
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { SK_TAB_LOCK } from '@/config/identity';
import { TabWriteGuard, type TabGuardStatus } from './tabWriteGuard';

// One guard per browser tab (module-scoped singleton, not per-component) —
// the lock protocol only makes sense as a single instance contending for one
// localStorage key on behalf of this tab, no matter how many components
// call the hook.
let sharedGuard: TabWriteGuard | null = null;

/** sessionStorage (unlike localStorage) is NOT shared across tabs even on the
 *  same origin, and survives a reload of the SAME tab — exactly the "this
 *  browser tab, across its whole lifetime" scope a stable tabId needs. Used
 *  so this tab still recognizes a lock it just claimed via requestTakeover
 *  after the reload that follows (see requestTakeover below) — without this,
 *  the reload would mint a brand-new random tabId that doesn't match the
 *  record it just wrote, and the tab would see its own fresh lock as
 *  foreign and gate itself again. */
const TAB_SESSION_ID_KEY = 'lantern:tab-session-id';

function getOrCreateTabId(): string {
  const existing = window.sessionStorage.getItem(TAB_SESSION_ID_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(TAB_SESSION_ID_KEY, created);
  return created;
}

/** Constructing the guard also primes it (one synchronous checkNow()) so the
 *  very first render already reports the right status — otherwise a lone
 *  tab would flash the "blocked" gate for one frame until the mount effect
 *  below got a chance to run start(). checkNow() is idempotent, so this is
 *  safe to call from render (via getSnapshot) under React 18 Strict Mode's
 *  double-invoke. Only ever reached from an `enabled` branch, so desktop and
 *  test mode never touch localStorage at all. */
function getSharedGuard(): TabWriteGuard {
  if (!sharedGuard) {
    sharedGuard = new TabWriteGuard(SK_TAB_LOCK, { tabId: getOrCreateTabId() });
    sharedGuard.checkNow();
  }
  return sharedGuard;
}

/** requestTakeover() calls `window.location.reload()`, which fires a
 *  non-persisted `pagehide` on THIS tab before the reload lands. Without
 *  this flag, that pagehide's normal "release the lock on real close"
 *  handling would immediately clearIfMine() the lock this tab just claimed —
 *  opening a gap for another tab's heartbeat to reclaim it before the
 *  reloaded page gets a chance to run its own checkNow(), so the reloaded
 *  tab would come back seeing its own takeover as a foreign lock and gate
 *  itself again. Set right before the reload; a fresh reload never needs it
 *  reset (the module reloads too), but __resetTabWriteGuardForTests clears
 *  it for test isolation within one file. */
let takingOver = false;

/** Test seam: reset the shared instance (each real tab only ever gets one —
 *  this only matters for test isolation across renderHook calls in one file). */
export function __resetTabWriteGuardForTests(): void {
  sharedGuard?.stop();
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
export function useTabWriteGuard(enabled: boolean): TabWriteGuardState {
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
    // `event.persisted` distinguishes the two. A bfcache-frozen tab doesn't
    // run its heartbeat timer (JS is suspended), so releasing here would be
    // correct too, but doing nothing is simpler and self-correcting: the
    // frozen tab's lock just goes stale on its own if another tab needs it.
    const handlePageHide = (event: PageTransitionEvent) => {
      if (!event.persisted && !takingOver) guard.stop();
    };
    window.addEventListener('pagehide', handlePageHide);

    // On restore from bfcache, this component remounts nothing (React never
    // saw the unmount) and the heartbeat timer was frozen the whole time —
    // re-evaluate immediately so a restored tab can't keep showing itself as
    // 'owner' on a lock it stopped maintaining, and picks up a takeover that
    // happened while it was frozen.
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) guard.checkNow();
    };
    window.addEventListener('pageshow', handlePageShow);

    return () => {
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
      // Set BEFORE requestTakeover()/reload() — the reload's pagehide can
      // fire before this call returns, and handlePageHide/the effect
      // cleanup must see this already true or they'd release the lock this
      // call is about to claim (see the `takingOver` doc comment above).
      takingOver = true;
      getSharedGuard().requestTakeover();
      // This blocked tab's zustand/persist stores hydrated from localStorage
      // whenever THIS tab first loaded — possibly stale relative to whatever
      // the other (real owner) tab has saved since. Mounting AppShell
      // straight onto that stale in-memory snapshot would let the very next
      // write persist it, erasing the other tab's real changes — the same
      // class of silent data loss this whole gate exists to prevent. A full
      // reload re-hydrates every persisted store from CURRENT localStorage
      // before this tab is allowed to write anything (codex-review P1).
      window.location.reload();
    },
  };
}
