import type { Store } from "./db.ts";

/** How often the relay reclaims unused stream-allocation leases. */
export const STREAM_LEASE_GC_INTERVAL_MS = 60_000;

/**
 * Reclaim unused stream leases now, then periodically while the relay runs.
 * A stream that has accepted ciphertext is never eligible for reclamation.
 */
export function startStreamLeaseGc(
  store: Store,
  intervalMs = STREAM_LEASE_GC_INTERVAL_MS,
): ReturnType<typeof setInterval> {
  const reclaim = () => { store.reclaimInactiveStreamLeases(); };
  reclaim();
  const timer = setInterval(reclaim, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}
