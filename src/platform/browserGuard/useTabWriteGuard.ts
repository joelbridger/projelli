// src/platform/browserGuard/useTabWriteGuard.ts
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { SK_TAB_LOCK } from '@/config/identity';
import { TabWriteGuard, type TabGuardStatus } from './tabWriteGuard';

// One guard per browser tab (module-scoped singleton, not per-component) —
// the lock protocol only makes sense as a single instance contending for one
// localStorage key on behalf of this tab, no matter how many components
// call the hook.
let sharedGuard: TabWriteGuard | null = null;

/** Constructing the guard also primes it (one synchronous checkNow()) so the
 *  very first render already reports the right status — otherwise a lone
 *  tab would flash the "blocked" gate for one frame until the mount effect
 *  below got a chance to run start(). checkNow() is idempotent, so this is
 *  safe to call from render (via getSnapshot) under React 18 Strict Mode's
 *  double-invoke. Only ever reached from an `enabled` branch, so desktop and
 *  test mode never touch localStorage at all. */
function getSharedGuard(): TabWriteGuard {
  if (!sharedGuard) {
    sharedGuard = new TabWriteGuard(SK_TAB_LOCK);
    sharedGuard.checkNow();
  }
  return sharedGuard;
}

/** Test seam: reset the shared instance (each real tab only ever gets one —
 *  this only matters for test isolation across renderHook calls in one file). */
export function __resetTabWriteGuardForTests(): void {
  sharedGuard?.stop();
  sharedGuard = null;
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
    // lock to go stale.
    const handlePageHide = () => {
      guard.stop();
    };
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.removeEventListener('storage', handleStorageEvent);
      window.removeEventListener('pagehide', handlePageHide);
      guard.stop();
    };
  }, [enabled]);

  return {
    status,
    requestTakeover: () => {
      if (enabled) getSharedGuard().requestTakeover();
    },
  };
}
