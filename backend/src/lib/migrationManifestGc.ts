import type { Store } from "./db.ts";

/** How often the relay removes expired migration rows and unused stream leases. */
export const LEGACY_MANIFEST_GC_INTERVAL_MS = 60_000;

/**
 * Remove expired migration bridge rows and unused stream leases now,
 * then keep doing so while the relay runs. The immediate sweep makes both
 * deadlines hold even when no desktop calls a relay endpoint after expiry.
 */
export function startLegacyManifestGc(
  store: Store,
  intervalMs = LEGACY_MANIFEST_GC_INTERVAL_MS,
): ReturnType<typeof setInterval> {
  const purge = () => {
    store.purgeExpiredLegacyManifest();
    store.reclaimInactiveStreamLeases();
  };
  purge();
  const timer = setInterval(purge, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}
